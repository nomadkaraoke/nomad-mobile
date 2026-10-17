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
  totalCredits: number;
  extraCredits: number;
  seconds: number;
}

/** What the user is asked to confirm when a track runs longer than the credits already charged. */
export function durationConfirm(job: JobLike): DurationConfirm {
  const sd = job.state_data ?? {};
  const extraCredits = sd.pending_additional_credits ?? 0;
  return {
    totalCredits: (sd.credits_charged ?? 0) + extraCredits,
    extraCredits,
    seconds: sd.duration_actual_seconds ?? 0,
  };
}
