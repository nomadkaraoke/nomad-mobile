// Me -> Your music profile -> "Connected": every connected or imported source, its status, counts and actions (Phase 3b Task 18).
import * as decide from '@nomad/api-decide';
import { IntlProvider } from '@nomad/i18n';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Linking, View, type AlertButton } from 'react-native';

import { useAuth } from '../../auth/store';
import { ImportResult } from '../../discover/connect/ImportResult';
import { gen, session } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';

jest.setTimeout(20_000);

let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});
jest.mock('../../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => false,
  requestAppleMusicUserToken: jest.fn(),
}));

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
  listMusicServices: jest.fn(async () => []),
  getServicesSummary: jest.fn(),
  getServiceCapabilities: jest.fn(async () => ({ screenshot_import: true, listenbrainz_oauth: false })),
  removeSourceData: jest.fn(async () => ({ removed_songs: 40, removed_artists: 12 })),
  startAppleMusicLink: jest.fn(async () => ({ connect_url: 'https://decide.test/en/connect/apple-music?state=s', expires_in: 600 })),
  getAppleMusicAppDeveloperToken: jest.fn(async () => 'dev-token'),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const m = (f: unknown) => f as jest.Mock;
const DAY = 24 * 60 * 60 * 1000;
const source = (over: Partial<decide.SourceSummary>): decide.SourceSummary => ({
  source: 'listenbrainz',
  connected: true,
  username: 'fixture-user',
  artists: 12,
  songs: 40,
  last_import_at: null,
  status: 'ok',
  auth: 'username',
  pending_listenbrainz_import: null,
  ...over,
});

