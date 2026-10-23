import { strToU8 } from 'fflate';
import { ExportAggregator, ExportZipReader, wantExportEntry } from '../index';
import { accountHistory, buildStreamedZip, buildZip, csv, extendedHistory, SONGS } from '../__fixtures__/buildExport';
import { readZip } from '../__fixtures__/readZip';

function entries(zip: Uint8Array, chunk = zip.length, want = wantExportEntry): Record<string, string> {
  const out: Record<string, string> = {};
  const reader = new ExportZipReader((name, data) => {
    out[name] = new TextDecoder().decode(data);
  }, want);
  for (let off = 0; off < zip.length; off += chunk) {
    const end = Math.min(zip.length, off + chunk);
    reader.push(zip.subarray(off, end), end === zip.length);
  }
  return out;
}

describe('wantExportEntry', () => {
  it.each([
    ['MyData/StreamingHistory_music_0.json', true],
    ['MyData/StreamingHistory0.json', true],
    ['MyData/StreamingHistory_podcast_0.json', false],
    ['Spotify Extended Streaming History/Streaming_History_Audio_2019-2021_3.json', true],
    ['Spotify Extended Streaming History/Streaming_History_Video_2019-2021.json', false],
    ['MyData/endsong_2.json', true],
    ['MyData/YourLibrary.json', true],
    ['MyData/Playlist1.json', true],
    ['MyData/Userdata.json', false],
    ['MyData/', false],
    ['__MACOSX/MyData/._StreamingHistory0.json', false],
    ['MyData/._StreamingHistory0.json', false],
    ['Apple_Media_Services/Apple Music Activity/Apple Music Play Activity.csv', true],
    ['Apple Music - Play History Daily Tracks.csv', true],
    ['Apple Music Activity/Identifier Information.csv', false],
    ['Apple_Media_Services.zip', true],
    ['Apple Media Services.zip', true],
    ['my_spotify_data.zip', true],
    ['iCloud Photos Part 1 of 3.zip', false],
  ])('%s → %s', (name, expected) => {
    expect(wantExportEntry(name)).toBe(expected);
  });
});

describe('ExportZipReader', () => {
  const files = { 'a/StreamingHistory0.json': '[1]', 'a/YourLibrary.json': '{"tracks":[]}', 'a/Userdata.json': '{}' };

  it('emits only wanted entries, deflated or stored, whole or in tiny chunks', () => {
    for (const level of [0, 6] as const) {
      const zip = buildZip(files, level);
      const want = { 'a/StreamingHistory0.json': '[1]', 'a/YourLibrary.json': '{"tracks":[]}' };
      expect(entries(zip)).toEqual(want);
      expect(entries(zip, 7)).toEqual(want);
      expect(entries(zip, 1)).toEqual(want);
    }
  });

  it('re-reads nested zips recursively (up to a depth limit)', () => {
    const lvl3 = buildZip({ 'deep/StreamingHistory2.json': '[3]' });
    const lvl2 = buildZip({ 'StreamingHistory1.json': '[2]', 'spotify_more.zip': lvl3 });
    const lvl1 = buildZip({ 'Apple_Media_Services.zip': lvl2, 'StreamingHistory0.json': '[1]' });
    expect(entries(lvl1, 7)).toEqual({ 'StreamingHistory0.json': '[1]', 'StreamingHistory1.json': '[2]', 'deep/StreamingHistory2.json': '[3]' });
    // A zip nested deeper than the limit is ignored rather than recursed into forever.
    let z = buildZip({ 'StreamingHistory9.json': '[9]' });
    for (let i = 0; i < 6; i++) z = buildZip({ 'spotify.zip': z });
    expect(entries(z)).toEqual({});
  });

  it('skips a corrupt entry without throwing', () => {
    const zip = buildZip({ 'StreamingHistory0.json': 'x'.repeat(5000), 'YourLibrary.json': '{}' });
    // Corrupt the first entry's deflate stream (just after its 30-byte header + name).
    const bad = zip.slice();
    const start = 30 + 'StreamingHistory0.json'.length;
    for (let i = start; i < start + 8; i++) bad[i] = 0xff;
    expect(() => entries(bad)).not.toThrow();
  });

  it('ignores non-zip bytes', () => {
    expect(entries(strToU8('hello, this is not a zip'))).toEqual({});
  });
});

