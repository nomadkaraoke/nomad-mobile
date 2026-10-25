import * as decide from '@nomad/api-decide';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useClearMeOnAccountChange } from '../../me/useClearMeOnAccountChange';
import { useMeOutbox } from '../../me/meOutbox';
import { useLibrary } from '../../me/useLibrary';
import { useSetlists } from '../../me/useSetlists';
import { useLovedOverrides } from '../../me/lovedOverrides';
import { useAuth } from '../../auth/store';
import { userKeyFor } from '../../auth/userKey';
import { appStorage } from '../../storage';
import { li, resetMe, signIn, wrapperFor } from './helpers';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(),
  listSetlists: jest.fn(),
  createSetlist: jest.fn(),
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
