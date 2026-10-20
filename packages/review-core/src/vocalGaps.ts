import type { ReviewDoc } from './doc';
import { newId } from './edits';
import type { LyricsSegment, VocalGap, Word } from './types';

/** Words starting/ending this close to a gap edge are its neighbours (backend rounds to 2dp). */
export const GAP_EDGE_TOLERANCE_S = 0.05;
const EDGE_PAD_S = 0.05;
const MIN_WORD_S = 0.05;

type TimedWord = Word & { start_time: number; end_time: number };
const isTimed = (w: Word): w is TimedWord => w.start_time !== null && w.end_time !== null;

/**
 * Sung stretches the transcription skipped (evidenced or suspect) that still hold no timed
 * word. Derived from the current segments, so a gap closes as soon as words land in it and
 * reopens on undo; the server payload is never mutated.
 */
export function openVocalGaps(doc: ReviewDoc): VocalGap[] {
  const gaps = doc.source.vocal_gaps?.gaps ?? [];
  return gaps
    .filter((g) => (g.evidenced || g.suspect) && g.end > g.start)
    .filter(
      (g) =>
        !doc.segments.some((seg) =>
          seg.words.some(
            (w) =>
              isTimed(w) && w.start_time < g.end - GAP_EDGE_TOLERANCE_S && w.end_time > g.start + GAP_EDGE_TOLERANCE_S,
          ),
        ),
    )
    .sort((a, b) => a.start - b.start);
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

/**
 * Insert the reference lines for a gap at the right chronological place. Synced reference
 * lines (whose segments carry word timings inside the gap) keep those timings, fitted into the
 * room between the neighbouring lines; other lines go in untimed, bounded by the gap, so
 * Finish stays blocked until they are Tap-synced. With no reference lines at all, one empty
 * line spanning the gap is inserted for the reviewer to type into.
 */
export function insertGapLines(doc: ReviewDoc, gap: VocalGap): { doc: ReviewDoc; insertedAt: number } {
  const plan = planInsertion(gap, doc.segments);
  const following = plan.segments[plan.at];
  const preceding = plan.segments[plan.at - 1];
  const singer = following?.singer ?? preceding?.singer;
  const withSinger = singer !== undefined ? { singer } : {};

  const synced = firstNonEmpty(gap.synced_reference_lines);
  const picked = synced ?? firstNonEmpty(gap.reference_lines);
  let inserted: LyricsSegment[];

  if (!picked) {
    inserted = [{ id: newId('seg'), text: '', words: [], start_time: gap.start, end_time: gap.end, ...withSinger }];
  } else {
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
    const lo = Math.max(gap.start, (lastEnd(preceding) ?? -Infinity) + EDGE_PAD_S);
    const hi = Math.min(gap.end, (firstStart(following) ?? Infinity) - EDGE_PAD_S);
    inserted = fitToWindow(built, lo, hi);
  }

  return {
    doc: { ...doc, segments: [...plan.segments.slice(0, plan.at), ...inserted, ...plan.segments.slice(plan.at)] },
    insertedAt: plan.at,
  };
}
