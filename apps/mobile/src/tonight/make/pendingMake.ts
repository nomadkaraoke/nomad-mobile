import type { Song } from '@nomad/api-kjbox';

import { appStorage } from '../../storage';

/**
 * A make submit whose outcome is still unknown (it was sent and no clear answer came back: the singer left, the box
 * timed out, the retry budget ran out). Kept per account and night, keyed on the song the singer asked for, so making
 * the same song again reuses the same client_request_id and source (the box replays it for 24 h) instead of starting
 * a second gen job from a fresh search. Cleared when the send clearly succeeded or clearly failed, or when /me shows
 * the make-it row.
 */
export type PendingMake = {
  clientRequestId: string;
  sourceMeta: { search_session_id: string; selection_index: number } | { youtube_url: string };
  /** What was sent (the judge's applied names). */
  songArtist: string;
  songTitle: string;
  at: number;
};

type Wanted = { artist: string; title: string; friend?: string };

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const storeKey = (userKey: string | null, nightId: string) => `tonight.make.pending.v1.${userKey ?? 'anon'}.${nightId}`;
/** The song the singer asked for (before any judge correction) and who it's for. */
export const pendingKey = (w: Wanted) => JSON.stringify([norm(w.artist), norm(w.title), norm(w.friend)]);

function load(userKey: string | null, nightId: string): Record<string, PendingMake> {
  try {
    const raw = appStorage.getString(storeKey(userKey, nightId));
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, PendingMake>) : {};
  } catch {
    return {};
  }
}

function save(userKey: string | null, nightId: string, all: Record<string, PendingMake>) {
  const key = storeKey(userKey, nightId);
  if (Object.keys(all).length === 0) appStorage.remove(key);
  else appStorage.set(key, JSON.stringify(all));
}

export function getPendingMake(userKey: string | null, nightId: string, w: Wanted): PendingMake | null {
  return load(userKey, nightId)[pendingKey(w)] ?? null;
}

export function setPendingMake(userKey: string | null, nightId: string, w: Wanted, p: PendingMake): void {
  save(userKey, nightId, { ...load(userKey, nightId), [pendingKey(w)]: p });
}

export function clearPendingMake(userKey: string | null, nightId: string, w: Wanted): void {
  const all = load(userKey, nightId);
  delete all[pendingKey(w)];
  save(userKey, nightId, all);
}

/** The make-it row in /me for this song (asked-for or sent names), the singer's own or the friend's. */
export function findMakeRow(songs: Song[] | undefined, w: Wanted, p: PendingMake | null): Song | null {
  const names = new Set([JSON.stringify([norm(w.artist), norm(w.title)])]);
  if (p) names.add(JSON.stringify([norm(p.songArtist), norm(p.songTitle)]));
  return (
    (songs ?? []).find((s) => {
      if (s.request.source_type !== 'make') return false;
      if (!names.has(JSON.stringify([norm(s.request.song_artist), norm(s.request.song_title)]))) return false;
      return w.friend ? s.owner === 'friend' && norm(s.request.singer_name) === norm(w.friend) : s.owner === 'me';
    }) ?? null
  );
}
