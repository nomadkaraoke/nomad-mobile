// Quiz draft state machine + decide quiz request mapping (spec §8.2).
export type Affinity = 'like' | 'love';

export interface QuizArtistPick {
  name: string;
  mbid?: string;
  /** decide's `artist_id` (the Spotify id when the artist search has one, else the MBID). */
  artistId?: string;
  affinity: Affinity;
  reason?: string;
}

export interface QuizDraft {
  step: 1 | 2 | 3 | 4;
  genres: string[];
  decades: string[];
  energy: 'chill' | 'medium' | 'high' | null;
  artists: QuizArtistPick[];
  songs: { songKey: string; artist: string; title: string }[];
}

export const EMPTY_QUIZ: QuizDraft = {
  step: 1,
  genres: [],
  decades: [],
  energy: null,
  artists: [],
  songs: [],
};

export function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Tap cycle: not picked -> like -> love -> not picked. A cycled artist keeps its list position. */
export type ArtistIds = { mbid?: string | null; artistId?: string | null };

/** Only the ids that are set (no `undefined` keys, so equality checks and JSON stay clean). */
function idsOf(ids: ArtistIds | undefined): Pick<QuizArtistPick, 'mbid' | 'artistId'> {
  return { ...(ids?.mbid ? { mbid: ids.mbid } : {}), ...(ids?.artistId ? { artistId: ids.artistId } : {}) };
}

export function cycleAffinity(d: QuizDraft, name: string, ids?: ArtistIds): QuizDraft {
  const existing = d.artists.find((a) => sameName(a.name, name));
  if (!existing) {
    const pick: QuizArtistPick = { name, ...idsOf(ids), affinity: 'like' };
    return { ...d, artists: [...d.artists, pick] };
  }
  if (existing.affinity === 'like') {
    return { ...d, artists: d.artists.map((a) => (a === existing ? { ...a, affinity: 'love' as const } : a)) };
  }
  return { ...d, artists: d.artists.filter((a) => a !== existing) };
}

/** Picks with a catalog id, as decide's ManualArtistInput (only the ids that are set). */
function manualArtists(d: QuizDraft): { artist_name: string; mbid?: string; artist_id?: string }[] {
  return d.artists
    .filter((a) => a.mbid || a.artistId)
    .map((a) => ({
      artist_name: a.name,
      ...(a.mbid ? { mbid: a.mbid } : {}),
      ...(a.artistId ? { artist_id: a.artistId } : {}),
    }));
}

export function canAdvance(d: QuizDraft): boolean {
  return d.step === 1 ? d.genres.length >= 1 : true;
}

/** POST /api/quiz/submit body. Loved songs are sent separately via loveSong, so known_song_ids stays empty. */
export function toSubmitRequest(d: QuizDraft) {
  return {
    genres: d.genres,
    decade_preferences: d.decades,
    energy_preference: d.energy,
    artist_affinities: d.artists.map((a) => ({ artist_name: a.name, affinity: a.affinity })),
    manual_artists: manualArtists(d),
    known_song_ids: [] as string[],
  };
}

/** PUT /api/quiz/progress body; step maps as is into decide's 1-5 range. */
export function toProgressRequest(d: QuizDraft) {
  return {
    step: d.step,
    genres: d.genres,
    decades: d.decades,
    energy_preference: d.energy,
    artist_affinities: d.artists.map((a) => ({ artist_name: a.name, affinity: a.affinity })),
    manual_artists: manualArtists(d),
    enjoy_songs: d.songs.map((s) => ({ song_id: s.songKey, artist: s.artist, title: s.title })),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | null =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

/** Lenient parse of GET /api/quiz/progress; null when it is not a progress doc. Step 5 (web-only) clamps to 4. */
export function fromProgress(p: unknown): QuizDraft | null {
  if (!isRecord(p)) return null;
  const { step } = p;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > 5) return null;
  const genres = strings(p.genres);
  const decades = strings(p.decades);
  if (!genres || !decades) return null;

  const energy = p.energy_preference;
  const ids = new Map<string, ArtistIds>();
  if (Array.isArray(p.manual_artists)) {
    for (const m of p.manual_artists) {
      if (isRecord(m) && typeof m.artist_name === 'string') {
        ids.set(m.artist_name.trim().toLowerCase(), {
          mbid: typeof m.mbid === 'string' ? m.mbid : null,
          artistId: typeof m.artist_id === 'string' ? m.artist_id : null,
        });
      }
    }
  }
  const artists: QuizArtistPick[] = [];
  if (Array.isArray(p.artist_affinities)) {
    for (const a of p.artist_affinities) {
      if (!isRecord(a) || typeof a.artist_name !== 'string') continue;
      // decide's third level, "occasionally", has no mobile equivalent: treat it as "like".
      const affinity = a.affinity === 'love' ? 'love' : a.affinity === 'like' || a.affinity === 'occasionally' ? 'like' : null;
      if (!affinity) continue;
      artists.push({ name: a.artist_name, ...idsOf(ids.get(a.artist_name.trim().toLowerCase())), affinity });
    }
  }
  const songs: QuizDraft['songs'] = [];
  if (Array.isArray(p.enjoy_songs)) {
    for (const s of p.enjoy_songs) {
      if (isRecord(s) && typeof s.song_id === 'string' && typeof s.artist === 'string' && typeof s.title === 'string') {
        songs.push({ songKey: s.song_id, artist: s.artist, title: s.title });
      }
    }
  }
  return {
    step: Math.min(step, 4) as QuizDraft['step'],
    genres,
    decades,
    energy: energy === 'chill' || energy === 'medium' || energy === 'high' ? energy : null,
    artists,
    songs,
  };
}

// decide's PUT /api/quiz/progress replaces the whole progress doc, and decide web edits fields mobile doesn't
// (the "occasionally" affinity, vocal comfort, hits vs deep cuts, per-song singing notes, Spotify ids). The merges
// below lay a mobile request over the doc read from GET /api/quiz/progress so mobile's autosave never wipes them.

type AffinityEntry = { artist_name: string; affinity: 'occasionally' | 'like' | 'love' };
const norm = (s: string) => s.trim().toLowerCase();
const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** Mobile's "like" stays decide web's "occasionally" when that is what was saved; any other edit wins. */
function keepOccasionally(saved: Record<string, unknown>, entries: AffinityEntry[]): AffinityEntry[] {
  const occasionally = new Set(
    records(saved.artist_affinities)
      .filter((a) => a.affinity === 'occasionally' && typeof a.artist_name === 'string')
      .map((a) => norm(a.artist_name as string)),
  );
  return entries.map((a) =>
    a.affinity === 'like' && occasionally.has(norm(a.artist_name)) ? { ...a, affinity: 'occasionally' } : a,
  );
}

/** Each entry keeps the saved entry's extra fields (same `field` value), with mobile's fields on top. */
function keepExtras<T extends Record<string, unknown>>(saved: unknown, entries: T[], field: keyof T & string): T[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const s of records(saved)) if (typeof s[field] === 'string') byKey.set(norm(s[field] as string), s);
  return entries.map((e) => {
    const old = byKey.get(norm(e[field] as string));
    return old ? ({ ...old, ...e } as T) : e;
  });
}

