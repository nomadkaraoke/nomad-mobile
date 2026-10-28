import { ApiError, getGetMade, type GetMadeItem } from '@nomad/api-decide';
import { listBoardRequests, submitSongRequest, type SongRequestPublic } from '@nomad/api-gen';
import { jobPhase, songKey } from '@nomad/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAuth } from '../auth/store';
import { useMyJobs } from '../jobs/useMyJobs';
import { useOffline } from '../net/useOffline';
import { getMadeStorageKey, useUserKey, writeCacheFor } from './account';
import { isObj, readCache } from './cache';
import { BOARD_QUERY_KEY, useGetMadeLocal, type RequestState } from './getMadeLocal';
import { useMeOutbox, type MeOutboxItem } from './meOutbox';
import { useInvalidateOnSynced } from './useLibrary';

export type GetMadeCache = { items: GetMadeItem[]; savedAt: number };
const isCache = (v: unknown): v is GetMadeCache => isObj(v) && Array.isArray(v.items) && typeof v.savedAt === 'number';

export const getMadeKeyFor = (userKey: string | null) => ['decide', userKey, 'get-made'] as const;

/**
 * A Get this made row: decide's item, plus the requests board's vote count when the song is already on the board,
 * and what "Request it free" can do for it (null: it can be requested).
 */
export type GetMadeRow = GetMadeItem & {
  boardVotes: number | null;
  request: RequestState | null;
};

const BOARD_STALE_MS = 5 * 60_000;

/** Dismissals still waiting in the Me outbox (they survive an app restart; the memory overrides don't). */
function pendingDismissals(items: MeOutboxItem[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const it of items) if (it.op === 'dismiss') out.set(it.dismissKey, it.dismissed);
  return out;
}

/** Puts rows the server list no longer has (an undo after a refetch) back in weight order. */
function withRestored(server: GetMadeItem[], restored: GetMadeItem[]): GetMadeItem[] {
  const out = [...server];
  for (const r of restored) {
    if (out.some((x) => x.key === r.key)) continue;
    const at = out.findIndex((x) => x.weight < r.weight);
    out.splice(at < 0 ? out.length : at, 0, r);
  }
  return out;
}

/**
 * Get this made (spec §6.9): decide's list of the user's songs with no karaoke version, minus songs the user already
 * made (their gen jobs, by normalised artist|title) and dismissed ones, with board vote counts. Cached per account,
 * so offline shows the last list. Dismiss is optimistic and goes through the Me outbox.
 */
export function useGetMade() {
  const queryClient = useQueryClient();
  const userKey = useUserKey();
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const netOffline = useOffline();
  const queryKey = useMemo(() => getMadeKeyFor(userKey), [userKey]);
  const cached = useMemo(() => readCache(userKey && getMadeStorageKey(userKey), isCache), [userKey]);

  const q = useQuery<GetMadeCache>({
    queryKey,
    enabled: userKey !== null,
    initialData: cached,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const next = { items: await getGetMade(), savedAt: Date.now() };
      if (!signal?.aborted && userKey) writeCacheFor(userKey, getMadeStorageKey(userKey), next);
      return next;
    },
  });
  // A sent dismissal, love or sung log can change the list.
  useInvalidateOnSynced([queryKey]);

  const jobs = useMyJobs(email);
  const board = useQuery({
    queryKey: BOARD_QUERY_KEY,
    queryFn: listBoardRequests,
    enabled: userKey !== null,
    staleTime: BOARD_STALE_MS,
    retry: false,
  });

  const outboxItems = useMeOutbox((s) => s.items);
  const dismissed = useGetMadeLocal((s) => s.dismissed);
  const requests = useGetMadeLocal((s) => s.requests);

  const items = useMemo<GetMadeRow[]>(() => {
    // A failed job didn't make the song; anything else (done, working, waiting on the person) did or will.
    const made = new Set((jobs.data ?? []).filter((j) => jobPhase(j.status) !== 'failed').map((j) => songKey(j.artist, j.title)));
    const onBoard = new Map<string, SongRequestPublic>();
    for (const r of board.data?.requests ?? []) onBoard.set(songKey(r.artist, r.title), r);
    const votedToday = board.data?.votedToday === true;
    const yourVote = board.data?.yourVoteRequestId ?? null;
    const pending = pendingDismissals(outboxItems);
    const restored = Object.values(dismissed).filter((d) => !d.dismissed).map((d) => d.item);
    return withRestored(q.data?.items ?? [], restored)
      .filter((it) => it.title.trim() !== '') // R4: a row needs a real title (never a key)
      .filter((it) => !(dismissed[it.key]?.dismissed ?? pending.get(it.key) ?? false))
      .filter((it) => !made.has(songKey(it.artist, it.title)))
      .map((it) => {
        const match = onBoard.get(songKey(it.artist, it.title)) ?? null;
        let request: RequestState | null = requests[it.key] ?? null;
        if (request?.kind === 'requested' && match) request = { kind: 'requested', votes: match.vote_count };
        if (!request && match && yourVote === match.id) request = { kind: 'requested', votes: match.vote_count };
        // Gen's submit spends the day's one vote: once it's spent elsewhere, say so up front instead of a 409.
        if (!request && votedToday) request = { kind: 'vote_used' };
        return { ...it, boardVotes: match?.vote_count ?? null, request };
      });
  }, [q.data, jobs.data, board.data, outboxItems, dismissed, requests]);

  const findItem = useCallback(
    (key: string): GetMadeItem | undefined =>
      q.data?.items.find((x) => x.key === key) ?? useGetMadeLocal.getState().dismissed[key]?.item,
    [q.data],
  );

  const setDismissed = useCallback(
    (key: string, value: boolean) => {
      const item = findItem(key);
      if (!item) return;
      useGetMadeLocal.getState().setDismissed(item, value);
      useMeOutbox.getState().enqueue({ key: `dismiss:${key}`, op: 'dismiss', dismissKey: key, dismissed: value });
    },
    [findItem],
  );
  const dismiss = useCallback((key: string) => setDismissed(key, true), [setDismissed]);
  const undismiss = useCallback((key: string) => setDismissed(key, false), [setDismissed]);

  /**
   * "Request it free": ONE submit to gen's board, never a vote (gen's submit already spends the day's vote, and a
   * vote after `already_exists` would toggle it off). The outcome is shown on the row.
   */
  const request = useCallback(
    async (row: Pick<GetMadeItem, 'key' | 'artist' | 'title'>) => {
      const local = useGetMadeLocal.getState();
      if (local.requests[row.key]?.kind === 'pending') return;
      local.setRequest(row.key, { kind: 'pending' });
      try {
        const out = await submitSongRequest(row.artist, row.title);
        if (out.status === 'created' || out.status === 'already_exists') {
          useGetMadeLocal.getState().setRequest(row.key, { kind: 'requested', votes: out.request.vote_count });
          void queryClient.invalidateQueries({ queryKey: BOARD_QUERY_KEY });
        } else {
          useGetMadeLocal.getState().setRequest(row.key, { kind: out.status });
        }
      } catch {
        useGetMadeLocal.getState().setRequest(row.key, { kind: 'error' });
      }
    },
    [queryClient],
  );

  const offline = netOffline || (q.isError && q.error instanceof ApiError && q.error.status === 0);
  return {
    items,
    loading: userKey !== null && q.data === undefined && q.isFetching,
    offline,
    dismiss,
    undismiss,
    request,
  };
}
