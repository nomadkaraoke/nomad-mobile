// Get this made (Phase 4b, D3): the Me shelf and screen, Make it / Request it free / dismiss with undo.
import * as decide from '@nomad/api-decide';
import * as gen from '@nomad/api-gen';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { userKeyFor } from '../../auth/userKey';
import { useGetMadeLocal } from '../../me/getMadeLocal';
import { useMakeIntent } from '../../make/intentStore';
import { useMeOutbox } from '../../me/meOutbox';
import { meQueryClient } from '../../me/queryClientRef';
import { job } from '../../test-utils/jobFixtures';
import { appRoutes } from '../../test-utils/routes';
import { appStorage } from '../../storage';
import { resetMe, signIn } from './helpers';

jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(async () => ({ status: 'ok', etag: 'e', items: [] })),
  listSetlists: jest.fn(async () => []),
  listKaraokeLog: jest.fn(async () => ({ entries: [] })),
  putKaraokeLog: jest.fn(async () => ({})),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } })),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getVoiceProfile: jest.fn(async () => null),
  getVoiceFlags: jest.fn(async () => ({ session_enabled: false, is_admin: false, voice_data: false })),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getGetMade: jest.fn(),
  dismissGetMade: jest.fn(async () => {}),
  undismissGetMade: jest.fn(async () => {}),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
  listMyJobs: jest.fn(),
  listBoardRequests: jest.fn(),
  submitSongRequest: jest.fn(),
  voteApiRequestsBoardRequestsRequestIdVotePost: jest.fn(),
}));

let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});

const api = decide as jest.Mocked<typeof decide>;
const g = gen as jest.Mocked<typeof gen>;

type Item = decide.GetMadeItem;
const item = (n: number, o: Partial<Item> = {}): Item => ({
  key: `band ${n}|song ${n}`,
  song_key: `band ${n}|song ${n}`,
  artist: `Band ${n}`,
  title: `Song ${n}`,
  why: 'saved',
  weight: 1 - n / 100,
  ...o,
});
const boardReq = (artist: string, title: string, votes: number, id = 'r1') =>
  ({ id, artist, title, status: 'open', source: 'human', vote_count: votes, created_at: '2026-10-01T00:00:00Z' }) as gen.SongRequestPublic;
const board = (requests: gen.SongRequestPublic[] = [], votedToday: boolean | null = false, yourVoteRequestId: string | null = null) => ({
  requests,
  votedToday,
  yourVoteRequestId,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockConnected = true;
  resetMe('me@example.com');
  useMakeIntent.getState().clear();
  g.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  g.listMyJobs.mockResolvedValue([]);
  g.listBoardRequests.mockResolvedValue(board());
  api.getGetMade.mockResolvedValue([item(0), item(1), item(2), item(3)]);
});

const openScreen = async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/get-made' });
  return screen.findByTestId('me-getmade-screen');
};

describe('Get this made shelf', () => {
  it('shows up to 3 rows after the setlists and See all opens the full list', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    expect(await screen.findByTestId('me-getmade-2')).toBeTruthy();
    expect(screen.queryByTestId('me-getmade-3')).toBeNull();
    const json = JSON.stringify(screen.toJSON());
    const at = ['me-setlists', 'me-getmade', 'me-all-songs'].map((id) => json.indexOf(`"testID":"${id}"`));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    fireEvent.press(screen.getByTestId('me-getmade-all'));
    expect(await screen.findByTestId('me-getmade-screen')).toBeTruthy();
    expect(await screen.findByTestId('getmade-row-3')).toBeTruthy();
  });

  it('renders nothing when there is nothing to make', async () => {
    api.getGetMade.mockResolvedValue([]);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await screen.findByTestId('me-all-songs');
    await waitFor(() => expect(api.getGetMade).toHaveBeenCalled());
    expect(screen.queryByTestId('me-getmade')).toBeNull();
  });
});

