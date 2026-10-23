import { ExportAggregator, type ExportSummary } from '@nomad/core';
import { File } from 'expo-file-system';

/** Bytes per read: big files are never held whole (a whole-file read ran Android out of Java heap). */
const SLICE = 256 * 1024;
/** Slices between macrotask yields, so the UI keeps drawing (progress, Cancel) while a big export is parsed. */
const YIELD_EVERY = 4;

/** Any name the aggregator treats as an Apple play-history CSV. */
const BARE_CSV_NAME = 'Play Activity.csv';
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** The picked file is neither a Spotify nor an Apple privacy export. */
export class NotAnExportError extends Error {
  constructor() {
    super('not_an_export');
    this.name = 'NotAnExportError';
  }
}

const aborted = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const isZip = (b: Uint8Array) => ZIP_MAGIC.every((m, i) => b[i] === m);
/** Text has no NUL bytes; a video or image picked by mistake does. */
const looksBinary = (b: Uint8Array) => b.subarray(0, 4096).includes(0);

/**
 * Parses a picked Spotify / Apple privacy export on the phone (Phase 3b spec §5.4: works offline). A zip goes
 * through `ExportAggregator.createReader()` (nested zips and Apple CSVs stream; the summary's `truncated` flag comes
 * from it); anything else is read as a bare Apple Play Activity CSV. Throws `NotAnExportError` when nothing in it
 * looks like an export, and an `AbortError` when `signal` aborts.
 */
export async function readExportFile(
  uri: string,
  opts: { onProgress?: (read: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<ExportSummary> {
  const { onProgress, signal } = opts;
  if (signal?.aborted) throw aborted();
  const agg = new ExportAggregator();
  const handle = new File(uri).open();
  try {
    const total = handle.size ?? 0;
    let push: ((slice: Uint8Array, final: boolean) => void) | null = null;
    let read = 0;
    let slices = 0;
    while (read < total) {
      const slice = handle.readBytes(Math.min(SLICE, total - read));
      if (slice.length === 0) break; // the file shrank under us: finish with what was read
      read += slice.length;
      if (!push) {
        if (isZip(slice)) {
          const reader = agg.createReader();
          push = (s, final) => reader.push(s, final);
        } else if (looksBinary(slice)) {
          throw new NotAnExportError();
        } else {
          // A bare CSV: the aggregator's streaming Apple CSV sink (UTF-8 decode → CSV parser), under a name it
          // routes to that parser; the headers decide whether it is a play history at all.
          push = agg.entryStream(BARE_CSV_NAME)!;
        }
      }
      push(slice, read >= total);
      onProgress?.(read, total);
      if (++slices % YIELD_EVERY === 0) await yieldToUi();
      if (signal?.aborted) throw aborted();
    }
    if (!push) throw new NotAnExportError(); // empty file
    if (read < total) push(new Uint8Array(0), true);
  } finally {
    handle.close();
  }
  const summary = agg.summary();
  if (!summary) throw new NotAnExportError();
  return summary;
}
