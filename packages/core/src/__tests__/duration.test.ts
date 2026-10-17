import { durationConfirm } from '../duration';

describe('durationConfirm', () => {
  it('sums charged and pending credits', () => {
    expect(
      durationConfirm({
        job_id: 'j',
        status: 'awaiting_duration_confirm',
        state_data: { credits_charged: 1, pending_additional_credits: 1, duration_actual_seconds: 872 },
      }),
    ).toEqual({ totalCredits: 2, extraCredits: 1, seconds: 872 });
  });
  it('defaults missing fields to 0', () => {
    expect(durationConfirm({ job_id: 'j', status: 'x' })).toEqual({ totalCredits: 0, extraCredits: 0, seconds: 0 });
    expect(durationConfirm({ job_id: 'j', status: 'x', state_data: null }).totalCredits).toBe(0);
  });
});
