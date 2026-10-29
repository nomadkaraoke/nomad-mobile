import { getRecommendationsV2, type RecSong } from '@nomad/api-decide';
import { DEFAULT_REC_FILTERS, toRecQuery } from '@nomad/core';
import { keepPreviousData, useQuery, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useVoiceStore } from '../voice/voiceStore';
import { currentUserKey, goTosStorageKey, useUserKey, writeCacheFor } from './account';
import { isObj, readCache, writeCache } from './cache';
import { useInvalidateOnSynced } from './useLibrary';

/**
 * decide's go_tos section (null: the response had none), kept per account so offline still shows it. `voice` is the
 * synced voice key it was fetched for: the fits are that profile's, so a cache for another one never seeds a query.
 */
export type GoTosCache = { songs: RecSong[] | null; savedAt: number; voice?: string | null };
const isCache = (v: unknown): v is GoTosCache =>
  isObj(v) &&
  (v.songs === null || Array.isArray(v.songs)) &&
  typeof v.savedAt === 'number' &&
  (v.voice === undefined || v.voice === null || typeof v.voice === 'string');

/** The account's offline go-tos, only if fetched for this voice key (read when a query is created, so never stale). */
const cacheFor = (userKey: string | null, voice: string | null): GoTosCache | undefined => {
  const c = readCache(userKey && goTosStorageKey(userKey), isCache);
  return c && (c.voice ?? null) === voice ? c : undefined;
};

const GO_TOS = 'go_tos';
const KIND = 'recs-gotos';

/** Every recs go-tos query (any account, any voice key). */
export const isRecsGoTosKey = (k: QueryKey): boolean => k[0] === 'decide' && k[2] === KIND;
/** The signed-in account's go-tos queries (another account's are never touched by this one's hide). */
const recsGoTosFilter = (userKey: string | null) => ({
  predicate: (q: { queryKey: QueryKey }) => isRecsGoTosKey(q.queryKey) && q.queryKey[1] === userKey,
});

/**
 * Where a hidden song sat, in a go-tos query or in the offline cache (`queryKey` null), to put it back on undo.
 * `userKey` is the account it was hidden for: an undo after an account change never writes into the new one's cache.
 */
export type GoToSpot = { queryKey: QueryKey | null; index: number; userKey: string };

const without = (c: GoTosCache, songKey: string): { next: GoTosCache; index: number } => {
  const index = c.songs?.findIndex((s) => s.song_key === songKey) ?? -1;
  if (index < 0 || !c.songs) return { next: c, index };
  const songs = c.songs.filter((s) => s.song_key !== songKey);
  return { next: { ...c, songs: songs.length ? songs : null }, index };
};
const withSong = (c: GoTosCache, song: RecSong, index: number): GoTosCache => {
  const songs = [...(c.songs ?? [])];
  if (songs.some((s) => s.song_key === song.song_key)) return c;
  songs.splice(Math.min(index, songs.length), 0, song);
  return { ...c, songs };
};

/**
 * Discover's "Not for me": takes the song out of every go-tos query and the signed-in account's offline cache
 * at once (the Me shelf must not keep a song the singer just hid, online or off). Returns where it was.
 */
export function dropRecsGoTo(queryClient: QueryClient, songKey: string): GoToSpot[] {
  const userKey = currentUserKey();
  if (!userKey) return [];
  const filter = recsGoTosFilter(userKey);
  // A refetch landing now would bring it back; a first load (no data yet) is left alone, as Discover does.
  void queryClient.cancelQueries({ predicate: (q) => filter.predicate(q) && q.state.data !== undefined });
  const spots: GoToSpot[] = [];
  for (const [queryKey, data] of queryClient.getQueriesData<GoTosCache>(filter)) {
    if (!data) continue;
    const { next, index } = without(data, songKey);
    if (index < 0) continue;
    queryClient.setQueryData(queryKey, next);
    spots.push({ queryKey, index, userKey });
  }
  const storageKey = goTosStorageKey(userKey);
  const cached = readCache(storageKey, isCache);
  if (cached) {
    const { next, index } = without(cached, songKey);
    if (index >= 0) {
      writeCache(storageKey, next);
      spots.push({ queryKey: null, index, userKey });
    }
  }
  return spots;
}

/** Undo of a hide (or a hide decide refused): the song goes back where it was. */
export function restoreRecsGoTo(queryClient: QueryClient, song: RecSong, spots: GoToSpot[]): void {
  for (const { queryKey, index, userKey } of spots) {
    if (currentUserKey() !== userKey) continue; // another account now: its data is not this hide's
    if (queryKey) {
      queryClient.setQueryData<GoTosCache>(queryKey, (d) => (d ? withSong(d, song, index) : d));
      continue;
    }
    const storageKey = goTosStorageKey(userKey);
    const cached = readCache(storageKey, isCache);
    if (cached) writeCache(storageKey, withSong(cached, song, index));
  }
}

/** Once decide has a hide or unhide, the go-tos are refetched from it. */
export const invalidateRecsGoTos = (queryClient: QueryClient) =>
  void queryClient.invalidateQueries(recsGoTosFilter(currentUserKey()));

/**
 * The voice profile decide has: a measuredAt once synced. While a new profile is still being sent, the last synced
 * one stays (the fits don't change until decide has it, and the shelf doesn't blank meanwhile).
 */
export function useSyncedVoiceKey(): string | null {
  const v = useVoiceStore((s) => (s.profile ? (s.pending ? undefined : s.profile.measuredAt) : null));
  const [last, setLast] = useState<string | null>(v ?? null);
  if (v !== undefined && v !== last) setLast(v);
  return v === undefined ? last : v;
}

/**
 * The recs `go_tos` section for the Me shelf (spec §6.5 item 3): default filters and any venue library, so the shelf
 * never inherits Discover's filters. Null when there is no section to show (none or an empty one in the response,
 * decide warming or unreachable with nothing cached): the shelf then falls back to the phone's own go-tos.
 */
export function useRecsGoTos(): RecSong[] | null {
  const userKey = useUserKey();
  // A voice profile decide now has changes every row's fit: refetch (Discover does the same for its picks).
  const voice = useSyncedVoiceKey();
  const queryKey = useMemo(() => ['decide', userKey, KIND, voice] as const, [userKey, voice]);
  const q = useQuery<GoTosCache>({
    queryKey,
    enabled: userKey !== null,
    // Read lazily per query: a new voice key gets the cache only if it was fetched for that voice, and a hide
    // since (which rewrote the cache) is already reflected.
    initialData: () => cacheFor(userKey, voice),
    initialDataUpdatedAt: () => cacheFor(userKey, voice)?.savedAt,
    // A new voice key keeps the previous rows on screen until its own land.
    placeholderData: keepPreviousData,
    // Real changes (a sung log or survey reaching decide, a hide) invalidate it; this is only the backstop.
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await getRecommendationsV2(toRecQuery(DEFAULT_REC_FILTERS, 'any'));
      const section = res.sections.find((s) => s.id === GO_TOS);
      const songs = section && section.songs.length > 0 ? section.songs : null;
      const next: GoTosCache = { songs, savedAt: Date.now(), voice };
      if (!signal?.aborted && userKey) writeCacheFor(userKey, goTosStorageKey(userKey), next);
      return next;
    },
  });
  useInvalidateOnSynced([queryKey]);
  return q.data?.songs ?? null;
}
