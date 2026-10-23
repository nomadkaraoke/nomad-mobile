import { MIN_PLAY_MS, wantExportEntry, type ExportSummary } from '../index';
import { accountHistory, buildZip, extendedHistory, playlistFile, SONGS, yourLibrary } from '../__fixtures__/buildExport';
import { readZip } from '../__fixtures__/readZip';

const byTitle = (s: ExportSummary | null, title: string) => s?.tracks.find((t) => t.title === title);
const sec = (iso: string) => Date.parse(iso) / 1000;

describe('Spotify extended history', () => {
  it('extendedSkipsPodcastsAndShort', () => {
    const zip = buildZip({
      'Spotify Extended Streaming History/Streaming_History_Audio_2023-2024_0.json': extendedHistory([
        { song: SONGS.hello, ts: '2024-03-01T20:00:00Z', ms: 200_000 },
        { song: SONGS.hello, ts: '2024-03-02T20:00:00Z', ms: 180_000 },
        { song: SONGS.hello, ts: '2024-03-03T20:00:00Z', ms: MIN_PLAY_MS - 1 }, // short
        { song: null, ts: '2024-03-04T20:00:00Z', ms: 900_000 }, // podcast
        { song: SONGS.starlight, ts: '2024-03-05T08:30:00Z', ms: MIN_PLAY_MS },
      ]),
      'Spotify Extended Streaming History/Streaming_History_Audio_2024_1.json': extendedHistory([
        { song: { artist: 'adele', title: 'HELLO' }, ts: '2024-02-01T10:00:00Z', ms: 60_000 },
      ]),
    });
    const s = readZip(zip)!;
    expect(s.kind).toBe('spotify-extended');
    expect(s.skipped).toEqual({ podcasts: 1, short: 1, malformed: 0 });
    expect(s.tracks).toHaveLength(2);
    const hello = byTitle(s, 'Hello')!;
    expect(hello).toEqual({
      artist: 'Adele',
      title: 'Hello',
      ms_played: 440_000,
      plays: 3,
      first_ts: sec('2024-02-01T10:00:00Z'),
      last_ts: sec('2024-03-02T20:00:00Z'),
    });
    expect(byTitle(s, 'Starlight')!.plays).toBe(1);
    expect(s.generatedAt).toBe('2024-03-05');
  });

  it('reads the pre-2023 endsong_N.json naming as extended', () => {
    const zip = buildZip({ 'MyData/endsong_0.json': extendedHistory([{ song: SONGS.rocket, ts: '2021-05-01T12:00:00Z', ms: 100_000 }]) });
    const s = readZip(zip)!;
    expect(s.kind).toBe('spotify-extended');
    expect(byTitle(s, 'Rocket Man')!.plays).toBe(1);
  });

  it('skipsVideo', () => {
    const zip = buildZip({
      'Spotify Extended Streaming History/Streaming_History_Video_2023-2024.json': extendedHistory([
        { song: SONGS.machu, ts: '2024-01-01T00:00:00Z', ms: 300_000 },
      ]),
      'Spotify Extended Streaming History/Streaming_History_Audio_2024.json': extendedHistory([
        { song: SONGS.hello, ts: '2024-01-02T00:00:00Z', ms: 300_000 },
      ]),
    });
    const s = readZip(zip)!;
    expect(s.tracks.map((t) => t.title)).toEqual(['Hello']);
    expect(wantExportEntry('Spotify Extended Streaming History/Streaming_History_Video_2023-2024.json')).toBe(false);
  });

  it('prefers extended over account history in the same zip (no double counting)', () => {
    const zip = buildZip({
      'MyData/StreamingHistory_music_0.json': accountHistory([{ song: SONGS.hello, endTime: '2024-01-02 00:03', ms: 300_000 }]),
      'MyData/Streaming_History_Audio_2024.json': extendedHistory([{ song: SONGS.hello, ts: '2024-01-02T00:03:00Z', ms: 300_000 }]),
    });
    const s = readZip(zip)!;
    expect(s.kind).toBe('spotify-extended');
    expect(byTitle(s, 'Hello')!.plays).toBe(1);
  });

  it('extended history with no music plays does not hide the account history', () => {
    const zip = buildZip({
      'MyData/StreamingHistory_music_0.json': accountHistory([{ song: SONGS.hello, endTime: '2024-01-02 00:03', ms: 300_000 }]),
      'Spotify Extended Streaming History/Streaming_History_Audio_2024.json': extendedHistory([{ song: null, ts: '2024-01-02T00:03:00Z', ms: 300_000 }]),
    });
    const s = readZip(zip)!;
    expect(s.kind).toBe('spotify-account');
    expect(s.tracks.map((t) => t.title)).toEqual(['Hello']);
  });

  it('counts malformed rows and unparseable files, never throws', () => {
    const zip = buildZip({
      'Streaming_History_Audio_2024_0.json': JSON.stringify([
        { ts: 'not a date', ms_played: 100_000, master_metadata_track_name: 'Hello', master_metadata_album_artist_name: 'Adele' },
        { ts: '2024-01-01T00:00:00Z', ms_played: 'x', master_metadata_track_name: 'Hello', master_metadata_album_artist_name: 'Adele' },
        { ts: '2024-01-01T00:00:00Z', ms_played: 100_000, master_metadata_track_name: 'Hello', master_metadata_album_artist_name: '  ' },
        { ts: '2024-02-30T00:00:00Z', ms_played: 100_000, master_metadata_track_name: 'Hello', master_metadata_album_artist_name: 'Adele' }, // no rollover to Mar 1
        { ts: '2024-01-01T24:00:00Z', ms_played: 100_000, master_metadata_track_name: 'Hello', master_metadata_album_artist_name: 'Adele' },
        'junk',
        { ts: '2024-01-01T00:00:00Z', ms_played: 100_000, master_metadata_track_name: 'Hello', master_metadata_album_artist_name: 'Adele' },
      ]),
      'Streaming_History_Audio_2024_1.json': '[{"ts": "2024-01-0', // truncated file
      'Streaming_History_Audio_2024_2.json': '{"not": "an array"}',
    });
    const s = readZip(zip)!;
    expect(s.kind).toBe('spotify-extended');
    expect(s.tracks).toHaveLength(1);
    expect(s.skipped.malformed).toBe(8);
    expect(s.truncated).toBe(false);
  });
});

