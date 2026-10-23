import { getServiceCapabilities, getServicesSummary, type Capabilities, type SourcesSummaryResponse } from '@nomad/api-decide';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useAuth } from '../../auth/store';
import { PROFILE_KEY } from '../profile/useMusicProfile';
import { RECS_KEY } from '../useRecommendations';

/** Every connected or imported source with counts and status (decide `GET /api/services/summary`). */
export const SERVICES_SUMMARY_KEY = ['decide', 'services-summary'] as const;
export const CAPABILITIES_KEY = ['decide', 'capabilities'] as const;

const HOUR_MS = 60 * 60 * 1000;
/** When decide can't say, every optional card stays hidden. */
const CAPABILITIES_OFF: Capabilities = Object.freeze({ screenshot_import: false, listenbrainz_oauth: false });

export function useServicesSummary(): UseQueryResult<SourcesSummaryResponse> {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  return useQuery({ queryKey: SERVICES_SUMMARY_KEY, queryFn: getServicesSummary, enabled: signedIn });
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
    staleTime: (q) => (q.state.data === CAPABILITIES_OFF ? 0 : HOUR_MS),
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
