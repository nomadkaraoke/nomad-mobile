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

function concat(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Push the export's bytes in any slicing; `onEntry` gets each wanted entry whole. Nested
 * `*.zip` entries are re-read recursively. A corrupt or unsupported entry is skipped (the
 * aggregator then reports "not an export" if nothing usable was found); bytes that aren't
 * a zip at all produce no entries.
 */
export class ExportZipReader {
  private readonly unzip: Unzip;

  constructor(
    private readonly onEntry: (name: string, data: Uint8Array) => void,
    private readonly want: (name: string) => boolean,
    private readonly depth = 0,
  ) {
    this.unzip = new Unzip((file) => this.onFile(file));
    this.unzip.register(UnzipInflate);
  }

  push(chunk: Uint8Array, final: boolean): void {
    try {
      this.unzip.push(chunk, final);
    } catch {
      // fflate throws on structurally broken archives; what was read so far still counts.
    }
  }

  private onFile(file: UnzipFile): void {
    const name = file.name;
    if (name.endsWith('/') || !this.want(name)) return;
    const nested = /\.zip$/i.test(name);
    if (nested && this.depth >= MAX_NEST) return;
    const parts: Uint8Array[] = [];
    let size = 0;
    let failed = false;
    file.ondata = (err, data, final) => {
      if (failed) return;
      if (err) {
        failed = true;
        return;
      }
      parts.push(data);
      size += data.length;
      if (!final) return;
      const whole = concat(parts, size);
      parts.length = 0;
      if (nested) new ExportZipReader(this.onEntry, this.want, this.depth + 1).push(whole, true);
      else this.onEntry(name, whole);
    };
    try {
      file.start();
    } catch {
      failed = true;
    }
  }
}
