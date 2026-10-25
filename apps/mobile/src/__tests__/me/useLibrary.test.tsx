import * as decide from '@nomad/api-decide';
import { renderHook, waitFor } from '@testing-library/react-native';

import { useMeOutbox } from '../../me/meOutbox';
import { useLibrary } from '../../me/useLibrary';
import { useLogStore } from '../../tonight/log/logStore';
import { useOutbox } from '../../tonight/log/outbox';
import { appStorage } from '../../storage';
import { userKeyFor } from '../../auth/userKey';
import { li, resetMe, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(),
  loveSong: jest.fn(),
  putKaraokeLog: jest.fn(() => new Promise(() => {})),
}));
const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');
const CACHE = `me.library.v1.${userKeyFor('a@example.com')}`;

beforeEach(() => {
  jest.clearAllMocks();
});

it('a 304 keeps the cached items', async () => {
  const client = resetMe();
  appStorage.set(CACHE, JSON.stringify({ etag: '"e1"', savedAt: 1, items: [{ ...li('A', 'One'), feel_counts: { great: 0, ok: 0, bad: 0 }, vibes: [], setlist_ids: [], backfill_times: 0, crowd_pleaser_count: 0, loved: false, hidden: false }] }));
  api.getLibrary.mockResolvedValue({ status: 'not-modified' });
  const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
  expect(result.current.items.map((s) => s.title)).toEqual(['One']);
  await waitFor(() => expect(api.getLibrary).toHaveBeenCalledWith('"e1"'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items.map((s) => s.title)).toEqual(['One']);
  expect(result.current.offline).toBe(false);
});

it('writes the cache on ok', async () => {
  const client = resetMe();
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"e2"', items: [li('A', 'Two') as never] });
  const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.items.map((s) => s.title)).toEqual(['Two']));
  expect(JSON.parse(appStorage.getString(CACHE)!).etag).toBe('"e2"');
});

it('offline (status 0) serves the cache with offline: true', async () => {
  const client = resetMe();
  appStorage.set(CACHE, JSON.stringify({ etag: '"e1"', savedAt: 1, items: [{ ...li('A', 'One'), feel_counts: { great: 0, ok: 0, bad: 0 }, vibes: [], setlist_ids: [], backfill_times: 0, crowd_pleaser_count: 0, loved: false, hidden: false }] }));
  api.getLibrary.mockRejectedValue(new ApiError(0, 'offline'));
  const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.offline).toBe(true));
  expect(result.current.items.map((s) => s.title)).toEqual(['One']);
  expect(result.current.error).toBe(false);
});

it('a pending backfill shows immediately', async () => {
  const client = resetMe();
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"e"', items: [] });
  useOutbox.setState({ items: [{ key: 'app_1', id: 'app_1', op: 'put', rev: 1, patch: { artist: 'Muse', title: 'Starlight', state: 'sung', times: 3, origin: 'backfill' } as never }] });
  const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
  expect(result.current.items).toHaveLength(1);
  expect(result.current.items[0]).toMatchObject({ artist: 'Muse', times_sung: 3, backfill_times: 3 });
  void useLogStore;
});

it('a queued love shows immediately', async () => {
  const client = resetMe();
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"e"', items: [li('A', 'One') as never] });
  api.loveSong.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  useMeOutbox.getState().enqueue({ key: 'love:k_One', op: 'love', song_key: 'k_One', artist: 'A', title: 'One', loved: true });
  await waitFor(() => expect(result.current.items[0]!.loved).toBe(true));
});

it('useSaveSong toggles through the outbox and agrees with Discover hearts', async () => {
  const { useSaveSong } = require('../../me/useSaveSong') as typeof import('../../me/useSaveSong');
  const { useLovedOverrides } = require('../../me/lovedOverrides') as typeof import('../../me/lovedOverrides');
  const { act } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');
  const client = resetMe();
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"e"', items: [li('A', 'One') as never] });
  api.loveSong.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useSaveSong(), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.saved('k_One')).toBe(false));
  act(() => result.current.toggle({ song_key: 'k_One', artist: 'A', title: 'One' }));
  expect(result.current.saved('k_One')).toBe(true);
  expect(useMeOutbox.getState().items[0]).toMatchObject({ op: 'love', song_key: 'k_One', loved: true });
  expect(useLovedOverrides.getState().byKey.k_One!.loved).toBe(true);
  act(() => result.current.toggle({ song_key: 'k_One', artist: 'A', title: 'One' }));
  expect(result.current.saved('k_One')).toBe(false);
});
