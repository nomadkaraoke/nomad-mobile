import { listKaraokeLog, type KaraokeLogEntry } from '@nomad/api-decide';
import type { PendingLog } from '@nomad/core';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { logMirrorStorageKey, useUserKey, writeCacheFor } from './account';
import { isObj, readCache } from './cache';

export type Mirror = { entries: KaraokeLogEntry[]; since?: string };
export const isMirror = (v: unknown): v is Mirror => isObj(v) && Array.isArray(v.entries) && (v.since === undefined || typeof v.since === 'string');

/** Under the karaoke-log key family, so `useKaraokeLogFreshness` invalidates it when the log outbox lands a write. */
export const logMirrorKeyFor = (userKey: string | null) => ['decide', userKey, 'karaoke-log', 'mirror'] as const;
const PAGE = 500;

/** Pulls everything changed since `since` (everything, when absent), paging; deleted rows remove entries. */
export async function syncMirror(prev: Mirror): Promise<Mirror> {
  const byId = new Map(prev.entries.map((e) => [e.id, e]));
  let since = prev.since;
  let cursor: string | undefined;
  do {
    // Deliberately `prev.since` (not the running `since`) on every page of one run: the cursor pages through the
    // result set of that one query, so changing `since` mid-run would page a different set.
    const page = await listKaraokeLog({ since: prev.since, limit: PAGE, cursor });
    for (const e of page.entries) {
      if (e.deleted) byId.delete(e.id);
      else byId.set(e.id, e);
      if (e.updated_at && (!since || Date.parse(e.updated_at) > Date.parse(since))) since = e.updated_at;
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return { entries: [...byId.values()], since };
}

/** The singer's whole karaoke log mirrored on the phone (MMKV), refreshed incrementally. */
export function useLogMirror(): { entries: KaraokeLogEntry[] } {
  const userKey = useUserKey();
  const cached = useMemo(() => readCache(userKey && logMirrorStorageKey(userKey), isMirror), [userKey]);
  const q = useQuery<Mirror>({
    queryKey: logMirrorKeyFor(userKey),
    enabled: userKey !== null,
    initialData: cached,
    // The cache is a seed, not fresh data: the incremental `since` sync still runs on mount (cold start).
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const key = userKey!;
      const prev = readCache(logMirrorStorageKey(key), isMirror) ?? { entries: [] };
      const next = await syncMirror(prev);
      writeCacheFor(key, logMirrorStorageKey(key), next);
      return next;
    },
  });
  return { entries: q.data?.entries ?? [] };
}

/** Mirror entries as the records `karaokeStats` reads (nulls from the wire become absent fields). */
export function toPendingLog(entries: KaraokeLogEntry[]): PendingLog[] {
  return entries.map((e) => ({
    id: e.id,
    artist: e.artist ?? '',
    title: e.title ?? '',
    song_key: e.song_key ?? null,
    state: e.state ?? '',
    times: e.times,
    origin: e.origin ?? undefined,
    deleted: e.deleted,
    sung_at: e.sung_at ?? null,
    survey: e.survey ? ({ ...e.survey, feel: e.survey.feel ?? undefined, key: e.survey.key ?? undefined } as PendingLog['survey']) : undefined,
    night: e.night
      ? { id: e.night.id ?? undefined, date: e.night.date ?? undefined, venue_name: e.night.venue_name ?? undefined, kind: e.night.kind ?? undefined }
      : undefined,
  }));
}

/**
 * id → the feel the server has counted for that record (sung records with a synced survey), from the mirror in the
 * query cache, else the phone's copy. Read on demand (not a subscription): the library overlay asks when a queued
 * survey needs it.
 */
export function syncedFeels(userKey: string | null, client?: QueryClient | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!userKey) return out;
  const mirror = client?.getQueryData<Mirror>(logMirrorKeyFor(userKey)) ?? readCache(logMirrorStorageKey(userKey), isMirror);
  for (const e of mirror?.entries ?? []) {
    if (!e.deleted && (e.state === 'sung' || e.state === 'sung_unplayed') && e.survey?.feel) out.set(e.id, e.survey.feel);
  }
  return out;
}
