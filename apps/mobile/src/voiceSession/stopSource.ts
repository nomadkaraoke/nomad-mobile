import type { PitchSource } from '../voice/pitchSource';

/**
 * Stops the pitch source without ever throwing. expo-audio's `useAudioStream` releases the native stream in its own
 * unmount cleanup, and on a released stream `stop()` throws ERR_USING_RELEASED_SHARED_OBJECT. Our stop calls can run
 * after that: a child screen's unmount cleanup (it runs after the session hook's), a timer that fires once the screen
 * has gone (the quiet second), or a take stopped while the route closes. A throw in an unmount cleanup or a timer
 * closes the release app (3c, prod smoke), and the release already stopped capture, so the error is dropped.
 */
export function stopSourceQuietly(source: Pick<PitchSource, 'stop'>): void {
  try {
    source.stop();
  } catch {
    // Already released.
  }
}
