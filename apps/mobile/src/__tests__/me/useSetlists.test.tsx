import * as decide from '@nomad/api-decide';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useSetlists } from '../../me/useSetlists';
import { useLibrarySettle } from '../../me/librarySettle';
import { useMeOutbox } from '../../me/meOutbox';
import { appStorage } from '../../storage';
import { userKeyFor } from '../../auth/userKey';
import { resetMe, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  listSetlists: jest.fn(),
  createSetlist: jest.fn(),
  putSetlistItems: jest.fn(),
  renameSetlist: jest.fn(),
  deleteSetlist: jest.fn(),
}));
const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');

beforeEach(() => {
  jest.clearAllMocks();
});

it('creating offline shows the setlist at once with a pl_ id', async () => {
  const client = resetMe();
  api.listSetlists.mockRejectedValue(new ApiError(0, 'offline'));
  api.createSetlist.mockRejectedValue(new ApiError(0, 'offline'));
  const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
  let id = '';
  act(() => {
    id = result.current.createSetlist('Friday');
  });
  expect(id).toMatch(/^pl_[A-Za-z0-9-]{8,64}$/);
  expect(result.current.setlists.map((s) => [s.id, s.name])).toEqual([[id, 'Friday']]);
  await waitFor(() => expect(result.current.offline).toBe(true));
  expect(result.current.setlists).toHaveLength(1);
  expect(useMeOutbox.getState().items).toHaveLength(1);
});

it('adds, removes and deletes optimistically', async () => {
  const client = resetMe();
  api.listSetlists.mockResolvedValue([]);
  api.createSetlist.mockRejectedValue(new ApiError(0, 'offline'));
  const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
  let id = '';
  act(() => {
    id = result.current.createSetlist('Mix');
  });
  act(() => result.current.addSongs([id], { artist: 'A', title: 'One', song_key: 'k1' }));
  expect(result.current.setlists[0]!.items).toHaveLength(1);
  act(() => result.current.addSongs([id], { artist: 'A', title: 'One', song_key: 'k1' }));
  expect(result.current.setlists[0]!.items).toHaveLength(1);
  const itemId = result.current.setlists[0]!.items![0]!.item_id;
  act(() => result.current.removeItem(id, itemId));
  expect(result.current.setlists[0]!.items).toHaveLength(0);
  act(() => result.current.deleteSetlist(id));
  expect(result.current.setlists).toHaveLength(0);
});

it('refuses (does not truncate) past 500 songs', async () => {
  const client = resetMe();
  api.listSetlists.mockResolvedValue([]);
  api.createSetlist.mockRejectedValue(new ApiError(0, 'offline'));
  const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
  let id = '';
  act(() => {
    id = result.current.createSetlist('Big');
  });
  const many = Array.from({ length: 500 }, (_, n) => ({ song_key: `k${n}`, artist: 'A', title: `T${n}` }));
  act(() => {
    expect(result.current.setItems(id, many)).toBe(true);
  });
  let res: { added: string[]; full: string[] } = { added: [], full: [] };
  act(() => {
    res = result.current.addSongs([id], { artist: 'A', title: 'One more', song_key: 'kx' });
  });
  expect(res).toEqual({ added: [], full: [id] });
  expect(result.current.setlists[0]!.items).toHaveLength(500);
});

