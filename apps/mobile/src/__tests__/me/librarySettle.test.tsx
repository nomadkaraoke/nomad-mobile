import * as decide from '@nomad/api-decide';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useLibrarySettle } from '../../me/librarySettle';
import { useMeOutbox } from '../../me/meOutbox';
import { useLibrary } from '../../me/useLibrary';
import { outboxIdle, useOutbox } from '../../tonight/log/outbox';
import { li, resetMe, wrapperFor } from './helpers';

// Its own file: other library tests leave sends hanging forever, which would hold these outboxes' flush.
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(),
  loveSong: jest.fn(),
  putKaraokeLog: jest.fn(),
  putSetlistItems: jest.fn(),
}));
const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(async () => {
  await outboxIdle();
  await useMeOutbox.idle();
});

describe('a synced write stays in the overlay until a fetch started after it lands', () => {
  const full = (o: Record<string, unknown>) => ({ feel_counts: { great: 0, ok: 0, bad: 0 }, vibes: [], setlist_ids: [], backfill_times: 0, crowd_pleaser_count: 0, loved: false, hidden: false, ...o });

  it.each([
    ['pending', () => new Promise<never>(() => {})],
    ['rejected', () => Promise.reject(new ApiError(0, 'offline'))],
  ])('a synced backfill stays counted while the refetch is %s', async (_l, refetch) => {
    const client = resetMe();
    api.getLibrary.mockResolvedValueOnce({ status: 'ok', etag: '"e"', items: [] });
    api.putKaraokeLog.mockResolvedValue({} as never);
    const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.getLibrary.mockImplementation(refetch);
    await act(async () => {
      useOutbox.getState().enqueue('app_1', 'put', { artist: 'Muse', title: 'Starlight', state: 'sung', times: 3, origin: 'backfill' } as never);
      await outboxIdle();
    });
    await waitFor(() => expect(api.getLibrary).toHaveBeenCalledTimes(2));
    expect(useOutbox.getState().items).toHaveLength(0);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ artist: 'Muse', times_sung: 3, backfill_times: 3 });
  });

  it('a post-sync fetch that lands replaces the overlay (counted once)', async () => {
    const client = resetMe();
    api.getLibrary.mockResolvedValueOnce({ status: 'ok', etag: '"e"', items: [] });
    api.putKaraokeLog.mockResolvedValue({} as never);
    const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let land!: (v: never) => void;
    api.getLibrary.mockImplementation(() => new Promise((r) => (land = r as never)));
    await act(async () => {
      useOutbox.getState().enqueue('app_1', 'put', { artist: 'Muse', title: 'Starlight', state: 'sung', times: 3, origin: 'backfill' } as never);
      await outboxIdle();
    });
    await waitFor(() => expect(api.getLibrary).toHaveBeenCalledTimes(2));
    await act(async () => land({ status: 'ok', etag: '"e2"', items: [full({ ...li('Muse', 'Starlight'), times_sung: 3, backfill_times: 3 })] } as never));
    await waitFor(() => expect(result.current.items[0]!.times_sung).toBe(3));
    await new Promise((r) => setTimeout(r, 5));
    expect(result.current.items[0]).toMatchObject({ times_sung: 3, backfill_times: 3 });
  });

  it('a synced love and setlist membership stay while the refetch is pending', async () => {
    const client = resetMe();
    api.getLibrary.mockResolvedValueOnce({ status: 'ok', etag: '"e"', items: [] });
    api.loveSong.mockResolvedValue();
    (api.putSetlistItems as jest.Mock).mockResolvedValue({});
    const { result } = renderHook(() => useLibrary(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.getLibrary.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      useMeOutbox.getState().enqueue({ key: 'love:k_One', op: 'love', song_key: 'k_One', artist: 'A', title: 'One', loved: true });
      useMeOutbox.getState().enqueue({ key: 'setlist:pl_existing1', op: 'save', id: 'pl_existing1', name: 'Mix', items: [{ song_key: 'k_Two', artist: 'A', title: 'Two' }], create: false, baseRev: 1 });
      await useMeOutbox.idle();
    });
    expect(useMeOutbox.getState().items).toHaveLength(0);
    const byTitle = Object.fromEntries(result.current.items.map((s) => [s.title, s]));
    expect(byTitle.One).toMatchObject({ loved: true });
    expect(byTitle.Two).toMatchObject({ setlist_ids: ['pl_existing1'] });
  });
});

it('settleSetlists drops writes sent at or before the fetch start and keeps later ones', () => {
  const w = (id: string, sentAt: number) => ({ item: { key: `setlist:${id}`, op: 'delete', id, rev: 1 } as never, result: undefined, sentAt });
  useLibrarySettle.setState({ setlistsSent: { pl_a: w('pl_a', 99), pl_b: w('pl_b', 100), pl_c: w('pl_c', 101) } });
  useLibrarySettle.getState().settleSetlists(100);
  expect(Object.keys(useLibrarySettle.getState().setlistsSent)).toEqual(['pl_c']);
  useLibrarySettle.getState().clear();
});
