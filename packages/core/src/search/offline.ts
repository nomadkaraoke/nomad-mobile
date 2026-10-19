// Port of decide's karaoke_decide/song_search/offline.py offline_groups: the karaoke
// groups the phone shows for an identify result over offline.db.
import { songKey } from './normalize';
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
  const groups: OfflineGroup[] = [];
  for (const key of keys) {
    const song = db.all<{ artist: string; title: string }>(
      'SELECT artist, title FROM songs WHERE song_key = ? AND karaoke = 1 LIMIT 1',
      [key],
    )[0];
    if (!song) continue;
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
    if (versions.length) {
      groups.push({
        songKey: key,
        artist: song.artist,
        title: song.title,
        karaoke: true,
        versionCount: versions.length,
        versions,
      });
    }
  }
  return groups;
}
