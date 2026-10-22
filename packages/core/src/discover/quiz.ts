// Quiz draft state machine + decide quiz request mapping (spec §8.2).
export type Affinity = 'like' | 'love';

export interface QuizArtistPick {
  name: string;
  mbid?: string;
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
export function cycleAffinity(d: QuizDraft, name: string, mbid?: string): QuizDraft {
  const existing = d.artists.find((a) => sameName(a.name, name));
  if (!existing) {
    const pick: QuizArtistPick = mbid ? { name, mbid, affinity: 'like' } : { name, affinity: 'like' };
    return { ...d, artists: [...d.artists, pick] };
  }
  if (existing.affinity === 'like') {
    return { ...d, artists: d.artists.map((a) => (a === existing ? { ...a, affinity: 'love' as const } : a)) };
  }
  return { ...d, artists: d.artists.filter((a) => a !== existing) };
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
    manual_artists: d.artists.filter((a) => a.mbid).map((a) => ({ artist_name: a.name, mbid: a.mbid as string })),
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
    manual_artists: d.artists.filter((a) => a.mbid).map((a) => ({ artist_name: a.name, mbid: a.mbid as string })),
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
  const mbids = new Map<string, string>();
  if (Array.isArray(p.manual_artists)) {
    for (const m of p.manual_artists) {
      if (isRecord(m) && typeof m.artist_name === 'string' && typeof m.mbid === 'string') {
        mbids.set(m.artist_name.trim().toLowerCase(), m.mbid);
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
      const mbid = mbids.get(a.artist_name.trim().toLowerCase());
      artists.push(mbid ? { name: a.artist_name, mbid, affinity } : { name: a.artist_name, affinity });
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

type WithWebFields<T> = Omit<T, 'artist_affinities'> & { artist_affinities: AffinityEntry[] } & Record<string, unknown>;
export type ProgressBody = WithWebFields<ReturnType<typeof toProgressRequest>>;
export type SubmitBody = WithWebFields<ReturnType<typeof toSubmitRequest>>;

/** The PUT /api/quiz/progress body: `req` over the saved doc (null when nothing was saved). */
export function mergeProgress(saved: unknown, req: ReturnType<typeof toProgressRequest>): ProgressBody {
  if (!isRecord(saved)) return req;
  return {
    ...saved,
    ...req,
    artist_affinities: keepOccasionally(saved, req.artist_affinities),
    manual_artists: keepExtras(saved.manual_artists, req.manual_artists, 'artist_name'),
    enjoy_songs: keepExtras(saved.enjoy_songs, req.enjoy_songs, 'song_id'),
  };
}

/** The POST /api/quiz/submit body: also carries the saved web-only answers into the profile. */
export function mergeSubmit(saved: unknown, req: ReturnType<typeof toSubmitRequest>): SubmitBody {
  if (!isRecord(saved)) return req;
  const out: SubmitBody = {
    ...req,
    artist_affinities: keepOccasionally(saved, req.artist_affinities),
    manual_artists: keepExtras(saved.manual_artists, req.manual_artists, 'artist_name'),
  };
  for (const k of ['vocal_comfort_pref', 'crowd_pleaser_pref'] as const) {
    if (typeof saved[k] === 'string') out[k] = saved[k];
  }
  return out;
}
