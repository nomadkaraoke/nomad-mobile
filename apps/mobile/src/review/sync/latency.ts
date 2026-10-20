/**
 * Audio output latency per platform, in seconds: what the singer hears lags the player's
 * `currentTime` by roughly this much, so Tap To Sync subtracts it from every press and release.
 *
 * How to measure (spec §4.3, device pass): re-sync a line with a clear onset on a real device
 * (or the emulator, noting it differs), tapping on the beat; then play it back and watch the
 * karaoke highlight against the voice. If the highlight is consistently late by more than
 * ~80 ms, set that platform's value to the offset (e.g. 0.12). Bluetooth output adds far more
 * (150–300 ms) and isn't corrected here.
 */
export const TAP_LATENCY_S = { ios: 0, android: 0 } as const;

export function tapLatencyFor(os: string): number {
  return os === 'ios' || os === 'android' ? TAP_LATENCY_S[os] : 0;
}

/** Monotonic wall clock (ms) that press durations are measured with; tests stub it. */
export const pressClockMs = (): number => performance.now();
