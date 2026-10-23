// Apple Media Services privacy export: the play-history CSVs, parsed as a text stream.
import { text, type ListenTally } from './tally';

/** Apple CSVs worth reading: the play activity / play history files ("…Play Activity.csv", "…Play History Daily Tracks.csv"). */
export function appleCsvEntry(base: string): boolean {
  return /\.csv$/i.test(base) && /play/i.test(base);
}

const BOM = String.fromCharCode(0xfeff);
const DELIM_RE = /[,\r\n]/g;

/**
 * Streaming RFC 4180 CSV: quoted fields may hold commas, `""` and line breaks; LF or CRLF
 * rows. Text can arrive in any slicing: an unfinished row is carried to the next push.
 */
export class CsvRows {
  private carry = '';
  private started = false;

  constructor(private readonly onRow: (fields: string[]) => void) {}

  push(chunk: string, final: boolean): void {
    let s = this.carry + chunk;
    if (!this.started && (s.length > 0 || final)) {
      if (s.startsWith(BOM)) s = s.slice(1);
      this.started = s.length > 0;
    }
    let pos = 0;
    while (pos < s.length) {
      const next = this.row(s, pos, final);
      if (next < 0) break;
      pos = next;
    }
    this.carry = s.slice(pos);
    if (final) this.carry = '';
  }

  /** Parses the row at `pos`; returns the index after it, or -1 if it isn't complete yet. */
  private row(s: string, pos: number, final: boolean): number {
    const fields: string[] = [];
    for (;;) {
      let field = '';
      if (s[pos] === '"') {
        let j = pos + 1;
        for (;;) {
          const q = s.indexOf('"', j);
          if (q < 0) {
            if (!final) return -1;
            field += s.slice(j);
            pos = s.length;
            break;
          }
          field += s.slice(j, q);
          if (q + 1 >= s.length && !final) return -1;
          if (s[q + 1] === '"') {
            field += '"';
            j = q + 2;
            continue;
          }
          pos = q + 1;
          break;
        }
      }
      DELIM_RE.lastIndex = pos;
      const m = DELIM_RE.exec(s);
      if (!m) {
        if (!final) return -1;
        fields.push(field + s.slice(pos));
        this.emit(fields);
        return s.length;
      }
      field += s.slice(pos, m.index);
      fields.push(field);
      const d = m[0];
      if (d === ',') {
        pos = m.index + 1;
        if (pos >= s.length) {
          if (!final) return -1;
          fields.push('');
          this.emit(fields);
          return s.length;
        }
        continue;
      }
      if (d === '\r' && m.index + 1 >= s.length && !final) return -1;
      this.emit(fields);
      return d === '\r' && s[m.index + 1] === '\n' ? m.index + 2 : m.index + 1;
    }
  }

  private emit(fields: string[]): void {
    if (fields.length === 1 && fields[0] === '') return; // blank line
    this.onRow(fields);
  }
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
const ARTIST = ['artist name', 'container artist name'];
const TITLE = ['song name', 'content name'];
const DURATION = ['play duration milliseconds'];
const TIME = ['event start timestamp', 'event end timestamp'];
const DATE_PLAYED = ['date played'];
const PLAY_COUNT = ['play count'];
const DESCRIPTION = ['track description'];

export type AppleFamily = 'activity' | 'daily';

/**
 * One Apple play-history CSV → its tally. The header row decides the family: event
 * timestamps = "Play Activity" (one row per play), `Date Played` = "Play History Daily Tracks"
 * (per-day totals with a play count). Any other header: not a play-history file, ignored.
 * Artist/title come from the aliased columns, else from `Track Description` ("Artist - Title").
 */
export class AppleCsv {
  private readonly rows = new CsvRows((f) => this.onRow(f));
  private cols: { artist: number[]; title: number[]; duration: number; time: number[]; count: number; description: number } | null = null;
  private tally: ListenTally | null = null;
  private headerDone = false;

  constructor(private readonly tallies: Record<AppleFamily, ListenTally>) {}

  push(chunk: string, final: boolean): void {
    this.rows.push(chunk, final);
  }

  private onRow(fields: string[]): void {
    if (!this.headerDone) {
      this.headerDone = true;
      this.header(fields);
      return;
    }
    const c = this.cols;
    const tally = this.tally;
    if (!c || !tally) return;
    const pick = (idx: number[]) => {
      for (const i of idx) {
        const v = text(fields[i]);
        if (v) return v;
      }
      return null;
    };
    let artist = pick(c.artist);
    let title = pick(c.title);
    if ((!artist || !title) && c.description >= 0) {
      const desc = text(fields[c.description]) ?? '';
      const cut = desc.indexOf(' - ');
      if (cut > 0) {
        artist = desc.slice(0, cut);
        title = desc.slice(cut + 3);
      }
    }
    const count = c.count >= 0 ? Number(fields[c.count]) : 1;
    tally.add(artist, title, fields[c.duration], pick(c.time), Number.isFinite(count) && count > 0 ? count : 1);
  }

  private header(fields: string[]): void {
    const names = fields.map(norm);
    const find = (aliases: string[]) => aliases.map((a) => names.indexOf(a)).filter((i) => i >= 0);
    const artist = find(ARTIST);
    const title = find(TITLE);
    const description = find(DESCRIPTION)[0] ?? -1;
    const duration = find(DURATION)[0] ?? -1;
    const time = find(TIME);
    const date = find(DATE_PLAYED);
    const family: AppleFamily | null = time.length ? 'activity' : date.length ? 'daily' : null;
    if (!family || duration < 0 || ((!artist.length || !title.length) && description < 0)) return;
    this.cols = { artist, title, duration, time: family === 'activity' ? time : date, count: find(PLAY_COUNT)[0] ?? -1, description };
    this.tally = this.tallies[family];
    this.tally.seen = true;
  }
}
