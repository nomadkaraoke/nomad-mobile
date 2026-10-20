// Job-summary fixtures and a route table for Make-tab tests.
import type { JobSummary } from '@nomad/api-gen';
import { View } from 'react-native';

import { makeRoutes } from './makeFixtures';

let seq = 0;

type StateData = NonNullable<JobSummary['state_data']>;
type JobOverrides = Partial<Omit<JobSummary, 'state_data'>> &
  Pick<JobSummary, 'job_id' | 'status'> & { state_data?: Partial<StateData> };

/**
 * A job summary as listMyJobs returns it, each call a minute newer unless `created_at` is given.
 * The zod output type lists every optional field; fixtures only set the ones the cards read.
 */
export const job = (over: JobOverrides): JobSummary =>
  ({
    progress: 0,
    artist: 'Muse',
    title: 'Starlight',
    user_email: 'me@example.com',
    created_at: new Date(Date.UTC(2026, 9, 1, 12, seq++)).toISOString(),
    ...over,
  }) as JobSummary;

/** App routes with the ready screen (/job/[id]) and the review (/review/[id]) stubbed, so Make-tab tests need none of their native modules. */
export function jobRoutes() {
  return {
    ...makeRoutes(),
    'job/[id]': () => <View testID="job-ready-stub" />,
    'review/[id]': () => <View testID="review-stub" />,
  };
}
