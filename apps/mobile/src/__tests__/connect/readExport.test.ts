// On-phone export reading (Phase 3b Task 17): 256 KiB slices from expo-file-system into @nomad/core's aggregator.
import {
  buildZip,
  csv,
  extendedHistory,
  SONGS,
} from '../../../../../packages/core/src/imports/__fixtures__/buildExport';
import { readZip } from '../../../../../packages/core/src/imports/__fixtures__/readZip';
import { NotAnExportError, readExportFile } from '../../discover/connect/readExport';
import { fsState } from '../../test-utils/memoryFs';

jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));

const SLICE = 256 * 1024;
const URI = 'file:///cache/my_spotify_data.zip';
const songs = Object.values(SONGS);

/** A stored (level 0) zip of Extended history big enough to need many slices. */
function bigZip(minBytes: number): Uint8Array {
  const rows: { song: (typeof songs)[number] | null; ts: string; ms: number }[] = [];
  let i = 0;
  const day = (n: number) => new Date(Date.UTC(2023, 0, 1) + n * 3_600_000).toISOString().replace('.000', '');
  // ~250 bytes per row once serialized.
  while (rows.length * 250 < minBytes) {
    rows.push({ song: i % 17 === 0 ? null : songs[i % songs.length]!, ts: day(i), ms: i % 5 === 0 ? 10_000 : 200_000 });
    i++;
  }
  return buildZip({ 'Spotify Extended Streaming History/Streaming_History_Audio_2023.json': extendedHistory(rows) }, 0);
}

beforeEach(() => {
  jest.useRealTimers();
  fsState.reset();
});

it('readExportFile streams a 3 MB synthetic zip in ≥ 12 slices and matches the core summary', async () => {
  const zip = bigZip(3 * 1024 * 1024);
  expect(zip.length).toBeGreaterThanOrEqual(3 * 1024 * 1024);
  fsState.files.set(URI, zip);
  const progress: [number, number][] = [];
  const timeouts = jest.spyOn(global, 'setTimeout');

  const summary = await readExportFile(URI, { onProgress: (read, total) => progress.push([read, total]) });

  expect(fsState.reads.length).toBeGreaterThanOrEqual(12);
  expect(Math.max(...fsState.reads)).toBe(SLICE);
  expect(summary).toEqual(readZip(zip));
  expect(summary.kind).toBe('spotify-extended');
  expect(summary.tracks.length).toBe(songs.length);
  expect(summary.truncated).toBe(false);
  // Progress after every slice, ending at the whole file.
  expect(progress.length).toBe(fsState.reads.length);
  expect(progress[progress.length - 1]).toEqual([zip.length, zip.length]);
  // A macrotask every 4 slices keeps the UI responsive.
  expect(timeouts.mock.calls.filter(([, ms]) => ms === 0).length).toBeGreaterThanOrEqual(
    Math.floor(fsState.reads.length / 4),
  );
  timeouts.mockRestore();
});

it('abort stops reading', async () => {
  const zip = bigZip(3 * 1024 * 1024);
  fsState.files.set(URI, zip);
  const controller = new AbortController();
  fsState.onRead = (readSoFar) => {
    if (readSoFar >= 2 * SLICE) controller.abort();
  };

  await expect(readExportFile(URI, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fsState.reads.length).toBeLessThanOrEqual(5);
});

it('an already-aborted signal reads nothing', async () => {
  fsState.files.set(URI, bigZip(1024));
  const controller = new AbortController();
  controller.abort();
  await expect(readExportFile(URI, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fsState.reads).toEqual([]);
});

it('a zip that is not an export throws NotAnExportError', async () => {
  fsState.files.set(URI, buildZip({ 'holiday/photo.jpg': new Uint8Array([1, 2, 3]), 'notes.txt': 'hello' }));
  await expect(readExportFile(URI, {})).rejects.toBeInstanceOf(NotAnExportError);
});

it('a binary file that is neither a zip nor text throws NotAnExportError without reading it all', async () => {
  const junk = new Uint8Array(3 * SLICE);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 31) & 0xff;
  fsState.files.set('file:///cache/video.mp4', junk);
  await expect(readExportFile('file:///cache/video.mp4', {})).rejects.toBeInstanceOf(NotAnExportError);
  expect(fsState.reads.length).toBe(1);
});

it('an empty file throws NotAnExportError', async () => {
  fsState.files.set(URI, new Uint8Array());
  await expect(readExportFile(URI, {})).rejects.toBeInstanceOf(NotAnExportError);
});

it('a bare Apple Play Activity CSV (with a BOM) is read as text', async () => {
  const body = csv(
    ['Artist Name', 'Song Name', 'Play Duration Milliseconds', 'Event Start Timestamp'],
    [
      [SONGS.hello.artist, SONGS.hello.title, 200_000, '2024-03-01T10:00:00Z'],
      [SONGS.hello.artist, SONGS.hello.title, 180_000, '2024-03-02T10:00:00Z'],
      [SONGS.rocket.artist, SONGS.rocket.title, 5_000, '2024-03-02T11:00:00Z'],
    ],
    { bom: true },
  );
  const uri = 'file:///cache/Apple Music Play Activity.csv';
  fsState.files.set(uri, new TextEncoder().encode(body));

  const summary = await readExportFile(uri, {});

  expect(summary.kind).toBe('apple');
  expect(summary.tracks).toEqual([
    expect.objectContaining({ artist: SONGS.hello.artist, title: SONGS.hello.title, plays: 2 }),
  ]);
  expect(summary.skipped.short).toBe(1);
});

it('a podcast-only export still returns a summary (0 tracks, skipped counted)', async () => {
  const zip = buildZip({
    'Streaming_History_Audio_2024.json': extendedHistory([
      { song: null, ts: '2024-01-01T10:00:00Z', ms: 900_000 },
      { song: null, ts: '2024-01-02T10:00:00Z', ms: 900_000 },
    ]),
  });
  fsState.files.set(URI, zip);
  const summary = await readExportFile(URI, {});
  expect(summary.tracks).toEqual([]);
  expect(summary.skipped.podcasts).toBe(2);
});
