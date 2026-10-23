// Synthetic Spotify / Apple export builders for tests. Songs come from the decide fixture
// catalog; no real exports, no lyrics.
// Imports only fflate: scripts/make-import-fixtures.ts loads this file with plain node (type stripping), which
// can't resolve the package's extensionless relative imports. readZip lives in readZip.ts for that reason.
import { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync, type Zippable } from 'fflate';

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

/**
 * A zip written by fflate's streaming `Zip`, so every entry has a data descriptor (sizes
 * after the data), like zips made on the fly. `stored: true` → ZipPassThrough (no compression).
 */
export function buildStreamedZip(files: Record<string, { body: string | Uint8Array; stored?: boolean }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  for (const [name, { body, stored }] of Object.entries(files)) {
    const entry = stored ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    entry.push(typeof body === 'string' ? strToU8(body) : body, true);
  }
  zip.end();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
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
