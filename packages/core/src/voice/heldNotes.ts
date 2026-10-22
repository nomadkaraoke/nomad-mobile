import type { VoicedFrame } from './frames';

export type HeldNote = { start: number; end: number; midi: number; note: number };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Held notes: runs where the rolling-median pitch stays within ±tolCents for ≥ minHoldS,
 * with voiced gaps no longer than maxGapS. The rolling median smooths vibrato and spikes.
 */
export function findHeldNotes(
  frames: VoicedFrame[],
  opts: { minHoldS?: number; tolCents?: number; maxGapS?: number; medianWindowS?: number } = {},
): HeldNote[] {
  const { minHoldS = 0.5, tolCents = 50, maxGapS = 0.1, medianWindowS = 0.2 } = opts;
  const eps = 1e-9;
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const notes: HeldNote[] = [];

  const segments: VoicedFrame[][] = [];
  for (const f of sorted) {
    const seg = segments[segments.length - 1];
    if (seg && f.t - seg[seg.length - 1]!.t <= maxGapS + eps) seg.push(f);
    else segments.push([f]);
  }

  for (const seg of segments) {
    const r: number[] = [];
    let lo = 0;
    for (let i = 0; i < seg.length; i++) {
      while (seg[i]!.t - seg[lo]!.t > medianWindowS + eps) lo++;
      r.push(median(seg.slice(lo, i + 1).map((f) => f.midi)));
    }
    let first = 0;
    let runMed = r[0]!;
    const close = (last: number) => {
      if (seg[last]!.t - seg[first]!.t >= minHoldS - eps) {
        notes.push({ start: seg[first]!.t, end: seg[last]!.t, midi: runMed, note: Math.round(runMed) });
      }
    };
    for (let i = 1; i < seg.length; i++) {
      if (Math.abs(r[i]! - runMed) <= tolCents / 100) {
        runMed = median(r.slice(first, i + 1));
      } else {
        close(i - 1);
        first = i;
        runMed = r[i]!;
      }
    }
    close(seg.length - 1);
  }
  return notes;
}