describe('streamed zips (data descriptors)', () => {
  const activity = csv(
    ['Artist Name', 'Song Name', 'Event Start Timestamp', 'Play Duration Milliseconds', 'Media Type'],
    [
      [SONGS.hello.artist, SONGS.hello.title, '2022-06-01T19:00:00Z', 200_000, 'AUDIO'],
      [SONGS.starlight.artist, SONGS.starlight.title, '2022-06-02T19:00:00Z', 200_000, 'AUDIO'],
    ],
  );

  it('reads deflated and stored entries, including a stored nested zip, whole or in 7-byte slices', () => {
    for (const nestedStored of [true, false]) {
      const inner = buildStreamedZip({ 'Apple Music Activity/Apple Music Play Activity.csv': { body: activity } });
      const outer = buildStreamedZip({
        'Apple_Media_Services.zip': { body: inner, stored: nestedStored },
        'notes.txt': { body: 'not music', stored: true },
      });
      for (const chunk of [outer.length, 7]) {
        const s = readZip(outer, chunk)!;
        expect(s.kind).toBe('apple');
        expect(s.tracks.map((t) => t.title).sort()).toEqual(['Hello', 'Starlight']);
        expect(s.truncated).toBe(false);
      }
    }
    const spotify = buildStreamedZip({
      'MyData/StreamingHistory_music_0.json': { body: accountHistory([{ song: SONGS.rocket, endTime: '2024-01-01 10:00', ms: 200_000 }]) },
      'MyData/StreamingHistory_music_1.json': { body: accountHistory([{ song: SONGS.rocket, endTime: '2024-01-02 10:00', ms: 200_000 }]), stored: true },
    });
    expect(readZip(spotify, 7)!.tracks).toEqual([expect.objectContaining({ title: 'Rocket Man', plays: 2 })]);
  });

  it('streams a nested zip into a child reader slice by slice (never buffered whole)', () => {
    const big = extendedHistory(Array.from({ length: 400 }, (_, i) => ({ song: SONGS.hello, ts: `2024-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`, ms: 100_000 + i })));
    const inner = buildZip({ 'Streaming_History_Audio_2024.json': big }, 0);
    const outer = buildZip({ 'spotify_data.zip': inner }, 0);
    const push = jest.spyOn(ExportZipReader.prototype, 'push');
    try {
      const SLICE = 1024;
      const s = readZip(outer, SLICE)!;
      expect(s.tracks[0]!.plays).toBe(400);
      const outerPushes = Math.ceil(outer.length / SLICE);
      // The child got many pushes of its own, each no larger than an outer slice.
      const childCalls = push.mock.calls.length - outerPushes;
      expect(childCalls).toBeGreaterThan(inner.length / SLICE / 2);
      expect(Math.max(...push.mock.calls.map(([chunk]) => chunk.length))).toBeLessThanOrEqual(SLICE);
    } finally {
      push.mockRestore();
    }
  });

  it('streams Apple CSV entries (addEntry never sees them) and buffers Spotify JSON', () => {
    const agg = new ExportAggregator();
    const addEntry = jest.spyOn(agg, 'addEntry');
    const zip = buildZip({
      'Apple Music Play Activity.csv': activity,
      'StreamingHistory0.json': accountHistory([{ song: SONGS.hello, endTime: '2024-01-01 10:00', ms: 200_000 }]),
    });
    const reader = agg.createReader();
    for (let off = 0; off < zip.length; off += 5) reader.push(zip.subarray(off, off + 5), off + 5 >= zip.length);
    expect(addEntry.mock.calls.map(([name]) => name)).toEqual(['StreamingHistory0.json']);
  });
});

describe('truncated or damaged archives', () => {
  const zip = buildZip({
    'MyData/StreamingHistory_music_0.json': accountHistory([{ song: SONGS.hello, endTime: '2024-01-01 10:00', ms: 200_000 }]),
    'MyData/StreamingHistory_music_1.json': accountHistory(
      Array.from({ length: 200 }, (_, i) => ({ song: { artist: `Fixture Artist ${i}`, title: `Fixture Song ${i}` }, endTime: '2024-01-02 10:00', ms: 200_000 })),
    ),
  });

  it('a complete zip is not truncated', () => {
    expect(readZip(zip, 7)!.truncated).toBe(false);
  });

  it('a cut-off download keeps what was read and says it is truncated', () => {
    for (const cut of [zip.length - 10, Math.floor(zip.length * 0.6)]) {
      const s = readZip(zip.subarray(0, cut), 7)!;
      expect(s.truncated).toBe(true);
      expect(s.tracks.map((t) => t.title)).toContain('Hello');
    }
  });

  it('a corrupt entry marks the archive damaged', () => {
    const bad = zip.slice();
    // The second entry's local header (PK\x03\x04), then its deflate data after the name.
    let hdr = 4;
    while (!(zip[hdr] === 0x50 && zip[hdr + 1] === 0x4b && zip[hdr + 2] === 3 && zip[hdr + 3] === 4)) hdr++;
    const start = hdr + 30 + zip[hdr + 26]! + zip[hdr + 28]!;
    for (let i = start; i < start + 40; i++) bad[i] = 0xff;
    const s = readZip(bad)!;
    expect(s.tracks.map((t) => t.title)).toEqual(['Hello']);
    expect(s.truncated).toBe(true);
  });
});

