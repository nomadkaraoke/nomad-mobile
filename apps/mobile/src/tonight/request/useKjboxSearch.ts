// Tonight's karaoke search against the box (spec §4.1 Search, Auto-correct): one debounced query at a time, a
// generation guard so only the latest query's answer renders (A.17), identification alongside the karaoke search
// (which song is meant vs whether the box has a karaoke version), and the Gemini auto-correct only when the search
// found nothing and identification had nothing either (A.29).
import {
  identify,
  resolve,
  searchSongs,
  type ArtistTitle,
  type IdentifyResult,
  type SearchSong,
} from '@nomad/api-kjbox';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useNightStore } from '../nightStore';
import { newRequestId } from './requestStore';

/** The box refuses shorter queries (400 invalid). */
export const KJBOX_MIN_QUERY = 3;
/** The web waits 700 ms; the app may use 300 ms because the generation guard, not the delay, keeps answers in order. */
export const KJBOX_DEBOUNCE_MS = 300;

/** A confident auto-correct from GET /search/resolve: what we searched instead, and its karaoke rows. */
export type Correction = { corrected: ArtistTitle; typed: string; kind: 'cosmetic' | 'content'; songs: SearchSong[] };

export type KjboxSearchState = {
  /** The debounced, trimmed query being searched. */
  query: string;
  /** The query `songs`/`identification`/`correction` answer (null before the first answer). */
  resultsQuery: string | null;
  loading: boolean;
  /** "Checking the spelling…": the auto-correct is running. */
  resolving: boolean;
  /** The typed text's karaoke results, grouped by song, in the server's ranking. */
  songs: SearchSong[];
  identification: IdentifyResult | null;
  correction: Correction | null;
  /**
   * Karaoke rows for the confidently identified song when the typed text's rows don't include it (the web's
   * fetchKaraokeForCorrection): "starlite muse" → Muse "Starlight". Empty until (and unless) that search finds rows.
   */
  identifiedSongs: SearchSong[];
  /** That search is still running: hold the empty state and the no-karaoke card until it settles. */
  fetchingIdentified: boolean;
  /** The singer tapped Undo on the correction: show what they typed. */
  undone: boolean;
  /** "Did you mean…?" chips (ambiguous). */
  alternatives: ArtistTitle[];
  /** The rows to show: the correction's while it stands, else the typed results. */
  shown: SearchSong[];
  makeEnabled: boolean;
  simpleMode: boolean;
  /** The search failed (a KjboxError, or anything fetch threw). */
  error: unknown;
  /** The search-session id sent with every call (groups the box's search log). */
  sid: string;
  undo(): void;
  redo(): void;
  retry(): void;
};

type Data = Omit<KjboxSearchState, 'shown' | 'sid' | 'undo' | 'redo' | 'retry'>;

