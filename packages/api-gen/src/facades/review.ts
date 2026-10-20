import type { BackingVocalsAnalysis, CorrectionData, InstrumentalOption } from '@nomad/review-core';

import {
  completeReviewApiReviewJobIdCompletePost,
  generatePreviewVideoApiReviewJobIdPreviewVideoPost,
  getCorrectionDataApiReviewJobIdCorrectionDataGet,
  getInstrumentalUrlsApiReviewJobIdInstrumentalUrlsGet,
  getPreviewVideoStatusApiReviewJobIdPreviewVideoPreviewHashStatusGet,
  getVocalsPeaksApiReviewJobIdVocalsPeaksGet,
  getWaveformDataApiReviewJobIdWaveformDataGet,
  heartbeatEncodingWorkerApiInternalEncodingWorkerHeartbeatJobIdPost,
  reportClientEventApiClientEventsPost,
  saveReviewSessionApiReviewJobIdSessionsPost,
  startReviewApiJobsJobIdStartReviewPost,
  submitCorrectionsApiJobsJobIdCorrectionsPost,
  warmupEncodingWorkerApiInternalEncodingWorkerWarmupJobIdPost,
} from '../client';
import { parseResponse } from '../overrides/parse';
import {
  CompleteReviewSchema,
  CorrectionDataSchema,
  InstrumentalUrlsSchema,
  PreviewRequestSchema,
  PreviewStatusSchema,
  VocalsPeaksSchema,
  WaveformDataSchema,
} from '../overrides/review';

/** Mark the job IN_REVIEW. Idempotent on gen (a second open is a success). */
export async function startReview(jobId: string): Promise<void> {
  await startReviewApiJobsJobIdStartReviewPost({ path: { job_id: jobId }, body: {} });
}

/** The full correction doc. Unknown keys are kept so it can be sent back unchanged. */
export async function getCorrectionData(jobId: string): Promise<CorrectionData> {
  const { data } = await getCorrectionDataApiReviewJobIdCorrectionDataGet({ path: { job_id: jobId } });
  return parseResponse(CorrectionDataSchema, data) as unknown as CorrectionData;
}

/** Stems + backing analysis + the "separation finished" flag. Poll this until `audioComplete`. */
export async function getInstrumentalUrls(jobId: string): Promise<{
  options: InstrumentalOption[];
  audioComplete?: boolean;
  backingAnalysis?: BackingVocalsAnalysis | null;
  autoApproval?: CorrectionData['auto_approval'];
}> {
  const { data } = await getInstrumentalUrlsApiReviewJobIdInstrumentalUrlsGet({ path: { job_id: jobId } });
  const body = parseResponse(InstrumentalUrlsSchema, data);
  return {
    options: body.instrumental_options as InstrumentalOption[],
    audioComplete: body.audio_complete,
    // gen sends {} until the analysis exists; treat that as absent.
    backingAnalysis:
      body.backing_vocals_analysis && Object.keys(body.backing_vocals_analysis).length > 0
        ? (body.backing_vocals_analysis as unknown as BackingVocalsAnalysis)
        : undefined,
    autoApproval: body.auto_approval as CorrectionData['auto_approval'],
  };
}

const DEFAULT_RETRY_AFTER_SECONDS = 15;

/** Base64 u8 peak envelope of the vocal stem. 202 = stems still separating: retry after `retryAfter` s. */
export async function getVocalsPeaks(
  jobId: string,
): Promise<{ status: 'ready'; peaks: string; rate: number } | { status: 'pending'; retryAfter: number }> {
  const { data, response } = await getVocalsPeaksApiReviewJobIdVocalsPeaksGet({ path: { job_id: jobId } });
  if (response.status === 202) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    return { status: 'pending', retryAfter: retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS };
  }
  const body = parseResponse(VocalsPeaksSchema, data);
  return { status: 'ready', peaks: body.peaks_b64, rate: body.peaks_per_second };
}

export async function getWaveformData(jobId: string, numPoints = 800): Promise<{ amplitudes: number[]; duration: number }> {
  const { data } = await getWaveformDataApiReviewJobIdWaveformDataGet({ path: { job_id: jobId }, query: { num_points: numPoints } });
  const body = parseResponse(WaveformDataSchema, data);
  return { amplitudes: body.amplitudes, duration: body.duration_seconds ?? body.duration ?? 0 };
}

