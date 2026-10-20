import type { LyricsSegment, Word } from './types';

/** Tap To Sync window: a tap may land this far outside the segment. */
export const SYNC_WINDOW_SECONDS = 3;

const isTimed = (w: Word): boolean => w.start_time !== null && w.end_time !== null;

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
