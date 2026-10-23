// Apple Music on Me -> "Your music profile": connect through decide web's MusicKit page, read status, reconnect.
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { AppState, Linking } from 'react-native';

import { useAuth } from '../auth/store';
import { appleMusicStatus } from '../discover/profile/useAppleMusic';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  // Phase 3b: the Improve card and the profile's Connected section read the services summary.
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } })),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getRecommendationsV2: jest.fn(async () => ({ sections: [], filters_applied: {}, next_cursor: null, has_profile: true, catalog_run: 'r' })),
  getPreferences: jest.fn(async () => ({ genres: [], decades: [], energy_preference: null })),
  listMyArtists: jest.fn(async () => ({ artists: [], total: 0, page: 1, per_page: 50, has_more: false })),
  listLovedSongs: jest.fn(async () => []),
  listHiddenSongs: jest.fn(async () => []),
  listMusicServices: jest.fn(),
  startAppleMusicLink: jest.fn(),
  getAppleMusicAppDeveloperToken: jest.fn(async () => 'dev-token'),
  connectAppleMusic: jest.fn(async () => undefined),
  disconnectMusicService: jest.fn(async () => undefined),
}));
const mockNativeAuth = { available: false, request: jest.fn() };
jest.mock('../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => mockNativeAuth.available,
  requestAppleMusicUserToken: (t: string) => mockNativeAuth.request(t),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));

const m = (f: unknown) => f as jest.Mock;
let openURL: jest.SpyInstance;
let appStateListener: ((s: string) => void) | undefined;
const backToApp = () => act(() => appStateListener?.('active'));
const apple = (over: Partial<decide.ConnectedServiceResponse> = {}): decide.ConnectedServiceResponse => ({
  service_type: 'apple_music',
  service_username: 'Apple Music',
  last_sync_at: '2026-10-22T16:00:00Z',
  sync_status: 'idle',
  sync_error: null,
  tracks_synced: 40,
  songs_synced: 120,
  ...over,
});
const LINK = { connect_url: 'https://decide.test/en/connect/apple-music?state=s&return=app', expires_in: 600 };

let rows: decide.ConnectedServiceResponse[];
const open = () => renderRouter(appRoutes(), { initialUrl: '/me/music-profile' });

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  rows = [];
  mockNativeAuth.available = false;
  m(decide.listMusicServices).mockImplementation(async () => rows);
  m(decide.startAppleMusicLink).mockResolvedValue(LINK);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListener = fn as (s: string) => void;
    return { remove: jest.fn() } as never;
  });
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('appleMusicStatus', () => {
  it.each([
    [undefined, 'notConnected'],
    [apple(), 'connected'],
    [apple({ sync_status: 'syncing' }), 'reading'],
    [apple({ last_sync_at: null }), 'reading'], // connected, first read not started yet
    [apple({ sync_status: 'error', sync_error: 'expired' }), 'expired'],
  ])('%#', (service, status) => {
    expect(appleMusicStatus(service)).toBe(status);
  });
});

describe('Apple Music on the music profile', () => {
  // Not an in-app tab: Android custom tabs drop Apple's popup opener, so authorize() never finished (Pixel, Firefox).
  it('opens the one-time link in the phone browser, and on return shows the library being read', async () => {
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    await waitFor(() => expect(openURL).toHaveBeenCalledWith(LINK.connect_url));
    rows = [apple({ last_sync_at: null })];
    await backToApp();
    expect(await screen.findByTestId('profile-apple-reading')).toBeTruthy();
    expect(screen.queryByTestId('profile-apple-connect')).toBeNull();
  });

  it('coming back without connecting leaves it not connected, with nothing to report', async () => {
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));
    await waitFor(() => expect(openURL).toHaveBeenCalled());
    await backToApp();

    await waitFor(() => expect(decide.listMusicServices).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('profile-apple-connect')).toBeTruthy();
    expect(screen.queryByTestId('profile-apple-failed')).toBeNull();
  });

  it('says so when the link cannot be made', async () => {
    m(decide.startAppleMusicLink).mockRejectedValue(new Error('offline'));
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    expect(await screen.findByTestId('profile-apple-failed')).toBeTruthy();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('shows the song count once read, and disconnects', async () => {
    rows = [apple()];
    open();

    expect(await screen.findByTestId('profile-apple-connected')).toHaveTextContent('Connected · 120 songs read');
    m(decide.disconnectMusicService).mockImplementation(async () => {
      rows = [];
    });
    fireEvent.press(screen.getByTestId('profile-apple-disconnect'));

    await waitFor(() => expect(decide.disconnectMusicService).toHaveBeenCalledWith('apple_music'));
    expect(await screen.findByTestId('profile-apple-connect')).toBeTruthy();
  });

  it('an expired sign-in offers to reconnect', async () => {
    rows = [apple({ sync_status: 'error', sync_error: 'Apple Music sign-in expired - reconnect Apple Music' })];
    open();

    expect(await screen.findByTestId('profile-apple-expired')).toBeTruthy();
    fireEvent.press(screen.getByTestId('profile-apple-reconnect'));

    await waitFor(() => expect(openURL).toHaveBeenCalledWith(LINK.connect_url));
  });

  it('refreshes the picks when the first read finishes', async () => {
    rows = [apple({ sync_status: 'syncing', last_sync_at: null })];
    open();
    expect(await screen.findByTestId('profile-apple-reading')).toBeTruthy();
    const before = m(decide.listMyArtists).mock.calls.length;

    rows = [apple()];
    expect(await screen.findByTestId('profile-apple-connected', {}, { timeout: 8000 })).toBeTruthy();
    await waitFor(() => expect(m(decide.listMyArtists).mock.calls.length).toBeGreaterThan(before));
  });
});

// Andrew (iPad): "it launched a web browser rather than doing it natively". On iOS, MusicKit does it in the app.
describe('Apple Music on iOS (native MusicKit)', () => {
  beforeEach(() => {
    mockNativeAuth.available = true;
  });

  it('gets a user token natively and connects without a browser', async () => {
    mockNativeAuth.request.mockResolvedValue({ status: 'authorized', token: 'mut' });
    m(decide.connectAppleMusic).mockImplementation(async () => {
      rows = [apple({ last_sync_at: null })];
    });
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    await waitFor(() => expect(decide.connectAppleMusic).toHaveBeenCalledWith('mut'));
    expect(mockNativeAuth.request).toHaveBeenCalledWith('dev-token');
    expect(openURL).not.toHaveBeenCalled();
    expect(await screen.findByTestId('profile-apple-reading')).toBeTruthy();
  });

  it('explains how to allow access when Apple Music access is denied', async () => {
    mockNativeAuth.request.mockResolvedValue({ status: 'denied' });
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    expect(await screen.findByTestId('profile-apple-denied')).toBeTruthy();
    expect(decide.connectAppleMusic).not.toHaveBeenCalled();
  });

  it('says a subscription is needed when decide (Apple) refuses the token', async () => {
    mockNativeAuth.request.mockResolvedValue({ status: 'authorized', token: 'mut' });
    m(decide.connectAppleMusic).mockRejectedValue(new decide.ApiError(422, 'refused'));
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    expect(await screen.findByTestId('profile-apple-noSubscription')).toBeTruthy();
  });

  it('reports other native failures', async () => {
    mockNativeAuth.request.mockResolvedValue({ status: 'error', code: 'userNotSignedIn' });
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    expect(await screen.findByTestId('profile-apple-failed')).toBeTruthy();
  });
});