describe('Get this made screen', () => {
  it('hides a song the user already made (normalised artist|title), but not one whose job failed', async () => {
    g.listMyJobs.mockResolvedValue([
      job({ job_id: 'j1', status: 'complete', artist: 'BAND  0', title: 'Song 0!' }),
      job({ job_id: 'j2', status: 'failed', artist: 'Band 1', title: 'Song 1' }),
    ]);
    await openScreen();
    expect(await screen.findByText(/Song 1/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Song 0/)).toBeNull());
    expect(screen.getByText(/Song 2/)).toBeTruthy();
  });

  it('shows the board votes on a row that is already requested, plus the why chip and artist', async () => {
    g.listBoardRequests.mockResolvedValue(board([boardReq('band 1', 'SONG 1', 7)]));
    await openScreen();
    const row = await screen.findByTestId('getmade-row-1');
    expect(await within(row).findByText('7 votes on the board')).toBeTruthy();
    expect(within(row).getByText(/Band 1/)).toBeTruthy();
    expect(within(row).getByText('Saved')).toBeTruthy();
    expect(within(screen.getByTestId('getmade-row-0')).queryByText(/on the board/)).toBeNull();
  });

  it.each([
    ['created', { status: 'created', request: boardReq('Band 0', 'Song 0', 1) }, 'Requested · 1 vote'],
    ['already_exists', { status: 'already_exists', request: boardReq('Band 0', 'Song 0', 5) }, 'Requested · 5 votes'],
    ['vote_used', { status: 'vote_used' }, "You've used today's free vote"],
    ['submission_limit', { status: 'submission_limit' }, 'One free request a day: try tomorrow'],
  ] as const)('Request it free → %s shows its copy and never votes', async (status, outcome, copy) => {
    g.submitSongRequest.mockResolvedValue(outcome as gen.RequestOutcome);
    await openScreen();
    await screen.findByTestId('getmade-request-0');
    const boardCalls = g.listBoardRequests.mock.calls.length;
    fireEvent.press(screen.getByTestId('getmade-request-0'));
    const row = screen.getByTestId('getmade-row-0');
    expect(await within(row).findByText(copy)).toBeTruthy();
    expect(g.submitSongRequest).toHaveBeenCalledTimes(1);
    expect(g.submitSongRequest).toHaveBeenCalledWith('Band 0', 'Song 0');
    expect(g.voteApiRequestsBoardRequestsRequestIdVotePost).not.toHaveBeenCalled();
    // Every board answer refreshes the board's vote state, including the daily limits.
    await waitFor(() => expect(g.listBoardRequests.mock.calls.length).toBeGreaterThan(boardCalls));
    expect(screen.queryByTestId('getmade-request-0')).toBeNull();
    if (status === 'vote_used' || status === 'submission_limit') expect(within(row).queryByText(/Requested/)).toBeNull();
  });

  it('with today\'s vote already spent elsewhere, Request it free is off up front (no 409 round trip)', async () => {
    g.listBoardRequests.mockResolvedValue(board([boardReq('Band 1', 'Song 1', 3, 'mine')], true, 'mine'));
    await openScreen();
    const row0 = await screen.findByTestId('getmade-row-0');
    expect(await within(row0).findByText("You've used today's free vote")).toBeTruthy();
    expect(screen.queryByTestId('getmade-request-0')).toBeNull();
    // The row the vote went to reads as requested.
    expect(within(screen.getByTestId('getmade-row-1')).getByText('Requested · 3 votes')).toBeTruthy();
    expect(g.submitSongRequest).not.toHaveBeenCalled();
  });

  it('dismiss hides the row at once and queues it; Undo brings it back and queues the undo', async () => {
    await openScreen();
    await screen.findByText(/Song 0/);
    fireEvent.press(screen.getByTestId('getmade-dismiss-0'));
    expect(screen.queryByText(/Song 0/)).toBeNull();
    expect(screen.getByTestId('getmade-toast')).toBeTruthy();
    await act(() => useMeOutbox.idle());
    expect(api.dismissGetMade).toHaveBeenCalledWith('band 0|song 0');
    fireEvent.press(screen.getByTestId('getmade-undo'));
    expect(await screen.findByText(/Song 0/)).toBeTruthy();
    expect(screen.queryByTestId('getmade-toast')).toBeNull();
    await act(() => useMeOutbox.idle());
    expect(api.undismissGetMade).toHaveBeenCalledWith('band 0|song 0');
  });

  it('dismiss while offline stays queued (latest wins) and the row stays hidden', async () => {
    api.dismissGetMade.mockRejectedValue(new decide.ApiError(0, 'offline'));
    await openScreen();
    await screen.findByText(/Song 1/);
    fireEvent.press(screen.getByTestId('getmade-dismiss-1'));
    await act(() => useMeOutbox.idle());
    expect(useMeOutbox.getState().items).toEqual([expect.objectContaining({ key: 'dismiss:band 1|song 1', op: 'dismiss', dismissed: true })]);
    expect(screen.queryByText(/Song 1/)).toBeNull();
  });

  it('the undo toast goes away after 5 s', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      await openScreen();
      await screen.findByText(/Song 0/);
      fireEvent.press(screen.getByTestId('getmade-dismiss-0'));
      expect(screen.getByTestId('getmade-toast')).toBeTruthy();
      act(() => jest.advanceTimersByTime(5_100));
      expect(screen.queryByTestId('getmade-toast')).toBeNull();
      expect(screen.queryByText(/Song 0/)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('offline shows the last (cached) list with Make it and Request it free disabled', async () => {
    mockConnected = false;
    api.getGetMade.mockRejectedValue(new decide.ApiError(0, 'offline'));
    appStorage.set(`me.getmade.v1.${userKeyFor('me@example.com')}`, JSON.stringify({ items: [item(0)], savedAt: Date.now() - 3_600_000 }));
    await openScreen();
    expect(await screen.findByText(/Song 0/)).toBeTruthy();
    expect(screen.getByTestId('getmade-make-0')).toBeDisabled();
    expect(screen.getByTestId('getmade-request-0')).toBeDisabled();
    fireEvent.press(screen.getByTestId('getmade-request-0'));
    fireEvent.press(screen.getByTestId('getmade-make-0'));
    expect(g.submitSongRequest).not.toHaveBeenCalled();
    expect(useMakeIntent.getState().intent).toBeNull();
  });

  it('Make it on a catalogued song sets an identified intent and opens the make flow', async () => {
    await openScreen();
    fireEvent.press(await screen.findByTestId('getmade-make-0'));
    expect(useMakeIntent.getState().intent).toMatchObject({ source: 'identified', songKey: 'band 0|song 0', artist: 'Band 0', title: 'Song 0' });
  });

  it('Make it on an uncatalogued (u:) song sets a typed intent', async () => {
    api.getGetMade.mockResolvedValue([item(0, { key: 'u:odd band|odd tune', song_key: null, artist: 'Odd Band', title: 'Odd Tune', why: 'sung' })]);
    await openScreen();
    const row = await screen.findByTestId('getmade-row-0');
    expect(within(row).getByText('You sang it')).toBeTruthy();
    fireEvent.press(screen.getByTestId('getmade-make-0'));
    expect(useMakeIntent.getState().intent).toMatchObject({ source: 'typed', artist: 'Odd Band', title: 'Odd Tune' });
    expect(useMakeIntent.getState().intent?.songKey).toBeUndefined();
  });

  it('signing out drops the cached list, the board vote state and this session\'s dismissals', async () => {
    await openScreen();
    await screen.findByText(/Song 0/);
    fireEvent.press(screen.getByTestId('getmade-dismiss-0'));
    const cacheKey = `me.getmade.v1.${userKeyFor('me@example.com')}`;
    expect(appStorage.getString(cacheKey)).toBeTruthy();
    await waitFor(() => expect(meQueryClient()?.getQueryData(['gen', 'requests-board'])).toBeTruthy());
    act(() => useAuth.setState({ state: { status: 'signedOut' } }));
    expect(meQueryClient()?.getQueryData(['gen', 'requests-board'])).toBeUndefined();
    expect(appStorage.getString(cacheKey)).toBeUndefined();
    expect(useGetMadeLocal.getState().dismissed).toEqual({});
    expect(useGetMadeLocal.getState().toast).toBeNull();
  });

  it('switching account purges the previous person\'s list, dismissals and board state', async () => {
    g.listBoardRequests.mockResolvedValue(board([], true, null));
    await openScreen();
    await screen.findByText(/Song 0/);
    fireEvent.press(screen.getByTestId('getmade-dismiss-0'));
    const oldKey = `me.getmade.v1.${userKeyFor('me@example.com')}`;
    expect(appStorage.getString(oldKey)).toBeTruthy();
    api.getGetMade.mockResolvedValue([item(7)]);
    g.listBoardRequests.mockResolvedValue(board());
    act(() => signIn('other@example.com'));
    expect(appStorage.getString(oldKey)).toBeUndefined();
    expect(useGetMadeLocal.getState().dismissed).toEqual({});
    expect(await screen.findByText(/Song 7/)).toBeTruthy();
    expect(screen.queryByText(/Song 1/)).toBeNull();
    // The old account's spent vote doesn't carry over.
    await waitFor(() => expect(screen.getByTestId('getmade-request-0')).toBeTruthy());
  });

  it('a double tap on Request it free sends one submit', async () => {
    let resolve!: (o: gen.RequestOutcome) => void;
    g.submitSongRequest.mockImplementation(() => new Promise((r) => (resolve = r)));
    await openScreen();
    const btn = await screen.findByTestId('getmade-request-0');
    fireEvent.press(btn);
    fireEvent.press(screen.getByTestId('getmade-request-0'));
    expect(g.submitSongRequest).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ status: 'created', request: boardReq('Band 0', 'Song 0', 1) }));
    expect(await screen.findByText('Requested · 1 vote')).toBeTruthy();
    expect(g.submitSongRequest).toHaveBeenCalledTimes(1);
  });

  it('a failed request shows the error and keeps the button for a retry', async () => {
    g.submitSongRequest.mockRejectedValueOnce(new gen.ApiError(500, 'boom'));
    g.submitSongRequest.mockResolvedValueOnce({ status: 'created', request: boardReq('Band 0', 'Song 0', 2) });
    await openScreen();
    fireEvent.press(await screen.findByTestId('getmade-request-0'));
    expect(await screen.findByText("Couldn't send the request. Try again.")).toBeTruthy();
    expect(screen.getByTestId('getmade-request-0')).not.toBeDisabled();
    fireEvent.press(screen.getByTestId('getmade-request-0'));
    expect(await screen.findByText('Requested · 2 votes')).toBeTruthy();
    expect(g.submitSongRequest).toHaveBeenCalledTimes(2);
  });

  it('a request that answers after the account changed is dropped (no outcome, no board refresh)', async () => {
    let resolve!: (o: gen.RequestOutcome) => void;
    g.submitSongRequest.mockImplementation(() => new Promise((r) => (resolve = r)));
    await openScreen();
    fireEvent.press(await screen.findByTestId('getmade-request-0'));
    act(() => signIn('other@example.com'));
    const boardCalls = g.listBoardRequests.mock.calls.length;
    await act(async () => resolve({ status: 'created', request: boardReq('Band 0', 'Song 0', 1) }));
    expect(useGetMadeLocal.getState().requests).toEqual({});
    await act(async () => {
      for (let n = 0; n < 5; n++) await Promise.resolve();
    });
    expect(g.listBoardRequests.mock.calls.length).toBe(boardCalls);
  });

  it('a failed load with nothing cached says so and Retry loads the list', async () => {
    api.getGetMade.mockRejectedValueOnce(new decide.ApiError(503, { code: 'warming_up' }));
    await openScreen();
    expect(await screen.findByTestId('getmade-error')).toHaveTextContent("Couldn't load these songs right now.");
    expect(screen.queryByTestId('getmade-empty')).toBeNull();
    fireEvent.press(screen.getByTestId('getmade-retry'));
    expect(await screen.findByText(/Song 0/)).toBeTruthy();
    expect(screen.queryByTestId('getmade-error')).toBeNull();
  });

  it('the shelf shows the load error with Retry', async () => {
    api.getGetMade.mockRejectedValueOnce(new decide.ApiError(503, { code: 'warming_up' }));
    renderRouter(appRoutes(), { initialUrl: '/me' });
    expect(await screen.findByTestId('me-getmade-error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('me-getmade-retry'));
    expect(await screen.findByTestId('me-getmade-0')).toBeTruthy();
  });

  it('Make it waits for the user\'s jobs (pending or failed) so a made song can\'t be made twice', async () => {
    let resolveJobs!: (j: gen.JobSummary[]) => void;
    g.listMyJobs.mockImplementation(() => new Promise((r) => (resolveJobs = r)));
    await openScreen();
    await screen.findByText(/Song 0/);
    expect(screen.getByTestId('getmade-make-0')).toBeDisabled();
    fireEvent.press(screen.getByTestId('getmade-make-0'));
    expect(useMakeIntent.getState().intent).toBeNull();
    await act(async () => resolveJobs([]));
    await waitFor(() => expect(screen.getByTestId('getmade-make-0')).not.toBeDisabled());
  });

  it('Make it stays off when the jobs list fails', async () => {
    g.listMyJobs.mockRejectedValue(new gen.ApiError(500, 'x'));
    await openScreen();
    await screen.findByText(/Song 0/);
    await waitFor(() => expect(g.listMyJobs).toHaveBeenCalled());
    await act(async () => {
      for (let n = 0; n < 5; n++) await Promise.resolve();
    });
    expect(screen.getByTestId('getmade-make-0')).toBeDisabled();
  });

  it('a decide outage (status 0) with the network up keeps Make it and Request it free on', async () => {
    api.getGetMade.mockRejectedValue(new decide.ApiError(0, 'unreachable'));
    appStorage.set(`me.getmade.v1.${userKeyFor('me@example.com')}`, JSON.stringify({ items: [item(0)], savedAt: Date.now() - 3_600_000 }));
    await openScreen();
    await screen.findByText(/Song 0/);
    await waitFor(() => expect(api.getGetMade).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('getmade-make-0')).not.toBeDisabled());
    expect(screen.getByTestId('getmade-request-0')).not.toBeDisabled();
    expect(screen.queryByTestId('getmade-offline')).toBeNull();
  });

  it('an undone row is no longer pinned once the server lists it again', async () => {
    await openScreen();
    await screen.findByText(/Song 0/);
    fireEvent.press(screen.getByTestId('getmade-dismiss-0'));
    await act(() => useMeOutbox.idle());
    fireEvent.press(screen.getByTestId('getmade-undo'));
    await act(() => useMeOutbox.idle());
    // The undo's send invalidates the list; the refetch includes the song again.
    await waitFor(() => expect(useGetMadeLocal.getState().dismissed['band 0|song 0']).toBeUndefined());
    expect(screen.getByText(/Song 0/)).toBeTruthy();
  });

  it('a failed background refetch of jobs (data kept) leaves Make it on', async () => {
    await openScreen();
    await screen.findByText(/Song 0/);
    await waitFor(() => expect(screen.getByTestId('getmade-make-0')).not.toBeDisabled());
    g.listMyJobs.mockRejectedValue(new gen.ApiError(500, 'x'));
    const calls = g.listMyJobs.mock.calls.length;
    // renderRouter runs on fake timers: kick the refetch, then step through react-query's retries until it errors.
    void meQueryClient()?.refetchQueries({ queryKey: ['jobs'] });
    for (let n = 0; n < 6; n++) {
      await act(async () => {
        jest.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
    }
    await waitFor(() => expect(meQueryClient()?.getQueryState(['jobs', 'me@example.com'])?.status).toBe('error'));
    expect(g.listMyJobs.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByTestId('getmade-make-0')).not.toBeDisabled();
  });

  it('while Retry is fetching, the error line is hidden and the spinner shows', async () => {
    let resolve!: (v: decide.GetMadeItem[]) => void;
    api.getGetMade.mockRejectedValueOnce(new decide.ApiError(503, { code: 'warming_up' }));
    api.getGetMade.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await openScreen();
    await screen.findByTestId('getmade-error');
    fireEvent.press(screen.getByTestId('getmade-retry'));
    await waitFor(() => expect(screen.queryByTestId('getmade-error')).toBeNull());
    expect(screen.getByTestId('getmade-loading')).toBeTruthy();
    await act(async () => resolve([item(0)]));
    expect(await screen.findByText(/Song 0/)).toBeTruthy();
  });

  it('the shelf hides its error while Retry is fetching', async () => {
    let resolve!: (v: decide.GetMadeItem[]) => void;
    api.getGetMade.mockRejectedValueOnce(new decide.ApiError(503, { code: 'warming_up' }));
    api.getGetMade.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    renderRouter(appRoutes(), { initialUrl: '/me' });
    fireEvent.press(await screen.findByTestId('me-getmade-retry'));
    await waitFor(() => expect(screen.queryByTestId('me-getmade-error')).toBeNull());
    await act(async () => resolve([item(0)]));
    expect(await screen.findByTestId('me-getmade-0')).toBeTruthy();
  });
});
