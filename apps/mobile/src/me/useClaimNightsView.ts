import type { HistoryNight } from '@nomad/api-kjbox';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOffline } from '../net/useOffline';
import { currentUserKey, useUserKey } from './account';
import { useClaimSuggestions, type ClaimOutcome } from './useClaimSuggestions';

/** How long a saved night's inline result stays before the card goes. */
export const CLAIM_RESULT_MS = 5_000;

export type ClaimSaved = Exclude<ClaimOutcome, { error: string }>;
export type ClaimCardStatus = 'idle' | 'busy' | 'error';

export type ClaimNightRow = {
  night: HistoryNight;
  /** Set for a night just saved: the card shows this result until CLAIM_RESULT_MS passes. */
  saved?: ClaimSaved;
  /** The songs the singer unticked (everything is ticked by default). */
  unticked: ReadonlySet<number>;
  status: ClaimCardStatus;
};

const EMPTY: ReadonlySet<number> = new Set();

type ViewState = {
  owner: string | null;
  unticked: Record<string, ReadonlySet<number>>;
  status: Record<string, ClaimCardStatus>;
  saved: Record<string, { night: HistoryNight; outcome: ClaimSaved }>;
};
const fresh = (owner: string | null): ViewState => ({ owner, unticked: {}, status: {}, saved: {} });

/**
 * The card state for "Were these you?" on Me and on /me/past-nights: ticks, busy / error per night, and saved nights
 * kept on screen for a few seconds with their result (the hook hides an answered night at once). Lives in the screen,
 * not the card, so a recycled list cell never carries another night's ticks.
 */
export function useClaimNightsView() {
  const s = useClaimSuggestions();
  const offline = useOffline();
  const userKey = useUserKey();
  // One state object tagged with its owner: after an account change it reads as empty, so none of the previous
  // person's ticks or results stay on screen (and writes for a stale owner start fresh).
  const [view, setView] = useState<ViewState>(() => fresh(userKey));
  const live = view.owner === userKey ? view : fresh(userKey);
  const update = useCallback(
    (fn: (v: ViewState) => Partial<ViewState>) =>
      setView((prev) => {
        const base = prev.owner === currentUserKey() ? prev : fresh(currentUserKey());
        return { ...base, ...fn(base) };
      }),
    [],
  );
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) clearTimeout(t);
      set.clear();
    };
  }, []);

  const toggle = useCallback((nightId: string, entryId: number) => {
    update((v) => {
      const next = new Set(v.unticked[nightId] ?? EMPTY);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return { unticked: { ...v.unticked, [nightId]: next } };
    });
  }, [update]);

  const send = useCallback(
    async (night: HistoryNight, ticked: number[], showResult: boolean) => {
      const id = night.night_id;
      update((v) => ({ status: { ...v.status, [id]: 'busy' } }));
      const out = await s.claim(night, ticked);
      if ('error' in out) {
        update((v) => ({ status: { ...v.status, [id]: 'error' } }));
        return;
      }
      update((v) => ({ status: { ...v.status, [id]: 'idle' } }));
      if (!showResult) return;
      update((v) => ({ saved: { ...v.saved, [id]: { night, outcome: out } } }));
      const t = setTimeout(() => {
        timers.current.delete(t);
        update((v) => {
          const { [id]: _gone, ...rest } = v.saved;
          return { saved: rest };
        });
      }, CLAIM_RESULT_MS);
      timers.current.add(t);
    },
    [s, update],
  );

  const save = useCallback(
    (night: HistoryNight) => {
      const off = live.unticked[night.night_id] ?? EMPTY;
      return send(
        night,
        night.songs.map((x) => x.entry_id).filter((e) => !off.has(e)),
        true,
      );
    },
    [send, live.unticked],
  );
  /** "None of these are me": the whole night as not_mine; the night just leaves (no result line). */
  const none = useCallback((night: HistoryNight) => send(night, [], false), [send]);

  const { unticked, status, saved } = live;
  const rows = useMemo<ClaimNightRow[]>(() => {
    const listed = new Set(s.nights.map((n) => n.night_id));
    const all: { night: HistoryNight; saved?: ClaimSaved }[] = s.nights.map((night) => ({ night, saved: saved[night.night_id]?.outcome }));
    for (const d of Object.values(saved)) if (!listed.has(d.night.night_id)) all.push({ night: d.night, saved: d.outcome });
    // Newest first, as kjbox lists them; a saved night stays where it was.
    all.sort((a, b) => (a.night.date < b.night.date ? 1 : a.night.date > b.night.date ? -1 : 0));
    return all.map((r) => ({
      ...r,
      unticked: unticked[r.night.night_id] ?? EMPTY,
      status: status[r.night.night_id] ?? 'idle',
    }));
  }, [s.nights, saved, unticked, status]);

  return {
    rows,
    /** Every night kjbox has for the account (listed + more_nights), for "See all N nights". */
    total: s.nights.length + s.more,
    more: s.more,
    loading: s.loading,
    offline,
    toggle,
    save,
    none,
  };
}
