import { getSongDetail, type Version } from '@nomad/api-decide';
import type { JobSummary } from '@nomad/api-gen';
import { sameSong } from '@nomad/core';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../auth/store';
import { useMyJobs } from '../../jobs/useMyJobs';
import type { LogSong } from '../log/logStore';

export type YouTubeSources = {
  /** The signed-in user's gen jobs (Phase 1's jobs list). */
  jobs?: readonly JobSummary[];
  /** decide's karaoke versions of the song (its `song_key`). */
  versions?: readonly Version[];
};

/**
 * The YouTube link to hand the host for a logged song (spec §6.2, ruling E9-R4): the user's own gen-made video of the
 * same artist + title, else a community version's `youtube_url` from decide search, else null (commercial versions
 * are never offered: those videos aren't ours to point a host at).
 */
export function youTubeLinkFor(song: Pick<LogSong, 'artist' | 'title'>, { jobs, versions }: YouTubeSources): string | null {
  for (const job of jobs ?? []) {
    const url = job.state_data?.youtube_url;
    if (url && sameSong({ artist: job.artist ?? '', title: job.title ?? '' }, song)) return url;
  }
  for (const v of versions ?? []) {
    if (v.kind === 'community' && v.youtube_url) return v.youtube_url;
  }
  return null;
}

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
