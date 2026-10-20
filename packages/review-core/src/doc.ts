import type { CorrectionData, LyricsSegment } from './types';

/** Immutable working copy of a correction doc. `source` keeps every key the app does not model. */
export type ReviewDoc = {
  readonly source: CorrectionData;
  readonly segments: readonly LyricsSegment[];
  readonly isDuet: boolean;
};

export function fromCorrectionData(data: CorrectionData): ReviewDoc {
  return { source: data, segments: data.corrected_segments, isDuet: !!data.is_duet };
}

export function toSubmission(doc: ReviewDoc): CorrectionData {
  // Wordless segments carry no lyrics and would only confuse the renderer: never submit them.
  return { ...doc.source, corrected_segments: doc.segments.filter((s) => s.words.length > 0), is_duet: doc.isDuet };
}

/** Replace one segment, keeping every other segment's object identity. Out-of-range index is a no-op. */
export function replaceSegment(doc: ReviewDoc, index: number, seg: LyricsSegment): ReviewDoc {
  if (!Number.isInteger(index) || index < 0 || index >= doc.segments.length) return doc;
  return { ...doc, segments: doc.segments.map((s, i) => (i === index ? seg : s)) };
}
