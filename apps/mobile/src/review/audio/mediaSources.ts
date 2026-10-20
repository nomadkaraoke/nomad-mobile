import { getInstrumentalUrls } from '@nomad/api-gen';
import { mediaUrl, type InstrumentalChoice, type InstrumentalOption } from '@nomad/review-core';

import { useAuth } from '../../auth/store';
import { GEN_API_URL } from '../../config';

/** A player error triggers at most this many URL refreshes (fresh options + fresh token) before it is surfaced. */
export const MAX_URL_REFRESHES = 3;

export type ReviewSource = 'vocals' | 'song';

/** Tokens never persist: build URLs at play time, from the signed-in session. */
const token = (): string | null => useAuth.getState().getToken();

/** The full song (`/audio`) or the vocals-only stem (`/audio/vocals`, 202 while separating). Range-capable. */
export function reviewAudioUrl(jobId: string, source: ReviewSource): string {
  const path = source === 'vocals' ? 'audio/vocals' : 'audio';
  return mediaUrl(GEN_API_URL, jobId, `/api/review/${encodeURIComponent(jobId)}/${path}`, token());
}

/** The instrumental stem's playable URL, or null when gen has not produced it yet. */
export function instrumentalUrl(jobId: string, options: readonly InstrumentalOption[], id: InstrumentalChoice): string | null {
  const audioUrl = options.find((o) => o.id === id)?.audio_url;
  return audioUrl ? mediaUrl(GEN_API_URL, jobId, audioUrl, token()) : null;
}

/** Re-fetches the stem options (signed URLs / fresh proxy paths) after a player error. */
export async function refreshInstrumentalOptions(jobId: string): Promise<InstrumentalOption[]> {
  return (await getInstrumentalUrls(jobId)).options;
}
