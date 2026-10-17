import { z } from 'zod';

import {
  cancelJobApiJobsJobIdCancelPost,
  confirmDurationApiJobsJobIdConfirmDurationPost,
  getJobApiJobsJobIdGet,
  listJobsApiJobsGet,
  retryJobApiJobsJobIdRetryPost,
} from '../client';
import { type JobDetail, JobDetailSchema, type JobSummary, JobSummarySchema } from '../overrides/jobs';
import { parseResponse } from '../overrides/parse';

/** The signed-in user's jobs, newest first (gen's dashboard summary projection). */
export async function listMyJobs(): Promise<JobSummary[]> {
  const { data } = await listJobsApiJobsGet({ query: { fields: 'summary' } });
  return parseResponse(z.array(JobSummarySchema), data);
}

export async function getJob(id: string): Promise<JobDetail> {
  const { data } = await getJobApiJobsJobIdGet({ path: { job_id: id } });
  return parseResponse(JobDetailSchema, data);
}

/** `acknowledgedCredits` = credits_charged + pending_additional_credits (402 if the user can't cover it). */
export async function confirmDuration(id: string, acknowledgedCredits: number): Promise<void> {
  await confirmDurationApiJobsJobIdConfirmDurationPost({ path: { job_id: id }, body: { acknowledged_credits: acknowledgedCredits } });
}

export async function cancelJob(id: string): Promise<void> {
  await cancelJobApiJobsJobIdCancelPost({ path: { job_id: id }, body: { reason: 'Cancelled in the mobile app' } });
}

/** Resume the same job from its checkpoint, like the web's Retry. */
export async function retryJob(id: string): Promise<void> {
  await retryJobApiJobsJobIdRetryPost({ path: { job_id: id }, body: { keep_trying: false } });
}
