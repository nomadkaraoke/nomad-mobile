export interface JobLike {
  job_id: string;
  status: string;
  created_at?: string | null;
  state_data?: {
    credits_charged?: number;
    pending_additional_credits?: number;
    duration_actual_seconds?: number;
  } | null;
}

export interface DurationConfirm {
  /** What the video costs in all (shown to the person). */
  totalCredits: number;
  /** How many more credits confirming takes. */
  extraCredits: number;
  /** The `acknowledged_credits` gen's confirm-duration route checks against. */
  acknowledgedCredits: number;
  seconds: number;
}

/**
 * What the user is asked to confirm when a track runs longer than the credits already charged.
 *
 * create-from-search takes 1 credit without writing `credits_charged`. Gen's duration reconcile reads a missing
 * value as 1, but its confirm-duration route reads it as 0 and expects `0 + pending`. So the person sees the
 * real total, and the acknowledgement uses gen's route arithmetic.
 */
export function durationConfirm(job: JobLike): DurationConfirm {
  const sd = job.state_data ?? {};
  const extraCredits = sd.pending_additional_credits ?? 0;
  return {
    totalCredits: (sd.credits_charged ?? 1) + extraCredits,
    extraCredits,
    acknowledgedCredits: (sd.credits_charged ?? 0) + extraCredits,
    seconds: sd.duration_actual_seconds ?? 0,
  };
}
