import * as kjbox from '@nomad/api-kjbox';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { userKeyFor } from '../../auth/userKey';
import { useAuth } from '../../auth/store';
import { CLAIM_REFETCH_DELAYS_MS, suggestionsKeyFor, useClaimAnswered, useClaimSuggestions } from '../../me/useClaimSuggestions';
import { useClearMeOnAccountChange } from '../../me/useClearMeOnAccountChange';
import { libraryKeyFor } from '../../me/useLibrary';
import { logMirrorKeyFor } from '../../me/useLogMirror';
import { appStorage } from '../../storage';
import { resetMe, signIn, wrapperFor } from './helpers';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getHistorySuggestions: jest.fn(),
  claimHistory: jest.fn(),
}));

let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const A = userKeyFor('a@example.com');
const B = userKeyFor('b@example.com');

const song = (id: number, o: Partial<kjbox.HistorySong> = {}): kjbox.HistorySong => ({
  entry_id: id,
  singer_name: 'Wren B',
  members: ['Wren B'],
  artist: 'Adele',
  title: `Hello ${id}`,
  started_at: '2026-10-10T02:14:00Z',
  state: 'sung',
  ...o,
});
const night = (id: string, songs = [song(1), song(2), song(3)], o: Partial<kjbox.HistoryNight> = {}): kjbox.HistoryNight => ({
  night_id: id,
  date: '2026-10-09',
  venue: 'Host Bar',
  names: ['Wren B'],
  unmatched: 0,
  songs,
  ...o,
});
const suggestions = (nights: kjbox.HistoryNight[], more = 0): kjbox.HistorySuggestions => ({ api_version: '1.0', nights, more_nights: more });
const result = (o: Partial<kjbox.HistoryClaimResult> = {}): kjbox.HistoryClaimResult => ({
  api_version: '1.0',
  saved: 1,
  already_saved: 0,
  taken: [],
  rejected: 0,
  ...o,
});

beforeEach(() => {
  jest.useRealTimers();
  mockConnected = true;
  api.getHistorySuggestions.mockReset();
  api.claimHistory.mockReset();
  useClaimAnswered.getState().clear();
});

function setup(email = 'a@example.com') {
  const client = resetMe(email);
  const wrapper = wrapperFor(client);
  return { client, wrapper };
}

describe('visibility', () => {
  it('shows the nights once loaded, with more_nights', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1'), night('n2')], 4));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    expect(h.result.current.visible).toBe(false); // loading
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    expect(h.result.current.nights.map((n) => n.night_id)).toEqual(['n1', 'n2']);
    expect(h.result.current.more).toBe(4);
  });

  it('no nights: not visible', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([]));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(api.getHistorySuggestions).toHaveBeenCalled());
    await act(async () => {});
    expect(h.result.current.visible).toBe(false);
  });

  it.each([
    ['unreachable', () => new KjboxError('internal', 530, undefined, {}, true)],
    ['older box (404)', () => new KjboxError('not_found', 404)],
    ['older box (non-JSON 404)', () => new KjboxError('internal', 404)],
    ['401', () => new KjboxError('unauthenticated', 401)],
    ['503', () => new KjboxError('gen_unavailable', 503, 5)],
    ['429', () => new KjboxError('rate_limited', 429, 60)],
    ['malformed reply', () => new KjboxError('internal', 200, undefined, { message: 'malformed reply' })],
  ])('%s: not visible, fetched once (no retry)', async (_label, err) => {
    api.getHistorySuggestions.mockRejectedValue(err());
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(api.getHistorySuggestions).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(h.result.current.visible).toBe(false);
    expect(h.result.current.nights).toEqual([]);
    expect(api.getHistorySuggestions).toHaveBeenCalledTimes(1);
  });

  it('offline: no fetch, not visible', async () => {
    mockConnected = false;
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await act(async () => {});
    expect(api.getHistorySuggestions).not.toHaveBeenCalled();
    expect(h.result.current.visible).toBe(false);
  });

  it('signed out: no fetch, not visible', async () => {
    const { wrapper } = setup();
    act(() => useAuth.setState({ state: { status: 'signedOut' } }));
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await act(async () => {});
    expect(api.getHistorySuggestions).not.toHaveBeenCalled();
    expect(h.result.current.visible).toBe(false);
  });

  it('never writes suggestions to the phone (memory only)', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    const { wrapper } = setup();
    const before = appStorage.getAllKeys().sort();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    expect(appStorage.getAllKeys().sort()).toEqual(before);
    expect(appStorage.getAllKeys().some((k) => appStorage.getString(k)?.includes('Wren'))).toBe(false);
  });

  it('uses a per-account query key under kjbox', () => {
    expect(suggestionsKeyFor(A)).toEqual(['kjbox', A, 'history-suggestions']);
  });
});

