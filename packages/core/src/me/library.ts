import { normalize, songKey as searchSongKey } from '../search/normalize';

export type Feel = 'great' | 'ok' | 'bad';
export type KeyFeel = 'too_low' | 'right' | 'too_high';

export type MeSong = {
  key: string;
  song_key: string | null;
  artist: string;
  title: string;
  times_sung: number;
  backfill_times: number;
  first_sung_at?: string | null;
  last_sung_at?: string | null;
  feel_counts: { great: number; ok: number; bad: number };
  latest_feel?: Feel | null;
  latest_key?: KeyFeel | null;
  crowd_pleaser_count: number;
  vibes: string[];
  loved: boolean;
  hidden: boolean;
  setlist_ids: string[];
  facets?: {
    mood?: string | null;
    energy_band?: string | null;
    has_karaoke: boolean;
    community: boolean;
    karafun: boolean;
    vr_tier?: string | null;
  } | null;
};

/** Library identity: the server song_key, else `u:` + the search normaliser's songKey. */
export function libraryKey(artist: string, title: string, serverSongKey?: string | null): string {
  return serverSongKey ?? 'u:' + searchSongKey(artist, title);
}

/** Go-to rule: not hidden, latest feel isn't bad, and (latest feel is great or sung 2+ times). */
export function isGoTo(s: MeSong): boolean {
  if (s.hidden || s.latest_feel === 'bad') return false;
  return s.latest_feel === 'great' || s.times_sung >= 2;
}

export type LibraryQuery = {
  text?: string;
  feel?: ('great' | 'ok' | 'bad' | 'unrated')[];
  often?: 'twice' | 'once' | 'unsung' | null;
  moods?: string[];
  vibes?: string[];
  library?: 'any' | 'community' | 'karafun';
  savedOnly?: boolean;
  sort: 'most' | 'recent' | 'rated' | 'az' | 'goto';
};

const rating = (s: MeSong): 'great' | 'ok' | 'bad' | 'unrated' => s.latest_feel ?? 'unrated';

function greatShare(s: MeSong): number {
  const { great, ok, bad } = s.feel_counts;
  const n = great + ok + bad;
  return n ? great / n : 0;
}

const ratedCount = (s: MeSong) => s.feel_counts.great + s.feel_counts.ok + s.feel_counts.bad;

const azCompare = (a: MeSong, b: MeSong) =>
  normalize(a.artist).localeCompare(normalize(b.artist)) || normalize(a.title).localeCompare(normalize(b.title));

/** Saved = loved (Save is Love); setlist-only songs are in the library but not saved. */
const isSaved = (s: MeSong) => s.loved;

export function queryLibrary(items: MeSong[], q: LibraryQuery): MeSong[] {
  const qTokens = q.text ? normalize(q.text).split(' ').filter(Boolean) : [];
  const feelSet = q.feel && q.feel.length ? new Set(q.feel) : null;
  const out = items.filter((s) => {
    const r = rating(s);
    if (feelSet ? !feelSet.has(r) : s.hidden) return false;
    if (qTokens.length) {
      const hay = normalize(`${s.artist} ${s.title}`);
      if (!qTokens.every((t) => hay.includes(t))) return false;
    }
    if (q.often === 'twice' && s.times_sung < 2) return false;
    if (q.often === 'once' && s.times_sung !== 1) return false;
    if (q.often === 'unsung' && s.times_sung !== 0) return false;
    if (q.moods?.length && !(s.facets?.mood && q.moods.includes(s.facets.mood))) return false;
    if (q.vibes?.length && !s.vibes.some((v) => q.vibes!.includes(v))) return false;
    if (q.library === 'community' && !s.facets?.community) return false;
    if (q.library === 'karafun' && !s.facets?.karafun) return false;
    if (q.savedOnly && !isSaved(s)) return false;
    return true;
  });
  const cmp: Record<LibraryQuery['sort'], (a: MeSong, b: MeSong) => number> = {
    az: azCompare,
    most: (a, b) => b.times_sung - a.times_sung || azCompare(a, b),
    recent: (a, b) => {
      const la = a.last_sung_at ?? '';
      const lb = b.last_sung_at ?? '';
      if (la !== lb) return la < lb ? 1 : -1;
      return azCompare(a, b);
    },
    rated: (a, b) => greatShare(b) - greatShare(a) || ratedCount(b) - ratedCount(a) || azCompare(a, b),
    goto: (a, b) =>
      Number(isGoTo(b)) - Number(isGoTo(a)) || b.times_sung - a.times_sung || azCompare(a, b),
  };
  return out.sort(cmp[q.sort]);
}

