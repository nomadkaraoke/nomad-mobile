// Turns an export's entries (from ExportZipReader, or a bare Apple CSV) into one summary.
import { DecodeUTF8, strFromU8 } from 'fflate';
import { AppleCsv, appleCsvEntry, type AppleFamily } from './apple';
import { addAccountHistory, addExtendedHistory, addLibrary, readPlaylists, spotifyEntryKind } from './spotify';
import { ListenTally, RefSet } from './tally';
import type { ExportRef, ExportSummary } from './types';
import { entryBaseName } from './zip';

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

  /** One zip entry, whole. Unknown names are ignored; unreadable history files count as malformed. */
  addEntry(name: string, data: Uint8Array): void {
    const base = entryBaseName(name);
    if (/\.csv$/i.test(base)) {
      if (!appleCsvEntry(base)) return;
      const csv = new AppleCsv(this.apple);
      const dec = new DecodeUTF8((str, final) => csv.push(str, final));
      if (data.length === 0) dec.push(data, true);
      for (let off = 0; off < data.length; off += DECODE_SLICE) {
        const end = Math.min(data.length, off + DECODE_SLICE);
        dec.push(data.subarray(off, end), end === data.length);
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

  /** The export's summary, or null when nothing looked like a Spotify or Apple export. */
  summary(): ExportSummary | null {
    if (this.spotifySeen) {
      const extended = this.extended.seen;
      const tally = extended ? this.extended : this.account;
      return {
        kind: extended ? 'spotify-extended' : 'spotify-account',
        generatedAt: tally.generatedAt(),
        tracks: tally.tracks(),
        liked: this.liked.refs.map((r) => ({ ...r })),
        playlists: this.playlists.map((p) => ({ name: p.name, tracks: p.tracks.map((r) => ({ ...r })) })),
        skipped: { ...tally.skipped },
      };
    }
    const { activity, daily } = this.apple;
    if (!activity.seen && !daily.seen) return null;
    const tally = activity.size > 0 || !daily.seen ? activity : daily;
    return { kind: 'apple', generatedAt: tally.generatedAt(), tracks: tally.tracks(), liked: [], playlists: [], skipped: { ...tally.skipped } };
  }
}
