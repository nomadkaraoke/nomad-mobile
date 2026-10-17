import { listMyJobs, type JobSummary } from '@nomad/api-gen';
import { jobPhase, sortJobsForMakeTab } from '@nomad/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Spec §4.6: poll about every 10s like the web. Mutable so tests can shrink it instead of faking timers. */
export const jobsPoll = { intervalMs: 10_000 };

/** A job still moving (or waiting on the person) keeps the list polling; done, failed and cancelled don't. */
export const isUnfinished = (job: JobSummary) => {
  const phase = jobPhase(job.status);
  return phase === 'working' || phase === 'needsUser';
};

/**
 * The signed-in person's jobs for the Make tab, sorted needs-you → working → done → failed.
 * Polls while anything is unfinished and the app is in the foreground; coming back to the
 * foreground refetches at once (Review Focus 1), which also covers returning from the review bridge on Android.
 */
export function useMyJobs(email: string | null) {
  const queryClient = useQueryClient();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setForeground(active);
      if (active) void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    });
    return () => sub.remove();
  }, [queryClient]);

  return useQuery({
    queryKey: ['jobs', email],
    queryFn: () => listMyJobs(email!),
    enabled: Boolean(email),
    select: sortJobsForMakeTab,
    refetchInterval: (query) =>
      foreground && query.state.data?.some(isUnfinished) ? jobsPoll.intervalMs : false,
  });
}
