import type { ReviewDoc } from './doc';
import type { Word } from './types';
import { openVocalGaps } from './vocalGaps';

export type IssueKind = 'untimed' | 'vocal_gap' | 'ai_corrected' | 'estimated' | 'long_word' | 'long_gap';
export type Issue = { kind: IssueKind; segment: number; word?: number; time: number };

/** A word or silence longer than this is worth a look. */
export const LONG_SECONDS = 2;

/** Tie-break order for issues at the same time (also the bar's counter label order). */
export const ISSUE_KIND_ORDER: readonly IssueKind[] = [
  'untimed',
  'vocal_gap',
  'ai_corrected',
  'estimated',
  'long_word',
  'long_gap',
];

const isTimed = (w: Word): boolean => w.start_time !== null && w.end_time !== null;

/**
 * Everything a reviewer should look at, sorted by time (ties by kind priority, then document
 * position). One issue per run of untimed words, per AI span, per run of estimated words.
 */
export function collectIssues(doc: ReviewDoc): Issue[] {
  const out: Issue[] = [];
  let prevTimed: { end: number } | null = null;

  doc.segments.forEach((seg, s) => {
    const words = seg.words;
    const nearestTimed = (from: number): number | null => {
      for (let j = from; j >= 0; j--) if (words[j]!.start_time !== null) return words[j]!.start_time;
      for (let j = from + 1; j < words.length; j++) if (words[j]!.start_time !== null) return words[j]!.start_time;
      return null;
    };
    let untimedRun = false;
    let estimatedRun = false;
    let lastSpan: string | null | undefined;

    words.forEach((w, j) => {
      if (!isTimed(w)) {
        if (!untimedRun) {
          out.push({ kind: 'untimed', segment: s, word: j, time: nearestTimed(j) ?? seg.start_time ?? 0 });
        }
        untimedRun = true;
      } else untimedRun = false;

      const start = w.start_time ?? seg.start_time ?? 0;

      if (w.ai_corrected) {
        const span = w.correction_span_id ?? null;
        // A new span starts at a different span id, or at the first word of a run without ids.
        if (lastSpan === undefined || span !== lastSpan) {
          out.push({ kind: 'ai_corrected', segment: s, word: j, time: start });
        }
        lastSpan = span;
      } else lastSpan = undefined;

      if (w.timing_estimated && !w.ai_corrected) {
        if (!estimatedRun) out.push({ kind: 'estimated', segment: s, word: j, time: start });
        estimatedRun = true;
      } else estimatedRun = false;

      if (isTimed(w)) {
        const st = w.start_time as number;
        const en = w.end_time as number;
        if (en - st > LONG_SECONDS) out.push({ kind: 'long_word', segment: s, word: j, time: st });
        if (prevTimed && st - prevTimed.end > LONG_SECONDS) {
          out.push({ kind: 'long_gap', segment: s, word: j, time: prevTimed.end });
        }
        prevTimed = { end: Math.max(en, st) };
      }
    });
  });

  for (const gap of openVocalGaps(doc)) {
    const idx = doc.segments.findIndex((seg) => seg.words.some((w) => w.start_time !== null && w.start_time >= gap.start));
    out.push({ kind: 'vocal_gap', segment: idx === -1 ? Math.max(0, doc.segments.length - 1) : idx, time: gap.start });
  }

  const rank = (k: IssueKind): number => ISSUE_KIND_ORDER.indexOf(k);
  return out
    .map((issue, order) => ({ issue, order }))
    .sort(
      (a, b) =>
        a.issue.time - b.issue.time ||
        rank(a.issue.kind) - rank(b.issue.kind) ||
        a.issue.segment - b.issue.segment ||
        (a.issue.word ?? -1) - (b.issue.word ?? -1) ||
        a.order - b.order,
    )
    .map((x) => x.issue);
}
