// Streaming zip reading for privacy exports (fflate). The app feeds the file in slices, so a
// multi-hundred-MB export never sits in memory whole; only wanted entries are inflated.
import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { appleCsvEntry } from './apple';
import { spotifyEntryKind } from './spotify';

/** How deep nested zips are followed (Apple's export nests Apple_Media_Services.zip). */
const MAX_NEST = 3;

export function entryBaseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

/**
 * True for the zip entries the parsers read: Spotify music history / library / playlists,
 * Apple play-history CSVs, and the nested zips those live in. macOS resource forks
 * (`__MACOSX/`, `._*`), podcast and video history are skipped.
 */
export const wantExportEntry = (name: string): boolean => {
  const base = entryBaseName(name);
  if (!base || base.startsWith('._') || name.includes('__MACOSX/')) return false;
  if (/\.zip$/i.test(base)) return /apple.?media.?services|spotify/i.test(base);
  if (/\.csv$/i.test(base)) return appleCsvEntry(base);
  const kind = spotifyEntryKind(base);
  return kind !== null;
};

const EMPTY = new Uint8Array(0);

/** Bytes kept from the end of the stream to find the end-of-central-directory record. */
const TAIL_BYTES = 22 + 0xffff;

/** Whether `tail` holds a zip end-of-central-directory signature (PK\x05\x06). */
function hasEndRecord(tail: Uint8Array): boolean {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) return true;
  }
  return false;
}

/** Joins buffered parts, dropping each part's reference as it is copied. */
function concat(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let off = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i]!, off);
    off += parts[i]!.length;
    parts[i] = EMPTY;
  }
  return out;
}


/** Receives one entry's bytes as they inflate (`final` on the last slice). */
export type EntrySink = (data: Uint8Array, final: boolean) => void;

/**
 * Push the export's bytes in any slicing. Each wanted entry goes either to the sink that
 * `onStream(name)` returns (streamed as it inflates: the Apple CSVs) or, when that is null
 * or absent, to `onEntry` whole (the Spotify JSON files, which JSON.parse needs whole).
 * Nested `*.zip` entries stream straight into a child reader (never buffered).
 *
 * Nothing throws: a corrupt or unsupported entry is skipped and bytes that aren't a zip
 * produce no entries. `truncated` reports whether the archive looked incomplete or damaged
 * (no end-of-central-directory record, an entry cut off or failing to inflate, or a broken
 * structure), so the app can say "this file looks incomplete" instead of importing part of it silently.
 *
 * fflate note: a STORED entry written with a data descriptor (streamed zip, size unknown)
 * can't be skipped over, so fflate reports it as empty and then surfaces the entries inside
 * it (a stored nested zip's files) as if they were top-level ones; they are still read.
 */
export class ExportZipReader {
  private readonly unzip: Unzip;
  private depth = 0;
  private broken = false;
  private open = 0;
  private ended = false;
  private endRecord = false;
  private tail: Uint8Array = EMPTY;
  private bytes = 0;
  private readonly children: ExportZipReader[] = [];

  constructor(
    private readonly onEntry: (name: string, data: Uint8Array) => void,
    private readonly want: (name: string) => boolean,
    private readonly onStream?: (name: string) => EntrySink | null,
  ) {
    this.unzip = new Unzip((file) => this.onFile(file));
    this.unzip.register(UnzipInflate);
  }

  /** True once the final push showed the archive was incomplete or damaged. */
  get truncated(): boolean {
    // A child that got no bytes is fflate's stored-with-descriptor case (see above), not damage.
    if (this.broken || this.children.some((c) => c.bytes > 0 && c.truncated)) return true;
    return this.ended && (this.open > 0 || !this.endRecord);
  }

  push(chunk: Uint8Array, final: boolean): void {
    this.bytes += chunk.length;
    this.keepTail(chunk);
    try {
      this.unzip.push(chunk, final);
    } catch {
      // fflate throws on structurally broken archives; what was read so far still counts.
      this.broken = true;
    }
    if (final) {
      this.ended = true;
      this.endRecord = hasEndRecord(this.tail);
      this.tail = EMPTY;
    }
  }

  private keepTail(chunk: Uint8Array): void {
    if (chunk.length >= TAIL_BYTES) {
      this.tail = chunk.slice(chunk.length - TAIL_BYTES);
      return;
    }
    const keep = Math.min(this.tail.length, TAIL_BYTES - chunk.length);
    const next = new Uint8Array(keep + chunk.length);
    next.set(this.tail.subarray(this.tail.length - keep), 0);
    next.set(chunk, keep);
    this.tail = next;
  }

  private onFile(file: UnzipFile): void {
    const name = file.name;
    if (name.endsWith('/') || !this.want(name)) return;
    let sink: EntrySink | null = null;
    if (/\.zip$/i.test(name)) {
      if (this.depth >= MAX_NEST) return;
      const child = new ExportZipReader(this.onEntry, this.want, this.onStream);
      child.depth = this.depth + 1;
      this.children.push(child);
      sink = (data, final) => child.push(data, final);
    } else {
      sink = this.onStream?.(name) ?? null;
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    let done = false;
    const finish = () => {
      done = true;
      this.open--;
    };
    file.ondata = (err, data, final) => {
      if (done) return;
      if (err) {
        this.broken = true;
        finish();
        return;
      }
      if (sink) sink(data, final);
      else {
        parts.push(data);
        size += data.length;
      }
      if (!final) return;
      finish();
      if (!sink) this.onEntry(name, concat(parts, size));
    };
    this.open++;
    try {
      file.start();
    } catch {
      this.broken = true;
      if (!done) finish();
    }
  }
}