export type PendingLog = {
  id: string;
  artist: string;
  title: string;
  song_key?: string | null;
  state: string;
  times?: number;
  origin?: string;
  survey?: {
    feel?: string;
    key?: string;
    crowd_pleaser?: boolean;
    vibes?: string[];
    answered_at?: string;
  };
  deleted?: boolean;
  sung_at?: string | null;
  /**
   * The feel the server already counted for this record (its synced survey), when known. A re-edited survey then
   * moves that count to the new feel instead of adding a second one.
   */
  prev_feel?: string | null;
  /**
   * True when the server already counted this record (it is in the log mirror / server data): a pending write on it
   * is an edit, not a new performance, so it only moves the survey fields. For a deleted record the overlay then
   * subtracts what it contributed (`times`, `origin`, `survey.feel`, taken from the synced copy).
   */
  synced?: boolean;
  /** Night context (needed by karaokeStats for nights and venues). */
  night?: { id?: string; date?: string; venue_name?: string; kind?: string };
};

export type PendingLoves = Record<string, { loved: boolean; artist: string; title: string; song_key: string }>;
export type PendingSetlist = {
  id: string;
  items: { song_key: string | null; artist: string; title: string }[];
  deleted?: boolean;
};

/** Server counting rule: sung or sung_unplayed, not deleted, has artist and title. */
export function countsAsSung(r: PendingLog): boolean {
  return (r.state === 'sung' || r.state === 'sung_unplayed') && !r.deleted && !!r.artist && !!r.title;
}

const FEELS = new Set(['great', 'ok', 'bad']);
const KEYS = new Set(['too_low', 'right', 'too_high']);

const blank = (artist: string, title: string, song_key: string | null): MeSong => ({
  key: libraryKey(artist, title, song_key),
  song_key,
  artist,
  title,
  times_sung: 0,
  backfill_times: 0,
  first_sung_at: null,
  last_sung_at: null,
  feel_counts: { great: 0, ok: 0, bad: 0 },
  latest_feel: null,
  latest_key: null,
  crowd_pleaser_count: 0,
  vibes: [],
  loved: false,
  hidden: false,
  setlist_ids: [],
  facets: null,
});

/**
 * Apply unsynced edits on top of the server items. Returns new objects; inputs are untouched.
 *
 * A `PendingLog` entry is a new performance unless it is marked `synced` (the server already counted it): then it
 * only moves the survey fields, and a deleted one subtracts its synced contribution.
 * Surveys use the server's per-field semantics: `latest_feel` and `latest_key` are each the newest
 * answer to that field by `answered_at`; a survey that skips a field leaves the older answer alone.
 * A pending survey with no `answered_at` was answered now, so it sorts after everything else.
 */
