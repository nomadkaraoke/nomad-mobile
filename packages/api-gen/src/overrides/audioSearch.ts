import { z } from 'zod';

import { opt } from './parse';

// The generated AudioSearchResultResponse types quality_data as an open record, which doesn't fit
// @nomad/core's AudioResultLike. This schema covers the fields gen's getSearchConfidence /
// categorizeResult read (frontend/lib/audio-search-utils.ts) plus the display fields of the
// backend's AudioSearchResultResponse; anything else passes through.
const QualityDataSchema = z.looseObject({
  format: opt(z.string()),
  bit_depth: opt(z.number()),
  sample_rate: opt(z.number()),
  bitrate: opt(z.number()),
  media: opt(z.string()),
});

export const AudioResultSchema = z.looseObject({
  index: z.number(),
  title: z.string(),
  artist: z.string(),
  provider: z.string(),
  url: opt(z.string()),
  duration: opt(z.number()),
  quality: opt(z.string()),
  source_id: opt(z.string()),
  seeders: opt(z.number()),
  target_file: opt(z.string()),
  year: opt(z.union([z.number(), z.string()])),
  label: opt(z.string()),
  edition_info: opt(z.string()),
  release_type: opt(z.string()),
  channel: opt(z.string()),
  view_count: opt(z.number()),
  match_score: opt(z.number()),
  formatted_size: opt(z.string()),
  formatted_duration: opt(z.string()),
  formatted_views: opt(z.string()),
  is_lossless: opt(z.boolean()),
  quality_str: opt(z.string()),
  quality_data: opt(QualityDataSchema),
});
export type AudioResult = z.output<typeof AudioResultSchema>;

export const StandaloneSearchSchema = z.object({
  search_session_id: z.string(),
  results: z.array(AudioResultSchema),
});
