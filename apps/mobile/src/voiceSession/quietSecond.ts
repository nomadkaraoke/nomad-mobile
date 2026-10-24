import { noiseFloor, type PitchFrame } from '@nomad/core';

import { createFramer, FRAME_SIZE } from '../voice/framer';
import type { PitchSource } from '../voice/pitchSource';
import { stopSourceQuietly } from './stopSource';

/** Wall-clock cap: a source that never delivers a full second of audio still ends (with 3c's minimum floor). */
const QUIET_TIMEOUT_MS = 3000;

/**
 * The setup screen's quiet second (3c's rule): the noise floor over frames whose window ends by 1.0 s of audio time.
 * Starts `source`, stops it once a frame passes 1.0 s (or after the timeout) and resolves the floor. Mic permission
 * must already be granted.
 */
export function measureQuietSecond(source: PitchSource, timeoutMs = QUIET_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve) => {
    const frames: PitchFrame[] = [];
    let rate = 16000;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopSourceQuietly(source);
      resolve(noiseFloor(frames));
    };
    const framer = createFramer((f) => {
      if (f.t + FRAME_SIZE / rate <= 1.0 + 1e-9) frames.push(f);
      else finish();
    });
    const timer = setTimeout(finish, timeoutMs);
    source
      .start((b) => {
        if (done) return;
        rate = b.sampleRate;
        framer.push(b);
      }, 'low')
      .catch(finish);
  });
}
