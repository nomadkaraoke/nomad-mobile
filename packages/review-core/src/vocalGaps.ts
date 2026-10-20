import type { ReviewDoc } from './doc';
import { newId } from './edits';
import type { LyricsSegment, VocalGap, Word } from './types';

/** Words starting/ending this close to a gap edge are its neighbours (backend rounds to 2dp). */
export const GAP_EDGE_TOLERANCE_S = 0.05;
const EDGE_PAD_S = 0.05;
const MIN_WORD_S = 0.05;

type TimedWord = Word & { start_time: number; end_time: number };
const isTimed = (w: Word): w is TimedWord => w.start_time !== null && w.end_time !== null;

export type OpenVocalGap = {
  gap: VocalGap;
  /**
   * Untimed words already sit between the gap's neighbouring timed words (the reviewer added or
   * inserted lyrics there but has not synced them yet). The UI offers "sync timing" instead of
   * Insert, which would duplicate the words.
   */
  pending: boolean;
  /** Line holding the first of those untimed words (open it for Tap To Sync), else null. */
  pendingSegment: number | null;
};

/** Line index of the first untimed word positioned (document order) between the gap's neighbours. */
function pendingSegmentOf(gap: VocalGap, segments: readonly LyricsSegment[]): number | null {
  const flat = segments.flatMap((seg, segIdx) => seg.words.map((w) => ({ w, segIdx })));
  let prev = -1;
  let next = flat.length;
  flat.forEach(({ w }, pos) => {
    if (w.start_time === null) return;
    if (w.start_time < gap.start + GAP_EDGE_TOLERANCE_S) prev = Math.max(prev, pos);
    else if (w.start_time >= gap.end - GAP_EDGE_TOLERANCE_S) next = Math.min(next, pos);
  });
  for (let pos = prev + 1; pos < next; pos++) if (flat[pos]!.w.start_time === null) return flat[pos]!.segIdx;
  return null;
}

/**
 * Evidenced vocal gaps (the lead vocal sings, no words there, and reference lyrics place lines
 * there; audio-only "suspect" gaps are too noisy) that still hold no timed word, in time order.
 * Derived from the current segments, so a gap closes as soon as words land in it and reopens on
 * undo; the server payload is never mutated. See `OpenVocalGap.pending`.
 */
export function openVocalGaps(doc: ReviewDoc): OpenVocalGap[] {
  const gaps = doc.source.vocal_gaps?.gaps ?? [];
  return gaps
    .filter((g) => g.evidenced && g.end > g.start)
    .filter(
      (g) =>
        !doc.segments.some((seg) =>
          seg.words.some(
            (w) =>
              isTimed(w) && w.start_time < g.end - GAP_EDGE_TOLERANCE_S && w.end_time > g.start + GAP_EDGE_TOLERANCE_S,
          ),
        ),
    )
    .sort((x, y) => x.start - y.start)
    .map((gap) => {
      const pendingSegment = pendingSegmentOf(gap, doc.segments);
      return { gap, pending: pendingSegment !== null, pendingSegment };
    });
}