/**
 * decide web's manual_artists are their own list (autocomplete picks, some with only a Spotify `artist_id`), not
 * a copy of the affinities. Matched by name:
 * - a saved entry whose artist mobile never had in its draft (`touched`) is kept as it is;
 * - one mobile still has is kept, with mobile's ids on top;
 * - one mobile had and the user removed is dropped.
 * Mobile's own new id'd picks follow.
 */
type ManualEntry = Record<string, unknown> & { artist_name: string };

function mergeManualArtists(
  saved: unknown,
  req: { artist_name: string }[],
  current: { artist_name: string }[],
  touched: ReadonlySet<string>,
): ManualEntry[] {
  const mine = new Map(req.map((r) => [norm(r.artist_name), r]));
  const kept = new Set(current.map((a) => norm(a.artist_name)));
  const out: ManualEntry[] = [];
  const used = new Set<string>();
  for (const s of records(saved)) {
    if (typeof s.artist_name !== 'string') continue;
    const entry = s as ManualEntry;
    const k = norm(entry.artist_name);
    if (used.has(k)) continue;
    const r = mine.get(k);
    if (r) out.push({ ...entry, ...r });
    else if (!touched.has(k) || kept.has(k)) out.push(entry);
    else continue;
    used.add(k);
  }
  for (const [k, r] of mine) if (!used.has(k)) out.push(r);
  return out;
}

/** Normalized names, for the `touched` argument of the merges. */
export const artistKeys = (names: Iterable<string>): Set<string> => new Set([...names].map(norm));

type WithWebFields<T> = Omit<T, 'artist_affinities'> & { artist_affinities: AffinityEntry[] } & Record<string, unknown>;
export type ProgressBody = WithWebFields<ReturnType<typeof toProgressRequest>>;
export type SubmitBody = WithWebFields<ReturnType<typeof toSubmitRequest>>;

/**
 * The PUT /api/quiz/progress body: `req` over the saved doc (null when nothing was saved). `touched` is every
 * artist name (see `artistKeys`) the mobile draft has had since it was loaded; it defaults to the current picks.
 */
export function mergeProgress(
  saved: unknown,
  req: ReturnType<typeof toProgressRequest>,
  touched: ReadonlySet<string> = artistKeys(req.artist_affinities.map((a) => a.artist_name)),
): ProgressBody {
  if (!isRecord(saved)) return req;
  return {
    ...saved,
    ...req,
    artist_affinities: keepOccasionally(saved, req.artist_affinities),
    manual_artists: mergeManualArtists(saved.manual_artists, req.manual_artists, req.artist_affinities, touched),
    enjoy_songs: keepExtras(saved.enjoy_songs, req.enjoy_songs, 'song_id'),
  };
}

/** The POST /api/quiz/submit body: also carries the saved web-only answers into the profile. */
export function mergeSubmit(
  saved: unknown,
  req: ReturnType<typeof toSubmitRequest>,
  touched: ReadonlySet<string> = artistKeys(req.artist_affinities.map((a) => a.artist_name)),
): SubmitBody {
  if (!isRecord(saved)) return req;
  const out: SubmitBody = {
    ...req,
    artist_affinities: keepOccasionally(saved, req.artist_affinities),
    manual_artists: mergeManualArtists(saved.manual_artists, req.manual_artists, req.artist_affinities, touched),
  };
  for (const k of ['vocal_comfort_pref', 'crowd_pleaser_pref'] as const) {
    if (typeof saved[k] === 'string') out[k] = saved[k];
  }
  return out;
}
