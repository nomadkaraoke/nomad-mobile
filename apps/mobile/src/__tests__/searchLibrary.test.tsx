import * as decide from '@nomad/api-decide';
import { useNetInfo } from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';
import Database from 'better-sqlite3';
import path from 'node:path';

import { useLibraryFilter } from '../find/library';
import { resetSearchCacheForTests, useSearch } from '../find/useSearch';
import { openOfflineReader } from '../offline/offlineIndex';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(),
  resolveQuery: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
}));
jest.mock('../offline/offlineIndex', () => ({ openOfflineReader: jest.fn(() => null) }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: jest.fn() }));

const searchSongs = decide.searchSongs as jest.Mock;
const popularSongs = decide.popularSongs as jest.Mock;
const FIXTURE = path.join(__dirname, '../../../../packages/core/src/search/__fixtures__/offline_fixture.db');
let raw: Database.Database;
beforeAll(() => {
  raw = new Database(FIXTURE, { readonly: true });
});
afterAll(() => raw.close());
const reader = () => ({ all: <T,>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[] });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetSearchCacheForTests();
  (openOfflineReader as jest.Mock).mockReturnValue(null);
  (useNetInfo as jest.Mock).mockReturnValue({ isConnected: true, isInternetReachable: true });
  popularSongs.mockResolvedValue([]);
  searchSongs.mockResolvedValue({ identification: { status: 'none', kind: null, best: null, candidates: [] }, groups: [] });
  act(() => useLibraryFilter.getState().set('karafun'));
});
afterEach(() => {
  act(() => useLibraryFilter.getState().set('any'));
  jest.useRealTimers();
});

const settle = () => act(async () => { await jest.advanceTimersByTimeAsync(400); });

it('search sends library: popular and typed queries carry the chosen library', async () => {
  renderHook(() => useSearch(''));
  await settle();
  expect(popularSongs).toHaveBeenCalledWith(30, 'karafun');
  renderHook(() => useSearch('starlight'));
  await settle();
  expect(searchSongs).toHaveBeenCalledWith('starlight', expect.objectContaining({ library: 'karafun' }));
});

it('changing the library re-runs the query and does not reuse the popular cache', async () => {
  renderHook(() => useSearch(''));
  await settle();
  act(() => useLibraryFilter.getState().set('community'));
  await settle();
  expect(popularSongs).toHaveBeenLastCalledWith(30, 'community');
  expect(popularSongs).toHaveBeenCalledTimes(2);
});

it('offline: the popular list keeps only groups in the chosen library', async () => {
  (openOfflineReader as jest.Mock).mockReturnValue(reader());
  (useNetInfo as jest.Mock).mockReturnValue({ isConnected: false, isInternetReachable: false });
  act(() => useLibraryFilter.getState().set('any'));
  const all = renderHook(() => useSearch(''));
  await settle();
  const anyCount = all.result.current.groups.length;
  expect(anyCount).toBeGreaterThan(0);
  all.unmount();
  act(() => useLibraryFilter.getState().set('karafun'));
  const kf = renderHook(() => useSearch(''));
  await settle();
  for (const g of kf.result.current.groups) expect(g.versions.some((v) => v.brand_code === 'KV')).toBe(true);
  expect(kf.result.current.groups.length).toBeLessThanOrEqual(anyCount);
});
