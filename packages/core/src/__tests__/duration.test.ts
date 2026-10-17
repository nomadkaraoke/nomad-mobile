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

  // gen's get_credits_charged: a job without credits_charged (made before gen v0.278.2) was charged 1.
  // The total shown is also what confirm-duration's acknowledged_credits must equal.
  it('a job without credits_charged counts the 1 credit it was charged', () => {
    expect(
      durationConfirm({
        job_id: 'j',
        status: 'awaiting_duration_confirm',
        state_data: { pending_additional_credits: 1, duration_actual_seconds: 900 },
      }),
    ).toEqual({ totalCredits: 2, extraCredits: 1, seconds: 900 });
  });

  it('keeps an explicit 0 charged (admin / tenant / bypassed jobs)', () => {
    expect(
      durationConfirm({
        job_id: 'j',
        status: 'awaiting_duration_confirm',
        state_data: { credits_charged: 0, pending_additional_credits: 2, duration_actual_seconds: 1300 },
      }).totalCredits,
    ).toBe(2);
  });

  it('defaults missing fields', () => {
    expect(durationConfirm({ job_id: 'j', status: 'x' })).toEqual({ totalCredits: 1, extraCredits: 0, seconds: 0 });
    expect(durationConfirm({ job_id: 'j', status: 'x', state_data: null }).totalCredits).toBe(1);
  });
});
