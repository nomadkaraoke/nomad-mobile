import type { LyricsSegment, SingerId, Word } from './types';
import { replaceSegment, type ReviewDoc } from './doc';
import { nextTimedStart, prevTimedEnd, sanitizeSegment } from './timing';

/** Minimum word length in seconds. */
export const MIN_WORD_SECONDS = 0.05;
/** Timing differences below this (seconds) are rounding noise. */
const TIME_EPSILON = 1e-6;
/** Millisecond rounding, so repeated steps don't accumulate float error. */
const ms = (t: number): number => Math.round(t * 1000) / 1000;

let idCounter = 0;
/** Pure-JS unique id (no nanoid / crypto dependency). */
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const isTimed = (w: Word): boolean => w.start_time !== null && w.end_time !== null;
const joinText = (words: readonly Word[]): string => words.map((w) => w.text).join(' ');
const splitText = (text: string): string[] => text.split(/\s+/).filter((p) => p.length > 0);

function rebuild(seg: LyricsSegment, words: Word[]): LyricsSegment {
  return sanitizeSegment({ ...seg, words, text: joinText(words) });
}

function getWord(doc: ReviewDoc, s: number, w: number): { seg: LyricsSegment; word: Word } | null {
  const seg = doc.segments[s];
  const word = seg?.words[w];
  return seg && word ? { seg, word } : null;
}

function withSegments(doc: ReviewDoc, segments: LyricsSegment[]): ReviewDoc {
  return { ...doc, segments };
}

/** Evenly spread [start, end] over n slots. */
function spread(n: number, start: number, end: number): Array<[number, number]> {
  const step = (end - start) / n;
  return Array.from({ length: n }, (_, i) => [start + i * step, start + (i + 1) * step] as [number, number]);
}

// ---------------------------------------------------------------- words

export function deleteLine(doc: ReviewDoc, s: number): ReviewDoc {
  if (!doc.segments[s]) return doc;
  return withSegments(doc, doc.segments.filter((_, i) => i !== s));
}

export function deleteWord(doc: ReviewDoc, s: number, w: number): ReviewDoc {
  const hit = getWord(doc, s, w);
  if (!hit) return doc;
  const words = hit.seg.words.filter((_, i) => i !== w);
  if (words.length === 0) return deleteLine(doc, s);
  return replaceSegment(doc, s, rebuild(hit.seg, words));
}

export function splitWord(doc: ReviewDoc, s: number, w: number, parts: string[]): ReviewDoc {
  const hit = getWord(doc, s, w);
  const texts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (!hit || texts.length === 0) return doc;
  const { seg, word } = hit;
  const timed = isTimed(word);
  const slots = timed ? spread(texts.length, word.start_time as number, word.end_time as number) : [];
  const pieces: Word[] = texts.map((text, k) => {
    const { original_text: _o, ...rest } = word;
    return {
      ...rest,
      ...(k === 0 && word.original_text !== undefined ? { original_text: word.original_text } : {}),
      id: `${word.id}_s${k}`,
      text,
      start_time: timed ? slots[k]![0] : null,
      end_time: timed ? slots[k]![1] : null,
      timing_estimated: true,
    };
  });
  const words = [...seg.words.slice(0, w), ...pieces, ...seg.words.slice(w + 1)];
  return replaceSegment(doc, s, rebuild(seg, words));
}

export function editWordText(doc: ReviewDoc, s: number, w: number, text: string): ReviewDoc {
  const hit = getWord(doc, s, w);
  if (!hit) return doc;
  const parts = splitText(text);
  if (parts.length === 0) return deleteWord(doc, s, w);
  if (parts.length > 1) return splitWord(doc, s, w, parts);
  const words = hit.seg.words.map((x, i) => (i === w ? { ...x, text: parts[0]! } : x));
  return replaceSegment(doc, s, rebuild(hit.seg, words));
}

