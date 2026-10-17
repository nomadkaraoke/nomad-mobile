import { z } from 'zod';

import { opt } from './parse';

// GET /api/jobs?fields=summary returns untyped dicts (the SUMMARY_FIELD_PATHS projection in gen's
// firestore_service, pruned by jobs.py _SUMMARY_STATE_DATA_KEYS). Loose objects: fields the app
// doesn't read yet (error_details, audio_progress, ...) pass through untyped.
const StateDataSchema = z.looseObject({
  youtube_url: opt(z.string()),
  pending_additional_credits: opt(z.number()),
  credits_charged: opt(z.number()),
  duration_actual_seconds: opt(z.number()),
  brand_code: opt(z.string()),
});

const UrlTreeSchema = z.record(z.string(), z.unknown());

export const JobSummarySchema = z.looseObject({
  job_id: z.string(),
  status: z.string(),
  progress: z.number().nullish().transform((v) => v ?? 0),
  artist: opt(z.string()),
  title: opt(z.string()),
  created_at: opt(z.string()),
  user_email: opt(z.string()),
  error_message: opt(z.string()),
  credit_refunded: opt(z.boolean()),
  state_data: opt(StateDataSchema),
  file_urls: opt(UrlTreeSchema),
});
export type JobSummary = z.output<typeof JobSummarySchema>;

export const JobDetailSchema = JobSummarySchema.extend({
  download_urls: opt(UrlTreeSchema),
});
export type JobDetail = z.output<typeof JobDetailSchema>;
