import { useCallback } from 'react';

import { useLovedOverrides } from './lovedOverrides';
import { useLibrary } from './useLibrary';
import { useMeOutbox } from './meOutbox';

export type SaveSongRef = { artist: string; title: string; song_key: string };

/** Save (love) a song from Me: queued offline-safe, and shared with Discover's hearts through the overrides store. */
export function useSaveSong(): { saved(key: string): boolean; toggle(song: SaveSongRef): void } {
  const { items } = useLibrary();
  const overrides = useLovedOverrides((s) => s.byKey);
  const saved = useCallback(
    (key: string) => overrides[key]?.loved ?? items.find((i) => i.key === key || i.song_key === key)?.loved ?? false,
    [items, overrides],
  );
  const toggle = useCallback(
    (song: SaveSongRef) => {
      const loved = !saved(song.song_key);
      useLovedOverrides.getState().set(song, loved);
      useMeOutbox.getState().enqueue({ key: `love:${song.song_key}`, op: 'love', song_key: song.song_key, artist: song.artist, title: song.title, loved });
    },
    [saved],
  );
  return { saved, toggle };
}
