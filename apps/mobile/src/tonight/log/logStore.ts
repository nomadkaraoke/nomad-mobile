import type { KaraokeLogPatch, LogNight, Survey } from '@nomad/api-decide';
import { create } from 'zustand';

import { useAuth } from '../../auth/store';
import { appStorage } from '../../storage';
import { newUuid, useNightStore, userKeyFor } from '../nightStore';
import { useOutbox } from './outbox';

/**
 * Tonight's karaoke log on the phone (spec §6.1): decide's karaoke-log records mirrored locally, written first here
 * and synced through the outbox. Per user (MMKV `tonight.log.v1.<userKey>`, swapped on account change, ruling
 * E8-R1). Ids: `app_<uuid>` for songs logged at other bars; kjbox's `history_id` (`kj_…`) for Nomad songs, whose
 * facts kjbox owns (the app only writes their survey or a delete, ruling E8-R4).
 */
export type LogState = 'planned' | 'requested' | 'sung' | 'skipped';
export type LogSurvey = Omit<Survey, 'answered_at'>;
export type LogEntry = {
  id: string;
  source: 'app' | 'kjbox';
  state: LogState;
  artist: string;
  title: string;
  song_key?: string;
  night?: LogNight;
  sung_at?: string;
  survey?: Survey;
  /** Backfill: how many times (1-50) it was sung before. */
  times?: number;
  origin?: 'live' | 'backfill';
  /** Local ms epoch of the last change. */
  updatedAt: number;
};
export type BackfillOptions = {
  /** 1-50. */
  times: number;
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, matching `precision` (omitted for `unknown`). */
  date?: string;
  precision: NonNullable<LogNight['date_precision']>;
};
export type LogSong = { song_key?: string; artist: string; title: string };

/**
 * The artist stored for a song logged without one (decide needs an artist). Fixed and untranslated, so every
 * locale's unknowns are one artist; the UI shows it as the translated "Unknown artist" (`artistLabel`).
 */
export const UNKNOWN_ARTIST = 'Unknown Artist';

/** The artist to show: the sentinel becomes the caller's translated "Unknown artist". */
export const artistLabel = (artist: string, unknownLabel: string): string => (artist === UNKNOWN_ARTIST ? unknownLabel : artist);

const logKey = (userKey: string) => `tonight.log.v1.${userKey}`;
const surveyedKey = (userKey: string) => `tonight.surveyed.v1.${userKey}`;

export const isKjId = (id: string) => id.startsWith('kj_');

