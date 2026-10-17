import type { AudioResultLike, JobLike } from '@nomad/core';

import type { AudioResult, JobDetail, JobSummary } from '../index';

// Compile-time contract: `pnpm typecheck` fails if the zod-inferred API types stop fitting the
// structural types @nomad/core's ranking and duration logic read.
type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
export type AudioResultFitsCore = Assert<Extends<AudioResult, AudioResultLike>>;
export type JobSummaryFitsCore = Assert<Extends<JobSummary, JobLike>>;
export type JobDetailFitsCore = Assert<Extends<JobDetail, JobLike>>;

it('API types are assignable to @nomad/core structural types (checked by tsc)', () => {
  const audio: AudioResultLike = {} as AudioResult;
  const job: JobLike = {} as JobSummary;
  expect([audio, job]).toHaveLength(2);
});
