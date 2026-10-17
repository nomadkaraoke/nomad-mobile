import type { JobSummary } from '@nomad/api-gen';
import { QueryClient } from '@tanstack/react-query';

import { cachedJobSummary } from '../jobs/cachedJob';

const job = (job_id: string) => ({ job_id, status: 'complete' }) as JobSummary;

it('finds the job in any cached jobs list, or undefined', () => {
  const qc = new QueryClient();
  qc.setQueryData(['jobs', 'a@example.com'], [job('j1')]);
  qc.setQueryData(['jobs', 'b@example.com'], [job('j2'), job('j3')]);
  qc.setQueryData(['job', 'j4'], job('j4')); // a single job, not a list: not a source
  expect(cachedJobSummary(qc, 'j3')).toMatchObject({ job_id: 'j3' });
  expect(cachedJobSummary(qc, 'j4')).toBeUndefined();
  expect(cachedJobSummary(new QueryClient(), 'j1')).toBeUndefined();
});
