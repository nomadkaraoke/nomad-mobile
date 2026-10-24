// Port of decide's karaoke_decide/song_search/offline.py offline_groups: the karaoke
// groups the phone shows for an identify result over offline.db.
import { ftsMatchQuery, identityNormalize, songKey, songNorm } from './normalize';
import { tierFromCode, type SongVocalRange } from '../voice/fit';
import type { IdentifyResult, OfflineGroup, OfflineVersion, SqlReader } from './types';

/**
 * The offline.db layout this app reads (decide `offline.OFFLINE_SCHEMA_VERSION`). The phone only uses a
 * file whose manifest `schema` and `meta.offline_schema_version` equal it.
 */
export const OFFLINE_SCHEMA_VERSION = 1;

type VersionRow = {
  brand_code: string;
  brand_name: string;
  kind: OfflineVersion['kind'];
  youtube_url: string | null;
  rank: number;
};

const LIBRARY_CHUNK = 500;

/**
 * Library codes per song key from `song_libraries` (no schema bump). Keys without rows are absent. Only a missing
 * `song_libraries` table (older offline.db) is swallowed, with a warning, and gives an empty map; any other error is
 * re-thrown so a real failure never silently turns every song into "no library".
 */
export function offlineSongLibraries(db: SqlReader, songKeys: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    for (let i = 0; i < songKeys.length; i += LIBRARY_CHUNK) {
      const chunk = songKeys.slice(i, i + LIBRARY_CHUNK);
      const rows = db.all<{ song_key: string; library_code: string }>(
        `SELECT song_key, library_code FROM song_libraries WHERE song_key IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      for (const r of rows) {
        const list = out.get(r.song_key);
        if (list) list.push(r.library_code);
        else out.set(r.song_key, [r.library_code]);
      }
    }
  } catch (e) {
    if (e instanceof Error && /no such table:\s*song_libraries/i.test(e.message)) {
      console.warn('offline.db has no song_libraries table; library filters will match nothing');
      return new Map();
    }
    throw e;
  }
  return out;
}

type VocalRangeRow = {
  artist: string;
  vr_low: number | null;
  vr_high: number | null;
  vr_p10: number | null;
  vr_p50: number | null;
  vr_p90: number | null;
  vr_tier: number | null;
  vr_octave_conf: number | null;
};
type ArtistRangeRow = { low: number; high: number; p10: number; p50: number; p90: number };

/**
 * A song's vocal range from offline.db (Phase 3c, additive: the schema stays 1). The song's own `vr_*` columns
 * (tiers 4/3/2) when `vr_p10` is set; else its artist's row in `artist_vocal_range` (keyed by
 * `identityNormalize(artist)`) as tier `rough` with no octave confidence; else null. Null on any SQLite error,
 * which includes an older list without these columns or that table.
 */
export function offlineVocalRange(db: SqlReader, key: string): SongVocalRange | null {
  try {
    const row = db.all<VocalRangeRow>(
      'SELECT artist, vr_low, vr_high, vr_p10, vr_p50, vr_p90, vr_tier, vr_octave_conf FROM songs WHERE song_key = ? LIMIT 1',
      [key],
    )[0];
    if (!row) return null;
    const tier = row.vr_tier === null ? null : tierFromCode(row.vr_tier);
    if (
      row.vr_p10 !== null &&
      row.vr_low !== null &&
      row.vr_high !== null &&
      row.vr_p50 !== null &&
      row.vr_p90 !== null &&
      tier !== null &&
      tier !== 'rough'
    ) {
      return {
        low: row.vr_low,
        high: row.vr_high,
        p10: row.vr_p10,
        p50: row.vr_p50,
        p90: row.vr_p90,
        tier,
        octaveConfidence: row.vr_octave_conf,
      };
    }
    const artist = db.all<ArtistRangeRow>(
      'SELECT low, high, p10, p50, p90 FROM artist_vocal_range WHERE artist_key = ? LIMIT 1',
      [identityNormalize(row.artist)],
    )[0];
    if (!artist || [artist.low, artist.high, artist.p10, artist.p50, artist.p90].some((v) => v === null)) return null;
    return { ...artist, tier: 'rough', octaveConfidence: null };
  } catch {
    return null;
  }
}

/**
 * `confident` → the identified song's group; `candidates` → one group per candidate
 * (identify order) that has versions; `none` → []. Rivals (no karaoke version) never
 * produce a group. Versions: playable first, then rank, then index order.
 */
export function offlineGroups(db: SqlReader, ident: IdentifyResult): OfflineGroup[] {
  let songs: { artist: string; title: string }[];
  if (ident.status === 'confident' && ident.best) songs = [ident.best];
  else if (ident.status === 'candidates') songs = ident.candidates;
  else return [];
  const keys = [...new Set(songs.map((s) => songKey(s.artist, s.title)))];
  return keys.map((key) => offlineSongGroup(db, key)).filter((g): g is OfflineGroup => g !== null);
}

/**
 * One karaoke song's group by `song_key` (the song page offline), or null when the list doesn't have it or
 * it is a rival (no karaoke version). Versions: playable first, then rank, then index order.
 */
export function offlineSongGroup(db: SqlReader, key: string): OfflineGroup | null {
  const song = db.all<{ artist: string; title: string }>(
    'SELECT artist, title FROM songs WHERE song_key = ? AND karaoke = 1 LIMIT 1',
    [key],
  )[0];
  if (!song) return null;
  const versions = db
    .all<VersionRow>(
      'SELECT brand_code, brand_name, kind, youtube_url, rank FROM versions ' +
        'WHERE song_key = ? ORDER BY youtube_url IS NULL, rank, rowid',
      [key],
    )
    .map((v) => ({
      brandCode: v.brand_code,
      brandName: v.brand_name,
      kind: v.kind,
      youtubeUrl: v.youtube_url,
      rank: v.rank,
    }));
  if (!versions.length) return null;
  const libraries = offlineSongLibraries(db, [key]).get(key) ?? [];
  return { songKey: key, artist: song.artist, title: song.title, karaoke: true, versionCount: versions.length, libraries, versions };
}

// ---------------------------------------------------------------------------------------------------------
// Typed-word search and popular list (decide availability.search / availability.popular over offline.db)

/** FTS candidates read before relevance sorting (decide availability.CANDIDATE_LIMIT). */
const CANDIDATE_LIMIT = 250;
/** Version count stops adding relevance here (decide availability._VERSION_COUNT_CAP). */
const VERSION_COUNT_CAP = 12;

type SongRow = { song_key: string; artist: string; title: string };

/** Song rows → groups with every version, playable first; songs without versions are dropped. */
function groupsOf(db: SqlReader, rows: SongRow[]): OfflineGroup[] {
  if (!rows.length) return [];
  const keys = [...new Set(rows.map((r) => r.song_key))];
  const byKey = new Map<string, OfflineVersion[]>(keys.map((k) => [k, []]));
  const versions = db.all<VersionRow & { song_key: string }>(
    'SELECT song_key, brand_code, brand_name, kind, youtube_url, rank FROM versions ' +
      `WHERE song_key IN (${keys.map(() => '?').join(',')}) ORDER BY song_key, youtube_url IS NULL, rank, rowid`,
    keys,
  );
  for (const v of versions) {
    byKey.get(v.song_key)?.push({
      brandCode: v.brand_code,
      brandName: v.brand_name,
      kind: v.kind,
      youtubeUrl: v.youtube_url,
      rank: v.rank,
    });
  }
  const libs = offlineSongLibraries(db, keys);
  const seen = new Set<string>();
  const groups: OfflineGroup[] = [];
  for (const r of rows) {
    const vs = byKey.get(r.song_key)!;
    if (seen.has(r.song_key) || !vs.length) continue;
    seen.add(r.song_key);
    groups.push({
      songKey: r.song_key,
      artist: r.artist,
      title: r.title,
      karaoke: true,
      versionCount: vs.length,
      libraries: libs.get(r.song_key) ?? [],
      versions: vs,
    });
  }
  return groups;
}

/** decide availability._group_relevance: title equals the query > title prefix either way > other; then playable; then version count (capped). */
function relevance(title: string, group: OfflineGroup, queryKey: string): [number, number, number] {
  const titleKey = `|||${identityNormalize(title)}`;
  const titleScore = titleKey === queryKey ? 2 : titleKey.startsWith(queryKey) || queryKey.startsWith(titleKey) ? 1 : 0;
  const playable = group.versions.some((v) => v.youtubeUrl !== null) ? 1 : 0;
  return [titleScore, playable, Math.min(group.versionCount, VERSION_COUNT_CAP)];
}

/**
 * Karaoke songs whose artist/title contain every typed word (the last as a prefix), most relevant first:
 * the phone's version of decide's typed-query availability search. Rivals never appear. `[]` on no match
 * or any SQLite error (search must never get worse than empty).
 *
 * Differs from decide (`AvailabilityIndex.search`): no short-query LIKE or trigram + fuzzy fallback when FTS
 * finds nothing (a typo finds no typed-word groups; identify still corrects it), and the FTS query is built
 * from `songNorm(q)` where decide uses `normalize(q)`.
 */
export function searchAvailabilityOffline(db: SqlReader, q: string, limit = 20): OfflineGroup[] {
  try {
    const match = ftsMatchQuery(songNorm(q));
    if (!match) return [];
    const rows = db.all<SongRow>(
      'SELECT s.song_key, s.artist, s.title FROM songs_fts f JOIN songs s ON s.rowid = f.rowid ' +
        'WHERE songs_fts MATCH ? AND s.karaoke = 1 ORDER BY rank LIMIT ?',
      [match, CANDIDATE_LIMIT],
    );
    const queryKey = `|||${identityNormalize(q)}`;
    const scored = groupsOf(db, rows).map((g) => ({ g, r: relevance(g.title, g, queryKey) }));
    // Array.prototype.sort is stable: equal relevance keeps FTS rank order.
    scored.sort((a, b) => b.r[0] - a.r[0] || b.r[1] - a.r[1] || b.r[2] - a.r[2]);
    return scored.slice(0, Math.max(1, limit)).map((s) => s.g);
  } catch {
    return [];
  }
}

/**
 * The most popular karaoke songs on the phone (the empty-query list when the cloud can't be reached). `[]` on error.
 *
 * Differs from decide (`AvailabilityIndex.popular`, `pop DESC, version_count DESC, song_key`): equal
 * popularity is ordered by `song_key` only, so ties may list in another order.
 */
export function popularOffline(db: SqlReader, limit = 30): OfflineGroup[] {
  try {
    return groupsOf(
      db,
      db.all<SongRow>(
        'SELECT song_key, artist, title FROM songs WHERE karaoke = 1 AND pop IS NOT NULL ORDER BY pop DESC, song_key LIMIT ?',
        [Math.max(1, limit)],
      ),
    );
  } catch {
    return [];
  }
}
