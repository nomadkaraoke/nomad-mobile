import {
  ApiError,
  getRecommendationsV2,
  isWarmingUp,
  type RecommendationsV2Response,
  type RecSection,
} from '@nomad/api-decide';
import { filtersKey, matchesLibrary, toRecQuery, type LibraryFilter, type RecFilters } from '@nomad/core';
import { keepPreviousData, useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useAuth } from '../auth/store';
import { useLibraryFilter } from '../find/library';
import { useOffline } from '../net/useOffline';
import {
  clearRecsSnapshot,
  loadRecsSnapshot,
  ownsRecsSnapshot,
  recsSnapshotKey,
  saveRecsSnapshot,
} from './recsSnapshot';
import { useVoiceStore } from '../voice/voiceStore';
import { useDiscoverStale } from './staleStore';

/** While decide's catalog is still loading (503 warming_up), Discover polls this often. */
export const WARMING_POLL_MS = 15_000;

/** Every recommendations query (all filter keys) lives under this prefix. */
export const RECS_KEY = ['recs'] as const;

export type RecsPages = InfiniteData<RecommendationsV2Response, string | undefined>;

/** The merged pages: a later page's section with the same id continues it (a non-`best` sort pages `all`). */
export type Recs = {
  sections: RecSection[];
  hasProfile: boolean;
  /** decide has the user's voice profile (`voice.has_profile`; absent from responses before decide's 3c deploy). */
  voiceProfile: boolean;
};

export function mergePages(pages: readonly RecommendationsV2Response[]): Recs {
  const sections: RecSection[] = [];
  const byId = new Map<string, RecSection>();
  for (const page of pages) {
    for (const s of page.sections) {
      const seen = byId.get(s.id);
      if (seen) seen.songs = [...seen.songs, ...s.songs];
      else {
        const copy = { ...s, songs: [...s.songs] };
        byId.set(s.id, copy);
        sections.push(copy);
      }
    }
  }
  return {
    sections: sections.filter((s) => s.songs.length > 0),
    hasProfile: pages[0]?.has_profile ?? false,
    voiceProfile: pages[0]?.voice?.has_profile ?? false,
  };
}

/** Saved rows carry decide's karaoke flags; map them to the shape the shared library filter reads. */
function filterByLibrary(recs: Recs, library: LibraryFilter): Recs {
  if (library === 'any') return recs;
  const sections = recs.sections
    .map((s) => ({
      ...s,
      songs: s.songs.filter((song) =>
        matchesLibrary(
          {
            libraries: song.karaoke.karafun ? ['KV'] : [],
            versions: song.karaoke.community ? [{ kind: 'community' }] : [],
          },
          library,
        ),
      ),
    }))
    .filter((s) => s.songs.length > 0);
  return { ...recs, sections };
}

/**
 * A failed request that never reached decide: the client's error interceptor wraps fetch's TypeError (and a
 * timeout) as `ApiError(0, …)`; a raw non-ApiError (thrown before the interceptor) counts too.
 */
const isNetworkError = (e: unknown) => (e instanceof ApiError ? e.status === 0 : e != null);

/** Client errors (401, 404, 422) and the catalog warming up won't change on an immediate retry; status 0 (network) may. */
const shouldRetry = (failures: number, e: unknown) =>
  failures < 1 && !isWarmingUp(e) && !(e instanceof ApiError && e.status !== 0 && e.status < 500);

/**
 * Personal recommendations (decide v2) for the current filters and venue library. Only runs signed in. A 503
 * warming_up is never retried; the query polls every 15 s until the catalog is ready instead.
 */
export function useRecommendations(filters: RecFilters) {
  const queryClient = useQueryClient();
  const library = useLibraryFilter((s) => s.filter);
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const signedIn = email !== null;
  const offline = useOffline();
  const stale = useDiscoverStale((s) => s.stale);

  const query = useInfiniteQuery({
    queryKey: [...RECS_KEY, filtersKey(filters, library)],
    enabled: signedIn && !offline,
    queryFn: ({ pageParam }) => getRecommendationsV2(toRecQuery(filters, library), pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // Changing a filter keeps the old picks on screen until the new ones land (no flash to the loader).
    placeholderData: keepPreviousData,
    retry: shouldRetry,
    refetchInterval: (q) => (isWarmingUp(q.state.error) ? WARMING_POLL_MS : false),
  });

  // Someone else's picks must never show after a sign-out (or a sign-in as someone else).
  useEffect(() => {
    if (!signedIn) {
      queryClient.removeQueries({ queryKey: RECS_KEY });
      clearRecsSnapshot();
    }
  }, [signedIn, queryClient]);

  // A decide 401 marked Discover stale; a good load means decide accepts the session again.
  const ok = query.isSuccess && !query.isRefetchError;
  useEffect(() => {
    if (ok && stale) useDiscoverStale.getState().clear();
  }, [ok, stale]);

  // A voice profile decide now has (saved, then synced): reload so the rows carry their fit (Phase 3c).
  const voiceSynced = useVoiceStore((s) => (s.profile && !s.pending ? s.profile.measuredAt : null));
  const lastVoice = useRef(voiceSynced);
  useEffect(() => {
    if (voiceSynced !== null && voiceSynced !== lastVoice.current) void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    lastVoice.current = voiceSynced;
  }, [voiceSynced, queryClient]);

  // Stale flipped back (cleared elsewhere, e.g. a new sign-in) while this query is still failing: reload.
  const wasStale = useRef(stale);
  useEffect(() => {
    if (wasStale.current && !stale && !ok) void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    wasStale.current = stale;
  }, [stale, ok, queryClient]);

  const pages = query.data?.pages;
  const firstPage = pages?.[0];
  const loadedKey = query.isPlaceholderData ? undefined : query.dataUpdatedAt;
  // Keep the last good first page for offline use. Re-saved on every change, so hides are reflected.
  const currentKey = recsSnapshotKey(email ?? '', filtersKey(filters, library));
  useEffect(() => {
    if (email && firstPage && loadedKey !== undefined && !offline) saveRecsSnapshot(currentKey, firstPage);
  }, [email, firstPage, loadedKey, offline, currentKey]);

  // Offline (or decide unreachable): show what was last fetched, if it is this user's and under 7 days old.
  const useSnapshot = signedIn && (offline || (query.isError && isNetworkError(query.error)));
  const snapshot = useMemo(() => {
    if (!useSnapshot || !email) return null;
    const snap = loadRecsSnapshot();
    return snap && ownsRecsSnapshot(snap, email) ? snap : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the live data changes (a hide re-saves)
  }, [useSnapshot, email, firstPage]);

  const live = useMemo(() => (pages ? mergePages(pages) : undefined), [pages]);
  const offlineSnapshot = useSnapshot && (live !== undefined || snapshot !== null);
  const data = useMemo(() => {
    if (!useSnapshot) return live;
    if (live) return filterByLibrary(live, library);
    return snapshot ? filterByLibrary(mergePages([snapshot.data]), library) : undefined;
  }, [useSnapshot, live, snapshot, library]);

  return {
    data,
    offlineSnapshot,
    /** Offline with nothing usable saved (none, too old, or someone else's). */
    offlineEmpty: useSnapshot && data === undefined,
    status: query.status,
    warming: isWarmingUp(query.error),
    error: query.error,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
