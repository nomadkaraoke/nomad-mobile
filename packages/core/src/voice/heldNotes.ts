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

export type HeldNoteOptions = { minHoldS?: number; tolCents?: number; maxGapS?: number; medianWindowS?: number };

export const HELD_NOTE_DEFAULTS = { minHoldS: 0.5, tolCents: 50, maxGapS: 0.1, medianWindowS: 0.2 } as const;

/**
 * Held notes: runs where the rolling-median pitch stays within ±tolCents for ≥ minHoldS,
 * with voiced gaps no longer than maxGapS. The rolling median smooths vibrato and spikes.
 *
 * Cost: the run's median is kept in a sorted array that grows by one binary-search insert (a splice) per frame, so
 * extending a run costs O(log L) compares plus one memmove, instead of re-sorting the whole run every frame. That
 * re-sort made a call O(L² log L) and froze the JS thread on long held notes, because the voice test reruns this on
 * every mic buffer. Results are identical to the re-sorting version (same multiset, same median arithmetic).
 */
export function findHeldNotes(frames: VoicedFrame[], opts: HeldNoteOptions = {}): HeldNote[] {
  return scanHeldNotes(frames, opts).notes;
}

/**
 * `findHeldNotes` plus what an incremental caller (`createHeldNoteTracker`) needs:
 * - `runsFrom`: frames with t < runsFrom only feed the rolling median; runs (and so notes) start at the first frame
 *   at or after it, with a fresh run median, exactly as if a run had just broken there.
 * - `openRunStart`: t of the first frame of the last run of the last segment (the only run later frames can still
 *   extend), or null with no frames. Every note and run before it is final: a run breaks on r[i], which only depends
 *   on frames up to i (the rolling median looks back, never ahead).
 */
export function scanHeldNotes(
  frames: VoicedFrame[],
  opts: HeldNoteOptions = {},
  runsFrom = -Infinity,
): { notes: HeldNote[]; openRunStart: number | null } {
  const { minHoldS, tolCents, maxGapS, medianWindowS } = { ...HELD_NOTE_DEFAULTS, ...opts };
  const eps = 1e-9;
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const notes: HeldNote[] = [];
  let openRunStart: number | null = null;

  const segments: VoicedFrame[][] = [];
  for (const f of sorted) {
    const seg = segments[segments.length - 1];
    if (seg && f.t - seg[seg.length - 1]!.t <= maxGapS + eps) seg.push(f);
    else segments.push([f]);
  }

  for (const seg of segments) {
    const begin = seg.findIndex((f) => f.t >= runsFrom);
    if (begin < 0) continue;
    const r: number[] = [];
    let lo = 0;
    for (let i = 0; i < seg.length; i++) {
      while (seg[i]!.t - seg[lo]!.t > medianWindowS + eps) lo++;
      r.push(i < begin ? NaN : median(seg.slice(lo, i + 1).map((f) => f.midi)));
    }
    let first = begin;
    let runMed = r[begin]!;
    // Sorted copy of r[first..i]: its median is runMed.
    let run: number[] = [runMed];
    const close = (last: number) => {
      if (seg[last]!.t - seg[first]!.t >= minHoldS - eps) {
        notes.push({ start: seg[first]!.t, end: seg[last]!.t, midi: runMed, note: Math.round(runMed) });
      }
    };
    for (let i = begin + 1; i < seg.length; i++) {
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
    openRunStart = seg[first]!.t;
  }
  return { notes, openRunStart };
}
