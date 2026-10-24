import { hzToMidi } from './notes';

export type PitchFrame = { t: number; hz: number | null; clarity: number; rms: number };
export type VoicedFrame = { t: number; midi: number };

/** Nearest-rank percentile (p in 0..1): sorted[ceil(p·n) − 1]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

/** max(0.003, 3 × P90(rms)) over the first 1.0 s of frames. */
export function noiseFloor(frames: PitchFrame[]): number {
  const rms = frames.filter((f) => f.t < 1.0).map((f) => f.rms);
  if (rms.length === 0) return 0.003;
  return Math.max(0.003, 3 * percentile(rms, 0.9));
}

/** Keeps clear, loud-enough, in-band frames as MIDI. */
export function gateFrames(
  frames: PitchFrame[],
  floor: number,
  opts: { minClarity?: number; minHz?: number; maxHz?: number } = {},
): VoicedFrame[] {
  const { minClarity = 0.9, minHz = 60, maxHz = 1200 } = opts;
  const out: VoicedFrame[] = [];
  for (const f of frames) {
    if (f.hz === null || f.clarity < minClarity || f.rms <= floor || f.hz < minHz || f.hz > maxHz) continue;
    out.push({ t: f.t, midi: hzToMidi(f.hz) });
  }
  return out;
}
