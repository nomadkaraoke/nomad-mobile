export type JobPhase = 'working' | 'needsUser' | 'done' | 'failed';

// Mirrors karaoke-gen/backend/models/job.py JobStatus. Unknown statuses count as 'working'
// so a new backend status never strands the UI.
const NEEDS_USER = new Set([
  'awaiting_audio_selection',
  'awaiting_audio_edit',
  'in_audio_edit',
  'awaiting_duration_confirm',
  'awaiting_review',
  'in_review',
  'awaiting_instrumental_selection',
]);
const DONE = new Set(['complete', 'prep_complete']);
// 'error' is deprecated in gen but job_manager still sets it on some failures.
const FAILED = new Set(['failed', 'cancelled', 'error']);

export function jobPhase(status: string): JobPhase {
  if (NEEDS_USER.has(status)) return 'needsUser';
  if (DONE.has(status)) return 'done';
  if (FAILED.has(status)) return 'failed';
  return 'working';
}
