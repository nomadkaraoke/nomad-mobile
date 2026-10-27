import { countsAsSung, libraryKey, type MeSong, type PendingLog } from './library';
import { normalize } from '../search/normalize';

export type KaraokeStats = {
  songs: number;
  performances: number;
  nights: number;
  venues: number;
  topArtist: string | null;
  mostSung: { artist: string; title: string; count: number } | null;
  greatShare: number | null;
};

type Row = { key: string; artist: string; title: string; count: number };

const yearOf = (iso: string | null | undefined): number | null => {
  const m = iso ? /^(\d{4})/.exec(iso) : null;
  return m ? Number(m[1]) : null;
};
const recordYear = (r: PendingLog) => yearOf(r.sung_at) ?? yearOf(r.night?.date);

/**
 * Stats for the Me tab. Without a year, songs/performances come from the (overlaid) library items;
 * with a year they come from the log records dated in that year (undated backfill is excluded).
 * Nights and venues always come from the log and never include backfill records.
 */
export function karaokeStats(items: MeSong[], log: PendingLog[], scope: { year?: number }): KaraokeStats {
  const year = scope.year;
  const inScope = (r: PendingLog) => year === undefined || recordYear(r) === year;
  const sung = log.filter((r) => countsAsSung(r) && inScope(r));

  let rows: Row[];
  if (year === undefined) {
    rows = items.filter((s) => s.times_sung > 0).map((s) => ({ key: s.key, artist: s.artist, title: s.title, count: s.times_sung }));
  } else {
    const byKey = new Map<string, Row>();
    for (const r of sung) {
      const key = libraryKey(r.artist, r.title, r.song_key ?? null);
      const row = byKey.get(key) ?? { key, artist: r.artist, title: r.title, count: 0 };
      row.count += r.times ?? 1;
      byKey.set(key, row);
    }
    rows = [...byKey.values()];
  }

  const performances = rows.reduce((n, r) => n + r.count, 0);

  let mostSung: KaraokeStats['mostSung'] = null;
  for (const r of rows) {
    if (
      !mostSung ||
      r.count > mostSung.count ||
      (r.count === mostSung.count &&
        (normalize(r.artist).localeCompare(normalize(mostSung.artist)) ||
          normalize(r.title).localeCompare(normalize(mostSung.title))) < 0)
    ) {
      mostSung = { artist: r.artist, title: r.title, count: r.count };
    }
  }

  // Top artist: by normalised name, displayed with the most common original spelling.
  const artists = new Map<string, { total: number; spellings: Map<string, number> }>();
  for (const r of rows) {
    const k = normalize(r.artist);
    const a = artists.get(k) ?? { total: 0, spellings: new Map() };
    a.total += r.count;
    a.spellings.set(r.artist, (a.spellings.get(r.artist) ?? 0) + r.count);
    artists.set(k, a);
  }
  let topArtist: string | null = null;
  let topTotal = 0;
  for (const [, a] of [...artists.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (a.total > topTotal) {
      topTotal = a.total;
      let best = '';
      let bestN = -1;
      for (const [sp, n] of a.spellings) if (n > bestN) [best, bestN] = [sp, n];
      topArtist = best;
    }
  }

  // All-time: each song's current latest feel. A year: the latest feel among that year's own dated records, so a
  // song rated great in 2025 and bad in 2026 counts as great in 2025's scope.
  const feelOf = new Map<string, string | null | undefined>();
  if (year === undefined) {
    for (const s of items) feelOf.set(s.key, s.latest_feel);
  } else {
    const latest = new Map<string, { at: string; feel: string }>();
    for (const r of sung) {
      const feel = r.survey?.feel;
      if (!feel) continue;
      const key = libraryKey(r.artist, r.title, r.song_key ?? null);
      const at = r.survey?.answered_at ?? r.sung_at ?? r.night?.date ?? '';
      const cur = latest.get(key);
      if (!cur || at >= cur.at) latest.set(key, { at, feel });
    }
    for (const [k, v] of latest) feelOf.set(k, v.feel);
  }
  let great = 0;
  let rated = 0;
  for (const r of rows) {
    const f = feelOf.get(r.key);
    if (f) {
      rated += 1;
      if (f === 'great') great += 1;
    }
  }

  const nights = new Set<string>();
  const venues = new Set<string>();
  for (const r of sung) {
    if (r.origin === 'backfill') continue;
    const venue = r.night?.venue_name?.trim().toLowerCase() ?? '';
    if (venue) venues.add(venue);
    const day = r.night?.date ?? r.sung_at?.slice(0, 10);
    const id = r.night?.id ? `id:${r.night.id}` : day ? `d:${day}|${venue}` : null;
    if (id) nights.add(id);
  }

  return {
    songs: rows.length,
    performances,
    nights: nights.size,
    venues: venues.size,
    topArtist,
    mostSung,
    greatShare: rated ? great / rated : null,
  };
}
