import * as decide from '@nomad/api-decide';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { clearMeLocalData, useClearMeOnAccountChange } from '../../me/useClearMeOnAccountChange';
import { useMeOutbox } from '../../me/meOutbox';
import { useLibrary } from '../../me/useLibrary';
import { useSetlists } from '../../me/useSetlists';
import { useSongHistory } from '../../me/SongHistory';
import { useGetMadeLocal } from '../../me/getMadeLocal';
import { useLovedOverrides } from '../../me/lovedOverrides';
import { useClaimAnswered } from '../../me/useClaimSuggestions';
import { useAuth } from '../../auth/store';
import { userKeyFor } from '../../auth/userKey';
import { appStorage } from '../../storage';
import { li, resetMe, signIn, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(),
  listSetlists: jest.fn(),
  createSetlist: jest.fn(),
  listKaraokeLog: jest.fn(),
  listSongHistory: jest.fn(),
}));
const api = decide as jest.Mocked<typeof decide>;
const { ApiError } = jest.requireActual<typeof decide>('@nomad/api-decide');
const A = userKeyFor('a@example.com');

it('keeps A out of B, and A comes back to their own pending writes after a lone sign-out', async () => {
  const client = resetMe('a@example.com');
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"a"', items: [li('A', 'Secret') as never] });
  api.listSetlists.mockResolvedValue([]);
  api.createSetlist.mockRejectedValue(new ApiError(0, 'offline'));
  const wrapper = wrapperFor(client);
  renderHook(() => useClearMeOnAccountChange(), { wrapper });
  const lib = renderHook(() => useLibrary(), { wrapper });
  const sl = renderHook(() => useSetlists(), { wrapper });
  await waitFor(() => expect(lib.result.current.items.map((s) => s.title)).toEqual(['Secret']));
  act(() => {
    sl.result.current.createSetlist('Mine');
  });
  expect(useMeOutbox.getState().items).toHaveLength(1);
  expect(appStorage.getString(`me.library.v1.${A}`)).toBeTruthy();
  expect(appStorage.getString(`me.outbox.v1.${A}`)).toBeTruthy();

  // Sign out alone: caches go, A's unsent write stays.
  act(() => useAuth.setState({ state: { status: 'signedOut' } }));
  expect(appStorage.getString(`me.library.v1.${A}`)).toBeUndefined();
  expect(appStorage.getString(`me.outbox.v1.${A}`)).toBeTruthy();
  act(() => signIn('a@example.com'));
  expect(useMeOutbox.getState().items).toHaveLength(1);

  // Now B signs in.
  act(() => useAuth.setState({ state: { status: 'signedOut' } }));
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"b"', items: [] });
  act(() => signIn('b@example.com'));
  expect(useMeOutbox.getState().items).toEqual([]);
  expect(appStorage.getAllKeys().filter((k) => k.startsWith('me.') && k.endsWith(`.${A}`))).toEqual([]);
  const libB = renderHook(() => useLibrary(), { wrapper });
  const firstB = libB.result.current.items;
  await waitFor(() => expect(api.getLibrary).toHaveBeenLastCalledWith(undefined));
  expect(libB.result.current.items).toEqual([]);
  expect(firstB).toEqual([]);
});

it('a direct A to B switch (no sign-out) leaks nothing: loves, library, outbox', async () => {
  const client = resetMe('a@example.com');
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"a"', items: [li('A', 'Secret') as never] });
  const wrapper = wrapperFor(client);
  renderHook(() => useClearMeOnAccountChange(), { wrapper });
  const lib = renderHook(() => useLibrary(), { wrapper });
  await waitFor(() => expect(lib.result.current.items).toHaveLength(1));
  act(() => useLovedOverrides.getState().set({ song_key: 'k_Secret', artist: 'A', title: 'Secret' }, true));
  act(() => useMeOutbox.getState().enqueue({ key: 'love:k_Secret', op: 'love', song_key: 'k_Secret', artist: 'A', title: 'Secret', loved: true }));
  api.getLibrary.mockImplementation(() => new Promise(() => {}));
  act(() => signIn('b@example.com'));
  expect(useLovedOverrides.getState().byKey).toEqual({});
  expect(useMeOutbox.getState().items).toEqual([]);
  expect(appStorage.getString(`me.library.v1.${A}`)).toBeUndefined();
  const libB = renderHook(() => useLibrary(), { wrapper });
  expect(libB.result.current.items).toEqual([]);
});

it('a fetch that finishes after sign-out writes no cache for the old account', async () => {
  const client = resetMe('a@example.com');
  let release!: (v: never) => void;
  api.getLibrary.mockImplementation(() => new Promise((r) => (release = r as never)));
  const wrapper = wrapperFor(client);
  renderHook(() => useClearMeOnAccountChange(), { wrapper });
  renderHook(() => useLibrary(), { wrapper });
  await waitFor(() => expect(api.getLibrary).toHaveBeenCalled());
  act(() => useAuth.setState({ state: { status: 'signedOut' } }));
  await act(async () => {
    release({ status: 'ok', etag: '"a"', items: [li('A', 'Late') as never] } as never);
    await Promise.resolve();
  });
  expect(appStorage.getString(`me.library.v1.${A}`)).toBeUndefined();
});

