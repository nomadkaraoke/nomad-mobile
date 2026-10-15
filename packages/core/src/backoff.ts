/** Poll delay for attempt n: 2s, 4s, 8s, 16s, then capped at 30s. */
export function nextPollDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt), 30000);
}
