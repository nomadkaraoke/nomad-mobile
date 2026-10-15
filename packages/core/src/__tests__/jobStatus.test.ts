import { jobPhase } from '../jobStatus';

// Statuses from karaoke-gen/backend/models/job.py (checked 2026-10-14).
it.each([
  ['searching_audio', 'working'],
  ['downloading', 'working'],
  ['separating_stage1', 'working'],
  ['transcribing', 'working'],
  ['rendering_video', 'working'],
  ['encoding', 'working'],
  ['awaiting_audio_selection', 'needsUser'],
  ['awaiting_audio_edit', 'needsUser'],
  ['in_audio_edit', 'needsUser'],
  ['awaiting_duration_confirm', 'needsUser'],
  ['awaiting_review', 'needsUser'],
  ['in_review', 'needsUser'],
  ['awaiting_instrumental_selection', 'needsUser'],
  ['complete', 'done'],
  ['prep_complete', 'done'],
  ['failed', 'failed'],
  ['cancelled', 'failed'],
  ['error', 'failed'],
  ['some_future_status', 'working'],
])('%s → %s', (s, phase) => expect(jobPhase(s)).toBe(phase));
