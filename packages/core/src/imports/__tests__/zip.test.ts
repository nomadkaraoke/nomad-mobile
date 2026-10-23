import { strToU8 } from 'fflate';
import { ExportZipReader, wantExportEntry } from '../index';
import { buildZip } from '../__fixtures__/buildExport';

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
