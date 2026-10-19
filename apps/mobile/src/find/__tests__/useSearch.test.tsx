import * as decide from '@nomad/api-decide';
import type { SearchResponse, SongGroup } from '@nomad/api-decide';
import type { SqlReader } from '@nomad/core';
import { useNetInfo } from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';
import Database from 'better-sqlite3';
import path from 'node:path';

import { openOfflineReader } from '../../offline/offlineIndex';
import { currentSid } from '../searchSession';
import { resetSearchCacheForTests, useSearch } from '../useSearch';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(),
  resolveQuery: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
}));
jest.mock('../../offline/offlineIndex', () => ({ openOfflineReader: jest.fn(() => null) }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: jest.fn() }));

const searchSongs = decide.searchSongs as jest.Mock;
const popularSongs = decide.popularSongs as jest.Mock;
const resolveQuery = decide.resolveQuery as jest.Mock;
const readerMock = openOfflineReader as jest.Mock;
const netMock = useNetInfo as jest.Mock;

// The fixture offline.db decide emits for the matcher's parity tests (Muse "Starlight" is a karaoke song in it).
const FIXTURE = path.join(__dirname, '../../../../../packages/core/src/search/__fixtures__/offline_fixture.db');
let raw: Database.Database;
let fixture: SqlReader;
beforeAll(() => {
  raw = new Database(FIXTURE, { readonly: true });
  fixture = { all: <T,>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[] };
});
afterAll(() => raw.close());

const group = (title: string, artist = 'Cloud'): SongGroup => ({
  song_key: `${artist.toLowerCase()}|${title.toLowerCase()}`,
  artist,
  title,
  version_count: 1,
  versions: [{ brand_code: 'KV', brand_name: 'Karaoke Version', kind: 'commercial', youtube_url: null, rank: 1 }],
});

const response = (groups: SongGroup[], status: 'confident' | 'none' = 'none'): SearchResponse => ({
  identification:
    status === 'none'
      ? { status, kind: null, best: null, candidates: [] }
      : {
          status,
          kind: 'same',
          best: { ...groups[0]!, song_key: groups[0]!.song_key, popularity: 50, karaoke: true },
          candidates: [],
        },
  groups,
  index: { run: 'r1', built_at: 1 },
  sid: 's',
});

type Deferred<T> = { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Advances fake time and lets the promises that settle along the way run. */
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const settle = (fn: () => void) => act(async () => fn());

beforeEach(() => {
  jest.useFakeTimers();
  resetSearchCacheForTests();
  netMock.mockReset().mockReturnValue({ isConnected: true });
  readerMock.mockReset().mockReturnValue(null);
  popularSongs.mockReset().mockResolvedValue([group('Popular')]);
  searchSongs.mockReset().mockImplementation(async (q: string) => response([group(q)]));
  resolveQuery.mockReset().mockResolvedValue({ kind: 'content', corrected: null, groups: [], alternatives: [] });
});
afterEach(() => jest.useRealTimers());

describe('the popular list', () => {
  it.each(['', '   ', 'a'])('a query under 2 characters (%j) shows the popular list and never searches', async (q) => {
    const { result } = renderHook(() => useSearch(q));
    await advance(300);
    expect(popularSongs).toHaveBeenCalledWith(30);
    expect(searchSongs).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ source: 'cloud', loading: false, identification: null, error: null });
    expect(result.current.groups.map((g) => g.title)).toEqual(['Popular']);
  });

  it('is fetched once an hour: clearing the search box shows the cached list at once', async () => {
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), { initialProps: { q: '' } });
    await advance(0);
    rerender({ q: 'hello' });
    await advance(300);
    rerender({ q: '' });
    await advance(300);
    expect(popularSongs).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ source: 'cloud', loading: false, query: '' });
    expect(result.current.groups.map((g) => g.title)).toEqual(['Popular']);
  });

  it('comes from the offline list when there is no connection', async () => {
    netMock.mockReturnValue({ isConnected: false });
    readerMock.mockReturnValue(fixture);
    const { result } = renderHook(() => useSearch(''));
    await advance(300);
    expect(popularSongs).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ source: 'offline', offline: true, loading: false });
    expect(result.current.groups[0]).toMatchObject({ song_key: 'billie eilish|birds of a feather', version_count: 2 });
  });
});

