// Discover search orchestration (spec §4.1, §7.1, §7.3): the on-device offline matcher and decide's search
// service run together for each debounced query; only the latest query may set state.
import {
  popularSongs,
  resolveQuery,
  searchSongs,
  type Identification,
  type ResolveResponse,
  type SongGroup,
  type SongRef,
} from '@nomad/api-decide';
import {
  identify,
  identifyKind,
  OFFLINE_MARGIN_BONUS,
  offlineGroups,
  popularOffline,
  searchAvailabilityOffline,
  type IdentifyResult,
  type OfflineGroup,
  type SongRef as CoreSongRef,
  type SqlReader,
} from '@nomad/core';
import { useNetInfo } from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';

import { openOfflineReader } from '../offline/offlineIndex';
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
  error: 'unreachable' | null;
  /** The (debounced, trimmed) query this state answers; under 2 characters → the popular list. */
  query: string;
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

const toGroup = (g: OfflineGroup): SongGroup => ({
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

/** decide SearchService.search over offline.db: the identified song's group(s) first, then the typed-word matches. Throws on SQLite errors. */
function searchOffline(db: SqlReader, q: string): Results {
  const ident = identify(db, q, { marginBonus: OFFLINE_MARGIN_BONUS });
  const merged = new Map<string, OfflineGroup>();
  const add = (gs: OfflineGroup[]) => gs.forEach((g) => merged.has(g.songKey) || merged.set(g.songKey, g));
  add(offlineGroups(db, ident));
  if (ident.status === 'confident' && ident.best) {
    add(searchAvailabilityOffline(db, `${ident.best.artist} ${ident.best.title}`, SEARCH_LIMIT));
  }
  add(searchAvailabilityOffline(db, q, SEARCH_LIMIT));
  return { identification: toIdentification(q, ident), groups: [...merged.values()].slice(0, SEARCH_LIMIT).map(toGroup) };
}

/** The offline answer for `q`, or null with no usable list. Never throws (a broken list → cloud only). */
function offlineResults(q: string): Results | null {
  try {
    const db = openOfflineReader();
    if (!db) return null;
    if (q.length < MIN_QUERY_CHARS) return { identification: null, groups: popularOffline(db, POPULAR_LIMIT).map(toGroup) };
    return searchOffline(db, q);
  } catch {
    return null;
  }
}

let popularCache: { at: number; groups: SongGroup[] } | null = null;

/** Test hook: forget the cached popular list. */
export function resetSearchCacheForTests(): void {
  popularCache = null;
}

async function cloudResults(q: string, signal: AbortSignal): Promise<Results> {
  if (q.length < MIN_QUERY_CHARS) {
    const groups = await popularSongs(POPULAR_LIMIT);
    popularCache = { at: Date.now(), groups };
    return { identification: null, groups };
  }
  const r = await searchSongs(q, { limit: SEARCH_LIMIT, sid: currentSid(), signal });
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
};

/**
 * Discover's search. For each debounced query (a new one bumps the generation; results for an older one are
 * dropped): the offline list answers first when downloaded, the cloud answer replaces it, a cold service
 * shows `warmingUp` after 1.5 s and `error: 'unreachable'` after 30 s (offline results kept), and a cloud
 * `none` with no groups asks the Gemini resolve once. Under 2 characters: the popular list.
 */
export function useSearch(rawQuery: string): SearchState {
  const q = useDebounced(rawQuery.trim());
  const net = useNetInfo();
  const offline = net.isConnected === false;
  const [data, setData] = useState<Data>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

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

    const cached = q.length < MIN_QUERY_CHARS && popularCache && Date.now() - popularCache.at < POPULAR_FRESH_MS;
    if (cached) {
      cloudDone = true;
      set({ query: q, offline, source: 'cloud', identification: null, groups: popularCache!.groups, resolve: null, loading: false, warmingUp: false, error: null });
      return () => {
        cancelled = true;
      };
    }
    set({ query: q, offline, loading: true, warmingUp: false, error: null, resolve: null });

    const settleWithoutCloud = (error: SearchState['error']) => {
      cloudDone = true;
      if (local) set({ loading: false, warmingUp: false, error });
      else set({ source: 'none', identification: null, groups: [], loading: false, warmingUp: false, error });
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
        cloudResults(q, controller.signal).then(
          (r) => {
            if (!live() || cloudDone) return;
            cloudDone = true;
            const needsResolve =
              q.length >= MIN_QUERY_CHARS && r.identification?.status === 'none' && r.groups.length === 0;
            set({ source: 'cloud', ...r, warmingUp: false, error: null, loading: needsResolve });
            if (!needsResolve) return;
            resolveQuery(q, currentSid()).then(
              (resolve) => set({ resolve, loading: false }),
              () => set({ loading: false }),
            );
          },
          () => {
            if (!live() || cloudDone) return;
            if (Date.now() - started + RETRY_AFTER_MS >= UNREACHABLE_AFTER_MS) settleWithoutCloud('unreachable');
            else later(RETRY_AFTER_MS, () => live() && !cloudDone && run());
          },
        );
      };
      run();
    }

    later(0, () => {
      if (!live() || cloudDone) return;
      local = offlineResults(q);
      if (!live() || cloudDone) return; // The cloud answered while the matcher ran.
      if (local) set({ source: 'offline', ...local, resolve: null, loading: !offline });
      else if (offline) settleWithoutCloud(null);
    });

    return () => {
      cancelled = true;
      controller.abort();
      timers.forEach(clearTimeout);
    };
  }, [q, offline, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...data, retry };
}
