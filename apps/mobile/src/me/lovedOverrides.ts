import type { PendingLoves } from '@nomad/core';
import { create } from 'zustand';

/**
 * Loves made this session that the cached library hasn't seen yet. Discover's hearts and Me's saves both write here
 * (and read it), so the two views always agree. `at` lets a library fetch that started later drop the override.
 */
export type LovedOverride = PendingLoves[string] & { at: number };

type Store = {
  byKey: Record<string, LovedOverride>;
  set(song: { song_key: string; artist: string; title: string }, loved: boolean): void;
  /** Removes an override only if it is still the one set at `at` (a failed love rolling back). */
  unset(songKey: string, at?: number): void;
  /** Drops overrides set before `before` (the library was fetched after them). */
  settle(before: number): void;
  clear(): void;
};

export const useLovedOverrides = create<Store>((set, get) => ({
  byKey: {},
  set: (song, loved) =>
    set({ byKey: { ...get().byKey, [song.song_key]: { loved, artist: song.artist, title: song.title, song_key: song.song_key, at: Date.now() } } }),
  unset: (songKey, at) => {
    const cur = get().byKey[songKey];
    if (!cur || (at !== undefined && cur.at !== at)) return;
    const { [songKey]: _gone, ...rest } = get().byKey;
    set({ byKey: rest });
  },
  settle: (before) =>
    set({ byKey: Object.fromEntries(Object.entries(get().byKey).filter(([, o]) => o.at >= before)) }),
  clear: () => set({ byKey: {} }),
}));