describe('a synced write stays visible until a refetch lands', () => {
  const echo = (id: string, name: string, items: decide.SetlistItemIn[], rev = 1) =>
    ({ id, name, rev, description: null, song_ids: [], song_count: items.length, created_at: 'x', updated_at: 'x', items: items.map((x, n) => ({ item_id: `srv-${n}`, added_at: 'x', facets: null, ...x })) }) as never;

  it.each([
    ['pending', () => new Promise<never>(() => {})],
    ['rejected', () => Promise.reject(new ApiError(0, 'offline'))],
  ])('a synced create keeps the setlist and its items while the refetch is %s', async (_label, refetch) => {
    const client = resetMe();
    api.listSetlists.mockResolvedValueOnce([]);
    api.createSetlist.mockImplementation(async (i) => echo(i.id, i.name, i.items));
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(api.listSetlists).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let id = '';
    act(() => {
      id = result.current.createSetlist('Friday');
    });
    act(() => void result.current.addSongs([id], { artist: 'A', title: 'One', song_key: 'k1' }));
    api.listSetlists.mockImplementation(refetch);
    await act(async () => useMeOutbox.idle());
    await waitFor(() => expect(api.listSetlists).toHaveBeenCalledTimes(2));
    expect(useMeOutbox.getState().items).toHaveLength(0);
    expect(result.current.setlists.map((s) => [s.id, s.name, (s.items ?? []).map((x) => x.title)])).toEqual([[id, 'Friday', ['One']]]);
    // and the MMKV cache has it for the next cold start
    const cache = JSON.parse(appStorage.getString(`me.setlists.v1.${userKeyFor('a@example.com')}`)!);
    expect(cache.setlists.map((s: { id: string }) => s.id)).toEqual([id]);
  });

  it.each([
    ['pending', () => new Promise<never>(() => {})],
    ['rejected', () => Promise.reject(new ApiError(0, 'offline'))],
  ])('a synced reorder keeps the new order while the refetch is %s', async (_label, refetch) => {
    const client = resetMe();
    const a = { song_key: 'k1', artist: 'A', title: 'One' };
    const b = { song_key: 'k2', artist: 'A', title: 'Two' };
    api.listSetlists.mockResolvedValueOnce([echo('pl_existing1', 'Mix', [a, b])]);
    api.putSetlistItems.mockImplementation(async (sid, items) => echo(sid, 'Mix', items, 2));
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.setlists).toHaveLength(1));
    api.listSetlists.mockImplementation(refetch);
    const [x, y] = result.current.setlists[0]!.items!;
    act(() => void result.current.setItems('pl_existing1', [y!, x!]));
    await act(async () => useMeOutbox.idle());
    await waitFor(() => expect(api.listSetlists).toHaveBeenCalledTimes(2));
    expect(useMeOutbox.getState().items).toHaveLength(0);
    expect(result.current.setlists[0]!.items!.map((i) => i.title)).toEqual(['Two', 'One']);
  });

  it('a synced delete stays deleted while the refetch is pending', async () => {
    const client = resetMe();
    api.listSetlists.mockResolvedValueOnce([echo('pl_existing1', 'Mix', [])]);
    api.deleteSetlist.mockResolvedValue();
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.setlists).toHaveLength(1));
    api.listSetlists.mockImplementation(() => new Promise(() => {}));
    act(() => result.current.deleteSetlist('pl_existing1'));
    await act(async () => useMeOutbox.idle());
    expect(result.current.setlists).toHaveLength(0);
  });

  it('with nothing cached, a synced create stays visible through a rejected refetch, and addSongs works in the gap', async () => {
    const client = resetMe();
    api.listSetlists.mockRejectedValue(new ApiError(0, 'offline')); // the first fetch fails: nothing is ever cached
    api.createSetlist.mockImplementation(async (i) => echo(i.id, i.name, i.items));
    api.putSetlistItems.mockImplementation(async (sid, items) => echo(sid, 'Friday', items, 2));
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.offline).toBe(true));
    let id = '';
    act(() => {
      id = result.current.createSetlist('Friday');
    });
    await act(async () => useMeOutbox.idle());
    await waitFor(() => expect(api.listSetlists).toHaveBeenCalledTimes(2)); // the post-sync refetch, rejected too
    expect(useMeOutbox.getState().items).toHaveLength(0);
    expect(result.current.setlists.map((s) => [s.id, s.name])).toEqual([[id, 'Friday']]);
    // Adding a song in the gap builds on the sent list (it is not refused or created nameless).
    let res: { added: string[]; full: string[] } = { added: [], full: [] };
    act(() => {
      res = result.current.addSongs([id], { artist: 'A', title: 'One', song_key: 'k1' });
    });
    expect(res).toEqual({ added: [id], full: [] });
    expect(useMeOutbox.getState().items[0]).toMatchObject({ op: 'save', id, name: 'Friday', create: false });
    expect(result.current.setlists[0]!.items!.map((x) => x.title)).toEqual(['One']);
    await act(async () => useMeOutbox.idle());
    await waitFor(() => expect(api.listSetlists).toHaveBeenCalledTimes(3));
    expect(result.current.setlists.map((s) => [s.id, (s.items ?? []).map((x) => x.title)])).toEqual([[id, ['One']]]);
    // removeItem in the gap works too
    const itemId = result.current.setlists[0]!.items![0]!.item_id;
    act(() => result.current.removeItem(id, itemId));
    expect(result.current.setlists[0]!.items).toHaveLength(0);
    expect(useMeOutbox.getState().items[0]).toMatchObject({ op: 'save', id, name: 'Friday', items: [] });
  });

  it('with nothing cached, a fetch that started after the send settles the overlay', async () => {
    const client = resetMe();
    api.listSetlists.mockRejectedValueOnce(new ApiError(0, 'offline'));
    api.createSetlist.mockImplementation(async (i) => echo(i.id, i.name, i.items));
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.offline).toBe(true));
    let id = '';
    act(() => {
      id = result.current.createSetlist('Friday');
    });
    // The refetch after the send answers with the server's lists (another one too): the server copy now rules.
    api.listSetlists.mockImplementation(async () => [echo(id, 'Friday (server)', []), echo('pl_other0001', 'Other', [])]);
    await act(async () => useMeOutbox.idle());
    await waitFor(() => expect(result.current.setlists.map((s) => s.name)).toEqual(['Friday (server)', 'Other']));
    expect(Object.keys(useLibrarySettle.getState().setlistsSent)).toEqual([]);
  });

  it('an edit sent once the cache exists is not reverted by an older unsettled send', async () => {
    const client = resetMe();
    api.listSetlists.mockRejectedValueOnce(new ApiError(0, 'offline'));
    api.createSetlist.mockImplementation(async (i) => echo(i.id, i.name, i.items));
    api.putSetlistItems.mockImplementation(async (sid, items) => echo(sid, 'Friday', items, 2));
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.offline).toBe(true));
    let id = '';
    act(() => {
      id = result.current.createSetlist('Friday');
    });
    api.listSetlists.mockImplementation(() => new Promise<never>(() => {})); // the post-sync refetch hangs
    await act(async () => useMeOutbox.idle());
    // A cache appears that hasn't seen the send (a fetch that started before it): the overlay keeps the list.
    act(() => client.setQueryData(['decide', userKeyFor('a@example.com'), 'setlists'], { setlists: [], savedAt: 1 }));
    expect(result.current.setlists.map((s) => s.id)).toEqual([id]);
    act(() => void result.current.addSongs([id], { artist: 'A', title: 'One', song_key: 'k1' }));
    await act(async () => useMeOutbox.idle());
    expect(result.current.setlists[0]!.items!.map((x) => x.title)).toEqual(['One']);
  });

  it('save() never creates a nameless setlist when the list is unknown', async () => {
    const client = resetMe();
    api.listSetlists.mockResolvedValue([]);
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = true;
    act(() => {
      ok = result.current.setItems('pl_unknown1', [{ song_key: 'k1', artist: 'A', title: 'One' }]);
    });
    expect(ok).toBe(false);
    act(() => result.current.renameSetlist('pl_unknown1', 'X'));
    expect(useMeOutbox.getState().items).toEqual([]);
  });

  it('save() falls back to the last-known setlist when it drops out of the cache', async () => {
    const client = resetMe();
    const a = { song_key: 'k1', artist: 'A', title: 'One' };
    api.listSetlists.mockResolvedValueOnce([echo('pl_existing1', 'Mix', [a])]);
    api.putSetlistItems.mockRejectedValue(new ApiError(401, 'x')); // parks the queue
    const { result } = renderHook(() => useSetlists(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.setlists).toHaveLength(1));
    // The cache loses it (e.g. a refetch raced a create); the screen still shows the list it had.
    act(() => client.setQueryData(['decide', userKeyFor('a@example.com'), 'setlists'], { setlists: [], savedAt: 1 }));
    act(() => void result.current.setItems('pl_existing1', [a, { song_key: 'k2', artist: 'A', title: 'Two' }]));
    expect(useMeOutbox.getState().items[0]).toMatchObject({ op: 'save', id: 'pl_existing1', name: 'Mix', create: false });
  });
});

it('a write synced before any setlists fetch does not seed a one-list cache', async () => {
  resetMe();
  api.createSetlist.mockImplementation(async (i) => ({ id: i.id, name: i.name, rev: 1, items: [] }) as never);
  useMeOutbox.getState().enqueue({ key: 'setlist:pl_cold0001', op: 'save', id: 'pl_cold0001', name: 'Cold', items: [], create: true, baseRev: null });
  await useMeOutbox.idle();
  expect(appStorage.getString(`me.setlists.v1.${userKeyFor('a@example.com')}`)).toBeUndefined();
});
