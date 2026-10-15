import { nextPollDelayMs } from '../backoff';

it('doubles from 2s and caps at 30s', () => {
  expect([0, 1, 2, 3, 4, 10].map(nextPollDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
});
it('treats negative attempts as 0', () => expect(nextPollDelayMs(-1)).toBe(2000));
