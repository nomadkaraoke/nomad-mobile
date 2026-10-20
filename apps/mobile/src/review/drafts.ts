import type { InstrumentalChoice, LyricsSegment } from '@nomad/review-core';

import { appStorage } from '../storage';

/**
 * An in-progress review, kept so a killed app resumes where it was. Never holds media URLs or tokens:
 * only edited lyric segments and the person's choices.
 */
export type Draft = {
  v: 1;
  /** `metadata.audio_hash` of the doc the edits were made against; a draft for other audio is never applied. */
  audioHash: string | null;
  segments: LyricsSegment[];
  isDuet: boolean;
  /** True once the person toggled duet (is_duet is only sent to gen when loaded true or toggled). */
  isDuetTouched?: boolean;
  selection: InstrumentalChoice | null;
  editCount: number;
  savedAt: number;
};

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
 * The saved draft for this job, or null. A draft whose audio hash differs from `audioHash`
 * (gen's doc changed underneath it), or that is corrupt or an unknown version, is deleted.
 * A null server hash only matches a draft saved with a null hash.
 */
export function loadDraft(jobId: string, audioHash: string | null): Draft | null {
  const raw = appStorage.getString(key(jobId));
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Draft;
    if (d && d.v === 1 && Array.isArray(d.segments) && d.audioHash === audioHash) return d;
  } catch {
    // fall through to delete
  }
  clearDraft(jobId);
  return null;
}
