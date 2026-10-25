import { ApiError, getLibrary } from '@nomad/api-decide';
import { overlayLibrary, type MeSong } from '@nomad/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useLogStore } from '../tonight/log/logStore';
import { useOutbox } from '../tonight/log/outbox';
import { libraryStorageKey, useUserKey, writeCacheFor } from './account';
import { isObj, readCache } from './cache';
import { useLovedOverrides } from './lovedOverrides';
import { useMeOutbox } from './meOutbox';
import { pendingLoves, pendingLog, pendingSetlists, toMeSong } from './pending';

export type LibraryCache = { etag: string; items: MeSong[]; savedAt: number };
const isCache = (v: unknown): v is LibraryCache => isObj(v) && typeof v.etag === 'string' && Array.isArray(v.items) && typeof v.savedAt === 'number';

export const libraryKeyFor = (userKey: string | null) => ['decide', userKey, 'library'] as const;

/** Invalidates the library and setlist queries whenever an outbox lands a write (shared by both hooks). */
export function useInvalidateOnSynced(keys: (readonly unknown[])[]): void {
  const queryClient = useQueryClient();
  const tonight = useOutbox((s) => s.synced);
  const me = useMeOutbox((s) => s.synced);
  const seen = useRef({ tonight, me });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { tonight, me };
    if (prev.tonight === tonight && prev.me === me) return;
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys are stable per user
  }, [queryClient, tonight, me]);
}

/**
 * The singer's library: the cached server items (MMKV, revalidated by etag) overlaid with everything still waiting
 * in the outboxes, so a log, love or setlist change shows at once and offline.
 */
export function useLibrary(): { items: MeSong[]; loading: boolean; offline: boolean; error: boolean; refetch(): void } {
  const queryClient = useQueryClient();
  const userKey = useUserKey();
  const queryKey = useMemo(() => libraryKeyFor(userKey), [userKey]);
  const cached = useMemo(() => readCache(userKey && libraryStorageKey(userKey), isCache), [userKey]);

  const q = useQuery<LibraryCache>({
    queryKey,
    enabled: userKey !== null,
    initialData: cached,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const startedAt = Date.now();
      const prev = queryClient.getQueryData<LibraryCache>(queryKey);
      const res = await getLibrary(prev?.etag);
      let next: LibraryCache;
      if (res.status === 'not-modified' && prev) next = { ...prev, savedAt: Date.now() };
      else if (res.status === 'ok') next = { etag: res.etag, items: res.items.map(toMeSong), savedAt: Date.now() };
      else {
        // 304 with nothing cached: fetch it fresh
        const full = await getLibrary();
        if (full.status !== 'ok') throw new Error('library unavailable');
        next = { etag: full.etag, items: full.items.map(toMeSong), savedAt: Date.now() };
      }
      if (userKey) writeCacheFor(userKey, libraryStorageKey(userKey), next);
      useLovedOverrides.getState().settle(startedAt);
      return next;
    },
  });

  useInvalidateOnSynced([queryKey]);

  const logItems = useOutbox((s) => s.items);
  const logEntries = useLogStore((s) => s.entries);
  const meItems = useMeOutbox((s) => s.items);
  const overrides = useLovedOverrides((s) => s.byKey);
  const base = q.data?.items;
  const items = useMemo(
    () =>
      overlayLibrary(base ?? [], {
        log: pendingLog(logItems, logEntries),
        loves: { ...overrides, ...pendingLoves(meItems) },
        setlists: pendingSetlists(meItems),
      }),
    [base, logItems, logEntries, meItems, overrides],
  );

  const offline = q.isError && q.error instanceof ApiError && q.error.status === 0;
  return {
    items,
    loading: userKey !== null && q.data === undefined && q.isFetching,
    offline,
    error: q.isError && !offline && q.data === undefined,
    refetch: () => void q.refetch(),
  };
}
