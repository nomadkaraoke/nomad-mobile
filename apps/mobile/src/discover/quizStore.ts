// The quiz draft (spec §8.2): resumed from decide's saved progress (or this phone's copy), autosaved as it changes,
// plus the smart artist suggestions shown on step 3.
import {
  getPreferences,
  getQuizProgress,
  listLovedSongs,
  listMyArtists,
  saveQuizProgress,
  smartQuizArtists,
  type QuizArtistResponse,
  type QuizProgressRequest,
} from '@nomad/api-decide';
import {
  artistKeys,
  EMPTY_QUIZ,
  fromProgress,
  mergeProgress,
  toProgressRequest,
  type QuizArtistPick,
  type QuizDraft,
} from '@nomad/core';
import { create } from 'zustand';

import { appStorage } from '../storage';

export const QUIZ_STORAGE_KEY = 'discover.quiz.v1';
/** Changes are sent to decide this long after the last one. */
export const AUTOSAVE_MS = 1000;
/** A new pick asks for more suggestions this long after the last pick (one smart call for a burst of taps). */
export const SUGGEST_REFRESH_MS = 600;
/** decide web's batch sizes (useInfiniteArtists): 15 first, then 10 more. */
export const FIRST_SUGGESTIONS = 15;
export const MORE_SUGGESTIONS = 10;

