// Apple Music on Me -> "Your music profile": connect through decide web's MusicKit page, read status, reconnect.
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { appleMusicStatus } from '../discover/profile/useAppleMusic';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
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
  disconnectMusicService: jest.fn(async () => undefined),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), openBrowserAsync: jest.fn() }));

const m = (f: unknown) => f as jest.Mock;
const browser = WebBrowser as jest.Mocked<typeof WebBrowser>;
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
  m(decide.listMusicServices).mockImplementation(async () => rows);
  m(decide.startAppleMusicLink).mockResolvedValue(LINK);
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
  it('connects through the one-time link in an auth session, then shows the library being read', async () => {
    browser.openAuthSessionAsync.mockImplementation(async () => {
      rows = [apple({ last_sync_at: null })];
      return { type: 'success', url: 'nomadkaraoke://music-connected?service=apple_music' };
    });
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    await waitFor(() =>
      expect(browser.openAuthSessionAsync).toHaveBeenCalledWith(LINK.connect_url, 'nomadkaraoke://music-connected'),
    );
    expect(await screen.findByTestId('profile-apple-reading')).toBeTruthy();
    expect(screen.queryByTestId('profile-apple-connect')).toBeNull();
  });

  it('a closed browser leaves it not connected, with nothing to report', async () => {
    browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    await waitFor(() => expect(decide.listMusicServices).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('profile-apple-connect')).toBeTruthy();
    expect(screen.queryByTestId('profile-apple-failed')).toBeNull();
  });

  it('says so when the link cannot be made', async () => {
    m(decide.startAppleMusicLink).mockRejectedValue(new Error('offline'));
    open();

    fireEvent.press(await screen.findByTestId('profile-apple-connect'));

    expect(await screen.findByTestId('profile-apple-failed')).toBeTruthy();
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
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
    browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
    open();

    expect(await screen.findByTestId('profile-apple-expired')).toBeTruthy();
    fireEvent.press(screen.getByTestId('profile-apple-reconnect'));

    await waitFor(() => expect(browser.openAuthSessionAsync).toHaveBeenCalled());
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
