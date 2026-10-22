import type { Song } from '@nomad/api-kjbox';

import { appStorage } from '../../storage';
import { useNightStore, type ActiveNight } from '../nightStore';

/**
 * A make submit whose outcome is still unknown (it was sent and no clear answer came back: the singer left, the box
 * timed out, the retry budget ran out). Kept per account and night, keyed on the song the singer asked for, so making
 * the same song again reuses the same client_request_id and source (the box replays it for 24 h) instead of starting
 * a second gen job from a fresh search. Cleared when the send clearly succeeded or clearly failed, or when /me shows
 * the make-it row; dropped after the box's 24 h replay window; other nights' records are purged (app open, night
 * change).
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
/** The box replays a client_request_id for 24 h; past that, resending it could make a second job, so forget it. */
export const PENDING_MAKE_TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'tonight.make.pending.v1.';
const storeKey = (userKey: string | null, nightId: string) => `${PREFIX}${userKey ?? 'anon'}.${nightId}`;
/** Every pending-make key written (MMKV has no prefix scan here): `[storage key, night id]`. */
const INDEX_KEY = 'tonight.make.pending.index.v1';

function loadIndex(): [string, string][] {
  try {
    const v: unknown = JSON.parse(appStorage.getString(INDEX_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') : [];
  } catch {
    return [];
  }
}
function saveIndex(index: [string, string][]) {
  if (index.length === 0) appStorage.remove(INDEX_KEY);
  else appStorage.set(INDEX_KEY, JSON.stringify(index));
}

/** Removes every pending-make record not of `nightId` (null: all of them), for every account. */
export function purgePendingMakes(nightId: string | null): void {
  const keep: [string, string][] = [];
  for (const [key, night] of loadIndex()) {
    if (nightId !== null && night === nightId) keep.push([key, night]);
    else appStorage.remove(key);
  }
  saveIndex(keep);
}

const nomadNightId = (a: ActiveNight | null) => (a?.kind === 'nomad' ? a.nightId : null);

/**
 * Purges other nights' records now (app open) and whenever the active night changes. Returns the unsubscribe.
 * Installed once from the Tonight tab's module.
 */
export function installPendingMakePurge(): () => void {
  purgePendingMakes(nomadNightId(useNightStore.getState().active));
  return useNightStore.subscribe((s, prev) => {
    const id = nomadNightId(s.active);
    if (id !== nomadNightId(prev.active)) purgePendingMakes(id);
  });
}
/** The song the singer asked for (before any judge correction) and who it's for. */
export const pendingKey = (w: Wanted) => JSON.stringify([norm(w.artist), norm(w.title), norm(w.friend)]);

/** This account's records for the night, without any past the 24 h replay window (those are purged). */
function load(userKey: string | null, nightId: string): Record<string, PendingMake> {
  let all: Record<string, PendingMake>;
  try {
    const raw = appStorage.getString(storeKey(userKey, nightId));
    const v: unknown = raw ? JSON.parse(raw) : {};
    all = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, PendingMake>) : {};
  } catch {
    all = {};
  }
  const cutoff = Date.now() - PENDING_MAKE_TTL_MS;
  const fresh = Object.fromEntries(Object.entries(all).filter(([, p]) => typeof p?.at === 'number' && p.at >= cutoff));
  if (Object.keys(fresh).length !== Object.keys(all).length) save(userKey, nightId, fresh);
  return fresh;
}

function save(userKey: string | null, nightId: string, all: Record<string, PendingMake>) {
  const key = storeKey(userKey, nightId);
  const index = loadIndex().filter(([k]) => k !== key);
  if (Object.keys(all).length === 0) {
    appStorage.remove(key);
  } else {
    appStorage.set(key, JSON.stringify(all));
    index.push([key, nightId]);
  }
  saveIndex(index);
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

/** Same stored source: a resend may reuse the record's id (a different pick gets a new one). */
export const sameSource = (a: PendingMake['sourceMeta'], b: PendingMake['sourceMeta']) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

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
