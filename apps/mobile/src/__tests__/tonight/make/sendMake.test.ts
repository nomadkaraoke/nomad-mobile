// The make submit's retry window (fix round 1, item 2).
import { KjboxError } from '@nomad/api-kjbox';

import { makeTiming, MakeStillPending, sendMake } from '../../../tonight/make/sendMake';

it('defaults: the last attempt starts by 330 s (with a 95 s call, the spinner tops out around 7 min)', () => {
  expect(makeTiming.lastStartMs).toBe(330_000);
});

it('never starts an attempt after lastStartMs, then reports the outcome as still pending', async () => {
  // Fake timers (Date.now included): a real clock with a 45 ms budget was flaky on a loaded machine.
  jest.useFakeTimers({ now: 0 });
  const starts: number[] = [];
  try {
    const outcome = sendMake(async () => {
      starts.push(Date.now());
      throw new KjboxError('busy_retry', 409, 0);
    });
    const settled = expect(outcome).rejects.toBeInstanceOf(MakeStillPending);
    await jest.advanceTimersByTimeAsync(makeTiming.lastStartMs + 60_000);
    await settled;
    // Every 3 s from 0 while the next start still fits in 330 s: 0, 3, …, 330 s.
    expect(starts.length).toBe(Math.floor(makeTiming.lastStartMs / makeTiming.retryMinMs) + 1);
    expect(Math.max(...starts)).toBeLessThanOrEqual(makeTiming.lastStartMs);
  } finally {
    jest.useRealTimers();
  }
});