describe('claim', () => {
  afterEach(() => {
    act(() => useClaimAnswered.getState().clear());
    jest.useRealTimers();
  });

  it('a 400 invalid claim refetches the suggestions and shows the refreshed list', async () => {
    api.getHistorySuggestions.mockResolvedValueOnce(suggestions([night('n1'), night('n2')]));
    api.claimHistory.mockRejectedValue(new KjboxError('invalid', 400));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    api.getHistorySuggestions.mockResolvedValueOnce(suggestions([night('n2')]));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    await waitFor(() => expect(api.getHistorySuggestions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.result.current.nights.map((n) => n.night_id)).toEqual(['n2']));
  });

  it('a 404 not_found claim refetches the suggestions too', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockRejectedValue(new KjboxError('not_found', 404));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    await waitFor(() => expect(api.getHistorySuggestions).toHaveBeenCalledTimes(2));
  });

  it('unreachable after the retry marks the list stale without refetching now (the card keeps its error line)', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockRejectedValue(new KjboxError('internal', 530, undefined, {}, true));
    const { client, wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    await act(async () => {});
    expect(api.getHistorySuggestions).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(suggestionsKeyFor(A))?.isInvalidated).toBe(true);
    expect(h.result.current.visible).toBe(true);
  });

  it('a 429 claim leaves the list alone', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockRejectedValue(new KjboxError('rate_limited', 429, 60));
    const { client, wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    expect(client.getQueryState(suggestionsKeyFor(A))?.isInvalidated).toBe(false);
  });

  it('releases the in-flight slot: after a failed claim, the same night can be sent again', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockRejectedValueOnce(new KjboxError('rate_limited', 429, 1)).mockResolvedValueOnce(result());
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    const n = h.result.current.nights[0]!;
    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = await h.result.current.claim(n, [1]);
    });
    await act(async () => {
      second = await h.result.current.claim(n, [1]);
    });
    expect(first).toEqual({ error: 'failed' });
    expect(second).toMatchObject({ saved: 1 });
    expect(api.claimHistory).toHaveBeenCalledTimes(2);
  });

  it('signed out: sends nothing and reports failed', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    const n = h.result.current.nights[0]!;
    act(() => useAuth.setState({ state: { status: 'signedOut' } }));
    let out: unknown;
    await act(async () => {
      out = await h.result.current.claim(n, [1]);
    });
    expect(out).toEqual({ error: 'failed' });
    expect(api.claimHistory).not.toHaveBeenCalled();
  });
  it('sends the ticked songs as mine and the rest as not_mine, then hides the night', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1'), night('n2')]));
    api.claimHistory.mockResolvedValue(result({ saved: 2, rejected: 1, taken: [] }));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    let out: unknown;
    await act(async () => {
      out = await h.result.current.claim(h.result.current.nights[0]!, [3, 1]);
    });
    expect(api.claimHistory).toHaveBeenCalledTimes(1);
    expect(api.claimHistory).toHaveBeenCalledWith('n1', [1, 3], [2]);
    expect(out).toEqual({ saved: 2, alreadySaved: 0, taken: 0, takenIds: [], rejected: 1 });
    expect(h.result.current.nights.map((n) => n.night_id)).toEqual(['n2']);
  });

  it('"none of these are me": nothing ticked sends every song as not_mine', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockResolvedValue(result({ saved: 0, rejected: 3 }));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, []);
    });
    expect(api.claimHistory).toHaveBeenCalledWith('n1', [], [1, 2, 3]);
    expect(h.result.current.visible).toBe(false);
  });

  it('ignores ticked ids that are not songs of that night', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockResolvedValue(result());
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [2, 99]);
    });
    expect(api.claimHistory).toHaveBeenCalledWith('n1', [2], [1, 3]);
  });

  it('reports taken songs (count and ids)', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockResolvedValue(result({ saved: 1, taken: [2] }));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    let out: unknown;
    await act(async () => {
      out = await h.result.current.claim(h.result.current.nights[0]!, [1, 2, 3]);
    });
    expect(out).toMatchObject({ saved: 1, taken: 1, takenIds: [2] });
  });

  it('retries once with the same body after an unreachable (timeout) failure', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory
      .mockRejectedValueOnce(new KjboxError('internal', 0, undefined, { message: 'aborted' }, true))
      .mockResolvedValueOnce(result({ saved: 0, already_saved: 1 }));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    let out: unknown;
    await act(async () => {
      out = await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    expect(api.claimHistory).toHaveBeenCalledTimes(2);
    expect(api.claimHistory.mock.calls[0]).toEqual(api.claimHistory.mock.calls[1]);
    expect(out).toMatchObject({ saved: 0, alreadySaved: 1 });
  });

  it('a failure after the retry keeps the night and reports failed', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockRejectedValue(new KjboxError('internal', 530, undefined, {}, true));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    let out: unknown;
    await act(async () => {
      out = await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    expect(api.claimHistory).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ error: 'failed' });
    expect(h.result.current.nights.map((n) => n.night_id)).toEqual(['n1']);
  });

  it('a server answer (invalid) is not retried and reports failed', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockRejectedValue(new KjboxError('invalid', 400));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    let out: unknown;
    await act(async () => {
      out = await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    expect(api.claimHistory).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ error: 'failed' });
    expect(h.result.current.visible).toBe(true);
  });

  it('offline: sends nothing and reports offline', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    const n = h.result.current.nights[0]!;
    mockConnected = false;
    h.rerender({});
    let out: unknown;
    await act(async () => {
      out = await h.result.current.claim(n, [1]);
    });
    expect(api.claimHistory).not.toHaveBeenCalled();
    expect(out).toEqual({ error: 'offline' });
  });

  it('a double tap on Save sends one claim', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    let resolve!: (r: kjbox.HistoryClaimResult) => void;
    api.claimHistory.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { wrapper } = setup();
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    const n = h.result.current.nights[0]!;
    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    act(() => {
      p1 = h.result.current.claim(n, [1]);
      p2 = h.result.current.claim(n, [1, 2]);
    });
    await act(async () => resolve(result()));
    expect(api.claimHistory).toHaveBeenCalledTimes(1);
    expect(await p2).toEqual(await p1);
    // once it has settled, another Save of another night sends again
  });

  it('invalidates suggestions, then refetches the library and the log mirror at +10 s and +30 s', async () => {
    jest.useFakeTimers();
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockResolvedValue(result());
    const { client, wrapper } = setup();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    const keysCalled = () => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keysCalled()).toContain(JSON.stringify(suggestionsKeyFor(A)));
    const lib = JSON.stringify(libraryKeyFor(A));
    const mirror = JSON.stringify(logMirrorKeyFor(A));
    expect(keysCalled().filter((k) => k === lib)).toHaveLength(0);
    expect(CLAIM_REFETCH_DELAYS_MS).toEqual([10_000, 30_000]);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(keysCalled().filter((k) => k === lib)).toHaveLength(1);
    expect(keysCalled().filter((k) => k === mirror)).toHaveLength(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20_000);
    });
    expect(keysCalled().filter((k) => k === lib)).toHaveLength(2);
    expect(keysCalled().filter((k) => k === mirror)).toHaveLength(2);
  });

  it('a later refetch for another account is skipped (the claimer signed out)', async () => {
    jest.useFakeTimers();
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    api.claimHistory.mockResolvedValue(result());
    const { client, wrapper } = setup();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    act(() => signIn('b@example.com'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    const lib = JSON.stringify(libraryKeyFor(A));
    expect(spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))).not.toContain(lib);
  });
});

