// The quiz's Q2 ("where did it sit?") prefill from the singer's pitch summary and the song's range (Phase 3d).
import type { PitchSummary } from './pitchSummary';

export type SongPitchRange = { low: number; high: number; p10: number; p50: number; p90: number };

export type PositionPrefill = {
  /** The singer's highest / lowest held note in this song (rounded MIDI). */
  highest: number;
  lowest: number;
  /** `comfortable` when the singer reached both ends of the song's line; otherwise no suggestion. */
  suggested: 'comfortable' | null;
};

/** 0 first, so a tie keeps the song where it is. */
const OCTAVES = [0, -12, 12] as const;

/**
 * The octave the singer sang the song in: `o` minimising |s.p50 − (song.p50 + o)|. `comfortable` iff
 * s.heldHigh ≥ song.p90 + o − 1 and s.heldLow ≤ song.p10 + o + 1. Null without a summary; no suggestion without
 * the song's range.
 */
export function prefillPosition(s: PitchSummary | null, song: SongPitchRange | null): PositionPrefill | null {
  if (!s) return null;
  const out: PositionPrefill = { highest: s.heldHigh, lowest: s.heldLow, suggested: null };
  if (!song) return out;
  let o: number = OCTAVES[0];
  for (const c of OCTAVES) if (Math.abs(s.p50 - (song.p50 + c)) < Math.abs(s.p50 - (song.p50 + o))) o = c;
  if (s.heldHigh >= song.p90 + o - 1 && s.heldLow <= song.p10 + o + 1) out.suggested = 'comfortable';
  return out;
}
