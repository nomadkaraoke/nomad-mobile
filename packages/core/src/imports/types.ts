// On-phone Spotify / Apple privacy-export parsing: the shapes shared by the zip reader,
// the aggregator and the decide upload (POST /api/services/spotify-export | apple-export).

export type ExportKind = 'spotify-account' | 'spotify-extended' | 'apple';

/** One song's plays across the export. Timestamps are Unix seconds (what decide expects). */
export interface ListenAggregate {
  artist: string;
  title: string;
  ms_played: number;
  plays: number;
  first_ts: number;
  last_ts: number;
}

export interface ExportRef {
  artist: string;
  title: string;
}

export interface ExportSummary {
  kind: ExportKind;
  /** YYYY-MM-DD (UTC) of the latest counted play; today when the export has no plays. */
  generatedAt: string;
  tracks: ListenAggregate[];
  liked: ExportRef[];
  playlists: { name: string; tracks: ExportRef[] }[];
  skipped: { podcasts: number; short: number; malformed: number };
  /** The zip looked incomplete or damaged (e.g. a cut-off download): what was read is partial. */
  truncated: boolean;
}

/** Plays shorter than this are not counted (Spotify's own "stream" threshold). */
export const MIN_PLAY_MS = 30_000;

/** decide rejects timestamps outside [0, MAX_TS] (2100-01-01 UTC). */
export const MAX_TS = 4_102_444_800;
