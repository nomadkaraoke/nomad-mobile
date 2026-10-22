import { hideSong, loveSong, unhideSong, type RecSong } from '@nomad/api-decide';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { RECS_KEY, type RecsPages } from './useRecommendations';

/** How long the "Hidden from your picks · Undo" toast stays up. */
export const HIDDEN_TOAST_MS = 5_000;

/** Where a removed song sat: put back at the same spot on undo or a failed hide. */
type Spot = { page: number; section: string; index: number };
type Removed = { queryKey: QueryKey; spots: Spot[] };

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
  // song_key -> what hiding it removed, and the hide request (an undo waits for it).
  const pending = useRef(new Map<string, { removed: Removed[]; request: Promise<unknown> }>());

  useEffect(() => {
    if (!hidden) return;
    const timer = setTimeout(() => setHidden(null), HIDDEN_TOAST_MS);
    return () => clearTimeout(timer);
  }, [hidden]);

  const hide = useCallback(
    (song: RecSong) => {
      const key = song.song_key;
      void queryClient.cancelQueries({ queryKey: RECS_KEY });
      const removed = removeEverywhere(queryClient, key);
      setHidden(song);
      const request = hideSong(key, { artist: song.artist, title: song.title }).catch(() => {
        // Only roll back if this hide is still the live one (no undo in between).
        if (pending.current.get(key)?.request !== request) return;
        pending.current.delete(key);
        putBack(queryClient, song, removed);
        setHidden((h) => (h?.song_key === key ? null : h));
      });
      pending.current.set(key, { removed, request });
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
      putBack(queryClient, song, entry.removed);
      // After the hide has landed, so decide never sees the unhide first.
      void entry.request.then(() => unhideSong(key)).catch(() => {
        removeEverywhere(queryClient, key); // decide still has it hidden
      });
    },
    [queryClient],
  );

  const love = useCallback((song: RecSong) => {
    const key = song.song_key;
    setLoved((s) => new Set(s).add(key));
    loveSong(key, { artist: song.artist, title: song.title }).catch(() => {
      setLoved((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    });
  }, []);

  return { hide, love, undoHide, hidden, loved, dismissHidden: () => setHidden(null) };
}