type QuizStore = {
  draft: QuizDraft;
  /**
   * The progress doc last read from or sent to decide. decide's PUT replaces the whole doc, so every save lays
   * the draft over it (`mergeProgress`) and keeps what decide web saved that mobile doesn't edit.
   */
  saved: unknown;
  /**
   * Every artist name (normalized) the draft has had since it was loaded. A saved web manual artist mobile never
   * had is kept on save; one the user removed here is dropped (core `mergeProgress`).
   */
  touched: ReadonlySet<string>;
  /**
   * "Your artists" on step 3: the loaded picks, then those added from search. Nothing leaves it until the next
   * load, so an artist tapped off stays there (also after leaving and re-entering step 3).
   */
  listed: Pick<QuizArtistPick, 'name' | 'mbid' | 'artistId'>[];
  /**
   * Song keys decide had as loved when the quiz was opened from the music profile (`load(owner, true)`); empty
   * otherwise. Finishing unloves those the user tapped off, since step 4 shows them as picked.
   */
  seededLoved: readonly string[];
  /** The signed-in email the draft belongs to; null until `load` finishes. */
  owner: string | null;
  /** Suggestions in the order shown. Append-only: an artist once shown is never removed. */
  suggestions: QuizArtistResponse[];
  suggesting: boolean;
  /** The genres + decades the last suggestion call was made for. */
  suggestedFor: string | null;
  /**
   * Resumes the draft. `seed` (opened from the music profile to edit it): decide's current preferences, artists
   * and loved songs are laid over the saved progress, which can be missing or stale.
   */
  load(owner: string, seed?: boolean): Promise<void>;
  update(change: (d: QuizDraft) => QuizDraft): void;
  /** Sends a pending autosave now (the quiz is closing). */
  flush(): void;
  /** Asks decide for (more) smart suggestions; a call while one is in flight runs once it lands. */
  suggest(): void;
  /** Suggestions when there are none yet, or when genres/decades changed since the last call (still append-only). */
  suggestIfStale(): void;
  /** A new pick: refresh the suggestions shortly. */
  suggestSoon(): void;
  /** Adds an artist (from search) to "Your artists". */
  list(artist: Pick<QuizArtistPick, 'name' | 'mbid' | 'artistId'>): void;
  /**
   * After submit: forgets this phone's copy and stops pending work. The on-screen state stays (no flash while the
   * modal closes); the next `load` replaces it.
   */
  clear(): void;
  reset(): void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let suggestTimer: ReturnType<typeof setTimeout> | null = null;
let suggestAgain = false;
/** Bumped by reset/load, so answers to an older draft's calls are dropped. */
let generation = 0;

const norm = (s: string) => s.trim().toLowerCase();
/** What a suggestion call depends on besides the picks. */
const suggestionKey = (d: QuizDraft) => JSON.stringify([[...d.genres].sort(), [...d.decades].sort()]);

function stopTimers() {
  if (saveTimer) clearTimeout(saveTimer);
  if (suggestTimer) clearTimeout(suggestTimer);
  saveTimer = suggestTimer = null;
  suggestAgain = false;
}

/** This phone's copy, only when it belongs to `owner`. */
function readLocal(owner: string): unknown {
  try {
    const raw = appStorage.getString(QUIZ_STORAGE_KEY);
    if (raw === undefined) return null;
    const v = JSON.parse(raw) as { owner?: unknown; progress?: unknown };
    return v.owner === owner ? (v.progress ?? null) : null;
  } catch {
    appStorage.remove(QUIZ_STORAGE_KEY);
    return null;
  }
}

type CurrentProfile = {
  prefs: Awaited<ReturnType<typeof getPreferences>> | null;
  artists: { name: string; affinity: 'love' | 'like' }[] | null;
  songs: QuizDraft['songs'] | null;
};

/** What decide holds now (each part null when it can't be read): the source of truth for editing. */
async function currentProfile(): Promise<CurrentProfile> {
  const [prefs, artists, loved] = await Promise.allSettled([getPreferences(), listMyArtists(), listLovedSongs()]);
  return {
    prefs: prefs.status === 'fulfilled' ? prefs.value : null,
    artists: artists.status === 'fulfilled' ? artists.value.artists.map((a) => ({
            name: a.artist_name,
            // decide's quiz level; the draft has no "occasionally", and artists with none (synced) default to like.
            affinity: a.affinity === 'love' ? ('love' as const) : ('like' as const),
          })) : null,
    songs:
      loved.status === 'fulfilled'
        ? loved.value.map((x) => ({ songKey: x.song_key, artist: x.artist, title: x.title }))
        : null,
  };
}

/** The saved draft with the current profile on top: current answers win, removed artists and songs stay removed. */
function overlayProfile(d: QuizDraft, c: CurrentProfile): QuizDraft {
  const out: QuizDraft = { ...d };
  if (c.prefs) {
    out.genres = c.prefs.genres ?? [];
    out.decades = c.prefs.decades ?? [];
    out.energy = c.prefs.energy_preference ?? null;
  }
  if (c.artists) {
    const have = new Map(d.artists.map((a) => [norm(a.name), a]));
    out.artists = c.artists.map(({ name, affinity }) => have.get(norm(name)) ?? { name, affinity });
  }
  if (c.songs) out.songs = c.songs;
  return out;
}

const manualNames = (progress: unknown): string[] => {
  const list = (progress as { manual_artists?: unknown } | null)?.manual_artists;
  return Array.isArray(list)
    ? list.flatMap((m: { artist_name?: unknown }) => (typeof m?.artist_name === 'string' ? [m.artist_name] : []))
    : [];
};

const INITIAL = {
  draft: EMPTY_QUIZ,
  saved: null,
  touched: new Set<string>(),
  listed: [],
  seededLoved: [],
  owner: null,
  suggestions: [],
  suggesting: false,
  suggestedFor: null,
} satisfies Partial<QuizStore>;

export const useQuizDraft = create<QuizStore>((set, get) => {
  /** The body for decide (and this phone's copy): the draft over the last saved doc. */
  const body = () => mergeProgress(get().saved, toProgressRequest(get().draft), get().touched);

  const send = () => {
    saveTimer = null;
    const progress = body();
    set({ saved: progress });
    // Best effort: a failed save leaves this phone's copy, and a decide 401 only marks Discover stale.
    saveQuizProgress(progress as QuizProgressRequest).catch(() => {});
  };

  return {
    ...INITIAL,

    async load(owner, seed = false) {
      stopTimers();
      const gen = ++generation;
      set({ ...INITIAL });
      let remote: unknown = null;
      try {
        remote = await getQuizProgress();
      } catch {
        // Offline or decide unavailable: this phone's copy, if any.
      }
      const current = seed ? await currentProfile() : null;
      if (gen !== generation) return;
      const local = readLocal(owner);
      const fromRemote = remote ? fromProgress(remote) : null;
      const fromLocal = !fromRemote && local ? fromProgress(local) : null;
      const fromProgressDoc = fromRemote ?? fromLocal ?? EMPTY_QUIZ;
      const draft = current ? overlayProfile(fromProgressDoc, current) : fromProgressDoc;
      // Names the saved progress had but the profile no longer lists count as touched, so submit drops them
      // from the merged manual_artists instead of resurrecting them.
      const staleNames = [...fromProgressDoc.artists.map((a) => a.name), ...manualNames(remote ?? local)];
      set({
        owner,
        draft,
        saved: fromRemote ? remote : fromLocal ? local : null,
        touched: artistKeys([...draft.artists.map((a) => a.name), ...(current ? staleNames : [])]),
        listed: draft.artists.map(({ name, mbid, artistId }) => ({ name, mbid, artistId })),
        seededLoved: current?.songs?.map((x) => x.songKey) ?? [],
      });
    },

    update(change) {
      const { owner } = get();
      if (!owner) return;
      const draft = change(get().draft);
      const touched = new Set(get().touched);
      for (const a of draft.artists) touched.add(norm(a.name));
      set({ draft, touched });
      appStorage.set(QUIZ_STORAGE_KEY, JSON.stringify({ owner, progress: body() }));
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(send, AUTOSAVE_MS);
    },

    flush() {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      send();
    },

    suggest() {
      if (get().suggesting) {
        suggestAgain = true;
        return;
      }
      const gen = generation;
      const { draft, suggestions } = get();
      const picked = draft.artists.map((a) => a.name);
      const shown = suggestions.map((a) => a.name);
      set({ suggesting: true, suggestedFor: suggestionKey(draft) });
      smartQuizArtists({
        genres: draft.genres,
        decades: draft.decades,
        manual_artists: picked,
        manual_song_artists: [...new Set(draft.songs.map((s) => s.artist))],
        exclude: [...new Set([...shown, ...picked])],
        count: shown.length ? MORE_SUGGESTIONS : FIRST_SUGGESTIONS,
      })
        .then((res) => {
          if (gen !== generation) return;
          const seen = new Set(get().suggestions.map((a) => norm(a.name)));
          const fresh = res.artists.filter((a) => !seen.has(norm(a.name)) && seen.add(norm(a.name)));
          if (fresh.length) set({ suggestions: [...get().suggestions, ...fresh] });
        })
        .catch(() => {
          // Suggestions are optional: the search box still works.
        })
        .finally(() => {
          if (gen !== generation) return;
          set({ suggesting: false });
          if (suggestAgain) {
            suggestAgain = false;
            get().suggest();
          }
        });
    },

    suggestIfStale() {
      const { draft, suggestions, suggesting, suggestedFor } = get();
      const changed = suggestedFor !== suggestionKey(draft);
      if (suggesting) {
        if (changed) suggestAgain = true;
      } else if (suggestions.length === 0 || changed) get().suggest();
    },

    list(artist) {
      if (get().listed.some((a) => norm(a.name) === norm(artist.name))) return;
      set({ listed: [...get().listed, artist] });
    },

    suggestSoon() {
      if (suggestTimer) clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => {
        suggestTimer = null;
        get().suggest();
      }, SUGGEST_REFRESH_MS);
    },

    clear() {
      stopTimers();
      generation++;
      appStorage.remove(QUIZ_STORAGE_KEY);
    },

    reset() {
      stopTimers();
      generation++;
      set({ ...INITIAL });
    },
  };
});
