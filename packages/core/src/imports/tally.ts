// Per-song play aggregation shared by the Spotify and Apple parsers.
import { identityNormalize } from '../search/normalize';
import { MAX_TS, MIN_PLAY_MS, type ExportRef, type ListenAggregate } from './types';

/** Identity key of a song: normalized artist + NUL + normalized title (raw lowercase if that's empty). */
export function songIdentity(artist: string, title: string): string {
  const a = identityNormalize(artist) || artist.toLowerCase();
  const t = identityNormalize(title) || title.toLowerCase();
  return `${a}\u0000${t}`;
}

/** A trimmed non-empty string, or null. */
export function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/** A finite number from a number or numeric string, or null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

const DATE_ONLY_RE = /^(\d{4})(\d{2})(\d{2})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/** Unix seconds of a UTC civil time, or null when a field is out of range (no Date.UTC rollover: Feb 30 is not Mar 2). */
function utcSeconds(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(ms).getUTCDate() !== d) return null;
  return ms / 1000;
}

/**
 * Unix seconds from an export timestamp: Spotify `endTime` ("2024-05-01 21:15", UTC),
 * Spotify `ts` / Apple ISO 8601 (zone optional, UTC assumed), Apple `YYYYMMDD` dates, or
 * epoch seconds / milliseconds. Null when unparseable or outside decide's range.
 */
export function toUnixSeconds(v: unknown): number | null {
  let sec: number | null = null;
  const n = num(v);
  const s = typeof v === 'string' ? v.trim() : '';
  const day = DATE_ONLY_RE.exec(s);
  if (day) {
    sec = utcSeconds(Number(day[1]), Number(day[2]), Number(day[3]), 0, 0, 0);
  } else if (n !== null) {
    sec = n > 1e11 ? n / 1000 : n;
  } else {
    const m = ISO_RE.exec(s);
    if (m) {
      const [, y, mo, d, h = '0', mi = '0', se = '0', zone] = m;
      sec = utcSeconds(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(se));
      if (sec !== null && zone && zone.toUpperCase() !== 'Z') {
        const z = /([+-])(\d{2}):?(\d{2})/.exec(zone)!;
        sec -= (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60;
      }
    }
  }
  if (sec === null || !Number.isFinite(sec)) return null;
  sec = Math.floor(sec);
  return sec >= 0 && sec <= MAX_TS ? sec : null;
}

/** Aggregated plays of one history family (e.g. Spotify extended, Apple play activity). */
export class ListenTally {
  /** A file of this family was read (even if every row was skipped). */
  seen = false;
  readonly skipped = { podcasts: 0, short: 0, malformed: 0 };
  private readonly songs = new Map<string, ListenAggregate>();
  private maxTs = -1;

  get size(): number {
    return this.songs.size;
  }

  /** Counts one history row (`plays` > 1 for pre-aggregated daily rows). */
  add(artistRaw: unknown, titleRaw: unknown, msRaw: unknown, tsRaw: unknown, plays = 1): void {
    const artist = text(artistRaw);
    const title = text(titleRaw);
    const ms = num(msRaw);
    const ts = toUnixSeconds(tsRaw);
    if (!artist || !title || ms === null || ts === null) {
      this.skipped.malformed++;
      return;
    }
    if (ms < MIN_PLAY_MS) {
      this.skipped.short++;
      return;
    }
    const key = songIdentity(artist, title);
    const agg = this.songs.get(key);
    const count = Math.max(1, Math.floor(plays));
    if (agg) {
      agg.ms_played += Math.round(ms);
      agg.plays += count;
      agg.first_ts = Math.min(agg.first_ts, ts);
      agg.last_ts = Math.max(agg.last_ts, ts);
    } else {
      this.songs.set(key, { artist, title, ms_played: Math.round(ms), plays: count, first_ts: ts, last_ts: ts });
    }
    this.maxTs = Math.max(this.maxTs, ts);
  }

  tracks(): ListenAggregate[] {
    return [...this.songs.values()].map((t) => ({ ...t }));
  }

  /** YYYY-MM-DD of the latest counted play, or today (UTC) when there were none. */
  generatedAt(): string {
    const d = this.maxTs >= 0 ? new Date(this.maxTs * 1000) : new Date();
    return d.toISOString().slice(0, 10);
  }
}

/** Deduplicating list of song refs (liked songs). */
export class RefSet {
  private readonly keys = new Set<string>();
  readonly refs: ExportRef[] = [];

  add(artistRaw: unknown, titleRaw: unknown): boolean {
    const artist = text(artistRaw);
    const title = text(titleRaw);
    if (!artist || !title) return false;
    const key = songIdentity(artist, title);
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.refs.push({ artist, title });
    return true;
  }
}
