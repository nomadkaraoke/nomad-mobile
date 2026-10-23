// Synthetic Spotify / Apple export builders for tests. Songs come from the decide fixture
// catalog; no real exports, no lyrics.
import { strToU8, zipSync, type Zippable } from 'fflate';
import { ExportAggregator } from '../aggregator';
import type { ExportSummary } from '../types';
import { ExportZipReader, wantExportEntry } from '../zip';

export const SONGS = {
  hello: { artist: 'Adele', title: 'Hello' },
  starlight: { artist: 'Muse', title: 'Starlight' },
  machu: { artist: 'The Strokes', title: 'Machu Picchu' },
  rocket: { artist: 'Elton John', title: 'Rocket Man' },
} as const;

export type Song = { artist: string; title: string };

/** A zip of `files` (string contents are UTF-8 encoded; Uint8Array as is). */
export function buildZip(files: Record<string, string | Uint8Array>, level: 0 | 6 = 6): Uint8Array {
  const z: Zippable = {};
  for (const [name, body] of Object.entries(files)) z[name] = typeof body === 'string' ? strToU8(body) : body;
  return zipSync(z, { level });
}

/** Account-data history rows (`StreamingHistory_music_*.json`). `endTime` is "YYYY-MM-DD HH:MM" UTC. */
export function accountHistory(rows: { song: Song; endTime: string; ms: number }[]): string {
  return JSON.stringify(rows.map((r) => ({ endTime: r.endTime, artistName: r.song.artist, trackName: r.song.title, msPlayed: r.ms })));
}

/** Extended history rows (`Streaming_History_Audio_*.json`). `song: null` is a podcast episode. */
export function extendedHistory(rows: { song: Song | null; ts: string; ms: number }[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      ts: r.ts,
      platform: 'android',
      ms_played: r.ms,
      master_metadata_track_name: r.song?.title ?? null,
      master_metadata_album_artist_name: r.song?.artist ?? null,
      master_metadata_album_album_name: r.song ? 'Fixture Album' : null,
      episode_name: r.song ? null : 'Fixture Episode',
      episode_show_name: r.song ? null : 'Fixture Show',
    })),
  );
}

export function yourLibrary(songs: Song[]): string {
  return JSON.stringify({ tracks: songs.map((s) => ({ artist: s.artist, album: 'Fixture Album', track: s.title, uri: 'spotify:track:fixture' })) });
}

export function playlistFile(playlists: { name: string; songs: Song[] }[]): string {
  return JSON.stringify({
    playlists: playlists.map((p) => ({
      name: p.name,
      lastModifiedDate: '2024-01-01',
      items: [
        ...p.songs.map((s) => ({ track: { trackName: s.title, artistName: s.artist, albumName: 'Fixture Album' }, episode: null, addedDate: '2024-01-01' })),
        { track: null, episode: { episodeName: 'Fixture Episode' }, addedDate: '2024-01-01' },
      ],
    })),
  });
}

/** A CSV with RFC 4180 quoting (fields with commas, quotes or newlines are quoted). */
export function csv(headers: string[], rows: (string | number)[][], opts: { bom?: boolean; eol?: string } = {}): string {
  const q = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const eol = opts.eol ?? '\r\n';
  const body = [headers, ...rows].map((r) => r.map(q).join(',')).join(eol) + eol;
  return (opts.bom ? '\uFEFF' : '') + body;
}

/** Reads a whole zip through the streaming reader, `chunk` bytes at a time. */
export function readZip(zip: Uint8Array, chunk = zip.length): ExportSummary | null {
  const agg = new ExportAggregator();
  const reader = new ExportZipReader((name, data) => agg.addEntry(name, data), wantExportEntry);
  for (let off = 0; off < zip.length; off += chunk) {
    const end = Math.min(zip.length, off + chunk);
    reader.push(zip.subarray(off, end), end === zip.length);
  }
  if (zip.length === 0) reader.push(new Uint8Array(0), true);
  return agg.summary();
}

