import type { JobSummary } from '@nomad/api-gen';
import type { QueryClient } from '@tanstack/react-query';

/** The Make tab's copy of a job (any `['jobs', …]` list in the cache), to show at once while the full job loads. */
export function cachedJobSummary(queryClient: QueryClient, id: string): JobSummary | undefined {
  return queryClient
    .getQueriesData<JobSummary[]>({ queryKey: ['jobs'] })
    .flatMap(([, jobs]) => jobs ?? [])
    .find((j) => j.job_id === id);
}
