// Discover search orchestration (spec §4.1, §7.1, §7.3): the on-device offline matcher and decide's search
// service run together for each debounced query; only the latest query may set state.
import {
  popularSongs,
  resolveQuery,
  searchSongs,
  type ApiError,
  type Identification,
  type ResolveResponse,
  type SongGroup,
  type SongRef,
} from '@nomad/api-decide';
import {
  identify,
  identifyKind,
  matchesLibrary,
  OFFLINE_MARGIN_BONUS,
  offlineGroups,
  popularOffline,
  searchAvailabilityOffline,
  type IdentifyResult,
  type LibraryFilter,
  type OfflineGroup,
  type SongRef as CoreSongRef,
  type SqlReader,
} from '@nomad/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useOffline } from '../net/useOffline';
import { openOfflineReader } from '../offline/offlineIndex';
import { useOfflineIndexStore } from '../offline/offlineIndexStore';
import { useLibraryFilter } from './library';
import { currentSid } from './searchSession';

/** Shorter queries show the popular list (decide search's MIN_QUERY_CHARS). */
export const MIN_QUERY_CHARS = 2;
export const DEBOUNCE_MS = 300;
/** No cloud answer by then while online → "Warming up…" (the service may be cold-starting). */
export const WARMING_UP_AFTER_MS = 1500;
/** No cloud answer by then → "can't reach search" (offline results stay). */
export const UNREACHABLE_AFTER_MS = 30_000;
/** A failed cloud call (503 while the index loads, a dropped connection) is retried this often until UNREACHABLE_AFTER_MS. */
export const RETRY_AFTER_MS = 2000;
/**
 * While online, offline results wait this long before showing: when the cloud answers within it, the cloud
 * answer is shown directly and the outcome layout doesn't flip from the offline answer to the cloud one.
 */
export const OFFLINE_HOLD_MS = 150;
/** The Gemini resolve only runs for a query left alone this long (since the last keystroke), never for prefixes. */
export const RESOLVE_STABLE_MS = 800;
export const SEARCH_LIMIT = 20;
export const POPULAR_LIMIT = 30;
const POPULAR_FRESH_MS = 60 * 60 * 1000;

export type SearchState = {
  /** Where `identification`/`groups` came from; `none` = no results to show (yet). */
  source: 'cloud' | 'offline' | 'none';
  /** Still working on the current query (cloud search or its resolve fallback in flight). */
  loading: boolean;
  /** Online, but the cloud hasn't answered within 1.5 s (cold start). */
  warmingUp: boolean;
  /** The device has no connection: only the offline list can answer. */
  offline: boolean;
  /** `null` for the popular list. */
  identification: Identification | null;
  groups: SongGroup[];
  /** The Gemini fallback's answer when the cloud found nothing at all. */
  resolve: ResolveResponse | null;
  /** `unreachable`: no answer (offline results may stay). `rejected`: decide refused this query (a 4xx). */
  error: 'unreachable' | 'rejected' | null;
  /** The (debounced, trimmed) query being searched; under 2 characters → the popular list. */
  query: string;
  /**
   * The query `identification`/`groups`/`resolve` answer. Until the new query's first answer lands it is the
   * previous query's (the old results stay up to avoid flicker): the UI must not show an identification card
   * or a correction unless `resultsQuery === query`.
   */
  resultsQuery: string | null;
  /** Runs the current query again (after `error`). */
  retry: () => void;
};

type Results = { identification: Identification | null; groups: SongGroup[] };

// ---------------------------------------------------------------------------------------------------------
// @nomad/core (camelCase) → decide's generated (snake_case) shapes, so the UI handles one shape.

const toRef = (s: CoreSongRef): SongRef => ({
  artist: s.artist,
  title: s.title,
  song_key: s.songKey,
  popularity: s.popularity,
  karaoke: s.karaoke,
});

export const toGroup = (g: OfflineGroup): SongGroup => ({
  song_key: g.songKey,
  artist: g.artist,
  title: g.title,
  version_count: g.versionCount,
  versions: g.versions.map((v) => ({
    brand_code: v.brandCode,
    brand_name: v.brandName,
    kind: v.kind,
    youtube_url: v.youtubeUrl,
    rank: v.rank,
  })),
});

function toIdentification(q: string, r: IdentifyResult): Identification {
  if (r.status === 'none' || !r.best) return { status: 'none', kind: null, best: null, candidates: [] };
  return {
    status: r.status,
    kind: r.status === 'confident' ? identifyKind(q, r.best.artist, r.best.title) : null,
    best: toRef(r.best),
    candidates: r.candidates.map(toRef),
  };
}

/** The groups in the chosen venue library (`any` keeps all); a song without library codes or a KV version drops out of `karafun`. */
function* inLibrary(groups: Iterable<OfflineGroup>, library: LibraryFilter): Generator<OfflineGroup> {
  for (const g of groups) {
    const tagged = { libraries: g.libraries, versions: g.versions.map((v) => ({ kind: v.kind, brand_code: v.brandCode })) };
    if (matchesLibrary(tagged, library)) yield g;
  }
}