export function mergeWords(doc: ReviewDoc, s: number, w: number): ReviewDoc {
  const a = getWord(doc, s, w);
  const b = getWord(doc, s, w + 1);
  if (!a || !b) return doc;
  let start = a.word.start_time ?? b.word.start_time;
  let end = b.word.end_time ?? a.word.end_time;
  if (start === null || end === null) start = end = null; // never leave a half-timed word
  const merged: Word = { ...a.word, text: `${a.word.text} ${b.word.text}`, start_time: start, end_time: end };
  const words = [...a.seg.words.slice(0, w), merged, ...a.seg.words.slice(w + 2)];
  return replaceSegment(doc, s, rebuild(a.seg, words));
}

// ---------------------------------------------------------------- lines

/** Longest-common-subsequence match: returns newIndex -> oldIndex for matched words. */
function lcsMatches(oldKeys: string[], newKeys: string[]): Map<number, number> {
  const n = oldKeys.length;
  const m = newKeys.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = oldKeys[i] === newKeys[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldKeys[i] === newKeys[j]) {
      out.set(j, i);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/**
 * Re-type a whole line. Words that survive an LCS diff (case-folded) keep their timings; new words
 * are spread evenly between their timed neighbours (or the segment bounds) and flagged
 * `timing_estimated`. `estimated` counts the words that were given estimated timing.
 */
export function applyLineText(doc: ReviewDoc, s: number, text: string): { doc: ReviewDoc; estimated: number } {
  const seg = doc.segments[s];
  if (!seg) return { doc, estimated: 0 };
  const texts = splitText(text);
  if (texts.length === 0) return { doc: deleteLine(doc, s), estimated: 0 };

  const fold = (t: string): string => t.toLowerCase();
  const matches = lcsMatches(seg.words.map((x) => fold(x.text)), texts.map(fold));
  const words: Word[] = texts.map((t, j) => {
    const oi = matches.get(j);
    if (oi !== undefined) return { ...seg.words[oi]!, text: t };
    return { id: newId('w'), text: t, start_time: null, end_time: null, confidence: 1, created_during_correction: true };
  });

  let estimated = 0;
  let j = 0;
  while (j < texts.length) {
    if (matches.has(j)) {
      j++;
      continue;
    }
    let k = j;
    while (k < texts.length && !matches.has(k)) k++;
    const prev = j > 0 ? words[j - 1]! : null;
    const next = k < texts.length ? words[k]! : null;
    const lo = prev && isTimed(prev) ? (prev.end_time as number) : seg.start_time;
    const hi = next && isTimed(next) ? (next.start_time as number) : seg.end_time;
    if (lo !== null && hi !== null) {
      const slots = spread(k - j, lo, Math.max(hi, lo));
      for (let x = j; x < k; x++) {
        words[x] = { ...words[x]!, start_time: slots[x - j]![0], end_time: slots[x - j]![1], timing_estimated: true };
        estimated++;
      }
    }
    j = k;
  }
  return { doc: replaceSegment(doc, s, rebuild(seg, words)), estimated };
}

export function splitLine(doc: ReviewDoc, s: number, w: number): ReviewDoc {
  const seg = doc.segments[s];
  if (!seg || !Number.isInteger(w) || w <= 0 || w >= seg.words.length) return doc;
  const first = rebuild(seg, seg.words.slice(0, w));
  const second = rebuild(
    { ...seg, id: newId('seg') },
    seg.words.slice(w),
  );
  const segments = [...doc.segments.slice(0, s), first, second, ...doc.segments.slice(s + 1)];
  return withSegments(doc, segments);
}

const resolveSinger = (seg: LyricsSegment): SingerId => seg.singer ?? 1;

export function mergeLines(doc: ReviewDoc, s: number): ReviewDoc {
  const a = doc.segments[s];
  const b = doc.segments[s + 1];
  if (!a || !b) return doc;
  const differ = resolveSinger(a) !== resolveSinger(b);
  const second = b.words.map((x) => (x.singer === undefined && differ ? { ...x, singer: resolveSinger(b) } : x));
  const merged = rebuild(a, [...a.words, ...second]);
  return withSegments(doc, [...doc.segments.slice(0, s), merged, ...doc.segments.slice(s + 2)]);
}

/** Insert a new line after segment `afterS` (-1 = at the start). Words are evenly timed over [start, end]. */
export function insertLine(doc: ReviewDoc, afterS: number, text: string, start: number, end: number): ReviewDoc {
  const texts = splitText(text);
  if (texts.length === 0 || afterS < -1 || afterS >= doc.segments.length) return doc;
  const slots = spread(texts.length, start, Math.max(end, start));
  const words: Word[] = texts.map((t, i) => ({
    id: newId('w'),
    text: t,
    start_time: slots[i]![0],
    end_time: slots[i]![1],
    confidence: 1,
    created_during_correction: true,
  }));
  const anchor = doc.segments[afterS];
  const seg = sanitizeSegment({
    id: newId('seg'),
    text: joinText(words),
    words,
    start_time: start,
    end_time: end,
    ...(anchor?.singer !== undefined ? { singer: anchor.singer } : {}),
  });
  return withSegments(doc, [...doc.segments.slice(0, afterS + 1), seg, ...doc.segments.slice(afterS + 1)]);
}

/** Room given to an inserted line when no later line bounds it. */
export const INSERT_FALLBACK_SECONDS = 3;

/**
 * Insert a typed line after segment `afterS` (-1 = at the start), timed by estimate: its words are
 * spread evenly from the end of the previous timed line to the start of the next one (or
 * `INSERT_FALLBACK_SECONDS` past it when nothing follows, capped at `audioDuration` when given) and flagged
 * `timing_estimated`. When the
 * room is too small for a minimum-length word each, the words go in untimed (Finish stays blocked
 * until they are synced). Blank text inserts nothing (`insertedAt: -1`).
 */
export function insertLineEstimated(
  doc: ReviewDoc,
  afterS: number,
  text: string,
  audioDuration?: number,
): { doc: ReviewDoc; insertedAt: number; timed: boolean } {
  const n = splitText(text).length;
  if (n === 0 || afterS < -1 || afterS >= doc.segments.length) return { doc, insertedAt: -1, timed: false };
  const lo = prevTimedEnd(doc.segments, afterS + 1) ?? 0;
  const next = nextTimedStart(doc.segments, afterS);
  // After the last line the fallback window never runs past the end of the audio.
  const hi = next ?? Math.min(lo + INSERT_FALLBACK_SECONDS, audioDuration ?? Infinity);
  const at = afterS + 1;
  const inserted = insertLine(doc, afterS, text, lo, Math.max(hi, lo));
  const timed = hi - lo >= MIN_WORD_SECONDS * n;
  const seg = inserted.segments[at]!;
  const words: Word[] = seg.words.map((w) =>
    timed ? { ...w, timing_estimated: true } : { ...w, start_time: null, end_time: null },
  );
  return { doc: replaceSegment(inserted, at, rebuild(seg, words)), insertedAt: at, timed };
}

// ---------------------------------------------------------------- timing

/** Last timed end strictly before (s, w), searching back across lines. */
function prevEnd(doc: ReviewDoc, s: number, w: number): number | null {
  for (let i = s; i >= 0; i--) {
    const words = doc.segments[i]!.words;
    for (let j = i === s ? w - 1 : words.length - 1; j >= 0; j--) {
      if (isTimed(words[j]!)) return words[j]!.end_time as number;
    }
  }
  return null;
}

/** First timed start strictly after (s, w), searching forward across lines. */
function nextStart(doc: ReviewDoc, s: number, w: number): number | null {
  for (let i = s; i < doc.segments.length; i++) {
    const words = doc.segments[i]!.words;
    for (let j = i === s ? w + 1 : 0; j < words.length; j++) {
      if (isTimed(words[j]!)) return words[j]!.start_time as number;
    }
  }
  return null;
}

/** Move a whole line by `delta` seconds, relative word timings intact, without crossing neighbours. */
export function shiftLine(doc: ReviewDoc, s: number, delta: number): ReviewDoc {
  const seg = doc.segments[s];
  if (!seg) return doc;
  const timed = seg.words.filter(isTimed);
  if (timed.length === 0) return doc;
  const lineStart = timed[0]!.start_time as number;
  const lineEnd = timed[timed.length - 1]!.end_time as number;
  const before = prevEnd(doc, s, 0);
  const after = nextStart(doc, s, seg.words.length - 1);
  const minDelta = Math.max(before ?? 0, 0) - lineStart;
  const maxDelta = after === null ? Infinity : after - lineEnd;
  const d = Math.min(Math.max(delta, minDelta), maxDelta);
  // Below a microsecond is float dust from repeated steps against a clamp, not a move. A clamp that
  // reverses the direction (a line already overlapping its neighbour) is not a move either: "earlier"
  // must never push a line later.
  if (Math.abs(d) < TIME_EPSILON || Math.sign(d) !== Math.sign(delta)) return doc;
  const words = seg.words.map((x) =>
    isTimed(x) ? { ...x, start_time: ms((x.start_time as number) + d), end_time: ms((x.end_time as number) + d) } : x,
  );
  return replaceSegment(doc, s, rebuild(seg, words));
}

export type WordTimingPatch = { start?: number; end?: number; audioDuration?: number };

/**
 * Set a word's timing with clamps: start >= previous word's end (across lines) and >= 0;
 * end <= next word's start (across lines) and <= audioDuration when given; end >= start + 0.05.
 */
export function setWordTiming(doc: ReviewDoc, s: number, w: number, patch: WordTimingPatch): ReviewDoc {
  const hit = getWord(doc, s, w);
  if (!hit) return doc;
  let start = patch.start ?? hit.word.start_time;
  let end = patch.end ?? hit.word.end_time;
  if (start === null && end === null) return doc;
  if (start === null) start = (end as number) - MIN_WORD_SECONDS;
  if (end === null) end = start + MIN_WORD_SECONDS;

  const lo = Math.max(prevEnd(doc, s, w) ?? 0, 0);
  const ns = nextStart(doc, s, w);
  const hi = Math.min(ns ?? Infinity, patch.audioDuration ?? Infinity);
  if (hi - lo < MIN_WORD_SECONDS) return doc; // no room to place a minimum-length word
  start = Math.max(lo, Math.min(start, hi - MIN_WORD_SECONDS));
  end = Math.max(start + MIN_WORD_SECONDS, Math.min(end, hi));
  if (start === hit.word.start_time && end === hit.word.end_time) return doc;
  const words = hit.seg.words.map((x, i) => (i === w ? { ...x, start_time: start, end_time: end } : x));
  return replaceSegment(doc, s, rebuild(hit.seg, words));
}

// ---------------------------------------------------------------- duet

export function setLineSinger(doc: ReviewDoc, s: number, singer: SingerId): ReviewDoc {
  const seg = doc.segments[s];
  if (!seg) return doc;
  return replaceSegment(doc, s, { ...seg, singer });
}

/** Turning duet off strips every `singer` field from lines and words. */
export function setDuet(doc: ReviewDoc, on: boolean): ReviewDoc {
  if (on) return { ...doc, isDuet: true };
  const segments = doc.segments.map((seg) => {
    const hasWordSinger = seg.words.some((x) => x.singer !== undefined);
    if (seg.singer === undefined && !hasWordSinger) return seg;
    const { singer: _s, ...rest } = seg;
    return { ...rest, words: seg.words.map(({ singer: _w, ...x }) => x) };
  });
  return { ...doc, isDuet: false, segments };
}
