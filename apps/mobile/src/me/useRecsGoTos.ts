import { getRecommendationsV2, type RecSong } from '@nomad/api-decide';
import { DEFAULT_REC_FILTERS, toRecQuery } from '@nomad/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useVoiceStore } from '../voice/voiceStore';
import { goTosStorageKey, useUserKey, writeCacheFor } from './account';
import { isObj, readCache } from './cache';
import { useInvalidateOnSynced } from './useLibrary';

/** decide's go_tos section (null: the response had none), kept per account so offline still shows it. */
export type GoTosCache = { songs: RecSong[] | null; savedAt: number };
const isCache = (v: unknown): v is GoTosCache =>
  isObj(v) && (v.songs === null || Array.isArray(v.songs)) && typeof v.savedAt === 'number';

const GO_TOS = 'go_tos';

/**
 * The recs `go_tos` section for the Me shelf (spec §6.5 item 3): default filters and any venue library, so the shelf
 * never inherits Discover's filters. Null when there is no section to show (none in the response, decide warming or
 * unreachable with nothing cached): the shelf then falls back to the phone's own go-tos.
 */
export function useRecsGoTos(): RecSong[] | null {
  const userKey = useUserKey();
  // A voice profile decide now has changes every row's fit: refetch (Discover does the same for its picks).
  const voice = useVoiceStore((s) => (s.profile && !s.pending ? s.profile.measuredAt : null));
  const queryKey = useMemo(() => ['decide', userKey, 'recs-gotos', voice] as const, [userKey, voice]);
  const cached = useMemo(() => readCache(userKey && goTosStorageKey(userKey), isCache), [userKey]);
  const q = useQuery<GoTosCache>({
    queryKey,
    enabled: userKey !== null,
    initialData: cached,
    initialDataUpdatedAt: cached?.savedAt,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await getRecommendationsV2(toRecQuery(DEFAULT_REC_FILTERS, 'any'));
      const section = res.sections.find((s) => s.id === GO_TOS);
      const next: GoTosCache = { songs: section && section.songs.length > 0 ? section.songs : null, savedAt: Date.now() };
      if (!signal?.aborted && userKey) writeCacheFor(userKey, goTosStorageKey(userKey), next);
      return next;
    },
  });
  // A sung log or survey that reached decide can change the go-tos.
  useInvalidateOnSynced([queryKey]);
  return q.data?.songs ?? null;
}
