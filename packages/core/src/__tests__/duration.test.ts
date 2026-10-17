import { durationConfirm } from '../duration';

describe('durationConfirm', () => {
  it('sums charged and pending credits', () => {
    expect(
      durationConfirm({
        job_id: 'j',
        status: 'awaiting_duration_confirm',
        state_data: { credits_charged: 1, pending_additional_credits: 1, duration_actual_seconds: 872 },
      }),
    ).toEqual({ totalCredits: 2, extraCredits: 1, acknowledgedCredits: 2, seconds: 872 });
  });

  // Found on the local stack: create-from-search charges 1 credit but never writes credits_charged. Gen's
  // reconcile treats a missing value as 1 (so 15 min = 2 credits = 1 more), while its confirm-duration route
  // treats it as 0 and expects acknowledged_credits = 0 + pending. Show the real total; acknowledge what gen checks.
  it('without credits_charged, the total counts the credit create-from-search took; the ack matches gen', () => {
    expect(
      durationConfirm({
        job_id: 'j',
        status: 'awaiting_duration_confirm',
        state_data: { pending_additional_credits: 1, duration_actual_seconds: 900 },
      }),
    ).toEqual({ totalCredits: 2, extraCredits: 1, acknowledgedCredits: 1, seconds: 900 });
  });

  it('defaults missing fields', () => {
    expect(durationConfirm({ job_id: 'j', status: 'x' })).toEqual({
      totalCredits: 1,
      extraCredits: 0,
      acknowledgedCredits: 0,
      seconds: 0,
    });
    expect(durationConfirm({ job_id: 'j', status: 'x', state_data: null }).acknowledgedCredits).toBe(0);
  });
});
