// The make submit's retry window (fix round 1, item 2).
import { KjboxError } from '@nomad/api-kjbox';

import { makeTiming, MakeStillPending, sendMake } from '../../../tonight/make/sendMake';

it('defaults: the last attempt starts by 330 s (with a 95 s call, the spinner tops out around 7 min)', () => {
  expect(makeTiming.lastStartMs).toBe(330_000);
});

it('never starts an attempt after lastStartMs, then reports the outcome as still pending', async () => {
  const saved = { ...makeTiming };
  Object.assign(makeTiming, { retryMinMs: 10, lastStartMs: 45 });
  const starts: number[] = [];
  const t0 = Date.now();
  try {
    await expect(
      sendMake(async () => {
        starts.push(Date.now() - t0);
        throw new KjboxError('busy_retry', 409, 0);
      }),
    ).rejects.toBeInstanceOf(MakeStillPending);
    expect(starts.length).toBeGreaterThan(1);
    expect(Math.max(...starts)).toBeLessThanOrEqual(45);
  } finally {
    Object.assign(makeTiming, saved);
  }
});
