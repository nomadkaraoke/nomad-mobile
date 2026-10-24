import type { PitchSource } from '../voice/pitchSource';

/** expo-modules-core's code for a call on a native shared object that was already released. */
export const RELEASED_SHARED_OBJECT = 'ERR_USING_RELEASED_SHARED_OBJECT';

const errorCode = (e: unknown): unknown => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined);

/**
 * Stops the pitch source without ever throwing. expo-audio's `useAudioStream` releases the native stream in its own
 * unmount cleanup, and on a released stream `stop()` throws ERR_USING_RELEASED_SHARED_OBJECT. Our stop calls can run
 * after that: a child screen's unmount cleanup (it runs after the session hook's), a timer that fires once the screen
 * has gone (the quiet second), or a take stopped while the route closes. A throw in an unmount cleanup or a timer
 * closes the release app (3c, prod smoke). The release already stopped capture, so that error (matched on its code)
 * is dropped; any other error is logged as a warning and not rethrown either, for the same reason.
 */
export function stopSourceQuietly(source: Pick<PitchSource, 'stop'>): void {
  try {
    source.stop();
  } catch (e) {
    if (errorCode(e) === RELEASED_SHARED_OBJECT) return;
    console.warn(`[voice session] stopping the mic failed: ${String(e)}`);
  }
}
