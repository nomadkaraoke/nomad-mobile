import type { LyricsSegment, Word } from './types';

/** Tap To Sync window: a tap may land this far outside the segment. */
export const SYNC_WINDOW_SECONDS = 3;

const isTimed = (w: Word): w is Word & { start_time: number; end_time: number } => w.start_time !== null && w.end_time !== null;

/**
 * Repair timing from older jobs: clamp each word's end >= start, and derive the segment's
 * bounds from its first and last timed words. Null-timed words stay null. Returns the same
 * object when nothing changes.
 */
export function sanitizeSegment(seg: LyricsSegment): LyricsSegment {
  let changed = false;
  const words = seg.words.map((w) => {
    if (w.start_time !== null && w.end_time !== null && w.end_time < w.start_time) {
      changed = true;
      return { ...w, end_time: w.start_time };
    }
    return w;
  });
  const timed = words.filter(isTimed);
  const start = timed.length ? (timed[0]!.start_time as number) : null;
  const end = timed.length ? (timed[timed.length - 1]!.end_time as number) : null;
  if (!changed && start === seg.start_time && end === seg.end_time) return seg;
  return { ...seg, words, start_time: start, end_time: end };
}

export function countUntimedWords(segments: readonly LyricsSegment[]): number {
  let n = 0;
  for (const s of segments) for (const w of s.words) if (!isTimed(w)) n++;
  return n;
}

export function firstUntimed(segments: readonly LyricsSegment[]): { segment: number; word: number } | null {
  for (let i = 0; i < segments.length; i++) {
    const words = segments[i]!.words;
    for (let j = 0; j < words.length; j++) if (!isTimed(words[j]!)) return { segment: i, word: j };
  }
  return null;
}

/** Clamp a tap time to [segStart - 3, segEnd + 3], floored at 0 (gen useManualSync clampSyncTime). */
export function clampSyncTime(t: number, segStart: number, segEnd: number): number {
  const lo = Math.max(0, segStart - SYNC_WINDOW_SECONDS);
  return Math.min(Math.max(t, lo), segEnd + SYNC_WINDOW_SECONDS);
}

/**
 * Index of the line playing at time `t`: the last line starting at or before `t` (which is the
 * line containing `t` whenever lines don't overlap), else -1 before the first line. Binary search
 * over segment starts; a segment without a start inherits the nearest earlier timed start.
 */
export function activeLine(segments: readonly LyricsSegment[], t: number): number {
  const startOf = (i: number): number => {
    for (let k = i; k >= 0; k--) {
      const s = segments[k]!;
      const v = s.start_time ?? s.words.find((w) => w.start_time !== null)?.start_time ?? null;
      if (v !== null && v !== undefined) return v;
    }
    return -Infinity;
  };
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (startOf(mid) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Skip trailing untimed lines that merely inherited an earlier start.
  while (found > 0 && segments[found]!.start_time === null && !segments[found]!.words.some((w) => w.start_time !== null)) found--;
  return startOf(found) === -Infinity ? -1 : found;
}

/** End of the last timed word on the closest earlier line that has one, else null. */
export function prevTimedEnd(segments: readonly LyricsSegment[], s: number): number | null {
  for (let i = s - 1; i >= 0; i--) {
    for (let j = segments[i]!.words.length - 1; j >= 0; j--) {
      const w = segments[i]!.words[j]!;
      if (isTimed(w)) return w.end_time;
    }
  }
  return null;
}

/** Start of the first timed word on the closest later line that has one, else null. */
export function nextTimedStart(segments: readonly LyricsSegment[], s: number): number | null {
  for (let i = s + 1; i < segments.length; i++) {
    const w = segments[i]!.words.find(isTimed);
    if (w) return w.start_time;
  }
  return null;
}
