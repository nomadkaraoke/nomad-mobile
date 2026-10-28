import { hideSong, unhideSong, type RecSong } from '@nomad/api-decide';
import { useQueryClient, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/store';
import { useLovedOverrides } from '../me/lovedOverrides';
import { useMeOutbox } from '../me/meOutbox';
import { RECS_KEY, type RecsPages } from './useRecommendations';

/** How long the "Hidden from your picks · Undo" toast stays up. */
export const HIDDEN_TOAST_MS = 5_000;

/** Where a removed song sat: put back at the same spot on undo or a failed hide. */
type Spot = { page: number; section: string; index: number };
type Removed = { queryKey: QueryKey; spots: Spot[] };

/** Numbers a new action on `key` (a hide or an undo) as the latest one. */
function nextAction(actions: Map<string, number>, key: string): number {
  const n = (actions.get(key) ?? 0) + 1;
  actions.set(key, n);
  return n;
}

/** True while this query is loading another page (an optimistic hide must not cancel that). */
const pagingNow = (q: Query): boolean =>
  q.state.fetchStatus === 'fetching' &&
  Boolean((q.state.fetchMeta as { fetchMore?: unknown } | null | undefined)?.fetchMore);

export function removeSong(data: RecsPages, songKey: string): { data: RecsPages; spots: Spot[] } {
  const spots: Spot[] = [];
  const pages = data.pages.map((page, p) => ({
    ...page,
    sections: page.sections.map((s) => {
      const index = s.songs.findIndex((x) => x.song_key === songKey);
      if (index < 0) return s;
      spots.push({ page: p, section: s.id, index });
      return { ...s, songs: s.songs.filter((x) => x.song_key !== songKey) };
    }),
  }));
  return { data: spots.length ? { ...data, pages } : data, spots };
}

export function insertSong(data: RecsPages, song: RecSong, spots: Spot[]): RecsPages {
  return {
    ...data,
    pages: data.pages.map((page, p) => ({
      ...page,
      sections: page.sections.map((s) => {
        const spot = spots.find((x) => x.page === p && x.section === s.id);
        if (!spot || s.songs.some((x) => x.song_key === song.song_key)) return s;
        const songs = [...s.songs];
        songs.splice(Math.min(spot.index, songs.length), 0, song);
        return { ...s, songs };
      }),
    })),
  };
}

function removeEverywhere(queryClient: QueryClient, songKey: string): Removed[] {
  const removed: Removed[] = [];
  for (const [queryKey, data] of queryClient.getQueriesData<RecsPages>({ queryKey: RECS_KEY })) {
    if (!data) continue;
    const r = removeSong(data, songKey);
    if (r.spots.length === 0) continue;
    queryClient.setQueryData(queryKey, r.data);
    removed.push({ queryKey, spots: r.spots });
  }
  return removed;
}

function putBack(queryClient: QueryClient, song: RecSong, removed: Removed[]) {
  for (const { queryKey, spots } of removed) {
    queryClient.setQueryData<RecsPages>(queryKey, (d) => (d ? insertSong(d, song, spots) : d));
  }
}

/**
 * "Not for me" and "Love it" on a picks row. Hiding takes the song out of every cached picks page at once,
 * shows an undo toast and puts it back if decide refuses; undo puts it back and unhides it.
 */
export function useSongFeedback() {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<RecSong | null>(null);
  const [loved, setLoved] = useState<ReadonlySet<string>>(() => new Set());
  // Loves and the undo toast are this person's: a sign-out or another account starts them over (no stale frame).
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const [owner, setOwner] = useState(email);
  if (owner !== email) {
    setOwner(email);
    setLoved(new Set());
    setHidden(null);
  }
  // song_key -> what hiding it removed, and the raw hide request (an undo waits for it to settle).
  const pending = useRef(new Map<string, { removed: Removed[]; request: Promise<void> }>());
  // song_key -> number of the latest hide/undo: a settled request only acts if its action is still the latest.
  const actions = useRef(new Map<string, number>());

  useEffect(() => {
    if (!hidden) return;
    const timer = setTimeout(() => setHidden(null), HIDDEN_TOAST_MS);
    return () => clearTimeout(timer);
  }, [hidden]);

  const hide = useCallback(
    (song: RecSong) => {
      const key = song.song_key;
      const action = nextAction(actions.current, key);
      // A refetch landing now would bring the song back; a page being loaded is left alone, and so is a first
      // load (no data yet): cancelling it would leave the previous filter's rows standing in (keepPreviousData).
      void queryClient.cancelQueries({
        queryKey: RECS_KEY,
        predicate: (q) => q.state.data !== undefined && !pagingNow(q),
      });
      const removed = removeEverywhere(queryClient, key);
      setHidden(song);
      const request = hideSong(key, { artist: song.artist, title: song.title });
      pending.current.set(key, { removed, request });
      request.catch(() => {
        // Only roll back if this hide is still the latest action (no undo or re-hide in between).
        if (actions.current.get(key) !== action) return;
        pending.current.delete(key);
        putBack(queryClient, song, removed);
        setHidden((h) => (h?.song_key === key ? null : h));
      });
    },
    [queryClient],
  );

  const undoHide = useCallback(
    (song: RecSong) => {
      const key = song.song_key;
      const entry = pending.current.get(key);
      pending.current.delete(key);
      setHidden((h) => (h?.song_key === key ? null : h));
      if (!entry) return;
      const action = nextAction(actions.current, key);
      putBack(queryClient, song, entry.removed);
      // After the hide has settled, so decide never sees the unhide first; skipped if the song was hidden again.
      void entry.request
        .catch(() => {})
        .then(() => (actions.current.get(key) === action ? unhideSong(key) : undefined))
        .catch(() => {
          if (actions.current.get(key) === action) removeEverywhere(queryClient, key); // decide still has it hidden
        });
    },
    [queryClient],
  );

  const love = useCallback((song: RecSong) => {
    const key = song.song_key;
    setLoved((s) => new Set(s).add(key));
    // Me's library and saves see this love at once (and Me's un-save un-hearts it here). The request goes through
    // the Me outbox (one item per song), so a later un-save is ordered after it and never overtaken by it.
    useLovedOverrides.getState().set(song, true);
    useMeOutbox.getState().enqueue({ key: `love:${key}`, op: 'love', song_key: key, artist: song.artist, title: song.title, loved: true });
  }, []);

  // The outbox gave up on a love (permanent error): the heart goes back (librarySettle drops the shared override).
  useEffect(
    () =>
      useMeOutbox.addDroppedListener((item) => {
        if (item.op !== 'love' || !item.loved) return;
        setLoved((s) => {
          if (!s.has(item.song_key)) return s;
          const next = new Set(s);
          next.delete(item.song_key);
          return next;
        });
      }),
    [],
  );

  // Me's saves and un-saves win over this view's own record.
  const overrides = useLovedOverrides((s) => s.byKey);
  // A Me un-save drops the heart for good (the override itself is settled away once decide has it).
  const gone = Object.entries(overrides).filter(([k, o]) => !o.loved && loved.has(k));
  if (gone.length) setLoved((s) => new Set([...s].filter((k) => !gone.some(([g]) => g === k))));
  const merged = useMemo(() => {
    const out = new Set(loved);
    for (const [k, o] of Object.entries(overrides)) {
      if (o.loved) out.add(k);
      else out.delete(k);
    }
    return out as ReadonlySet<string>;
  }, [loved, overrides]);

  return { hide, love, undoHide, hidden, loved: merged };
}