export function overlayLibrary(
  items: MeSong[],
  pending: { log: PendingLog[]; loves: PendingLoves; setlists: PendingSetlist[] },
): MeSong[] {
  const map = new Map<string, MeSong>();
  for (const s of items) {
    map.set(s.key, {
      ...s,
      feel_counts: { ...s.feel_counts },
      vibes: [...s.vibes],
      setlist_ids: [...s.setlist_ids],
    });
  }
  const touched = new Set<string>();
  const get = (artist: string, title: string, song_key: string | null | undefined): MeSong => {
    const key = libraryKey(artist, title, song_key ?? null);
    let s = map.get(key);
    if (!s) {
      s = blank(artist, title, song_key ?? null);
      map.set(key, s);
    }
    return s;
  };

  // 1. Sung records. A synced record is already in the server counts: only a NEW performance adds to them.
  for (const r of pending.log) {
    if (!countsAsSung(r) || r.synced) continue;
    const s = get(r.artist, r.title, r.song_key);
    const n = r.times ?? 1;
    s.times_sung += n;
    if (r.origin === 'backfill') s.backfill_times += n;
    if (r.sung_at) {
      if (!s.first_sung_at || r.sung_at < s.first_sung_at) s.first_sung_at = r.sung_at;
      if (!s.last_sung_at || r.sung_at > s.last_sung_at) s.last_sung_at = r.sung_at;
    }
  }

  // 1b. Deleted records the server already counted: take back their contribution (never below zero).
  for (const r of pending.log) {
    if (!r.deleted || !r.synced || !(r.state === 'sung' || r.state === 'sung_unplayed') || !r.artist || !r.title) continue;
    const key = libraryKey(r.artist, r.title, r.song_key ?? null);
    const s = map.get(key);
    if (!s) continue;
    const n = r.times ?? 1;
    s.times_sung = Math.max(0, s.times_sung - n);
    if (r.origin === 'backfill') s.backfill_times = Math.max(0, s.backfill_times - n);
    const feel = r.survey?.feel;
    if (feel && FEELS.has(feel) && s.feel_counts[feel as Feel] > 0) s.feel_counts[feel as Feel] -= 1;
    if (s.feel_counts.great + s.feel_counts.ok + s.feel_counts.bad === 0) s.latest_feel = null;
    if (s.times_sung === 0) {
      s.first_sung_at = null;
      s.last_sung_at = null;
    }
    touched.add(key);
  }

  // 2. Surveys, oldest first so the newest answer per field wins.
  const surveyed = pending.log
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.deleted && r.survey && r.artist && r.title)
    .sort((a, b) => {
      const ta = a.r.survey!.answered_at ?? '￿';
      const tb = b.r.survey!.answered_at ?? '￿';
      return ta < tb ? -1 : ta > tb ? 1 : a.i - b.i;
    });
  for (const { r } of surveyed) {
    const sv = r.survey!;
    // A record that doesn't count as sung must not create a phantom item.
    if ((!countsAsSung(r) || r.synced) && !map.has(libraryKey(r.artist, r.title, r.song_key ?? null))) continue;
    const s = get(r.artist, r.title, r.song_key);
    if (sv.feel && FEELS.has(sv.feel)) {
      s.latest_feel = sv.feel as Feel;
      const prev = r.prev_feel && FEELS.has(r.prev_feel) ? (r.prev_feel as Feel) : null;
      if (prev !== sv.feel) {
        if (prev && s.feel_counts[prev] > 0) s.feel_counts[prev] -= 1;
        s.feel_counts[sv.feel as Feel] += 1;
      }
    }
    if (sv.key && KEYS.has(sv.key)) s.latest_key = sv.key as KeyFeel;
    if (sv.crowd_pleaser) s.crowd_pleaser_count += 1;
    for (const v of sv.vibes ?? []) if (!s.vibes.includes(v)) s.vibes.push(v);
  }

  // 3. Loves.
  for (const l of Object.values(pending.loves)) {
    const s = get(l.artist, l.title, l.song_key);
    s.loved = l.loved;
    touched.add(s.key);
  }

  // 4. Setlists: membership of a pending list is exactly its items.
  for (const sl of pending.setlists) {
    for (const s of map.values()) {
      if (s.setlist_ids.includes(sl.id)) {
        s.setlist_ids = s.setlist_ids.filter((id) => id !== sl.id);
        touched.add(s.key);
      }
    }
    if (sl.deleted) continue;
    for (const it of sl.items) {
      const s = get(it.artist, it.title, it.song_key);
      if (!s.setlist_ids.includes(sl.id)) s.setlist_ids.push(sl.id);
      touched.add(s.key);
    }
  }

  // Drop songs whose only reason to exist was a love or setlist membership that's now gone.
  for (const key of touched) {
    const s = map.get(key)!;
    if (!s.loved && s.times_sung === 0 && s.setlist_ids.length === 0) map.delete(key);
  }
  return [...map.values()];
}
