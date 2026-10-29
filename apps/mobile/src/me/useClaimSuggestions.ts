import { claimHistory, getHistorySuggestions, KjboxError, type HistoryNight, type HistorySuggestions } from '@nomad/api-kjbox';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { create } from 'zustand';

import { useOffline } from '../net/useOffline';
import { currentUserKey, useUserKey } from './account';
import { libraryKeyFor, markLibraryCacheStale } from './useLibrary';
import { logMirrorKeyFor } from './useLogMirror';

/**
 * "Were these you?" (spec §6.10): past Nomad nights at the box with songs sung under a name like the account's.
 * The query is memory-only and per account (R39): it holds other singers' names and a claim needs the box anyway, so
 * it is never cached on the phone, and useClearMeOnAccountChange removes it on any account change.
 */
export const suggestionsKeyFor = (userKey: string | null) => ['kjbox', userKey, 'history-suggestions'] as const;

/** kjbox's outbox delivers claimed songs to decide asynchronously (R42): refetch Me's library and log mirror then. */
export const CLAIM_REFETCH_DELAYS_MS = [10_000, 30_000] as const;

const TEN_MIN = 10 * 60_000;

export type ClaimOutcome =
  | { saved: number; alreadySaved: number; taken: number; takenIds: number[]; rejected: number }
  | { error: 'offline' | 'failed' };

type ClaimAnswered = {
  /** Nights answered this session, per account (hidden at once, before the refetch lands). */
  byUser: Record<string, Record<string, true>>;
  markAnswered(userKey: string, nightId: string): void;
  /** Account change: none of this belongs to the next person (also drops the pending refetch timers). */
  clear(): void;
};

const timers = new Set<ReturnType<typeof setTimeout>>();
/** One claim in flight per account and night: a double-tapped Save gets the first tap's promise. */
const inFlight = new Map<string, Promise<ClaimOutcome>>();

export const useClaimAnswered = create<ClaimAnswered>((set) => ({
  byUser: {},
  markAnswered(userKey, nightId) {
    set((s) => ({ byUser: { ...s.byUser, [userKey]: { ...s.byUser[userKey], [nightId]: true } } }));
  },
  clear() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    set({ byUser: {} });
  },
}));

/** Fetch threw or a gateway answered with no JSON (timeout, tunnel down): the claim may or may not have landed. */
const isUnreachable = (e: unknown) => e instanceof KjboxError && e.unreachable;

function scheduleMeRefetch(queryClient: QueryClient, owner: string): void {
  for (const ms of CLAIM_REFETCH_DELAYS_MS) {
    const t = setTimeout(() => {
      timers.delete(t);
      if (currentUserKey() !== owner) return;
      void queryClient.invalidateQueries({ queryKey: libraryKeyFor(owner) });
      void queryClient.invalidateQueries({ queryKey: logMirrorKeyFor(owner) });
    }, ms);
    timers.add(t);
  }
}

/**
 * A failed claim may mean the list is out of date (another device or account took a song, the night changed, a
 * claim landed but its answer was lost). `invalid` / `not_found`: refetch now, so a stale list can't keep failing.
 * Unreachable after the retry: only mark it stale (refetched on the next mount), since a refetch now would fail too
 * and hide the card with its error line. Other answers (429, 401, 503) leave it alone.
 */
function staleAfterFailure(queryClient: QueryClient, owner: string, e: unknown): void {
  if (!(e instanceof KjboxError)) return;
  const queryKey = suggestionsKeyFor(owner);
  if (e.unreachable) void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
  else if (e.code === 'invalid' || e.code === 'not_found') void queryClient.invalidateQueries({ queryKey });
}

async function sendClaim(nightId: string, mine: number[], notMine: number[]) {
  try {
    return await claimHistory(nightId, mine, notMine);
  } catch (e) {
    // The server is idempotent (R44): one retry with the same body after a timeout or an unreachable box.
    if (!isUnreachable(e)) throw e;
    return await claimHistory(nightId, mine, notMine);
  }
}

export function useClaimSuggestions(): {
  nights: HistoryNight[];
  more: number;
  visible: boolean;
  /** The first fetch is still running (nothing to show yet). */
  loading: boolean;
  claim(night: HistoryNight, ticked: number[]): Promise<ClaimOutcome>;
} {
  const queryClient = useQueryClient();
  const userKey = useUserKey();
  const offline = useOffline();
  const queryKey = useMemo(() => suggestionsKeyFor(userKey), [userKey]);

  const q = useQuery<HistorySuggestions>({
    queryKey,
    queryFn: () => getHistorySuggestions(),
    enabled: userKey !== null && !offline,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN,
    retry: false,
  });

  const answered = useClaimAnswered((s) => (userKey ? s.byUser[userKey] : undefined));
  const nights = useMemo(() => {
    // Any error (unreachable, an older box's 404, 401/503, 429, a malformed reply) shows nothing, never an error UI.
    if (userKey === null || offline || q.isError || !q.data) return [];
    return q.data.nights.filter((n) => !answered?.[n.night_id]);
  }, [userKey, offline, q.isError, q.data, answered]);
  const more = nights.length > 0 ? (q.data?.more_nights ?? 0) : 0;

  const claim = useCallback(
    (night: HistoryNight, ticked: number[]): Promise<ClaimOutcome> => {
      const owner = currentUserKey();
      if (!owner) return Promise.resolve({ error: 'failed' });
      if (offline) return Promise.resolve({ error: 'offline' });
      const flightKey = `${owner}:${night.night_id}`;
      const running = inFlight.get(flightKey);
      if (running) return running;

      // R33: songs left unticked on Save are "not mine". While the list is fresh every listed song is still
      // claimable, so not_mine never names a song the account holds (R51: the server rejects that as invalid; a
      // failed claim refreshes the list, below).
      const ids = night.songs.map((s) => s.entry_id);
      const pick = new Set(ticked);
      const mine = ids.filter((id) => pick.has(id));
      const notMine = ids.filter((id) => !pick.has(id));

      const run = (async (): Promise<ClaimOutcome> => {
        try {
          const r = await sendClaim(night.night_id, mine, notMine);
          if (currentUserKey() !== owner) return { error: 'failed' };
          useClaimAnswered.getState().markAnswered(owner, night.night_id);
          void queryClient.invalidateQueries({ queryKey: suggestionsKeyFor(owner) });
          scheduleMeRefetch(queryClient, owner);
          // The timers die with the app: a relaunch before them must still fetch the library (the log mirror
          // already syncs on every launch).
          markLibraryCacheStale(owner);
          return { saved: r.saved, alreadySaved: r.already_saved, taken: r.taken.length, takenIds: r.taken, rejected: r.rejected };
        } catch (e) {
          if (currentUserKey() === owner) staleAfterFailure(queryClient, owner, e);
          return { error: 'failed' };
        } finally {
          inFlight.delete(flightKey);
        }
      })();
      inFlight.set(flightKey, run);
      return run;
    },
    [offline, queryClient],
  );

  return { nights, more, visible: nights.length > 0, loading: q.isLoading, claim };
}
