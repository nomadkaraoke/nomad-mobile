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

/**
 * The doc to send to gen: the source with the edited segments. Wordless segments carry no lyrics and would
 * only confuse the renderer, so they are never submitted. `is_duet` stays as the source had it (absent stays
 * absent) unless `isDuet` is given: callers pass it only when the flag is known (loaded true, or toggled),
 * because gen treats any non-null value as an instruction.
 */
export function toSubmission(doc: ReviewDoc, isDuet?: boolean): CorrectionData {
  const out: CorrectionData = { ...doc.source, corrected_segments: doc.segments.filter((s) => s.words.length > 0) };
  if (isDuet !== undefined) out.is_duet = isDuet;
  return out;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over a string's UTF-16 code units. */
function fnv1a(s: string, seed = FNV_OFFSET): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

/**
 * A cheap stable fingerprint of a server doc's lyrics: every segment's id and every word's id, text and
 * timings (and singers), in order. Two docs with the same fingerprint carry the same corrected lyrics. A draft keeps the
 * fingerprint of the doc it started from, so it is only restored over that same doc: corrections made
 * elsewhere (the web) change it and the stale draft is dropped. Not a security hash.
 */
export function docFingerprint(data: Pick<CorrectionData, 'corrected_segments'>): string {
  const parts: string[] = [];
  for (const seg of data.corrected_segments ?? []) {
    parts.push(`S${seg.id}\u001f${seg.singer ?? ''}`);
    for (const w of seg.words ?? []) {
      parts.push(`W${w.id}\u001f${w.text}\u001f${w.start_time ?? ''}\u001f${w.end_time ?? ''}\u001f${w.singer ?? ''}`);
    }
  }
  const canon = parts.join('\u001e');
  // Two FNV-1a passes with different seeds (64 bits) plus the length keep accidental collisions negligible.
  const a = fnv1a(canon).toString(16).padStart(8, '0');
  const b = fnv1a(canon, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${canon.length.toString(36)}-${a}${b}`;
}

/** Replace one segment, keeping every other segment's object identity. Out-of-range index is a no-op. */
export function replaceSegment(doc: ReviewDoc, index: number, seg: LyricsSegment): ReviewDoc {
  if (!Number.isInteger(index) || index < 0 || index >= doc.segments.length) return doc;
  return { ...doc, segments: doc.segments.map((s, i) => (i === index ? seg : s)) };
}
