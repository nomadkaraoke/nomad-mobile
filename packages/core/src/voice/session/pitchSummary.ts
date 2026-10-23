// A sung song's pitch summary (Phase 3d): what the app sends with an attempt instead of audio or raw frames.
import { percentile, type VoicedFrame } from '../frames';
import type { HeldNote } from '../heldNotes';
import { medianSpacing } from '../range';

/** decide's `PitchSummaryIn`, camelCase. MIDI numbers; `voicedS` in seconds. */
export type PitchSummary = {
  voicedS: number;
  heldCount: number;
  /** Lowest / highest held note (rounded MIDI). */
  heldLow: number;
  heldHigh: number;
  /** Nearest-rank percentiles of every voiced frame. */
  p10: number;
  p50: number;
  p90: number;
};

const MIN_VOICED_S = 10;
const MIN_HELD = 2;

/** The song's summary, or null with under 10 s of voiced singing or fewer than 2 held notes. */
export function summarizeSongPitch(frames: VoicedFrame[], held: HeldNote[]): PitchSummary | null {
  const voicedS = frames.length * medianSpacing(frames);
  if (voicedS < MIN_VOICED_S || held.length < MIN_HELD) return null;
  const notes = held.map((h) => h.note);
  const midis = frames.map((f) => f.midi);
  return {
    voicedS,
    heldCount: held.length,
    heldLow: Math.min(...notes),
    heldHigh: Math.max(...notes),
    p10: percentile(midis, 0.1),
    p50: percentile(midis, 0.5),
    p90: percentile(midis, 0.9),
  };
}
