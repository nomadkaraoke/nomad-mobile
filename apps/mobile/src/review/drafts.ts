import { docFingerprint, type CorrectionData, type InstrumentalChoice, type LyricsSegment } from '@nomad/review-core';

import { appStorage } from '../storage';

/**
 * An in-progress review, kept so a killed app resumes where it was. Never holds media URLs or tokens:
 * only edited lyric segments and the person's choices.
 */
export type Draft = {
  /** 2 added `serverFingerprint`; older drafts are dropped (they can't prove which doc they started from). */
  v: 2;
  /** `metadata.audio_hash` of the doc the edits were made against; a draft for other audio is never applied. */
  audioHash: string | null;
  /**
   * `docFingerprint` of the server doc the edits started from. Gen's doc changes when the review is finished
   * on the web (and may then come back to review with the same audio): a draft over another doc is stale.
   */
  serverFingerprint: string;
  segments: LyricsSegment[];
  isDuet: boolean;
  /** True once the person toggled duet (is_duet is only sent to gen when loaded true or toggled). */
  isDuetTouched?: boolean;
  selection: InstrumentalChoice | null;
  editCount: number;
  savedAt: number;
};

/** Which server doc a draft belongs to. */
export type DraftKey = { audioHash: string | null; serverFingerprint: string };

export function draftKeyOf(data: CorrectionData): DraftKey {
  return { audioHash: data.metadata?.audio_hash ?? null, serverFingerprint: docFingerprint(data) };
}

const key = (jobId: string) => `review-draft:${jobId}`;

export function clearDraft(jobId: string): void {
  appStorage.remove(key(jobId));
}

export function saveDraft(jobId: string, d: Draft): void {
  try {
    appStorage.set(key(jobId), JSON.stringify(d));
  } catch {
    // A draft is a convenience: a full or unavailable disk must not break editing.
  }
}

/**
 * The saved draft for this job, or null. A draft whose audio hash or server fingerprint differs from
 * `server` (gen's doc changed underneath it), or that is corrupt or an unknown version, is deleted.
 * A null server hash only matches a draft saved with a null hash.
 */
export function loadDraft(jobId: string, server: DraftKey): Draft | null {
  const raw = appStorage.getString(key(jobId));
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Draft;
    if (
      d &&
      d.v === 2 &&
      Array.isArray(d.segments) &&
      d.audioHash === server.audioHash &&
      d.serverFingerprint === server.serverFingerprint
    ) {
      return d;
    }
  } catch {
    // fall through to delete
  }
  clearDraft(jobId);
  return null;
}
