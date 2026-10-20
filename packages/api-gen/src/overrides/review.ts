import { z } from 'zod';

import { opt } from './parse';

// The review endpoints return untyped dicts (see docs/gen-untyped-endpoints.md). Everything is
// looseObject: unknown keys must survive a parse so the correction doc round-trips unchanged.

/** Only `corrected_segments` (segments that have a words array) is checked; the rest of the doc stays loose. */
export const CorrectionDataSchema = z.looseObject({
  corrected_segments: z.array(z.looseObject({ words: z.array(z.unknown()) })),
});

const InstrumentalOptionSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  audio_url: z.string().nullish().transform((v) => v ?? null),
});

/** GET /api/review/{id}/instrumental-urls (stems + separation status; also the stems-ready poll). */
export const InstrumentalUrlsSchema = z.looseObject({
  instrumental_options: z.array(InstrumentalOptionSchema).nullish().transform((v) => v ?? []),
  audio_complete: opt(z.boolean()),
  backing_vocals_analysis: z.looseObject({}).nullish(),
  auto_approval: opt(z.looseObject({})),
});

/** GET /api/review/{id}/vocals-peaks, 200 body (a 202 has no body). */
export const VocalsPeaksSchema = z.looseObject({
  peaks_b64: z.string(),
  peaks_per_second: z.number(),
});

export const WaveformDataSchema = z.looseObject({
  amplitudes: z.array(z.number()),
  duration_seconds: opt(z.number()),
  duration: opt(z.number()),
});

/** POST /api/review/{id}/preview-video: "success" = cache hit (mp4 ready), "generating" = poll status. */
export const PreviewRequestSchema = z.looseObject({
  status: z.enum(['success', 'generating']),
  preview_hash: z.string(),
});

export const PreviewStatusSchema = z.looseObject({
  status: z.enum(['ready', 'generating', 'error']),
});

export const CompleteReviewSchema = z.looseObject({
  status: z.string(),
});
