import type { MeSong } from '@nomad/core';
import { router, type Href } from 'expo-router';

/** Where a library row goes: the song page for a catalogued song, else its history page (artist and title as params). */
export function songHref(s: Pick<MeSong, 'key' | 'song_key' | 'artist' | 'title'>): Href {
  if (s.song_key) return `/song/${encodeURIComponent(s.song_key)}` as Href;
  return `/me/history/${encodeURIComponent(s.key)}?artist=${encodeURIComponent(s.artist)}&title=${encodeURIComponent(s.title)}` as Href;
}

export const openSongHref = (s: Pick<MeSong, 'key' | 'song_key' | 'artist' | 'title'>) => router.push(songHref(s));
