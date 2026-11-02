import type { LyricsSegment, Word } from './types';
import { replaceSegment, type ReviewDoc } from './doc';
import { clampSyncTime, nextTimedStart, prevTimedEnd, sanitizeSegment } from './timing';

/** A press shorter than this is a tap (marks the onset only); longer is a hold (keeps its release). */
export const HOLD_THRESHOLD_MS = 200;
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

/**
 * Start a Tap To Sync pass on one line. A fully untimed line has no bounds of its own, so they
 * come from its neighbours, then `opts.fallbackStart/fallbackEnd`, then 0 / start + 10 s.
 */
export function createTapSync(doc: ReviewDoc, segmentIndex: number, opts: TapSyncOptions = {}): TapSyncState {
  const segment = doc.segments[segmentIndex];
  if (!segment) throw new RangeError(`createTapSync: no segment ${segmentIndex}`);
  const segStart =
    segment.start_time ?? timedStarts(segment.words)[0] ?? prevTimedEnd(doc.segments, segmentIndex) ?? opts.fallbackStart ?? 0;
  const segEnd =
    segment.end_time ??
    timedEnds(segment.words).pop() ??
    nextTimedStart(doc.segments, segmentIndex) ??
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

/**
 * Write the synced line back into the doc (sanitized: no word with end < start). The last tapped
 * word's end is capped just before the next timed word (in the line if it was not re-synced this
 * pass, else on the next line), so a stopped or finished pass never overlaps what follows.
 */
export function commitTapSync(doc: ReviewDoc, state: TapSyncState): ReviewDoc {
  let seg = state.segment;
  const last = state.synced.size ? Math.max(...state.synced) : -1;
  const lastWord = last >= 0 ? seg.words[last] : undefined;
  if (lastWord && lastWord.start_time !== null && lastWord.end_time !== null) {
    // A pass that stopped early (auto-stop after slow taps, or Done mid-line) leaves the untapped words after the last
    // tapped one with their old timings, which can now start BEFORE it ("transcribed" 18.74 after "ever" 19.6 in gen's
    // fixture, review-3 / review-10 on Android CI). Those timings are stale: clear them, so the untimed issue blocks
    // Finish and leads the singer there, instead of saving words that highlight out of order.
    const tappedStart = lastWord.start_time;
    seg = {
      ...seg,
      words: seg.words.map((w, j) =>
        j > last && w.start_time !== null && w.start_time < tappedStart ? { ...w, start_time: null, end_time: null } : w,
      ),
    };
    const inLine = seg.words.slice(last + 1).find((w) => w.start_time !== null);
    const nextStart = inLine ? (inLine.start_time as number) : nextTimedStart(doc.segments, state.segmentIndex);
    if (nextStart !== null) {
      const end = Math.max(Math.min(lastWord.end_time, nextStart - OVERLAP_BUFFER_SECONDS), lastWord.start_time);
      seg = withWord(seg, last, { end_time: end });
    }
  }
  return replaceSegment(doc, state.segmentIndex, sanitizeSegment(seg));
}