describe('account change', () => {
  it('A switching to B removes A\'s suggestions and answered nights, so B never sees A\'s nights', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('a1'), night('a2')]));
    api.claimHistory.mockResolvedValue(result());
    const { client, wrapper } = setup('a@example.com');
    renderHook(() => useClearMeOnAccountChange(), { wrapper });
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    await act(async () => {
      await h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    expect(Object.keys(useClaimAnswered.getState().byUser)).toEqual([A]);

    let resolveB!: (s: kjbox.HistorySuggestions) => void;
    api.getHistorySuggestions.mockImplementation(() => new Promise((r) => (resolveB = r)));
    act(() => signIn('b@example.com'));
    expect(client.getQueryData(suggestionsKeyFor(A))).toBeUndefined();
    expect(useClaimAnswered.getState().byUser).toEqual({});
    // B's first render, before B's own answer: nothing of A's.
    expect(h.result.current.visible).toBe(false);
    expect(h.result.current.nights).toEqual([]);
    await act(async () => resolveB(suggestions([night('b1')])));
    await waitFor(() => expect(h.result.current.nights.map((n) => n.night_id)).toEqual(['b1']));
    expect(client.getQueryCache().findAll({ queryKey: ['kjbox', A] })).toHaveLength(0);
    expect(client.getQueryData(suggestionsKeyFor(B))).toBeTruthy();
  });

  it('sign-out removes the suggestions query', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('a1')]));
    const { client, wrapper } = setup('a@example.com');
    renderHook(() => useClearMeOnAccountChange(), { wrapper });
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    act(() => useAuth.setState({ state: { status: 'signedOut' } }));
    expect(client.getQueryCache().findAll({ queryKey: ['kjbox', A] })).toHaveLength(0);
    // Only the signed-out (null key) observer is left, disabled and empty.
    expect(client.getQueryCache().findAll({ predicate: (q) => q.queryKey[0] === 'kjbox' && q.state.data !== undefined })).toHaveLength(0);
    expect(h.result.current.visible).toBe(false);
  });

  it('a claim that finishes after the account switched does not mark B\'s nights', async () => {
    api.getHistorySuggestions.mockResolvedValue(suggestions([night('n1')]));
    let resolve!: (r: kjbox.HistoryClaimResult) => void;
    api.claimHistory.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { wrapper } = setup('a@example.com');
    renderHook(() => useClearMeOnAccountChange(), { wrapper });
    const h = renderHook(() => useClaimSuggestions(), { wrapper });
    await waitFor(() => expect(h.result.current.visible).toBe(true));
    let p!: Promise<unknown>;
    act(() => {
      p = h.result.current.claim(h.result.current.nights[0]!, [1]);
    });
    act(() => signIn('b@example.com'));
    await act(async () => resolve(result()));
    await p;
    expect(useClaimAnswered.getState().byUser).toEqual({});
  });
});