/**
 * `lines` is gen's required alias of `corrected_segments`. `is_duet` is omitted when `isDuet` is undefined:
 * gen overwrites the stored flag with any non-null value, so callers pass it only when known
 * (loaded as true, or toggled by the user).
 */
export async function saveCorrections(jobId: string, data: CorrectionData, isDuet?: boolean): Promise<void> {
  await submitCorrectionsApiJobsJobIdCorrectionsPost({
    path: { job_id: jobId },
    body: {
      corrections: { ...data, lines: data.corrected_segments },
      ...(isDuet === undefined ? {} : { is_duet: isDuet }),
    },
  });
}

/**
 * Final call of Finish. `auto` lets gen resolve the instrumental from its own verdict; `custom` is the
 * instrumental the singer uploaded (gen accepts it only for such jobs, as the web does).
 * Always sends `is_duet` (`isDuet ?? false`): on complete gen only latches the flag up, never down.
 */
export async function completeReview(
  jobId: string,
  data: CorrectionData,
  selection: 'clean' | 'with_backing' | 'auto' | 'custom',
  isDuet?: boolean,
): Promise<{ status: string }> {
  const { data: body } = await completeReviewApiReviewJobIdCompletePost({
    path: { job_id: jobId },
    body: { ...data, instrumental_selection: selection, is_duet: isDuet ?? false },
  });
  return { status: parseResponse(CompleteReviewSchema, body).status };
}

/** `success` = cache hit (video is ready); `generating` = poll `getPreviewStatus`. */
export async function requestPreview(
  jobId: string,
  data: CorrectionData,
  isDuet?: boolean,
): Promise<{ status: 'success' | 'generating'; previewHash: string }> {
  const { data: body } = await generatePreviewVideoApiReviewJobIdPreviewVideoPost({
    path: { job_id: jobId },
    body: isDuet === undefined ? { ...data } : { ...data, is_duet: isDuet },
  });
  const parsed = parseResponse(PreviewRequestSchema, body);
  return { status: parsed.status, previewHash: parsed.preview_hash };
}

export async function getPreviewStatus(jobId: string, hash: string): Promise<'ready' | 'generating' | 'error'> {
  const { data } = await getPreviewVideoStatusApiReviewJobIdPreviewVideoPreviewHashStatusGet({
    path: { job_id: jobId, preview_hash: hash },
  });
  return parseResponse(PreviewStatusSchema, data).status;
}

/** Relative API path of the preview mp4 (gen 302s to a signed URL). Add the token with review-core `mediaUrl`. */
export function previewVideoPath(jobId: string, hash: string): string {
  return `/api/review/${encodeURIComponent(jobId)}/preview-video/${encodeURIComponent(hash)}`;
}

/** Manual backup snapshot (gen dedupes identical data). */
export async function saveReviewSession(jobId: string, data: CorrectionData, editCount: number): Promise<void> {
  await saveReviewSessionApiReviewJobIdSessionsPost({
    path: { job_id: jobId },
    body: {
      correction_data: data,
      edit_count: editCount,
      trigger: 'manual',
      summary: {
        total_segments: data.corrected_segments.length,
        total_words: data.corrected_segments.reduce((n, s) => n + s.words.length, 0),
        corrections_made: editCount,
        changed_words: [],
      },
    },
  });
}

/** Start the encoding VM so a first preview is not cold. Best effort: never throws. */
export async function warmupEncoder(jobId: string): Promise<void> {
  try {
    await warmupEncodingWorkerApiInternalEncodingWorkerWarmupJobIdPost({ path: { job_id: jobId } });
  } catch {
    // fire and forget
  }
}

/** Keeps the encoding VM from idling out while the user edits. Best effort: never throws. */
export async function encoderHeartbeat(jobId: string): Promise<void> {
  try {
    await heartbeatEncodingWorkerApiInternalEncodingWorkerHeartbeatJobIdPost({ path: { job_id: jobId } });
  } catch {
    // fire and forget
  }
}

/** Telemetry for review degradation. Best effort: never throws. */
export async function reportClientEvent(
  type: 'lyrics_load_failed' | 'waveform_slow' | 'waveform_failed',
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await reportClientEventApiClientEventsPost({ body: { type, detail } });
  } catch {
    // fire and forget
  }
}
