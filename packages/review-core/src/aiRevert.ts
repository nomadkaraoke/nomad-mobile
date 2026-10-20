import type { LyricsSegment, Word } from './types';
import type { ReviewDoc } from './doc';
import { sanitizeSegment } from './timing';

/** Wire shape of `metadata.auto_approval.undo_info[spanId]` (gen ServerSuggestionUndoInfo). */
export interface ServerSuggestionUndoInfo {
  op: 'replace' | 'delete' | 'insert_after';
  new_word_ids: string[];
  removed_words: Word[];
  segment_id: string;
  prev_word_id: string | null;
  removed_segment: { segment: LyricsSegment; index: number } | null;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function contiguousIndices(words: Word[], ids: string[]): number[] | null {
  const idx = ids.map((id) => words.findIndex((w) => w.id === id));
  if (idx.some((i) => i < 0)) return null;
  const sorted = [...idx].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1]! + 1) return null;
  return sorted;
}

function isUndoInfo(raw: unknown): raw is ServerSuggestionUndoInfo {
  const r = raw as Partial<ServerSuggestionUndoInfo> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    Array.isArray(r.new_word_ids) &&
    Array.isArray(r.removed_words) &&
    typeof r.segment_id === 'string'
  );
}

/**
 * Revert one applied AI suggestion using the server's undo info. Returns the doc unchanged when the
 * info is missing or malformed, or when the span's words were edited since (no safe revert).
 */
export function revertAiSpan(doc: ReviewDoc, spanId: string): ReviewDoc {
  const raw = (doc.source.metadata.auto_approval?.undo_info ?? {})[spanId];
  if (!isUndoInfo(raw)) return doc;

  if (raw.removed_segment) {
    const { segment, index } = raw.removed_segment;
    if (doc.segments.some((s) => s.id === segment.id)) return doc;
    const at = Math.min(Math.max(index, 0), doc.segments.length);
    const restored = sanitizeSegment(clone(segment));
    return { ...doc, segments: [...doc.segments.slice(0, at), restored, ...doc.segments.slice(at)] };
  }

  const segIndex = doc.segments.findIndex((s) => s.id === raw.segment_id);
  if (segIndex < 0) return doc;
  const seg = doc.segments[segIndex]!;
  const words = [...seg.words];

  // Idempotency: a repeated revert must not re-insert words already present.
  if (raw.removed_words.some((r) => doc.segments.some((s) => s.words.some((w) => w.id === r.id)))) return doc;

  if (raw.new_word_ids.length > 0) {
    const sorted = contiguousIndices(words, raw.new_word_ids);
    if (!sorted) return doc;
    words.splice(sorted[0]!, sorted.length, ...clone(raw.removed_words));
  } else {
    let at = 0;
    if (raw.prev_word_id) {
      const prev = words.findIndex((w) => w.id === raw.prev_word_id);
      if (prev < 0) return doc;
      at = prev + 1;
    }
    words.splice(at, 0, ...clone(raw.removed_words));
  }

  const next = sanitizeSegment({ ...seg, words, text: words.map((w) => w.text).join(' ') });
  return { ...doc, segments: doc.segments.map((s, i) => (i === segIndex ? next : s)) };
}
