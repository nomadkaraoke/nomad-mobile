import { jobPhase } from './jobStatus';

export interface JobStepInfo {
  step: 0 | 1 | 2 | 3 | 4 | 5;
  /** True when the job is parked waiting on infrastructure (auto-retried, no user action). */
  slow: boolean;
}

/**
 * Backend status -> 5-stage progress (the stage the job is currently in).
 * Collapsed from gen's 10-step table, karaoke-gen/frontend/lib/job-status.ts STATUS_CONFIG:
 *   gen 1 (setup)                         -> 0 not started
 *   gen 2-3 (audio search/download/edit)  -> 1 getting audio
 *   gen 4 (separation + lyrics)           -> 2 separated
 *   gen 5-6 (screens, lyrics review)      -> 3 lyrics synced
 *   gen 7-9 (render, instrumental, encode)-> 4 video made
 *   gen 10 (upload/notify/complete)       -> 5 posted or complete
 * failed/cancelled and unknown statuses are 0 (unknown stays 'working' via jobPhase).
 */
const STEP_BY_STATUS: Record<string, JobStepInfo['step']> = {
  pending: 0,
  searching_audio: 1,
  awaiting_audio_selection: 1,
  downloading_audio: 1,
  download_pending_retry: 1,
  downloading: 1,
  awaiting_audio_edit: 1,
  in_audio_edit: 1,
  audio_edit_complete: 1,
  awaiting_duration_confirm: 1,
  separating_stage1: 2,
  separating_stage2: 2,
  audio_complete: 2,
  transcribing: 2,
  correcting: 2,
  lyrics_complete: 2,
  generating_screens: 3,
  applying_padding: 3,
  awaiting_review: 3,
  in_review: 3,
  review_complete: 4,
  rendering_video: 4,
  render_pending_capacity: 4,
  awaiting_instrumental_selection: 4,
  instrumental_selected: 4,
  generating_video: 4,
  encoding: 4,
  packaging: 4,
  uploading: 5,
  notifying: 5,
  complete: 5,
  prep_complete: 5,
  failed: 0,
  cancelled: 0,
};

const SLOW = new Set(['download_pending_retry', 'render_pending_capacity']);

export function jobStep(status: string): JobStepInfo {
  const key = status?.toLowerCase() ?? '';
  return { step: STEP_BY_STATUS[key] ?? 0, slow: SLOW.has(key) };
}

export interface SortableJob {
  status: string;
  created_at?: string | null;
}

const PHASE_ORDER = { needsUser: 0, working: 1, done: 2, failed: 3 } as const;

function ts(j: SortableJob): number {
  const t = j.created_at ? Date.parse(j.created_at) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Make tab order: needs-you, working, done, failed/cancelled; newest first within each. */
export function sortJobsForMakeTab<T extends SortableJob>(jobs: T[]): T[] {
  return [...jobs].sort(
    (a, b) => PHASE_ORDER[jobPhase(a.status)] - PHASE_ORDER[jobPhase(b.status)] || ts(b) - ts(a),
  );
}