let clock: () => number = () => Date.now();
/** Test hook: replaces the clock (pass nothing to restore Date.now). */
export const setLogClock = (fn?: () => number): void => {
  clock = fn ?? (() => Date.now());
};
const iso = () => new Date(clock()).toISOString();
/** Local calendar date (YYYY-MM-DD) of a ms epoch: the night's date. */
const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function loadJson<T>(key: string | null, ok: (v: unknown) => v is T, fallback: T): T {
  if (!key) return fallback;
  try {
    const raw = appStorage.getString(key);
    const v: unknown = raw ? JSON.parse(raw) : fallback;
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
const isRecord = (v: unknown): v is Record<string, never> => !!v && typeof v === 'object' && !Array.isArray(v);

function loadEntries(userKey: string | null): Record<string, LogEntry> {
  const raw = loadJson<Record<string, unknown>>(userKey ? logKey(userKey) : null, isRecord, {});
  const out: Record<string, LogEntry> = {};
  for (const [id, e] of Object.entries(raw)) {
    if (isRecord(e) && typeof (e as { artist?: unknown }).artist === 'string' && typeof (e as { title?: unknown }).title === 'string') {
      out[id] = e as unknown as LogEntry;
    }
  }
  return out;
}
/** Surveyed/skipped marks are kept this long (a night's songs never come back after that). */
export const SURVEYED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** id → when it was surveyed or skipped (ms epoch); marks older than 30 days are pruned. */
function pruneSurveyed(marks: Record<string, unknown>): Record<string, number> {
  const now = clock();
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(marks)) {
    const when = typeof at === 'number' ? at : now; // a legacy `true` mark starts its 30 days now
    if (now - when <= SURVEYED_TTL_MS) out[id] = when;
  }
  return out;
}
const loadSurveyed = (userKey: string | null): Record<string, number> =>
  pruneSurveyed(loadJson<Record<string, unknown>>(userKey ? surveyedKey(userKey) : null, isRecord, {}));

type LogStore = {
  userKey: string | null;
  entries: Record<string, LogEntry>;
  /** Ids whose post-song survey was saved or skipped (ruling E8-R3: it opens once per song). */
  surveyed: Record<string, number>;
  /** Logs a song at another bar (`app_<uuid>`) under the active Other night; returns the id (null when signed out). */
  addOther(song: LogSong, state: LogState): string | null;
  /** Logs a song sung before the app, with a rough date (`origin: 'backfill'`); returns the id (null when signed out). */
  addBackfill(song: LogSong, opts: BackfillOptions): string | null;
  /** Mirrors a Nomad song kjbox reported sung (local only: kjbox delivers the facts to decide). */
  noteNomad(id: string, song: { artist: string; title: string; nightId?: string }): void;
  /** Moves an app entry along planned → requested → sung (or skipped). kjbox owns Nomad entries' state: ignored. */
  setState(id: string, state: LogState): void;
  /** Saves the survey (answered now) and sends only `{survey}` to decide. */
  saveSurvey(id: string, survey: LogSurvey): void;
  /** Dismissed survey: never asked again for this song. */
  skipSurvey(id: string): void;
  /** Removes a mistaken log (soft delete in decide). */
  remove(id: string): void;
  rehydrate(email: string | null): void;
};

const emailOf = (): string | null => {
  const s = useAuth.getState().state;
  return s.status === 'signedIn' ? s.session.email : null;
};

export const useLogStore = create<LogStore>((set, get) => {
  const saveEntries = (entries: Record<string, LogEntry>) => {
    const { userKey } = get();
    if (!userKey) return;
    appStorage.set(logKey(userKey), JSON.stringify(entries));
    set({ entries });
  };
  const markSurveyed = (id: string) => {
    const { userKey } = get();
    if (!userKey || get().surveyed[id]) return;
    const surveyed = pruneSurveyed({ ...get().surveyed, [id]: clock() });
    appStorage.set(surveyedKey(userKey), JSON.stringify(surveyed));
    set({ surveyed });
  };
  const put = (id: string, patch: KaraokeLogPatch) => useOutbox.getState().enqueue(id, 'put', patch);

  const initialKey = emailOf() ? userKeyFor(emailOf()!) : null;
  return {
    userKey: initialKey,
    entries: loadEntries(initialKey),
    surveyed: loadSurveyed(initialKey),

    addOther(song, state) {
      if (!get().userKey) return null;
      const id = `app_${newUuid()}`;
      const active = useNightStore.getState().current();
      const night: LogNight | undefined =
        active?.kind === 'other'
          ? { id: active.nightId, kind: 'other', venue_name: active.venueName ?? null, date: localDate(active.startedAt) }
          : undefined;
      const entry: LogEntry = {
        id,
        source: 'app',
        state,
        artist: song.artist,
        title: song.title,
        ...(song.song_key ? { song_key: song.song_key } : {}),
        ...(night ? { night } : {}),
        ...(state === 'sung' ? { sung_at: iso() } : {}),
        updatedAt: clock(),
      };
      saveEntries({ ...get().entries, [id]: entry });
      if (active?.kind === 'other') useNightStore.getState().touch();
      const { updatedAt: _u, id: _i, source: _s, ...facts } = entry;
      put(id, facts);
      return id;
    },

    addBackfill(song, opts) {
      if (!get().userKey) return null;
      const id = `app_${newUuid()}`;
      const times = Math.min(50, Math.max(1, Math.round(opts.times)));
      const night: LogNight = {
        kind: 'other',
        ...(opts.precision !== 'unknown' && opts.date ? { date: opts.date } : {}),
        date_precision: opts.precision,
      };
      const entry: LogEntry = {
        id,
        source: 'app',
        state: 'sung',
        artist: song.artist,
        title: song.title,
        ...(song.song_key ? { song_key: song.song_key } : {}),
        night,
        times,
        origin: 'backfill',
        updatedAt: clock(),
      };
      saveEntries({ ...get().entries, [id]: entry });
      const { updatedAt: _u, id: _i, source: _s, ...facts } = entry;
      put(id, facts);
      return id;
    },

    noteNomad(id, song) {
      if (!get().userKey || get().entries[id]) return;
      saveEntries({
        ...get().entries,
        [id]: {
          id,
          source: 'kjbox',
          state: 'sung',
          artist: song.artist,
          title: song.title,
          ...(song.nightId ? { night: { id: song.nightId, kind: 'nomad' } } : {}),
          updatedAt: clock(),
        },
      });
    },

    setState(id, state) {
      const e = get().entries[id];
      if (!e || isKjId(id) || e.state === state) return;
      const sungAt = state === 'sung' ? (e.sung_at ?? iso()) : undefined;
      saveEntries({ ...get().entries, [id]: { ...e, state, ...(sungAt ? { sung_at: sungAt } : {}), updatedAt: clock() } });
      put(id, { state, ...(sungAt ? { sung_at: sungAt } : {}) });
    },

    saveSurvey(id, answers) {
      if (!get().userKey) return;
      const survey: Survey = {};
      for (const [k, v] of Object.entries(answers)) {
        if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) (survey as Record<string, unknown>)[k] = v;
      }
      survey.answered_at = iso();
      const e = get().entries[id];
      if (e) saveEntries({ ...get().entries, [id]: { ...e, survey: { ...e.survey, ...survey }, updatedAt: clock() } });
      markSurveyed(id);
      // Survey only, never facts (E8-R4): for kj_ ids kjbox owns everything else.
      put(id, { survey });
    },

    skipSurvey(id) {
      markSurveyed(id);
    },

    remove(id) {
      if (!get().userKey) return;
      const { [id]: _gone, ...rest } = get().entries;
      saveEntries(rest);
      useOutbox.getState().enqueue(id, 'delete');
    },

    rehydrate(email) {
      const userKey = email ? userKeyFor(email) : null;
      set({ userKey, entries: loadEntries(userKey), surveyed: loadSurveyed(userKey) });
    },
  };
});

// Account switch (ruling E8-R1, Review Focus 1): the new user's log, never the previous one's.
useAuth.subscribe((s) => {
  const email = s.state.status === 'signedIn' ? s.state.session.email : null;
  const want = email ? userKeyFor(email) : null;
  if (want !== useLogStore.getState().userKey) useLogStore.getState().rehydrate(email);
});
