// Spotify privacy-export entries: Account data (`MyData/`) and Extended streaming history.
import { RefSet, text, type ListenTally } from './tally';
import type { ExportRef } from './types';

export type SpotifyEntryKind = 'account' | 'extended' | 'library' | 'playlist';

/**
 * Which Spotify file `base` (an entry's file name) is, or null for anything else:
 * - account: `StreamingHistory_music_N.json`, or the pre-2023 `StreamingHistoryN.json`;
 * - extended: `Streaming_History_Audio_*.json`, or the pre-2023 `endsong_N.json`;
 * - library: `YourLibrary.json`; playlist: `PlaylistN.json` / `PlaylistsN.json`.
 * Podcast (`StreamingHistory_podcast_*`) and video (`Streaming_History_Video_*`) history is null.
 */
export function spotifyEntryKind(base: string): SpotifyEntryKind | null {
  if (/^StreamingHistory(_music_)?\d+\.json$/i.test(base)) return 'account';
  if (/^(Streaming_History_Audio_.*|endsong_\d+)\.json$/i.test(base)) return 'extended';
  if (/^YourLibrary\.json$/i.test(base)) return 'library';
  if (/^Playlists?\d*\.json$/i.test(base)) return 'playlist';
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Account history rows: `{endTime, artistName, trackName, msPlayed}`. False if not an array. */
export function addAccountHistory(json: unknown, tally: ListenTally): boolean {
  if (!Array.isArray(json)) return false;
  for (const row of json) {
    if (!isObj(row)) tally.skipped.malformed++;
    else tally.add(row.artistName, row.trackName, row.msPlayed, row.endTime);
  }
  return true;
}

/**
 * Extended history rows: `{ts, ms_played, master_metadata_track_name,
 * master_metadata_album_artist_name}`; a row without a track is a podcast episode or audiobook.
 */
export function addExtendedHistory(json: unknown, tally: ListenTally): boolean {
  if (!Array.isArray(json)) return false;
  for (const row of json) {
    if (!isObj(row)) tally.skipped.malformed++;
    else if (row.master_metadata_track_name == null) tally.skipped.podcasts++;
    else tally.add(row.master_metadata_album_artist_name, row.master_metadata_track_name, row.ms_played, row.ts);
  }
  return true;
}

/** `YourLibrary.json` `tracks[]{artist, track}` → liked songs. False if the shape is wrong. */
export function addLibrary(json: unknown, liked: RefSet): boolean {
  if (!isObj(json) || !Array.isArray(json.tracks)) return false;
  for (const t of json.tracks) if (isObj(t)) liked.add(t.artist, t.track);
  return true;
}

/** `PlaylistN.json` `playlists[]{name, items[].track{trackName, artistName}}` (episodes skipped). */
export function readPlaylists(json: unknown): { name: string; tracks: ExportRef[] }[] | null {
  if (!isObj(json) || !Array.isArray(json.playlists)) return null;
  const out: { name: string; tracks: ExportRef[] }[] = [];
  for (const p of json.playlists) {
    if (!isObj(p)) continue;
    const refs = new RefSet();
    if (Array.isArray(p.items)) for (const item of p.items) if (isObj(item) && isObj(item.track)) refs.add(item.track.artistName, item.track.trackName);
    out.push({ name: text(p.name) ?? '', tracks: refs.refs });
  }
  return out;
}
