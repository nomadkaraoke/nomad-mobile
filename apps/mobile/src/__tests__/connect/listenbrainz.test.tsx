// Connect -> ListenBrainz: one-tap MetaBrainz sign-in, username connect, then the sync wait (Phase 3b Task 23).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { syncPollConfig } from '../../discover/connect/useSyncWait';
import { gen, session } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: true, isInternetReachable: true }) };
});
jest.mock('../../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => false,
  requestAppleMusicUserToken: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})), openAuthSessionAsync: jest.fn() }));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  connectListenBrainz: jest.fn(),
  startListenBrainzOAuth: jest.fn(),
  triggerSync: jest.fn(),
  getSyncStatus: jest.fn(),
  getServicesSummary: jest.fn(),
  getServiceCapabilities: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const m = (f: unknown) => f as jest.Mock;
const AUTH_URL = 'https://metabrainz.org/oauth2/authorize?client_id=fixture';
const RETURN = 'nomadkaraoke://services/listenbrainz';

let sources: decide.SourceSummary[];
let oauthOn: boolean;

const completedJob = (over: Partial<decide.SyncResultItem> = {}) => ({
  services: [],
  active_job: {
    job_id: 'job-1',
    status: 'completed',
    progress: null,
    results: [
      {
        service_type: 'listenbrainz',
        tracks_fetched: 40,
        tracks_matched: 12,
        user_songs_created: 10,
        user_songs_updated: 2,
        artists_stored: 5,
        error: null,
        ...over,
      },
    ],
    error: null,
    created_at: '2026-10-22T10:00:00Z',
    completed_at: '2026-10-22T10:01:00Z',
  },
});
const runningJob = () => ({ ...completedJob(), active_job: { ...completedJob().active_job, status: 'in_progress', results: null } });

const open = async (url = '/discover/connect/listenbrainz') => {
  renderRouter(appRoutes(), { initialUrl: url });
  jest.useRealTimers();
  return screen.findByTestId('connect-lb-username');
};

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  syncPollConfig.intervalMs = 5;
  syncPollConfig.timeoutMs = 2_000;
  sources = [];
  oauthOn = true;
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  m(decide.getServicesSummary).mockImplementation(async () => ({ sources, capabilities: {} }));
  m(decide.getServiceCapabilities).mockImplementation(async () => ({ screenshot_import: false, listenbrainz_oauth: oauthOn }));
  m(decide.startListenBrainzOAuth).mockResolvedValue({ auth_url: AUTH_URL });
  m(decide.triggerSync).mockResolvedValue({ job_id: 'job-1', status: 'pending', message: '' });
  m(decide.getSyncStatus).mockReset().mockResolvedValueOnce(runningJob()).mockResolvedValue(completedJob());
  m(decide.connectListenBrainz).mockResolvedValue({});
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('ListenBrainz connect', () => {
  it('oauth button hidden when capability off', async () => {
    oauthOn = false;
    await open();
    await waitFor(() => expect(decide.getServiceCapabilities).toHaveBeenCalled());
    expect(screen.queryByTestId('connect-lb-oauth')).toBeNull();
    // The username way in is always there, with the sign-up help and the Spotify guide.
    expect(screen.getByTestId('connect-lb-submit')).toBeTruthy();
    expect(screen.getByTestId('connect-lb-signup')).toBeTruthy();
    expect(screen.getByTestId('connect-lb-spotify-guide')).toBeTruthy();
  });

  it('oauth success invalidates and syncs', async () => {
    m(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
      // decide stored the OAuth connection before redirecting back.
      sources = [{ source: 'listenbrainz', connected: true, username: 'fixture-user', auth: 'oauth', status: 'ok' }];
      return { type: 'success', url: `${RETURN}?status=connected` };
    });
    await open();
    const summaryCalls = m(decide.getServicesSummary).mock.calls.length;

    await act(async () => fireEvent.press(await screen.findByTestId('connect-lb-oauth')));

    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(AUTH_URL, RETURN);
    await waitFor(() => expect(decide.triggerSync).toHaveBeenCalledTimes(1));
    expect(m(decide.getServicesSummary).mock.calls.length).toBeGreaterThan(summaryCalls);
    // The linked account is shown prominently, so a wrong account is obvious.
    expect(await screen.findByTestId('connect-lb-account')).toBeTruthy();
    expect(screen.getByText(/fixture-user/)).toBeTruthy();
    expect(await screen.findByText('Added 5 artists and 12 songs you know')).toBeTruthy();
  });

  it('oauth error shows coded copy', async () => {
    m(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'success', url: `${RETURN}?status=error&reason=validate_failed` });
    await open();

    await act(async () => fireEvent.press(await screen.findByTestId('connect-lb-oauth')));

    expect(await screen.findByTestId('connect-lb-oauth-error')).toBeTruthy();
    expect(screen.getByText(/sign in at listenbrainz\.org once/i)).toBeTruthy();
    expect(decide.triggerSync).not.toHaveBeenCalled();
  });

  it('oauth closed without finishing stays idle', async () => {
    m(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'cancel' });
    await open();

    await act(async () => fireEvent.press(await screen.findByTestId('connect-lb-oauth')));

    await waitFor(() => expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalled());
    expect(screen.queryByTestId('connect-lb-oauth-error')).toBeNull();
    expect(decide.triggerSync).not.toHaveBeenCalled();
  });

  it('a cold-start return applies the result from the route', async () => {
    await open('/discover/connect/listenbrainz?status=error&reason=denied');
    expect(await screen.findByTestId('connect-lb-oauth-error')).toBeTruthy();
    expect(screen.getByText(/didn't allow/i)).toBeTruthy();
  });

  it('username connect then sync result', async () => {
    const input = await open();
    await act(async () => fireEvent.changeText(input, '  fixture-user '));
    await act(async () => fireEvent.press(screen.getByTestId('connect-lb-submit')));

    expect(decide.connectListenBrainz).toHaveBeenCalledWith('fixture-user');
    await waitFor(() => expect(decide.triggerSync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Added 5 artists and 12 songs you know')).toBeTruthy();
    expect(decide.getSyncStatus).toHaveBeenCalledTimes(2);
  });

  it('unknown username shows not-found copy and no sync', async () => {
    m(decide.connectListenBrainz).mockRejectedValue(new decide.ApiError(422, 'User not found'));
    const input = await open();
    await act(async () => fireEvent.changeText(input, 'e2e-nobody'));
    await act(async () => fireEvent.press(screen.getByTestId('connect-lb-submit')));

    expect(await screen.findByText("We couldn't find that username. Check the spelling and try again.")).toBeTruthy();
    expect(decide.triggerSync).not.toHaveBeenCalled();
  });

  it('a sync that outlasts the wait says it carries on in the background', async () => {
    syncPollConfig.timeoutMs = 30;
    m(decide.getSyncStatus).mockReset().mockResolvedValue({
      ...runningJob(),
      active_job: { ...runningJob().active_job, status: 'stalled' },
    });
    const input = await open();
    await act(async () => fireEvent.changeText(input, 'fixture-user'));
    await act(async () => fireEvent.press(screen.getByTestId('connect-lb-submit')));

    expect(await screen.findByTestId('connect-sync-slow')).toBeTruthy();
  });

  it('signup opens the ListenBrainz login in the in-app browser', async () => {
    await open();
    await act(async () => fireEvent.press(screen.getByTestId('connect-lb-signup')));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://listenbrainz.org/login/');
    expect(screen.getByText(/Verify your email/)).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId('connect-lb-spotify-guide')));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://listenbrainz.org/settings/music-services/details/');
  });
});
