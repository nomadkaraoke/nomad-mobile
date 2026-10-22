// Types for the on-device song matcher (a port of decide's karaoke_decide/song_search).

/**
 * Synchronous SQL reader over the offline index. expo-sqlite's `getAllSync` and
 * better-sqlite3's `prepare(sql).all(...params)` both fit (rows as column objects).
 */
export type SqlReader = { all<T>(sql: string, params?: unknown[]): T[] };

/** One identified song. `score` is rounded to 3 places, as decide's `Match.to_dict`. */
export type SongRef = {
  artist: string;
  title: string;
  /** `songKey(artist, title)`: the key the offline index stores versions under. */
  songKey: string;
  score: number;
  popularity: number | null;
  /** false = a rival: the song exists but has no karaoke version yet. */
  karaoke: boolean;
};

/** decide's scoring breakdown for the best match (values rounded to 2 places). */
export type MatchDetail = {
  q_cov: number;
  title_cov: number;
  artist_cov: number;
  sim: number;
  title_sim: number;
  title_lead: number;
};

export type IdentifyStatus = 'confident' | 'candidates' | 'none';

export type IdentifyResult = {
  status: IdentifyStatus;
  best: (SongRef & { detail: MatchDetail }) | null;
  /** Ranked best-first (best is candidates[0]); at most `limit`. */
  candidates: SongRef[];
};

/** How the identified song relates to what was typed (ignore unless status === 'confident'). */
export type IdentifyKind = 'same' | 'cosmetic' | 'completed' | 'content';

export type OfflineVersion = {
  brandCode: string;
  brandName: string;
  kind: 'community' | 'commercial';
  /** null = disc / library only (no playable link). */
  youtubeUrl: string | null;
  rank: number;
};

export type OfflineGroup = {
  songKey: string;
  artist: string;
  title: string;
  karaoke: true;
  versionCount: number;
  /** song_libraries codes for this song (empty when the table has no rows or is missing). */
  libraries: string[];
  /** Playable (YouTube URL) first, then rank, then index order. */
  versions: OfflineVersion[];
};
