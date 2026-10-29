import { getServiceCapabilities, getServicesSummary, type Capabilities, type SourcesSummaryResponse } from '@nomad/api-decide';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useAuth } from '../../auth/store';
import { userKeyFor } from '../../auth/userKey';
import { PROFILE_KEY } from '../profile/useMusicProfile';
import { RECS_KEY } from '../useRecommendations';

/**
 * Every connected or imported source with counts and status (decide `GET /api/services/summary`). The key is a prefix
 * (invalidate / remove every account's); each account's copy lives under `servicesSummaryKeyFor(userKey)`, so another
 * account never sees the previous one's counts while its own load.
 */
export const SERVICES_SUMMARY_KEY = ['decide', 'services-summary'] as const;
export const servicesSummaryKeyFor = (userKey: string | null) => [...SERVICES_SUMMARY_KEY, userKey] as const;
export const CAPABILITIES_KEY = ['decide', 'capabilities'] as const;

const HOUR_MS = 60 * 60 * 1000;
/**
 * When decide can't say, every optional card stays hidden. `fallback` marks it so it is never cached for the hour:
 * not detected by identity, since structural sharing keeps the previous (deep-equal) data object instead.
 */
const CAPABILITIES_OFF: Capabilities & { fallback: true } = Object.freeze({
  screenshot_import: false,
  listenbrainz_oauth: false,
  fallback: true,
});
const isFallback = (data: unknown) => (data as { fallback?: boolean } | undefined)?.fallback === true;

export function useServicesSummary(): UseQueryResult<SourcesSummaryResponse> {
  const userKey = useAuth((s) => (s.state.status === 'signedIn' ? userKeyFor(s.state.session.email) : null));
  // Imports and connects invalidate it (useInvalidateAfterImport); the staleTime only spares remounts a refetch.
  return useQuery({
    queryKey: servicesSummaryKeyFor(userKey),
    queryFn: getServicesSummary,
    enabled: userKey !== null,
    staleTime: 5 * 60_000,
  });
}

/**
 * What this decide can do right now (screenshot import, ListenBrainz OAuth, the upload cap). No sign-in needed.
 * Cached for an hour; on an error it answers "all off" (and asks again on the next mount, not an hour later).
 */
export function useCapabilities(): UseQueryResult<Capabilities> {
  return useQuery({
    queryKey: CAPABILITIES_KEY,
    queryFn: async () => {
      try {
        return await getServiceCapabilities();
      } catch {
        return CAPABILITIES_OFF;
      }
    },
    staleTime: (q) => (isFallback(q.state.data) ? 0 : HOUR_MS),
  });
}

/** After an import lands: the Connect summary, the picks and the music profile (new artists) all change. */
export function useInvalidateAfterImport(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SERVICES_SUMMARY_KEY });
    void queryClient.invalidateQueries({ queryKey: RECS_KEY });
    void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
  }, [queryClient]);
}
