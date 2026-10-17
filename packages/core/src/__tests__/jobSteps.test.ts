import { jobStep, sortJobsForMakeTab } from '../jobSteps';
import { jobPhase } from '../jobStatus';

describe('jobStep', () => {
  const table: [string, 0 | 1 | 2 | 3 | 4 | 5][] = [
    ['pending', 0],
    ['searching_audio', 1],
    ['awaiting_audio_selection', 1],
    ['downloading_audio', 1],
    ['download_pending_retry', 1],
    ['downloading', 1],
    ['awaiting_audio_edit', 1],
    ['in_audio_edit', 1],
    ['audio_edit_complete', 1],
    ['awaiting_duration_confirm', 1],
    ['separating_stage1', 2],
    ['separating_stage2', 2],
    ['audio_complete', 2],
    ['transcribing', 2],
    ['correcting', 2],
    ['lyrics_complete', 2],
    ['generating_screens', 3],
    ['applying_padding', 3],
    ['awaiting_review', 3],
    ['in_review', 3],
    ['review_complete', 4],
    ['rendering_video', 4],
    ['render_pending_capacity', 4],
    ['awaiting_instrumental_selection', 4],
    ['instrumental_selected', 4],
    ['generating_video', 4],
    ['encoding', 4],
    ['packaging', 4],
    ['uploading', 5],
    ['notifying', 5],
    ['complete', 5],
    ['prep_complete', 5],
    ['failed', 0],
    ['cancelled', 0],
  ];
  it.each(table)('%s -> step %i', (status, step) => {
    expect(jobStep(status).step).toBe(step);
  });

  it('flags only the parked statuses as slow', () => {
    for (const [status] of table) {
      expect(jobStep(status).slow).toBe(status === 'download_pending_retry' || status === 'render_pending_capacity');
    }
  });

  it('unknown status is step 0 and still working', () => {
    expect(jobStep('brand_new_status')).toEqual({ step: 0, slow: false });
    expect(jobPhase('brand_new_status')).toBe('working');
  });
});

describe('sortJobsForMakeTab', () => {
  const j = (job_id: string, status: string, created_at: string | null) => ({ job_id, status, created_at });
  it('orders needsUser, working, done, failed; newest first within each', () => {
    const jobs = [
      j('f', 'failed', '2026-10-17T10:00:00Z'),
      j('d-old', 'complete', '2026-10-15T10:00:00Z'),
      j('w-old', 'encoding', '2026-10-14T10:00:00Z'),
      j('n-old', 'awaiting_review', '2026-10-13T10:00:00Z'),
      j('c', 'cancelled', '2026-10-18T10:00:00Z'),
      j('d-new', 'complete', '2026-10-16T10:00:00Z'),
      j('w-new', 'transcribing', '2026-10-16T10:00:00Z'),
      j('n-new', 'awaiting_duration_confirm', '2026-10-17T10:00:00Z'),
      j('w-none', 'pending', null),
    ];
    expect(sortJobsForMakeTab(jobs).map((x) => x.job_id)).toEqual([
      'n-new', 'n-old', 'w-new', 'w-old', 'w-none', 'd-new', 'd-old', 'c', 'f',
    ]);
  });
  it('does not mutate its input', () => {
    const jobs = [j('a', 'complete', null), j('b', 'awaiting_review', null)];
    sortJobsForMakeTab(jobs);
    expect(jobs[0]!.job_id).toBe('a');
  });
});