/**
 * decide SearchService.search over offline.db: the identified song's group(s) first, then the typed-word matches.
 * Throws on SQLite errors.
 *
 * Differs from decide: no short-query LIKE / trigram + fuzzy fallback when FTS finds nothing (typos rely on
 * identify); the typed-word search runs on `songNorm(q)`, not decide's `normalize(q)`; `candidates` yields one
 * group per karaoke candidate (identify order) ahead of the typed-word groups, where the cloud returns only
 * the typed-word groups for candidates.
 */
function searchOffline(db: SqlReader, q: string, library: LibraryFilter): Results {
  const ident = identify(db, q, { marginBonus: OFFLINE_MARGIN_BONUS });
  const merged = new Map<string, OfflineGroup>();
  const add = (gs: OfflineGroup[]) => gs.forEach((g) => merged.has(g.songKey) || merged.set(g.songKey, g));
  add(offlineGroups(db, ident));
  if (ident.status === 'confident' && ident.best) {
    add(searchAvailabilityOffline(db, `${ident.best.artist} ${ident.best.title}`, SEARCH_LIMIT));
  }
  add(searchAvailabilityOffline(db, q, SEARCH_LIMIT));
  const groups = [...inLibrary(merged.values(), library)].slice(0, SEARCH_LIMIT).map(toGroup);
  return { identification: toIdentification(q, ident), groups };
}

/** The offline answer for `q`, or null with no usable list. Never throws (a broken list → cloud only). */
function offlineResults(q: string, library: LibraryFilter): Results | null {
  try {
    const db = openOfflineReader();
    if (!db) return null;
    if (q.length < MIN_QUERY_CHARS) return { identification: null, groups: [...inLibrary(popularOffline(db, POPULAR_LIMIT), library)].map(toGroup) };
    return searchOffline(db, q, library);
  } catch {
    return null;
  }
}

/** The ApiError when `e` is a 4xx (duck-typed: the generated client's error, whatever module instance threw it). */
function clientError(e: unknown): Pick<ApiError, 'status' | 'retryAfter'> | null {
  if (typeof e !== 'object' || e === null || !('status' in e)) return null;
  const { status, retryAfter } = e as Partial<ApiError>;
  return typeof status === 'number' && status >= 400 && status < 500 ? { status, retryAfter: retryAfter ?? null } : null;
}

let popularCache: { at: number; library: LibraryFilter; groups: SongGroup[] } | null = null;

/** Test hook: forget the cached popular list. */
export function resetSearchCacheForTests(): void {
  popularCache = null;
}

async function cloudResults(q: string, library: LibraryFilter, signal: AbortSignal): Promise<Results> {
  if (q.length < MIN_QUERY_CHARS) {
    const groups = await popularSongs(POPULAR_LIMIT, library);
    popularCache = { at: Date.now(), library, groups };
    return { identification: null, groups };
  }
  const r = await searchSongs(q, { limit: SEARCH_LIMIT, sid: currentSid(), library, signal });
  return { identification: r.identification, groups: r.groups };
}