describe('Spotify account data', () => {
  it('accountAggregatesPlays', () => {
    const zip = buildZip({
      'MyData/StreamingHistory_music_0.json': accountHistory([
        { song: SONGS.rocket, endTime: '2024-05-01 21:15', ms: 250_000 },
        { song: SONGS.rocket, endTime: '2024-05-03 07:00', ms: 120_000 },
        { song: SONGS.machu, endTime: '2024-05-02 10:00', ms: 5_000 },
      ]),
      'MyData/StreamingHistory_music_1.json': accountHistory([{ song: SONGS.rocket, endTime: '2024-04-30 23:59', ms: 100_000 }]),
      'MyData/StreamingHistory_podcast_0.json': accountHistory([{ song: SONGS.hello, endTime: '2024-05-01 00:00', ms: 999_999 }]),
    });
    const s = readZip(zip)!;
    expect(s.kind).toBe('spotify-account');
    expect(s.tracks).toEqual([
      { artist: 'Elton John', title: 'Rocket Man', ms_played: 470_000, plays: 3, first_ts: sec('2024-04-30T23:59:00Z'), last_ts: sec('2024-05-03T07:00:00Z') },
    ]);
    expect(s.skipped.short).toBe(1);
    expect(s.generatedAt).toBe('2024-05-03');
  });

  it('oldAccountNaming', () => {
    const zip = buildZip({
      'MyData/StreamingHistory0.json': accountHistory([{ song: SONGS.hello, endTime: '2019-12-31 23:00', ms: 200_000 }]),
      'MyData/StreamingHistory1.json': accountHistory([{ song: SONGS.starlight, endTime: '2020-01-01 01:00', ms: 200_000 }]),
      '__MACOSX/MyData/._StreamingHistory0.json': 'resource fork junk',
    });
    const s = readZip(zip)!;
    expect(s.kind).toBe('spotify-account');
    expect(s.tracks.map((t) => t.title).sort()).toEqual(['Hello', 'Starlight']);
    expect(s.skipped.malformed).toBe(0);
    expect(s.generatedAt).toBe('2020-01-01');
  });

  it('likedAndPlaylists', () => {
    const zip = buildZip({
      'MyData/YourLibrary.json': yourLibrary([SONGS.hello, SONGS.machu, { artist: 'ADELE', title: 'hello' }]),
      'MyData/Playlist1.json': playlistFile([
        { name: 'Road trip', songs: [SONGS.rocket, SONGS.starlight] },
        { name: 'Empty', songs: [] },
      ]),
      'MyData/StreamingHistory_music_0.json': accountHistory([{ song: SONGS.hello, endTime: '2024-01-01 10:00', ms: 200_000 }]),
    });
    const s = readZip(zip)!;
    expect(s.liked).toEqual([SONGS.hello, SONGS.machu]);
    expect(s.playlists).toEqual([
      { name: 'Road trip', tracks: [SONGS.rocket, SONGS.starlight] },
      { name: 'Empty', tracks: [] },
    ]);
  });

  it('a library-only export is still a Spotify export (generatedAt falls back to today)', () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-22T23:59:30Z') });
    try {
      const s = readZip(buildZip({ 'MyData/YourLibrary.json': yourLibrary([SONGS.hello]) }))!;
      expect(s.kind).toBe('spotify-account');
      expect(s.tracks).toEqual([]);
      expect(s.generatedAt).toBe('2026-10-22');
    } finally {
      jest.useRealTimers();
    }
  });

  it('generatedAtIsMaxPlayDate', () => {
    const zip = buildZip({
      'StreamingHistory_music_0.json': accountHistory([
        { song: SONGS.hello, endTime: '2023-11-05 12:00', ms: 200_000 },
        { song: SONGS.hello, endTime: '2024-02-29 23:59', ms: 200_000 },
        { song: SONGS.hello, endTime: '2024-01-01 00:00', ms: 200_000 },
        { song: SONGS.hello, endTime: '2025-06-01 00:00', ms: 1_000 }, // short plays don't count
      ]),
    });
    expect(readZip(zip)!.generatedAt).toBe('2024-02-29');
  });
});

describe('not an export', () => {
  it('notAnExportReturnsNull', () => {
    expect(readZip(buildZip({ 'photos/IMG_0001.jpg': new Uint8Array([1, 2, 3]), 'notes.txt': 'hi', 'Userdata.json': '{}' }))).toBeNull();
    expect(readZip(new Uint8Array([0x50, 0x4b, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(readZip(new TextEncoder().encode('just some text, not a zip at all'))).toBeNull();
    expect(readZip(new Uint8Array(0))).toBeNull();
  });
});

describe('streaming', () => {
  it('chunkedPushEqualsWholePush', () => {
    const zip = buildZip({
      'MyData/StreamingHistory_music_0.json': accountHistory([
        { song: SONGS.hello, endTime: '2024-01-01 10:00', ms: 200_000 },
        { song: SONGS.starlight, endTime: '2024-01-02 10:00', ms: 200_000 },
      ]),
      'MyData/YourLibrary.json': yourLibrary([SONGS.machu]),
      'MyData/Playlist1.json': playlistFile([{ name: 'Mix', songs: [SONGS.rocket] }]),
    });
    const whole = readZip(zip);
    expect(whole?.tracks).toHaveLength(2);
    expect(readZip(zip, 7)).toEqual(whole);
  });
});
