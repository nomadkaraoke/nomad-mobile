import type { VoicedFrame } from './frames';

export type HeldNote = { start: number; end: number; midi: number; note: number };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median of an already-sorted array (same arithmetic as `median`, so results are bit-identical). */
function sortedMedian(s: number[]): number {
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Inserts x into ascending `s`, keeping it sorted (binary search for the slot, then one splice). */
function sortedInsert(s: number[], x: number): void {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m]! <= x) lo = m + 1;
    else hi = m;
  }
  s.splice(lo, 0, x);
}

/**
 * Held notes: runs where the rolling-median pitch stays within ±tolCents for ≥ minHoldS,
 * with voiced gaps no longer than maxGapS. The rolling median smooths vibrato and spikes.
 *
 * Cost: the run's median is kept in a sorted array that grows by one binary-search insert (a splice) per frame, so
 * extending a run costs O(log L) compares plus one memmove, instead of re-sorting the whole run every frame. That
 * re-sort made a call O(L² log L) and froze the JS thread on long held notes, because the voice test reruns this on
 * every mic buffer. Results are identical to the re-sorting version (same multiset, same median arithmetic).
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
    // Sorted copy of r[first..i]: its median is runMed.
    let run: number[] = [runMed];
    const close = (last: number) => {
      if (seg[last]!.t - seg[first]!.t >= minHoldS - eps) {
        notes.push({ start: seg[first]!.t, end: seg[last]!.t, midi: runMed, note: Math.round(runMed) });
      }
    };
    for (let i = 1; i < seg.length; i++) {
      if (Math.abs(r[i]! - runMed) <= tolCents / 100) {
        sortedInsert(run, r[i]!);
        runMed = sortedMedian(run);
      } else {
        close(i - 1);
        first = i;
        runMed = r[i]!;
        run = [runMed];
      }
    }
    close(seg.length - 1);
  }
  return notes;
}
