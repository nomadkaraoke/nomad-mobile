import type { PendingLoves } from '@nomad/core';
import { create } from 'zustand';

import { useMeOutbox } from './meOutbox';

/**
 * Loves made this session that the cached library hasn't seen yet. Discover's hearts and Me's saves both write here
 * (and read it), so the two views always agree. `at` lets a library fetch that started later drop the override.
 */
export type LovedOverride = PendingLoves[string] & { at: number; /** a request for it is still in flight */ hold?: boolean; /** when the in-flight request succeeded */ releasedAt?: number };

type Store = {
  byKey: Record<string, LovedOverride>;
  set(song: { song_key: string; artist: string; title: string }, loved: boolean, hold?: boolean): void;
  /** The in-flight request for this override finished (success): it may now be settled. */
  release(songKey: string, at?: number): void;
  /** Removes an override only if it is still the one set at `at` (a failed love rolling back). */
  unset(songKey: string, at?: number): void;
  /** Drops overrides set before `before` (the library was fetched after them). */
  settle(before: number): void;
  clear(): void;
};

export const useLovedOverrides = create<Store>((set, get) => ({
  byKey: {},
  set: (song, loved, hold = false) =>
    set({ byKey: { ...get().byKey, [song.song_key]: { loved, artist: song.artist, title: song.title, song_key: song.song_key, at: Date.now(), hold } } }),
  release: (songKey, at) => {
    const cur = get().byKey[songKey];
    if (cur && (at === undefined || cur.at === at)) set({ byKey: { ...get().byKey, [songKey]: { ...cur, hold: false, releasedAt: Date.now() } } });
  },
  unset: (songKey, at) => {
    const cur = get().byKey[songKey];
    if (!cur || (at !== undefined && cur.at !== at)) return;
    const { [songKey]: _gone, ...rest } = get().byKey;
    set({ byKey: rest });
  },
  // Kept: newer than the fetch, in flight or finished since the fetch began (Discover: it may predate the love), or still queued in the Me outbox (the server hasn't it yet).
  settle: (before) =>
    set({
      byKey: Object.fromEntries(
        Object.entries(get().byKey).filter(
          ([k, o]) => o.at >= before || o.hold || (o.releasedAt ?? 0) >= before || useMeOutbox.getState().items.some((i) => i.key === `love:${k}`),
        ),
      ),
    }),
  clear: () => set({ byKey: {} }),
}));