let sources: decide.SourceSummary[];
const open = () =>
  renderRouter(
    {
      ...appRoutes(),
      'discover/connect/listenbrainz': () => <View testID="stub-listenbrainz" />,
      'discover/connect/lastfm': () => <View testID="stub-lastfm" />,
    },
    { initialUrl: '/me/music-profile' },
  );

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockConnected = true;
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  sources = [];
  m(decide.getServicesSummary).mockImplementation(async () => ({ sources, capabilities: { screenshot_import: true, listenbrainz_oauth: false } }));
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('Connected sources on the music profile', () => {
  it('shows each source with its name, status, counts and last import', async () => {
    sources = [
      source({ source: 'lastfm', artists: 1, songs: 1, last_import_at: new Date(Date.now() - 3 * DAY).toISOString() }),
      source({ source: 'spotify_export', connected: false, artists: 30, songs: 250, last_import_at: new Date().toISOString(), status: 'importing' }),
    ];
    open();

    const lastfm = within(await screen.findByTestId('connected-row-lastfm'));
    expect(lastfm.getByText('Last.fm')).toBeTruthy();
    expect(lastfm.getByText('Up to date')).toBeTruthy();
    expect(lastfm.getByText('1 artist · 1 song')).toBeTruthy();
    expect(lastfm.getByText('Last import 3 days ago')).toBeTruthy();
    const exp = within(screen.getByTestId('connected-row-spotify_export'));
    expect(exp.getByText('Spotify history')).toBeTruthy();
    expect(exp.getByText('Importing')).toBeTruthy();
    expect(exp.getByText('30 artists · 250 songs')).toBeTruthy();
    expect(exp.getByText('Last import today')).toBeTruthy();
  });

  it('says nothing is connected yet, and Add more opens the hub', async () => {
    open();

    expect(await screen.findByTestId('connected-empty')).toBeTruthy();
    fireEvent.press(screen.getByTestId('connect-add-more'));
    expect(await screen.findByTestId('connect-hub')).toBeTruthy();
  });

  it('remove confirms then calls removeSourceData and invalidates', async () => {
    sources = [source({ source: 'screenshot', connected: false })];
    const alert = jest.spyOn(Alert, 'alert');
    open();

    fireEvent.press(await screen.findByTestId('connected-remove-screenshot'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(decide.removeSourceData).not.toHaveBeenCalled();
    const [title, , buttons] = alert.mock.calls[0]! as [string, string, AlertButton[]];
    expect(title).toBe('Remove Screenshots?');

    const before = m(decide.getServicesSummary).mock.calls.length;
    sources = [];
    await act(async () => buttons.find((b) => b.style === 'destructive')?.onPress?.());

    expect(decide.removeSourceData).toHaveBeenCalledWith('screenshot');
    await waitFor(() => expect(m(decide.getServicesSummary).mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByTestId('connected-empty')).toBeTruthy();
  });

  it('cancelling the confirm removes nothing', async () => {
    sources = [source({ source: 'lastfm' })];
    const alert = jest.spyOn(Alert, 'alert');
    open();

    fireEvent.press(await screen.findByTestId('connected-remove-lastfm'));
    const buttons = alert.mock.calls[0]![2] as AlertButton[];
    await act(async () => buttons.find((b) => b.style === 'cancel')?.onPress?.());

    expect(decide.removeSourceData).not.toHaveBeenCalled();
  });

  it('a failed remove says so', async () => {
    sources = [source({ source: 'lastfm' })];
    m(decide.removeSourceData).mockRejectedValueOnce(new decide.ApiError(503, 'down'));
    const alert = jest.spyOn(Alert, 'alert');
    open();

    fireEvent.press(await screen.findByTestId('connected-remove-lastfm'));
    await act(async () => (alert.mock.calls[0]![2] as AlertButton[]).find((b) => b.style === 'destructive')?.onPress?.());

    expect(await screen.findByTestId('connected-error')).toBeTruthy();
  });

  it('needs_reconnect shows reconnect', async () => {
    sources = [source({ source: 'listenbrainz', status: 'needs_reconnect' }), source({ source: 'lastfm' })];
    open();

    const row = within(await screen.findByTestId('connected-row-listenbrainz'));
    expect(row.getByText('Needs reconnecting')).toBeTruthy();
    expect(screen.queryByTestId('connected-reconnect-lastfm')).toBeNull();

    fireEvent.press(screen.getByTestId('connected-reconnect-listenbrainz'));
    expect(await screen.findByTestId('stub-listenbrainz')).toBeTruthy();
  });

  it('Apple Music reconnects in place through MusicKit, not via the hub', async () => {
    sources = [source({ source: 'apple_music', status: 'needs_reconnect', auth: 'oauth' })];
    open();

    fireEvent.press(await screen.findByTestId('connected-reconnect-apple_music'));

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://decide.test/en/connect/apple-music?state=s'));
    expect(screen.queryByTestId('connect-hub')).toBeNull();
  });

  it('an unknown status reads as up to date', async () => {
    sources = [source({ source: 'lastfm', status: 'paused' as never })];
    open();

    const row = within(await screen.findByTestId('connected-row-lastfm'));
    expect(row.getByText('Up to date')).toBeTruthy();
  });

  it('offline with nothing loaded says so instead of spinning', async () => {
    mockConnected = false;
    m(decide.getServicesSummary).mockImplementation(() => new Promise(() => {}));
    open();

    expect(await screen.findByTestId('connected-offline')).toBeTruthy();
    expect(screen.queryByTestId('connected-loading')).toBeNull();
  });

  it('offline, Remove and Reconnect wait for a connection', async () => {
    mockConnected = false;
    sources = [source({ source: 'listenbrainz', status: 'needs_reconnect' })];
    const alert = jest.spyOn(Alert, 'alert');
    open();

    const remove = await screen.findByTestId('connected-remove-listenbrainz');
    expect(screen.getByTestId('connected-offline')).toBeTruthy();
    expect(remove.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('connected-reconnect-listenbrainz').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(remove);
    fireEvent.press(screen.getByTestId('connected-reconnect-listenbrainz'));

    expect(alert).not.toHaveBeenCalled();
    expect(decide.removeSourceData).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stub-listenbrainz')).toBeNull();
  });

  it('a summary that fails to load says so (not "nothing connected")', async () => {
    m(decide.getServicesSummary).mockRejectedValue(new decide.ApiError(503, 'down'));
    open();

    expect(await screen.findByTestId('connected-load-error', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('connected-empty')).toBeNull();
  });

  it('stale source shows nudge', async () => {
    sources = [source({ source: 'listenbrainz', status: 'stale' })];
    open();

    fireEvent.press(await screen.findByTestId('connected-stale-listenbrainz'));

    expect(screen.getByText('Connect Spotify to ListenBrainz so new listens arrive')).toBeTruthy();
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://listenbrainz.org/settings/music-services/details/');
  });
});

describe('ImportResult', () => {
  it.each([
    [1, 1, 'Added 1 artist and 1 song you know'],
    [3, 120, 'Added 3 artists and 120 songs you know'],
  ])('%i artists, %i songs', (artists, songs, text) => {
    render(
      <IntlProvider locale="en">
        <ImportResult artists={artists} songs={songs} />
      </IntlProvider>,
    );
    expect(screen.getByTestId('connect-import-result')).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
  });
});