function firstNonEmpty(by: Record<string, string[]> | undefined): { source: string; lines: string[] } | null {
  for (const [source, raw] of Object.entries(by ?? {})) {
    const lines = (raw ?? []).map((l) => (l ?? '').trim()).filter(Boolean);
    if (lines.length > 0) return { source, lines };
  }
  return null;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

function fromWords(base: LyricsSegment, words: Word[], id: string): LyricsSegment {
  const timed = words.filter(isTimed);
  return {
    ...base,
    id,
    words,
    text: words.map((w) => w.text).join(' '),
    start_time: timed.length ? Math.min(...timed.map((w) => w.start_time)) : null,
    end_time: timed.length ? Math.max(...timed.map((w) => w.end_time)) : null,
  };
}

/**
 * Where the gap's lines belong. If a line has timed words both before and after the gap middle
 * it is split there (the later words move to a new line).
 */
function planInsertion(gap: VocalGap, segments: readonly LyricsSegment[]): { segments: LyricsSegment[]; at: number } {
  const mid = (gap.start + gap.end) / 2;
  for (let i = 0; i < segments.length; i++) {
    const words = segments[i]!.words;
    const k = words.findIndex((w) => w.start_time !== null && w.start_time >= mid);
    if (k > 0 && words.some((w, j) => j < k && w.start_time !== null)) {
      const a = fromWords(segments[i]!, words.slice(0, k), segments[i]!.id);
      const b = fromWords(segments[i]!, words.slice(k), newId('seg'));
      return { segments: [...segments.slice(0, i), a, b, ...segments.slice(i + 1)], at: i + 1 };
    }
  }
  const idx = segments.findIndex((s) => s.words.some((w) => w.start_time !== null && w.start_time >= mid));
  return { segments: [...segments], at: idx === -1 ? segments.length : idx };
}

const lastEnd = (seg?: LyricsSegment): number | null => {
  const t = (seg?.words ?? []).filter(isTimed);
  return t.length ? t[t.length - 1]!.end_time : null;
};
const firstStart = (seg?: LyricsSegment): number | null => {
  const t = (seg?.words ?? []).find(isTimed);
  return t ? t.start_time : null;
};

/** Keep timed reference lines inside [lo, hi]; compress an overflowing one, untime one that cannot fit. */
function fitToWindow(lines: LyricsSegment[], lo: number, hi: number): LyricsSegment[] {
  let cursor = lo;
  return lines.map((seg) => {
    if (!seg.words.length || !seg.words.every(isTimed)) return seg;
    const t0 = seg.words[0]!.start_time as number;
    const t1 = seg.words[seg.words.length - 1]!.end_time as number;
    const start = Math.max(t0, cursor);
    const end = Math.min(t1, hi);
    if (t1 > t0 && start === t0 && end === t1) {
      cursor = t1;
      return seg;
    }
    if (t1 <= t0 || end - start < MIN_WORD_S * seg.words.length) {
      const words = seg.words.map((w) => ({ ...w, start_time: null, end_time: null }));
      return { ...seg, words, start_time: Math.max(lo, cursor), end_time: hi };
    }
    const k = (end - start) / (t1 - t0);
    const map = (t: number): number => Math.round((start + (t - t0) * k) * 1000) / 1000;
    const words = seg.words.map((w) => ({ ...w, start_time: map(w.start_time as number), end_time: map(w.end_time as number) }));
    cursor = end;
    return { ...seg, words, start_time: words[0]!.start_time, end_time: words[words.length - 1]!.end_time };
  });
}

/** Room the inserted lines may occupy: after the preceding line's last word, before the following line's first. */
function windowFor(gap: VocalGap, preceding?: LyricsSegment, following?: LyricsSegment): { lo: number; hi: number } {
  return {
    lo: Math.max(gap.start, (lastEnd(preceding) ?? -Infinity) + EDGE_PAD_S),
    hi: Math.min(gap.end, (firstStart(following) ?? Infinity) - EDGE_PAD_S),
  };
}

const splice = (doc: ReviewDoc, segs: LyricsSegment[], at: number, inserted: LyricsSegment[]): ReviewDoc => ({
  ...doc,
  segments: [...segs.slice(0, at), ...inserted, ...segs.slice(at)],
});

/**
 * Insert the reference lines for a gap at the right chronological place. Synced reference
 * lines (whose segments carry word timings inside the gap) keep those timings, fitted into the
 * room between the neighbouring lines; other lines go in untimed, bounded by the gap, so
 * Finish stays blocked until they are Tap-synced. With no usable reference lines nothing is
 * inserted: the result is `{doc (unchanged), insertedAt: -1, needsText: true}` and the UI asks
 * the reviewer to type the words (`insertGapText`).
 */
export function insertGapLines(
  doc: ReviewDoc,
  gap: VocalGap,
): { doc: ReviewDoc; insertedAt: number; needsText?: boolean } {
  const synced = firstNonEmpty(gap.synced_reference_lines);
  const picked = synced ?? firstNonEmpty(gap.reference_lines);
  if (!picked) return { doc, insertedAt: -1, needsText: true };

  const plan = planInsertion(gap, doc.segments);
  const following = plan.segments[plan.at];
  const preceding = plan.segments[plan.at - 1];
  const singer = following?.singer ?? preceding?.singer;
  const withSinger = singer !== undefined ? { singer } : {};

  const refSegs = synced ? doc.source.reference_lyrics?.[picked.source]?.segments ?? [] : [];
  const used = new Set<string>();
  const built: LyricsSegment[] = [];
  for (const line of picked.lines) {
    const texts = line.split(/\s+/).filter(Boolean);
    if (!texts.length) continue;
    const ref = refSegs.find((r) => {
      if (used.has(r.id) || norm(r.text) !== norm(line) || !r.words.length || !r.words.every(isTimed)) return false;
      const t0 = r.words[0]!.start_time as number;
      return t0 >= gap.start && t0 <= gap.end;
    });
    if (ref) {
      used.add(ref.id);
      const words: Word[] = ref.words.map((w) => ({
        id: newId('w'), text: w.text, start_time: w.start_time, end_time: w.end_time, confidence: 1,
      }));
      built.push({
        id: newId('seg'), text: words.map((w) => w.text).join(' '), words,
        start_time: words[0]!.start_time, end_time: words[words.length - 1]!.end_time, ...withSinger,
      });
    } else {
      const words: Word[] = texts.map((text) => ({
        id: newId('w'), text, start_time: null, end_time: null, confidence: 1,
      }));
      built.push({ id: newId('seg'), text: texts.join(' '), words, start_time: gap.start, end_time: gap.end, ...withSinger });
    }
  }
  const { lo, hi } = windowFor(gap, preceding, following);
  return { doc: splice(doc, plan.segments, plan.at, fitToWindow(built, lo, hi)), insertedAt: plan.at };
}

/**
 * Insert the reviewer's own words for a gap: one line per newline, the gap's room divided evenly
 * across lines and each line's words spread evenly, all marked `timing_estimated` so they show up
 * for scrutiny. Blank input inserts nothing (`insertedAt: -1`).
 */
export function insertGapText(doc: ReviewDoc, gap: VocalGap, text: string): { doc: ReviewDoc; insertedAt: number } {
  const lines = text.split(/\r?\n/).map((l) => l.split(/\s+/).filter(Boolean)).filter((l) => l.length > 0);
  if (!lines.length) return { doc, insertedAt: -1 };
  const plan = planInsertion(gap, doc.segments);
  const following = plan.segments[plan.at];
  const preceding = plan.segments[plan.at - 1];
  const singer = following?.singer ?? preceding?.singer;
  let { lo, hi } = windowFor(gap, preceding, following);
  const total = lines.reduce((n, l) => n + l.length, 0);
  if (hi - lo < MIN_WORD_S * total) {
    lo = gap.start;
    hi = gap.end;
  }
  const slot = (hi - lo) / total;
  let n = 0;
  const inserted: LyricsSegment[] = lines.map((texts) => {
    const words: Word[] = texts.map((t) => {
      const start = Math.round((lo + n * slot) * 1000) / 1000;
      const end = Math.round((lo + (n + 1) * slot) * 1000) / 1000;
      n++;
      return {
        id: newId('w'), text: t, start_time: start, end_time: end, confidence: 1,
        created_during_correction: true, timing_estimated: true,
      };
    });
    return {
      id: newId('seg'), text: texts.join(' '), words,
      start_time: words[0]!.start_time, end_time: words[words.length - 1]!.end_time,
      ...(singer !== undefined ? { singer } : {}),
    };
  });
  return { doc: splice(doc, plan.segments, plan.at, inserted), insertedAt: plan.at };
}
