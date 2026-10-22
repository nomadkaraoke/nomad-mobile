// The quiz draft (spec §8.2): resumed from decide's saved progress (or this phone's copy), autosaved as it changes,
// plus the smart artist suggestions shown on step 3.
import {
  getQuizProgress,
  saveQuizProgress,
  smartQuizArtists,
  type QuizArtistResponse,
  type QuizProgressRequest,
} from '@nomad/api-decide';
import { EMPTY_QUIZ, fromProgress, mergeProgress, toProgressRequest, type QuizDraft } from '@nomad/core';
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
  /** The signed-in email the draft belongs to; null until `load` finishes. */
  owner: string | null;
  /** Suggestions in the order shown. Append-only: an artist once shown is never removed. */
  suggestions: QuizArtistResponse[];
  suggesting: boolean;
  load(owner: string): Promise<void>;
  update(change: (d: QuizDraft) => QuizDraft): void;
  /** Sends a pending autosave now (the quiz is closing). */
  flush(): void;
  /** Asks decide for (more) smart suggestions; a call while one is in flight runs once it lands. */
  suggest(): void;
  /** A new pick: refresh the suggestions shortly. */
  suggestSoon(): void;
  /** Forgets the draft here and on this phone (after submit). */
  clear(): void;
  reset(): void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let suggestTimer: ReturnType<typeof setTimeout> | null = null;
let suggestAgain = false;
/** Bumped by reset/load, so answers to an older draft's calls are dropped. */
let generation = 0;

const norm = (s: string) => s.trim().toLowerCase();

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

const INITIAL = {
  draft: EMPTY_QUIZ,
  saved: null,
  owner: null,
  suggestions: [],
  suggesting: false,
} satisfies Partial<QuizStore>;

export const useQuizDraft = create<QuizStore>((set, get) => {
  /** The body for decide (and this phone's copy): the draft over the last saved doc. */
  const body = () => mergeProgress(get().saved, toProgressRequest(get().draft));

  const send = () => {
    saveTimer = null;
    const progress = body();
    set({ saved: progress });
    // Best effort: a failed save leaves this phone's copy, and a decide 401 only marks Discover stale.
    saveQuizProgress(progress as QuizProgressRequest).catch(() => {});
  };

  return {
    ...INITIAL,

    async load(owner) {
      stopTimers();
      const gen = ++generation;
      set({ ...INITIAL });
      let remote: unknown = null;
      try {
        remote = await getQuizProgress();
      } catch {
        // Offline or decide unavailable: this phone's copy, if any.
      }
      if (gen !== generation) return;
      const local = readLocal(owner);
      const fromRemote = remote ? fromProgress(remote) : null;
      const fromLocal = !fromRemote && local ? fromProgress(local) : null;
      set({
        owner,
        draft: fromRemote ?? fromLocal ?? EMPTY_QUIZ,
        saved: fromRemote ? remote : fromLocal ? local : null,
      });
    },

    update(change) {
      const { owner } = get();
      if (!owner) return;
      set({ draft: change(get().draft) });
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
      set({ suggesting: true });
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
      set({ ...INITIAL });
    },

    reset() {
      stopTimers();
      generation++;
      set({ ...INITIAL });
    },
  };
});
