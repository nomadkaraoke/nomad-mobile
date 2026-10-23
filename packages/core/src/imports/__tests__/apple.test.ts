import { ExportAggregator, type ExportSummary } from '../index';
import { buildZip, csv, readZip, SONGS } from '../__fixtures__/buildExport';

const BOM = String.fromCharCode(0xfeff);
const ACTIVITY_HEADERS = ['Apple Id Number', 'Artist Name', 'Song Name', 'Event Start Timestamp', 'Event End Timestamp', 'Play Duration Milliseconds', 'Media Type'];
const activityRow = (s: { artist: string; title: string }, ts: string, ms: number) => ['1', s.artist, s.title, ts, ts, ms, 'AUDIO'];

function fromCsvText(text: string, chunk = text.length): ExportSummary | null {
  const agg = new ExportAggregator();
  for (let off = 0; off < text.length; off += chunk) {
    const end = Math.min(text.length, off + chunk);
    agg.addCsvText(text.slice(off, end), end === text.length);
  }
  return agg.summary();
}

describe('Apple Music play activity', () => {
  it('nestedAppleZip', () => {
    const inner = buildZip({
      'Apple_Media_Services/Apple Music Activity/Apple Music Play Activity.csv': csv(ACTIVITY_HEADERS, [
        activityRow(SONGS.hello, '2022-06-01T19:00:00.000Z', 200_000),
        activityRow(SONGS.hello, '2022-06-03T19:00:00.000Z', 100_000),
        activityRow(SONGS.starlight, '2022-06-02T08:00:00Z', 12_000),
      ]),
    });
    const outer = buildZip({
      'Apple_Media_Services.zip': inner,
      'iCloud Photos Part 1 of 1.zip': buildZip({ 'IMG_0001.jpg': new Uint8Array([1, 2, 3]) }),
      'readme.txt': 'not music',
    });
    const s = readZip(outer)!;
    expect(s.kind).toBe('apple');
    expect(s.tracks).toEqual([
      { artist: 'Adele', title: 'Hello', ms_played: 300_000, plays: 2, first_ts: Date.parse('2022-06-01T19:00:00Z') / 1000, last_ts: Date.parse('2022-06-03T19:00:00Z') / 1000 },
    ]);
    expect(s.skipped.short).toBe(1);
    expect(s.liked).toEqual([]);
    expect(s.playlists).toEqual([]);
    expect(s.generatedAt).toBe('2022-06-03');
    // Same summary when the outer zip arrives 7 bytes at a time.
    expect(readZip(outer, 7)).toEqual(s);
  });

  it('appleHeaderAliases', () => {
    const text = csv(
      ['Container Artist Name', 'Content Name', 'Event End Timestamp', 'Play Duration Milliseconds'],
      [
        [SONGS.rocket.artist, SONGS.rocket.title, '2021-01-01T10:00:00Z', 240_000],
        [SONGS.rocket.artist, SONGS.rocket.title, '', 240_000], // no time
        ['', '', '2021-01-01T10:00:00Z', 240_000], // no artist / title
      ],
    );
    const s = fromCsvText(text)!;
    expect(s.kind).toBe('apple');
    expect(s.tracks.map((t) => [t.artist, t.title, t.plays])).toEqual([['Elton John', 'Rocket Man', 1]]);
    expect(s.skipped.malformed).toBe(2);
  });

  it('falls back to Track Description ("Artist - Title") and reads the daily tracks file', () => {
    const text = csv(
      ['Country', 'Track Identifier', 'Media type', 'Date Played', 'Hours', 'Play Duration Milliseconds', 'Play Count', 'Track Description'],
      [
        ['GB', '1', 'AUDIO', '20200310', '19', 480_000, 2, 'The Strokes - Machu Picchu'],
        ['GB', '2', 'AUDIO', '20200311', '8', 300_000, 1, 'Muse - Starlight - 2006 Remaster'],
        ['GB', '3', 'AUDIO', '20200312', '8', 300_000, 1, 'No separator here'],
      ],
    );
    const s = fromCsvText(text)!;
    expect(s.tracks).toEqual([
      { artist: 'The Strokes', title: 'Machu Picchu', ms_played: 480_000, plays: 2, first_ts: Date.UTC(2020, 2, 10) / 1000, last_ts: Date.UTC(2020, 2, 10) / 1000 },
      { artist: 'Muse', title: 'Starlight - 2006 Remaster', ms_played: 300_000, plays: 1, first_ts: Date.UTC(2020, 2, 11) / 1000, last_ts: Date.UTC(2020, 2, 11) / 1000 },
    ]);
    expect(s.skipped.malformed).toBe(1);
    expect(s.generatedAt).toBe('2020-03-11');
  });

  it('prefers play activity over the daily file in the same export (no double counting)', () => {
    const zip = buildZip({
      'Apple Music Activity/Apple Music Play Activity.csv': csv(ACTIVITY_HEADERS, [activityRow(SONGS.hello, '2022-06-01T19:00:00Z', 200_000)]),
      'Apple Music Activity/Apple Music - Play History Daily Tracks.csv': csv(
        ['Date Played', 'Play Duration Milliseconds', 'Play Count', 'Track Description'],
        [['20220601', 200_000, 1, 'Adele - Hello']],
      ),
    });
    expect(readZip(zip)!.tracks.map((t) => t.plays)).toEqual([1]);
  });

  it('bomCsv', () => {
    const text = BOM + csv(['Artist Name', 'Song Name', 'Event Start Timestamp', 'Play Duration Milliseconds'], [[SONGS.hello.artist, SONGS.hello.title, '2023-01-01T00:00:00Z', 100_000]]);
    const s = fromCsvText(text)!;
    expect(s.tracks).toHaveLength(1);
    // Also inside a zip (decoded with fflate's DecodeUTF8).
    expect(readZip(buildZip({ 'Apple Music Play Activity.csv': text }))!.tracks).toEqual(s.tracks);
  });

  it('handles quoted commas, quotes and newlines, LF or CRLF, in any chunking', () => {
    const odd = { artist: 'Crosby, Stills & Nash', title: 'Say "Hello"\nAgain' };
    const rows = [
      [odd.artist, odd.title, '2023-01-01T00:00:00Z', 100_000],
      [SONGS.hello.artist, SONGS.hello.title, '1672531200000', 100_000], // epoch milliseconds
      [SONGS.hello.artist, SONGS.hello.title, '2023-01-02 00:00:00', 100_000], // no zone → UTC
    ];
    const headers = ['Artist Name', 'Song Name', 'Event Start Timestamp', 'Play Duration Milliseconds'];
    for (const eol of ['\r\n', '\n']) {
      const text = csv(headers, rows, { eol, bom: true });
      const whole = fromCsvText(text)!;
      expect(whole.tracks.map((t) => [t.artist, t.title, t.plays])).toEqual([
        [odd.artist, odd.title, 1],
        ['Adele', 'Hello', 2],
      ]);
      expect(whole.tracks[1]!.first_ts).toBe(1672531200);
      for (const n of [1, 2, 3, 7]) expect(fromCsvText(text, n)).toEqual(whole);
    }
  });

  it('converts zoned ISO timestamps to UTC Unix seconds and rejects out-of-range ones', () => {
    const headers = ['Artist Name', 'Song Name', 'Event Start Timestamp', 'Play Duration Milliseconds'];
    const s = fromCsvText(
      csv(headers, [
        [SONGS.hello.artist, SONGS.hello.title, '2023-01-01T02:00:00+02:00', 100_000],
        [SONGS.starlight.artist, SONGS.starlight.title, '2023-01-01T00:00:00-0130', 100_000],
        [SONGS.rocket.artist, SONGS.rocket.title, '2150-01-01T00:00:00Z', 100_000],
      ]),
    )!;
    expect(s.tracks.map((t) => t.first_ts)).toEqual([Date.UTC(2023, 0, 1) / 1000, Date.UTC(2023, 0, 1, 1, 30) / 1000]);
    expect(s.skipped.malformed).toBe(1);
  });

  it('skips non-audio rows (music videos) and rejects impossible dates', () => {
    const s = fromCsvText(
      csv(
        ['Artist Name', 'Song Name', 'Event Start Timestamp', 'Play Duration Milliseconds', 'Media Type'],
        [
          [SONGS.hello.artist, SONGS.hello.title, '2023-01-01T00:00:00Z', 100_000, 'AUDIO'],
          [SONGS.hello.artist, SONGS.hello.title, '2023-01-02T00:00:00Z', 100_000, 'VIDEO'],
          [SONGS.hello.artist, SONGS.hello.title, '2023-02-29T00:00:00Z', 100_000, ''],
          [SONGS.hello.artist, SONGS.hello.title, '2023-13-01T00:00:00Z', 100_000, 'audio'],
        ],
      ),
    )!;
    expect(s.tracks.map((t) => t.plays)).toEqual([1]);
    expect(s.skipped.malformed).toBe(2);
    const daily = fromCsvText(csv(['Date Played', 'Play Duration Milliseconds', 'Track Description'], [['20230231', 100_000, 'Adele - Hello']]))!;
    expect(daily.tracks).toEqual([]);
    expect(daily.skipped.malformed).toBe(1);
    expect(daily.truncated).toBe(false);
  });

  it('a final row without a line break still counts', () => {
    const text = 'Artist Name,Song Name,Event Start Timestamp,Play Duration Milliseconds\nAdele,Hello,2023-01-01T00:00:00Z,100000';
    expect(fromCsvText(text, 5)!.tracks).toHaveLength(1);
    expect(fromCsvText(text.replace('Hello', '"Hello"'), 5)!.tracks).toHaveLength(1);
  });

  it('a CSV with unknown headers is not an export', () => {
    expect(fromCsvText(csv(['Date', 'Amount', 'Payee'], [['2024-01-01', '3.50', 'Coffee']]))).toBeNull();
    expect(fromCsvText('')).toBeNull();
    expect(readZip(buildZip({ 'Apple Music Library Playlists.csv': csv(['Title', 'Description'], [['x', 'y']]) }))).toBeNull();
  });
});