const idle = (query: string): Data => ({
  query,
  resultsQuery: null,
  loading: false,
  resolving: false,
  songs: [],
  identification: null,
  correction: null,
  identifiedSongs: [],
  fetchingIdentified: false,
  undone: false,
  alternatives: [],
  makeEnabled: true,
  simpleMode: false,
  error: null,
});

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useKjboxSearch(q: string): KjboxSearchState {
  const night = useNightStore((s) => s.active);
  const code = night?.kind === 'nomad' ? night.code : null;
  const nightId = night?.kind === 'nomad' ? night.nightId : undefined;
  const sid = useRef(newRequestId()).current;
  const query = useDebounced(q.trim(), KJBOX_DEBOUNCE_MS);
  const gen = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<Data>(() => idle(''));

  useEffect(() => {
    const myGen = ++gen.current;
    const live = () => myGen === gen.current;
    if (!code || query.length < KJBOX_MIN_QUERY) {
      setData({ ...idle(query) });
      return;
    }
    // Old rows stay up while the new query loads (no flicker); the UI keys off resultsQuery.
    setData((d) => ({ ...d, query, loading: true, resolving: false, error: null }));
    const identP = identify(code, query, sid, nightId).catch(() => null); // no index / limited: search still works
    void (async () => {
      try {
        const r = await searchSongs(code, query, sid, nightId);
        if (!live()) return; // superseded: a slower earlier answer never renders (A.17)
        const ident = await identP;
        if (!live()) return;
        const songs = r.songs ?? [];
        const needsResolve = songs.length === 0 && (!ident || ident.status === 'none');
        const meant = ident?.status === 'confident' && ident.song ? ident.song : null;
        const fetchIdentified = meant !== null && !songs.some((g) => sameSong(g, meant));
        setData({
          ...idle(query),
          resultsQuery: query,
          songs,
          identification: ident,
          alternatives: ident?.status === 'candidates' ? (ident.candidates ?? []).slice(0, 4) : [],
          makeEnabled: r.make_requests_enabled,
          simpleMode: r.simple_mode,
          resolving: needsResolve,
          fetchingIdentified: fetchIdentified,
        });
        if (meant && fetchIdentified) {
          try {
            const m = await searchSongs(code, `${meant.artist} ${meant.title}`, sid, nightId);
            if (!live()) return;
            setData((d) => ({ ...d, identifiedSongs: m.songs ?? [], fetchingIdentified: false }));
          } catch {
            // keep the typed-text rows
            if (live()) setData((d) => ({ ...d, fetchingIdentified: false }));
          }
        }
        if (!needsResolve) return;
        try {
          const res = await resolve(code, query, sid, nightId);
          if (!live()) return;
          setData((d) => ({
            ...d,
            resolving: false,
            correction: res.corrected
              ? { corrected: res.corrected, typed: res.typed ?? query, kind: res.kind ?? 'content', songs: res.songs ?? [] }
              : null,
            alternatives: !res.corrected && res.alternatives?.length ? res.alternatives.slice(0, 4) : d.alternatives,
          }));
        } catch {
          // offline / rate-limited: the empty state stays
          if (live()) setData((d) => ({ ...d, resolving: false }));
        }
      } catch (e) {
        if (!live()) return; // a stale failure never clobbers a live search
        setData((d) => ({ ...d, loading: false, resolving: false, error: e, resultsQuery: query }));
      }
    })();
  }, [code, nightId, query, sid, attempt]);

  const undo = useCallback(() => setData((d) => ({ ...d, undone: true })), []);
  const redo = useCallback(() => setData((d) => ({ ...d, undone: false })), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const shown =
    data.correction && !data.undone
      ? data.correction.songs
      : data.identifiedSongs.length > 0
        ? data.identifiedSongs
        : data.songs;
  return { ...data, shown, sid, undo, redo, retry };
}

// "Is this the same song?" as the web checks it (sing.js sameSong): the same title ignoring "(feat …)" and
// " - Remastered", and an artist credit in common.
const songKey = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*$|\s+-\s+.*$/, '')
    .replace(/[^a-z0-9]+/g, '');
const credits = (artist: string) =>
  new Set(
    artist
      .toLowerCase()
      .split(/\s*(?:,|&|\+|\/|\bfeaturing\b|\bfeat\.?|\bft\.?|\band\b|\bwith\b)\s*/)
      .map(songKey)
      .filter(Boolean),
  );
export function sameSong(a: ArtistTitle, b: ArtistTitle): boolean {
  if (songKey(a.title) !== songKey(b.title)) return false;
  const ca = credits(a.artist);
  for (const c of credits(b.artist)) if (ca.has(c)) return true;
  return false;
}

/** The identified song when identification is confident (otherwise null). */
export const confidentSong = (s: Pick<KjboxSearchState, 'identification'>): ArtistTitle & { karaoke: boolean } | null =>
  s.identification?.status === 'confident' && s.identification.song ? s.identification.song : null;

/**
 * "No karaoke version yet" (A.31): a confident identification, no row is that song, and the song index doesn't say
 * a karaoke version exists (the `karaoke:true` veto: a false "no version" is worse than a missed offer).
 */
type Settle = Pick<KjboxSearchState, 'identification' | 'shown' | 'loading' | 'resolving' | 'fetchingIdentified' | 'error'>;

export function songMissing(s: Settle): boolean {
  const song = confidentSong(s);
  if (!song || s.loading || s.resolving || s.fetchingIdentified || s.error) return false;
  return song.karaoke !== true && !s.shown.some((g) => sameSong(g, song));
}

/**
 * The sticky "Not seeing your song? Make it" bar (A.32): results are showing, and identification isn't confident
 * (with a confident one, the song is either in the rows or the no-karaoke card already offers make-it).
 */
export function showMakeBar(s: Settle): boolean {
  if (s.loading || s.fetchingIdentified || s.error || s.shown.length === 0) return false;
  const song = confidentSong(s);
  if (!song) return true;
  const settled = songMissing(s) || s.shown.some((g) => sameSong(g, song)) || song.karaoke !== true;
  return !settled;
}