export function useDebounced<T>(value: T, ms = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

type Data = Omit<SearchState, 'retry'>;

const INITIAL: Data = {
  source: 'none',
  loading: true,
  warmingUp: false,
  offline: false,
  identification: null,
  groups: [],
  resolve: null,
  error: null,
  query: '',
  resultsQuery: null,
};

/**
 * Discover's search. For each debounced query (a new one bumps the generation; results for an older one are
 * dropped): the offline list answers first when downloaded, the cloud answer replaces it, a cold service
 * shows `warmingUp` after 1.5 s and `error: 'unreachable'` after 30 s (offline results kept), and a cloud
 * `none` with no groups asks the Gemini resolve once. Under 2 characters: the popular list.
 * `library` overrides the venue library filter (the quiz's song step searches every song: `'any'`).
 */
export function useSearch(rawQuery: string, opts: { library?: LibraryFilter } = {}): SearchState {
  const typed = rawQuery.trim();
  const q = useDebounced(typed);
  // The last keystroke (raw, before the debounce): the resolve waits until the box has been left alone.
  const keystroke = useRef({ value: typed, at: 0 });
  useEffect(() => {
    keystroke.current = { value: typed, at: Date.now() };
  }, [typed]);
  const offline = useOffline();
  const venueLibrary = useLibraryFilter((s) => s.filter);
  const library = opts.library ?? venueLibrary;
  const [data, setData] = useState<Data>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  // A download finishing (or the list being removed) changes the run: re-run the current query against it.
  const indexRun = useOfflineIndexStore((s) => s.run);
  // The query whose 429 Retry-After was already retried automatically: one automatic retry per query, then
  // `unreachable` stays until the user taps retry().
  const autoRetried = useRef<string | null>(null);

  useEffect(() => {
    const gen = ++generation.current;
    let cancelled = false;
    const live = () => !cancelled && generation.current === gen;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const controller = new AbortController();
    const set = (patch: Partial<Data>) => {
      if (live()) setData((s) => ({ ...s, ...patch }));
    };
    let cloudDone = false;
    let local: Results | null = null;

    const cached = q.length < MIN_QUERY_CHARS && popularCache?.library === library && Date.now() - popularCache.at < POPULAR_FRESH_MS;
    if (cached) {
      cloudDone = true;
      set({ query: q, resultsQuery: q, offline, source: 'cloud', identification: null, groups: popularCache!.groups, resolve: null, loading: false, warmingUp: false, error: null });
      return () => {
        cancelled = true;
      };
    }
    set({ query: q, offline, loading: true, warmingUp: false, error: null, resolve: null });

    const settleWithoutCloud = (error: SearchState['error']) => {
      cloudDone = true;
      if (local) set({ source: 'offline', ...local, resultsQuery: q, resolve: null, loading: false, warmingUp: false, error });
      else set({ source: 'none', resultsQuery: q, identification: null, groups: [], resolve: null, loading: false, warmingUp: false, error });
    };

    // Cloud first (it is the slow one), then the offline matcher after yielding so typing never waits on it.
    if (!offline) {
      const started = Date.now();
      later(WARMING_UP_AFTER_MS, () => !cloudDone && set({ warmingUp: true }));
      later(UNREACHABLE_AFTER_MS, () => {
        if (cloudDone) return;
        controller.abort();
        settleWithoutCloud('unreachable');
      });
      const run = (): void => {
        cloudResults(q, library, controller.signal).then(
          (r) => {
            if (!live() || cloudDone) return;
            cloudDone = true;
            const needsResolve =
              q.length >= MIN_QUERY_CHARS && r.identification?.status === 'none' && r.groups.length === 0;
            set({ source: 'cloud', ...r, resultsQuery: q, warmingUp: false, error: null, loading: needsResolve });
            if (!needsResolve) return;
            // Only for a query left alone RESOLVE_STABLE_MS since the last keystroke (Gemini is never asked about
            // a prefix). Typing on starts a new generation (after the debounce), which drops this one.
            const askWhenStable = () => {
              if (!live()) return;
              // The box changed: typing on starts a new generation after the debounce, but a change undone within
              // the debounce (A → Ax → A) doesn't, so look again later instead of giving up.
              if (keystroke.current.value !== q) {
                later(RESOLVE_STABLE_MS, askWhenStable);
                return;
              }
              const wait = RESOLVE_STABLE_MS - (Date.now() - keystroke.current.at);
              if (wait > 0) {
                later(wait, askWhenStable);
                return;
              }
              resolveQuery(q, currentSid()).then(
                (resolve) => set({ resolve, loading: false }),
                () => set({ loading: false }),
              );
            };
            askWhenStable();
          },
          (e: unknown) => {
            if (!live() || cloudDone) return;
            // A client error won't fix itself on a 2 s retry: settle now. A 429 is "can't reach search" with its
            // Retry-After honoured by one automatic retry (when it fits in the unreachable window); any other 4xx
            // (400/404/422…) is decide refusing this query. A 408 is retried like a 5xx.
            const client = clientError(e);
            if (client && client.status !== 408) {
              controller.abort();
              settleWithoutCloud(client.status === 429 ? 'unreachable' : 'rejected');
              const wait = client.status === 429 && client.retryAfter != null ? client.retryAfter * 1000 : null;
              if (wait !== null && wait <= UNREACHABLE_AFTER_MS && autoRetried.current !== q) {
                autoRetried.current = q;
                later(wait, () => live() && setAttempt((n) => n + 1));
              }
              return;
            }
            if (Date.now() - started + RETRY_AFTER_MS >= UNREACHABLE_AFTER_MS) settleWithoutCloud('unreachable');
            else later(RETRY_AFTER_MS, () => live() && !cloudDone && run());
          },
        );
      };
      run();
    }

    later(0, () => {
      if (!live() || cloudDone) return;
      local = offlineResults(q, library);
      if (!live() || cloudDone) return; // The cloud answered while the matcher ran.
      const found = local;
      if (!found) {
        if (offline) settleWithoutCloud(null);
        return;
      }
      const show = () => {
        if (live() && !cloudDone) set({ source: 'offline', ...found, resultsQuery: q, resolve: null, loading: !offline });
      };
      if (offline) show();
      else later(OFFLINE_HOLD_MS, show);
    });

    return () => {
      cancelled = true;
      controller.abort();
      timers.forEach(clearTimeout);
    };
  }, [q, offline, attempt, indexRun, library]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...data, retry };
}