describe('typing (generation counter)', () => {
  it('ignores the late answer for "sta" once "starlite muse" was typed', async () => {
    const sta = deferred<SearchResponse>();
    const full = deferred<SearchResponse>();
    searchSongs.mockImplementation((q: string) => (q === 'sta' ? sta.promise : full.promise));
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), { initialProps: { q: 'sta' } });
    await advance(300);
    expect(searchSongs).toHaveBeenLastCalledWith('sta', expect.objectContaining({ limit: 20 }));

    rerender({ q: 'starlite muse' });
    await advance(300);
    expect(searchSongs).toHaveBeenLastCalledWith('starlite muse', expect.anything());

    // The older answer arrives first, while the newer query is still in flight: never shown.
    await settle(() => sta.resolve(response([group('Stale')])));
    expect(result.current.groups.map((g) => g.title)).not.toContain('Stale');
    expect(result.current).toMatchObject({ query: 'starlite muse', loading: true });

    await settle(() => full.resolve(response([group('Starlight', 'Muse')], 'confident')));
    expect(result.current).toMatchObject({ source: 'cloud', loading: false, query: 'starlite muse' });
    expect(result.current.groups.map((g) => g.title)).toEqual(['Starlight']);
  });

  it('a late answer for an older query never overwrites the newer result', async () => {
    const sta = deferred<SearchResponse>();
    searchSongs.mockImplementation((q: string) => (q === 'sta' ? sta.promise : Promise.resolve(response([group(q)]))));
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), { initialProps: { q: 'sta' } });
    await advance(300);
    rerender({ q: 'starlite muse' });
    await advance(300);
    expect(result.current.groups.map((g) => g.title)).toEqual(['starlite muse']);
    await settle(() => sta.resolve(response([group('Stale')])));
    expect(result.current.groups.map((g) => g.title)).toEqual(['starlite muse']);
  });

  it('waits for the 300 ms debounce: fast typing sends one search', async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useSearch(q), { initialProps: { q: '' } });
    await advance(0);
    rerender({ q: 'st' });
    await advance(100);
    rerender({ q: 'sta' });
    await advance(100);
    rerender({ q: 'star' });
    await advance(300);
    expect(searchSongs).toHaveBeenCalledTimes(1);
    expect(searchSongs).toHaveBeenCalledWith('star', { limit: 20, sid: currentSid(), signal: expect.any(AbortSignal) });
  });
});

describe('offline list and cloud together', () => {
  it('shows offline results first (snake_case, source offline), then the cloud answer replaces them', async () => {
    readerMock.mockReturnValue(fixture);
    const cloud = deferred<SearchResponse>();
    searchSongs.mockReturnValue(cloud.promise);
    const { result } = renderHook(() => useSearch('starlite muse'));
    await advance(300);
    expect(readerMock).toHaveBeenCalled();
    expect(result.current).toMatchObject({ source: 'offline', loading: true, offline: false });
    expect(result.current.identification?.best).toMatchObject({ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' });
    expect(result.current.groups[0]).toMatchObject({ song_key: 'muse|starlight', artist: 'Muse', title: 'Starlight' });
    expect(result.current.groups[0]!.versions[0]).toHaveProperty('brand_code');

    await settle(() => cloud.resolve(response([group('Cloud Answer')])));
    expect(result.current).toMatchObject({ source: 'cloud', loading: false });
    expect(result.current.groups.map((g) => g.title)).toEqual(['Cloud Answer']);
  });

  it('a broken offline list (identify throws) falls back to the cloud quietly', async () => {
    readerMock.mockReturnValue({
      all: () => {
        throw new Error('SQLITE_CORRUPT');
      },
    });
    const cloud = deferred<SearchResponse>();
    searchSongs.mockReturnValue(cloud.promise);
    const { result } = renderHook(() => useSearch('hello'));
    await advance(300);
    expect(result.current).toMatchObject({ source: 'none', loading: true });
    await settle(() => cloud.resolve(response([group('Hello')])));
    expect(result.current).toMatchObject({ source: 'cloud', groups: [expect.objectContaining({ title: 'Hello' })] });
  });

  it('without a connection, searches only the offline list', async () => {
    netMock.mockReturnValue({ isConnected: false });
    readerMock.mockReturnValue(fixture);
    const { result } = renderHook(() => useSearch('starlite muse'));
    await advance(300);
    expect(searchSongs).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ source: 'offline', offline: true, loading: false, error: null });
    expect(result.current.groups[0]?.song_key).toBe('muse|starlight');
  });

  it('without a connection or an offline list, settles on no results', async () => {
    netMock.mockReturnValue({ isConnected: false });
    const { result } = renderHook(() => useSearch('starlite muse'));
    await advance(300);
    expect(result.current).toMatchObject({ source: 'none', offline: true, loading: false, groups: [], error: null });
  });
});