describe('song history is per account', () => {
  const rec = { id: 'app_a1', user_id: 'a', state: 'sung', artist: 'A', title: 'Secret', song_key: null, song_key_status: 'unresolved' } as never;
  const KEY = 'u:secret-key';

  it.each([
    ['after a sign-out', true],
    ['on a direct A to B switch', false],
  ])('B never sees A\'s cached song history %s', async (_l, signOutFirst) => {
    const client = resetMe('a@example.com');
    api.listKaraokeLog.mockResolvedValue({ entries: [], next_cursor: null } as never);
    api.listSongHistory.mockResolvedValue([rec]);
    const wrapper = wrapperFor(client);
    renderHook(() => useClearMeOnAccountChange(), { wrapper });
    const a = renderHook(() => useSongHistory(KEY), { wrapper });
    await waitFor(() => expect(a.result.current.map((e) => e.id)).toEqual(['app_a1']));
    a.unmount();
    if (signOutFirst) {
      act(() => useAuth.setState({ state: { status: 'signedOut' } }));
      expect(client.getQueryCache().findAll({ predicate: (q) => q.queryKey[2] === 'song-history' })).toEqual([]);
    }
    api.listSongHistory.mockImplementation(() => new Promise(() => {}));
    act(() => signIn('b@example.com'));
    const b = renderHook(() => useSongHistory(KEY), { wrapper });
    expect(b.result.current).toEqual([]);
  });
});

it("sign-out drops the cached crowd figures (decide answers them for the viewer's voice bucket)", () => {
  const client = resetMe('a@example.com');
  renderHook(() => useClearMeOnAccountChange(), { wrapper: wrapperFor(client) });
  client.setQueryData(['decide', A, 'crowd', 'invented band|made up song', null], { singers: 5 });
  act(() => useAuth.setState({ state: { status: 'signedOut' } }));
  expect(client.getQueryCache().findAll({ predicate: (q) => q.queryKey[2] === 'crowd' })).toEqual([]);
});

it('account deletion (clearMeLocalData) forgets the owner, their caches, unsent Me writes and the loves overlay', async () => {
  const client = resetMe('a@example.com');
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: '"a"', items: [li('A', 'Secret') as never] });
  const wrapper = wrapperFor(client);
  renderHook(() => useClearMeOnAccountChange(), { wrapper });
  const lib = renderHook(() => useLibrary(), { wrapper });
  await waitFor(() => expect(lib.result.current.items).toHaveLength(1));
  act(() => useLovedOverrides.getState().set({ song_key: 'k_Secret', artist: 'A', title: 'Secret' }, true));
  act(() => useMeOutbox.getState().enqueue({ key: 'love:k_Secret', op: 'love', song_key: 'k_Secret', artist: 'A', title: 'Secret', loved: true }));
  expect(appStorage.getString(`me.outbox.v1.${A}`)).toBeTruthy();
  // wipeLocal signs out first (sessionDead), then clears Me: the owner is read from storage, not the session.
  act(() => useAuth.setState({ state: { status: 'signedOut' } }));
  expect(appStorage.getString(`me.outbox.v1.${A}`)).toBeTruthy(); // a lone sign-out keeps it
  act(() => clearMeLocalData());
  expect(appStorage.getAllKeys().filter((k) => k.startsWith('me.'))).toEqual([]);
  expect(useLovedOverrides.getState().byKey).toEqual({});
  // The same person signing in again gets nothing back.
  act(() => signIn('a@example.com'));
  expect(useMeOutbox.getState().items).toEqual([]);
});

it("account deletion (clearMeLocalData) also drops 4b's Get this made state and 4c's answered past nights", () => {
  resetMe('a@example.com');
  const item = { key: 'k_Gone', artist: 'Invented Band', title: 'Made Up Song' } as never;
  act(() => {
    useGetMadeLocal.getState().setDismissed(item, true);
    useGetMadeLocal.getState().setRequest('k_Gone', 'sent' as never);
    useClaimAnswered.getState().markAnswered(A, 'kn_1');
  });
  expect(Object.keys(useGetMadeLocal.getState().dismissed)).toEqual(['k_Gone']);
  expect(useClaimAnswered.getState().byUser[A]).toEqual({ kn_1: true });
  act(() => clearMeLocalData());
  expect(useGetMadeLocal.getState()).toMatchObject({ dismissed: {}, requests: {}, toast: null });
  expect(useClaimAnswered.getState().byUser).toEqual({});
});
