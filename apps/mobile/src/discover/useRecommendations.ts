import {
  ApiError,
  getRecommendationsV2,
  isWarmingUp,
  type RecommendationsV2Response,
  type RecSection,
} from '@nomad/api-decide';
import { filtersKey, toRecQuery, type RecFilters } from '@nomad/core';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useAuth } from '../auth/store';
import { useLibraryFilter } from '../find/library';
import { useDiscoverStale } from './staleStore';

/** While decide's catalog is still loading (503 warming_up), Discover polls this often. */
export const WARMING_POLL_MS = 15_000;

/** Every recommendations query (all filter keys) lives under this prefix. */
export const RECS_KEY = ['recs'] as const;

export type RecsPages = InfiniteData<RecommendationsV2Response, string | undefined>;

/** The merged pages: a later page's section with the same id continues it (a non-`best` sort pages `all`). */
export type Recs = { sections: RecSection[]; hasProfile: boolean };

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
  return { sections: sections.filter((s) => s.songs.length > 0), hasProfile: pages[0]?.has_profile ?? false };
}

/** Client errors (401, 404, 422) and the catalog warming up won't change on an immediate retry. */
const shouldRetry = (failures: number, e: unknown) =>
  failures < 1 && !isWarmingUp(e) && !(e instanceof ApiError && e.status < 500);

/**
 * Personal recommendations (decide v2) for the current filters and venue library. Only runs signed in. A 503
 * warming_up is never retried; the query polls every 15 s until the catalog is ready instead.
 */
export function useRecommendations(filters: RecFilters) {
  const queryClient = useQueryClient();
  const library = useLibraryFilter((s) => s.filter);
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const stale = useDiscoverStale((s) => s.stale);

  const query = useInfiniteQuery({
    queryKey: [...RECS_KEY, filtersKey(filters, library)],
    enabled: signedIn,
    queryFn: ({ pageParam }) => getRecommendationsV2(toRecQuery(filters, library), pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: shouldRetry,
    refetchInterval: (q) => (isWarmingUp(q.state.error) ? WARMING_POLL_MS : false),
  });

  // Someone else's picks must never show after a sign-out (or a sign-in as someone else).
  useEffect(() => {
    if (!signedIn) queryClient.removeQueries({ queryKey: RECS_KEY });
  }, [signedIn, queryClient]);

  // A decide 401 marked Discover stale; a good load means decide accepts the session again.
  const ok = query.isSuccess && !query.isRefetchError;
  useEffect(() => {
    if (ok && stale) useDiscoverStale.getState().clear();
  }, [ok, stale]);

  // Stale flipped back (cleared elsewhere, e.g. a new sign-in) while this query is still failing: reload.
  const wasStale = useRef(stale);
  useEffect(() => {
    if (wasStale.current && !stale && !ok) void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    wasStale.current = stale;
  }, [stale, ok, queryClient]);

  const pages = query.data?.pages;
  const data = useMemo(() => (pages ? mergePages(pages) : undefined), [pages]);

  return {
    data,
    status: query.status,
    warming: isWarmingUp(query.error),
    error: query.error,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
