import type { PitchFrame } from '@nomad/core';
import { PitchDetector } from 'pitchy';
import type { PcmBuffer } from './pitchSource';

/** Anything quieter than this is treated as silence (hz null) rather than asking pitchy about numerical dust. */
const SILENCE_RMS = 1e-4;
const MIN_HZ = 40;
const MAX_HZ = 2000;

/**
 * Turns PCM buffers into PitchFrames: a `frameSize` window every `hop` samples, pitchy's McLeod detector on each.
 *
 * Time base: `t` is the window's start sample index / sampleRate, counted from 0 at construction or the last
 * `reset()`. `noiseFloor()` treats frames with `t < 1.0` as "the first second", so callers MUST call `reset()`
 * at the start of every step (not just once per session) or the quiet second would be measured wrongly.
 * `reset()` also drops any buffered samples. A sample-rate change mid-stream recreates the detector and drops
 * the partial window (t keeps advancing).
 */
export function createFramer(
  onFrame: (f: PitchFrame) => void,
  opts: { frameSize?: 2048; hop?: 512 } = {},
): { push(b: PcmBuffer): void; reset(): void } {
  const frameSize = opts.frameSize ?? 2048;
  const hop = opts.hop ?? 512;
  let detector = PitchDetector.forFloat32Array(frameSize);
  let rate = 0;
  let pending = new Float32Array(0);
  let nextT = 0;

  return {
    push(b) {
      if (b.sampleRate !== rate) {
        rate = b.sampleRate;
        detector = PitchDetector.forFloat32Array(frameSize);
        pending = new Float32Array(0);
      }
      const joined = new Float32Array(pending.length + b.samples.length);
      joined.set(pending);
      joined.set(b.samples, pending.length);
      let off = 0;
      while (joined.length - off >= frameSize) {
        const window = joined.subarray(off, off + frameSize);
        let sum = 0;
        for (let i = 0; i < frameSize; i++) sum += window[i]! * window[i]!;
        const rms = Math.sqrt(sum / frameSize);
        let hz: number | null = null;
        let clarity = 0;
        if (rms >= SILENCE_RMS) {
          const [pitch, c] = detector.findPitch(window, rate);
          clarity = c;
          if (Number.isFinite(pitch) && pitch >= MIN_HZ && pitch <= MAX_HZ) hz = pitch;
        }
        onFrame({ t: nextT, hz, clarity, rms });
        nextT += hop / rate;
        off += hop;
      }
      pending = joined.slice(off);
    },
    reset() {
      pending = new Float32Array(0);
      nextT = 0;
    },
  };
}
