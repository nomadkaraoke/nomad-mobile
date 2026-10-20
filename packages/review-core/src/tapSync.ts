import type { LyricsSegment, Word } from './types';
import { replaceSegment, type ReviewDoc } from './doc';
import { clampSyncTime, sanitizeSegment } from './timing';

/** A press shorter than this is a tap (marks the onset only); longer is a hold (keeps its release). */
export const HOLD_THRESHOLD_MS = 250;
/** A tapped word never grows longer than this when its end is gap-filled. */
export const MAX_TAP_GAP_FILL_SECONDS = 1.0;
/** Keep this clear of the next word's onset. */
export const OVERLAP_BUFFER_SECONDS = 0.01;
/** Stop this long after the line end unless the user is still holding. */
export const STOP_AFTER_END_SECONDS = 1;
/** Used as the line end when nothing at all is known about it. */
const UNKNOWN_END_SPAN_SECONDS = 10;

export type TapSyncState = {
  segmentIndex: number;
  wordIndex: number;
  holding: boolean;
  done: boolean;
  /** Word indices that received a fresh start in this pass. */
  synced: ReadonlySet<number>;
  /** Working copy of the segment (not sanitized until commit). */
  segment: LyricsSegment;
  /** Window the taps are clamped into (the line's bounds as they were when sync started). */
  segStart: number;
  segEnd: number;
  /** Whether the previous word was a tap (gap-fill) or a hold (keep release). */
  prevWasTap: boolean;
};

export type TapSyncOptions = { fallbackStart?: number; fallbackEnd?: number };

const timedStarts = (words: readonly Word[]): number[] =>
  words.filter((w) => w.start_time !== null).map((w) => w.start_time as number);
const timedEnds = (words: readonly Word[]): number[] =>
  words.filter((w) => w.end_time !== null).map((w) => w.end_time as number);

function neighbourEnd(doc: ReviewDoc, s: number): number | null {
  for (let i = s - 1; i >= 0; i--) {
    const e = doc.segments[i]!.end_time ?? timedEnds(doc.segments[i]!.words).pop();
    if (e !== undefined && e !== null) return e;
  }
  return null;
}

function neighbourStart(doc: ReviewDoc, s: number): number | null {
  for (let i = s + 1; i < doc.segments.length; i++) {
    const st = doc.segments[i]!.start_time ?? timedStarts(doc.segments[i]!.words)[0];
    if (st !== undefined && st !== null) return st;
  }
  return null;
}

/**
 * Start a Tap To Sync pass on one line. A fully untimed line has no bounds of its own, so they
 * come from its neighbours, then `opts.fallbackStart/fallbackEnd`, then 0 / start + 10 s.
 */
export function createTapSync(doc: ReviewDoc, segmentIndex: number, opts: TapSyncOptions = {}): TapSyncState {
  const segment = doc.segments[segmentIndex];
  if (!segment) throw new RangeError(`createTapSync: no segment ${segmentIndex}`);
  const segStart =
    segment.start_time ?? timedStarts(segment.words)[0] ?? neighbourEnd(doc, segmentIndex) ?? opts.fallbackStart ?? 0;
  const segEnd =
    segment.end_time ??
    timedEnds(segment.words).pop() ??
    neighbourStart(doc, segmentIndex) ??
    opts.fallbackEnd ??
    segStart + UNKNOWN_END_SPAN_SECONDS;
  return {
    segmentIndex,
    wordIndex: 0,
    holding: false,
    done: segment.words.length === 0,
    synced: new Set<number>(),
    segment,
    segStart,
    segEnd: Math.max(segEnd, segStart),
    prevWasTap: false,
  };
}

const withWord = (seg: LyricsSegment, i: number, patch: Partial<Word>): LyricsSegment => ({
  ...seg,
  words: seg.words.map((w, j) => (j === i ? { ...w, ...patch } : w)),
});

/** Finish the previous word once the next onset is known (gen adjustPreviousWordEnd). */
function settlePrevious(seg: LyricsSegment, i: number, nextStart: number, wasTap: boolean): LyricsSegment {
  const prev = seg.words[i];
  if (!prev || prev.start_time === null) return seg;
  const start = prev.start_time;
  if (wasTap) {
    const end = Math.min(nextStart - OVERLAP_BUFFER_SECONDS, start + MAX_TAP_GAP_FILL_SECONDS);
    return withWord(seg, i, { end_time: Math.max(end, start) });
  }
  if (prev.end_time === null || prev.end_time > nextStart) {
    return withWord(seg, i, { end_time: Math.max(nextStart - OVERLAP_BUFFER_SECONDS, start) });
  }
  return seg;
}

/** Finger down: the current word starts now. */
export function press(state: TapSyncState, t: number): TapSyncState {
  if (state.done || state.holding) return state;
  const i = state.wordIndex;
  const start = clampSyncTime(t, state.segStart, state.segEnd);
  let segment = i > 0 ? settlePrevious(state.segment, i - 1, start, state.prevWasTap) : state.segment;
  // end = start until release, so an abandoned press can never keep a stale end.
  segment = withWord(segment, i, { start_time: start, end_time: start });
  return { ...state, segment, holding: true, synced: new Set(state.synced).add(i) };
}

/** Finger up: a hold ends at the release time, a tap is gap-filled (and finished on the next press). */
export function release(state: TapSyncState, t: number, heldMs: number): TapSyncState {
  if (state.done || !state.holding) return state;
  const i = state.wordIndex;
  const start = state.segment.words[i]!.start_time as number;
  const isTap = heldMs < HOLD_THRESHOLD_MS;
  // A tap's provisional end is start + cap. It is deliberately NOT capped by the next word's
  // old start (stale: that word has not been re-tapped this pass); the next press corrects it.
  const end = isTap ? start + MAX_TAP_GAP_FILL_SECONDS : Math.max(t, start);
  return {
    ...state,
    segment: withWord(state.segment, i, { end_time: end }),
    holding: false,
    prevWasTap: isTap,
    done: i >= state.segment.words.length - 1,
    wordIndex: i >= state.segment.words.length - 1 ? i : i + 1,
  };
}

/** The pass auto-stops one second after the line end, unless a hold is in progress. */
export function shouldStop(state: TapSyncState, t: number): boolean {
  return !state.holding && t > state.segEnd + STOP_AFTER_END_SECONDS;
}

/** Write the synced line back into the doc (sanitized: no word with end < start). */
export function commitTapSync(doc: ReviewDoc, state: TapSyncState): ReviewDoc {
  return replaceSegment(doc, state.segmentIndex, sanitizeSegment(state.segment));
}
