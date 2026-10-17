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

/**
 * The signed-in user's jobs, newest first (gen's dashboard summary projection). Gen returns every
 * user's jobs to an admin session, so keep only `email`'s. A malformed legacy job is dropped (and
 * warned about) instead of failing the whole list.
 */
export async function listMyJobs(email: string): Promise<JobSummary[]> {
  const { data } = await listJobsApiJobsGet({ query: { fields: 'summary' } });
  const me = email.trim().toLowerCase();
  return parseResponse(z.array(z.unknown()), data).flatMap((item) => {
    const job = JobSummarySchema.safeParse(item);
    if (!job.success) {
      console.warn('listMyJobs: dropping malformed job', (item as { job_id?: unknown } | null)?.job_id);
      return [];
    }
    return job.data.user_email?.toLowerCase() === me ? [job.data] : [];
  });
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

/**
 * Resume the same job from its checkpoint, like the web's Retry. `keepTrying` is the web's
 * "Keep trying" for a stalled audio download: gen waits up to an hour for the source instead of 20 minutes.
 */
export async function retryJob(id: string, { keepTrying = false }: { keepTrying?: boolean } = {}): Promise<void> {
  await retryJobApiJobsJobIdRetryPost({ path: { job_id: id }, body: { keep_trying: keepTrying } });
}
