// Turns an export's entries (from ExportZipReader, or a bare Apple CSV) into one summary.
import { DecodeUTF8, strFromU8 } from 'fflate';
import { AppleCsv, appleCsvEntry, type AppleFamily } from './apple';
import { addAccountHistory, addExtendedHistory, addLibrary, readPlaylists, spotifyEntryKind } from './spotify';
import { ListenTally, RefSet } from './tally';
import type { ExportRef, ExportSummary } from './types';
import { entryBaseName, ExportZipReader, wantExportEntry, type EntrySink } from './zip';

const BOM = String.fromCharCode(0xfeff);
/** CSV entries are decoded and parsed in slices of this many bytes. */
const DECODE_SLICE = 1 << 20;

/**
 * Collects a Spotify or Apple export. Each history family is tallied separately so the same
 * plays are never counted twice: Spotify Extended history wins over Account history, and
 * Apple's per-play activity file wins over its daily totals.
 */
export class ExportAggregator {
  private readonly extended = new ListenTally();
  private readonly account = new ListenTally();
  private readonly apple: Record<AppleFamily, ListenTally> = { activity: new ListenTally(), daily: new ListenTally() };
  private readonly liked = new RefSet();
  private readonly playlists: { name: string; tracks: ExportRef[] }[] = [];
  private spotifySeen = false;
  private csv: AppleCsv | null = null;

  private readonly readers: ExportZipReader[] = [];

  /** A zip reader wired to this aggregator (CSV entries streamed, JSON entries whole). */
  createReader(): ExportZipReader {
    const reader = new ExportZipReader(
      (name, data) => this.addEntry(name, data),
      wantExportEntry,
      (name) => this.entryStream(name),
    );
    this.readers.push(reader);
    return reader;
  }

  /**
   * A streaming sink for entries parsed as they inflate (the Apple play-history CSVs: decoded
   * by DecodeUTF8 straight into the CSV parser, never held whole), or null for entries that
   * must arrive whole through `addEntry` (Spotify JSON).
   */
  entryStream(name: string): EntrySink | null {
    if (!appleCsvEntry(entryBaseName(name))) return null;
    const csv = new AppleCsv(this.apple);
    const dec = new DecodeUTF8((str, final) => csv.push(str, final));
    return (data, final) => dec.push(data, final);
  }

  /** One zip entry, whole. Unknown names are ignored; unreadable history files count as malformed. */
  addEntry(name: string, data: Uint8Array): void {
    const base = entryBaseName(name);
    if (/\.csv$/i.test(base)) {
      const sink = this.entryStream(name);
      if (!sink) return;
      if (data.length === 0) sink(data, true);
      for (let off = 0; off < data.length; off += DECODE_SLICE) {
        const end = Math.min(data.length, off + DECODE_SLICE);
        sink(data.subarray(off, end), end === data.length);
      }
      return;
    }
    const kind = spotifyEntryKind(base);
    if (!kind) return;
    this.spotifySeen = true;
    const tally = kind === 'extended' ? this.extended : kind === 'account' ? this.account : null;
    if (tally) tally.seen = true;
    let json: unknown;
    try {
      let s = strFromU8(data);
      if (s.startsWith(BOM)) s = s.slice(1);
      json = JSON.parse(s);
    } catch {
      if (tally) tally.skipped.malformed++;
      return;
    }
    let ok: boolean;
    if (kind === 'extended') ok = addExtendedHistory(json, this.extended);
    else if (kind === 'account') ok = addAccountHistory(json, this.account);
    else if (kind === 'library') ok = addLibrary(json, this.liked);
    else {
      const pl = readPlaylists(json);
      if (pl) this.playlists.push(...pl);
      ok = pl !== null;
    }
    if (!ok && tally) tally.skipped.malformed++;
  }

  /** A bare Apple CSV file (not zipped), as decoded text in any slicing. */
  addCsvText(text: string, final: boolean): void {
    this.csv ??= new AppleCsv(this.apple);
    this.csv.push(text, final);
    if (final) this.csv = null;
  }

  private truncated(): boolean {
    return this.readers.some((r) => r.truncated);
  }

  /** The export's summary, or null when nothing looked like a Spotify or Apple export. */
  summary(): ExportSummary | null {
    if (this.spotifySeen) {
      // Extended wins unless it produced nothing while Account history is there.
      const extended = this.extended.seen && (this.extended.size > 0 || !this.account.seen);
      const tally = extended ? this.extended : this.account;
      return {
        kind: extended ? 'spotify-extended' : 'spotify-account',
        generatedAt: tally.generatedAt(),
        tracks: tally.tracks(),
        liked: this.liked.refs.map((r) => ({ ...r })),
        playlists: this.playlists.map((p) => ({ name: p.name, tracks: p.tracks.map((r) => ({ ...r })) })),
        skipped: { ...tally.skipped },
        truncated: this.truncated(),
      };
    }
    const { activity, daily } = this.apple;
    if (!activity.seen && !daily.seen) return null;
    const tally = activity.size > 0 || !daily.seen ? activity : daily;
    return { kind: 'apple', generatedAt: tally.generatedAt(), tracks: tally.tracks(), liked: [], playlists: [], skipped: { ...tally.skipped }, truncated: this.truncated() };
  }
}
