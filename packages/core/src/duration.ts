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
  /** What the video costs in all: shown to the person, and the `acknowledged_credits` confirm-duration expects. */
  totalCredits: number;
  /** How many more credits confirming takes. */
  extraCredits: number;
  seconds: number;
}

/**
 * What the user is asked to confirm when a track runs longer than the credits already charged.
 * A job without `credits_charged` (made before gen v0.278.2) was charged 1: gen's `get_credits_charged`
 * uses the same default, so the total shown is the total gen checks.
 */
export function durationConfirm(job: JobLike): DurationConfirm {
  const sd = job.state_data ?? {};
  const extraCredits = sd.pending_additional_credits ?? 0;
  return {
    totalCredits: (sd.credits_charged ?? 1) + extraCredits,
    extraCredits,
    seconds: sd.duration_actual_seconds ?? 0,
  };
}
