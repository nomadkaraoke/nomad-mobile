// Tonight's hooks over the shared `youTubeLinkFor` (media/youtube.ts): the live jobs and decide versions it picks from.
import { getSongDetail } from '@nomad/api-decide';
import type { JobSummary } from '@nomad/api-gen';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../auth/store';
import { useMyJobs } from '../../jobs/useMyJobs';
import { youTubeLinkFor } from '../../media/youtube';
import type { LogSong } from '../log/logStore';

/** The signed-in user's gen jobs, read once per screen (not per row: each `useMyJobs` adds a foreground listener). */
export function useMyJobsForLinks(): readonly JobSummary[] | undefined {
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  return useMyJobs(email).data;
}

/** `youTubeLinkFor` over live data: the screen's jobs and, with a `song_key`, decide's song detail (cached). */
export function useYouTubeLink(song: LogSong, jobs: readonly JobSummary[] | undefined): string | null {
  const key = song.song_key;
  const detail = useQuery({
    queryKey: ['decide', 'song', key],
    queryFn: () => getSongDetail(key!),
    enabled: !!key,
    staleTime: 60 * 60_000,
    retry: false,
  });
  return youTubeLinkFor(song, { jobs, versions: detail.data?.versions });
}