describe('a cold or unreachable search service', () => {
  it('warmingUp at 1.5 s, then error unreachable at 30 s, keeping the offline results', async () => {
    readerMock.mockReturnValue(fixture);
    searchSongs.mockReturnValue(new Promise(() => {}));
    // The first query is searched on mount (no debounce), so the clock starts at 0.
    const { result } = renderHook(() => useSearch('starlite muse'));
    await advance(0);
    expect(result.current).toMatchObject({ source: 'offline', warmingUp: false });
    await advance(1499);
    expect(result.current.warmingUp).toBe(false);
    await advance(1);
    expect(result.current).toMatchObject({ warmingUp: true, loading: true, error: null });
    await advance(28_499);
    expect(result.current.error).toBeNull();
    await advance(1);
    expect(result.current).toMatchObject({ error: 'unreachable', warmingUp: false, loading: false, source: 'offline' });
    expect(result.current.groups[0]?.song_key).toBe('muse|starlight');
    // The request was given up on.
    expect((searchSongs.mock.calls[0]![1] as { signal: AbortSignal }).signal.aborted).toBe(true);
  });

  it('a cold start that answers after 5 s swaps warmingUp for the cloud results', async () => {
    const cloud = deferred<SearchResponse>();
    searchSongs.mockReturnValue(cloud.promise);
    const { result } = renderHook(() => useSearch('hello'));
    await advance(2000);
    expect(result.current.warmingUp).toBe(true);
    await advance(3000);
    await settle(() => cloud.resolve(response([group('Hello')])));
    expect(result.current).toMatchObject({ warmingUp: false, source: 'cloud', loading: false, error: null });
  });

  it('retries a failed call (503 while the index loads) every 2 s until it answers', async () => {
    searchSongs.mockRejectedValueOnce(new Error('503')).mockRejectedValueOnce(new Error('503'));
    const { result } = renderHook(() => useSearch('hello'));
    await advance(300);
    expect(searchSongs).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(searchSongs).toHaveBeenCalledTimes(2);
    expect(result.current.warmingUp).toBe(true);
    await advance(2000);
    expect(searchSongs).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ source: 'cloud', warmingUp: false, error: null });
  });

  it('with no offline list, unreachable means no results, and retry() searches again', async () => {
    searchSongs.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useSearch('hello'));
    await advance(300 + 30_000);
    expect(result.current).toMatchObject({ error: 'unreachable', source: 'none', groups: [], loading: false });
    const calls = searchSongs.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(16); // one call per 2 s, not a tight loop

    searchSongs.mockReset().mockResolvedValue(response([group('Hello')]));
    act(() => result.current.retry());
    await advance(0);
    expect(searchSongs).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ error: null, source: 'cloud' });
  });
});

describe('the Gemini resolve fallback', () => {
  it('asks resolveQuery exactly once when the cloud finds no song and no groups', async () => {
    searchSongs.mockResolvedValue(response([]));
    const answer = deferred<unknown>();
    resolveQuery.mockReturnValue(answer.promise);
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), { initialProps: { q: 'that song from the whale movie' } });
    await advance(300);
    expect(resolveQuery).toHaveBeenCalledTimes(1);
    expect(resolveQuery).toHaveBeenCalledWith('that song from the whale movie', currentSid());
    expect(result.current).toMatchObject({ source: 'cloud', loading: true, resolve: null });

    const resolved = { kind: 'content', corrected: { artist: 'A', title: 'T', song_key: 'a|t', karaoke: true }, groups: [] };
    await settle(() => answer.resolve(resolved));
    expect(result.current).toMatchObject({ loading: false, resolve: resolved });

    rerender({ q: 'that song from the whale movie ' }); // same trimmed query: no new generation
    await advance(5000);
    expect(resolveQuery).toHaveBeenCalledTimes(1);
  });

  it('is not asked when the cloud has groups, or for the popular list', async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useSearch(q), { initialProps: { q: 'hello' } });
    await advance(300);
    rerender({ q: '' });
    await advance(300);
    expect(resolveQuery).not.toHaveBeenCalled();
  });

  it('a resolve failure just ends loading', async () => {
    searchSongs.mockResolvedValue(response([]));
    resolveQuery.mockRejectedValue(new Error('429'));
    const { result } = renderHook(() => useSearch('mystery'));
    await advance(300);
    expect(result.current).toMatchObject({ loading: false, resolve: null, error: null });
  });

  it('drops a resolve answer that arrives after a newer query', async () => {
    searchSongs.mockImplementation(async (q: string) => response(q === 'mystery' ? [] : [group(q)]));
    const answer = deferred<unknown>();
    resolveQuery.mockReturnValue(answer.promise);
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), { initialProps: { q: 'mystery' } });
    await advance(300);
    rerender({ q: 'hello' });
    await advance(300);
    await settle(() => answer.resolve({ kind: 'content', groups: [] }));
    expect(result.current).toMatchObject({ query: 'hello', resolve: null });
  });
});
