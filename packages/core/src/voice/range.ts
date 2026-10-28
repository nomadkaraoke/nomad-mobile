import { percentile, type VoicedFrame } from './frames';
import type { HeldNote } from './heldNotes';

export type RangeSummary = {
  low: number;
  high: number;
  comfortLow: number;
  comfortHigh: number;
  heldCount: number;
  freeVoicedS: number;
};

const MIN_FREE_S = 3;
const MIN_SPAN = 3;

/** Median gap between consecutive frame times (s): the hop, robust to dropped frames. */
export function medianSpacing(frames: VoicedFrame[]): number {
  if (frames.length < 2) return 0;
  const ts = frames.map((f) => f.t).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < ts.length; i++) diffs.push(ts[i]! - ts[i - 1]!);
  diffs.sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  return diffs.length % 2 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
}

/** Range from held notes (all phases), comfort from free singing when there is enough of it. */
export function summarizeRange(held: HeldNote[], free: VoicedFrame[]): RangeSummary | null {
  if (held.length < 2) return null;
  const notes = held.map((h) => h.note);
  const low = Math.min(...notes);
  const high = Math.max(...notes);
  const span = high - low;
  if (span < MIN_SPAN) return null;

  const freeVoicedS = free.length * medianSpacing(free);
  let comfortLow: number;
  let comfortHigh: number;
  if (freeVoicedS >= MIN_FREE_S) {
    const midis = free.map((f) => f.midi);
    comfortLow = Math.round(percentile(midis, 0.1));
    comfortHigh = Math.round(percentile(midis, 0.9));
  } else {
    comfortLow = low + Math.round(0.25 * span);
    comfortHigh = high - Math.round(0.25 * span);
  }
  const clamp = (n: number) => Math.min(high, Math.max(low, n));
  return { low, high, comfortLow: clamp(comfortLow), comfortHigh: clamp(comfortHigh), heldCount: held.length, freeVoicedS };
}

/**
 * The range with the high step's top note taken out as falsetto (the singer said so): `high` becomes the highest
 * high-step note at least 2 semitones below the top, else the top − 3 (never under `low`), and comfort is kept at or
 * under it. The voice type is then classified on this chest range.
 */
export function chestRangeBelowFalsetto(range: RangeSummary, highStepNotes: number[], top: number): RangeSummary {
  const below = highStepNotes.filter((n) => n <= top - 2);
  const high = Math.max(range.low, below.length ? Math.max(...below) : top - 3);
  if (high >= range.high) return range;
  const comfortHigh = Math.min(range.comfortHigh, high);
  return { ...range, high, comfortHigh, comfortLow: Math.min(range.comfortLow, comfortHigh) };
}
