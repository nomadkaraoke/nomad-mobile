// "Connect your music" hub at /discover/connect, and its entry on Discover's "Improve your picks" card (Phase 3b Task 18).
import * as decide from '@nomad/api-decide';
import { IntlProvider } from '@nomad/i18n';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { useAuth } from '../../auth/store';
import { ImproveCard } from '../../discover/components/ImproveCard';
import { gen, session } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';

jest.setTimeout(20_000);

let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getServicesSummary: jest.fn(),
  getServiceCapabilities: jest.fn(),
  listMusicServices: jest.fn(async () => []),
  startAppleMusicLink: jest.fn(),
  getAppleMusicAppDeveloperToken: jest.fn(async () => 'dev-token'),
}));
jest.mock('../../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => false,
  requestAppleMusicUserToken: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));

const m = (f: unknown) => f as jest.Mock;
const CARDS = ['screenshot', 'playlist', 'spotify-export', 'listenbrainz', 'lastfm', 'apple'];
const CARD_ID = /^connect-card-(screenshot|playlist|spotify-export|listenbrainz|lastfm|apple)$/;
const LINK = { connect_url: 'https://decide.test/en/connect/apple-music?state=s&return=app', expires_in: 600 };
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
const stub = (id: string) =>
  function Stub() {
    return <View testID={id} />;
  };
const open = () =>
  renderRouter(
    {
      ...appRoutes(),
      'discover/connect/screenshot': stub('stub-screenshot'),
      'discover/connect/playlist': stub('stub-playlist'),
      'discover/connect/spotify-export': stub('stub-spotify-export'),
      'discover/connect/listenbrainz': stub('stub-listenbrainz'),
      'discover/connect/lastfm': stub('stub-lastfm'),
      'discover/connect/apple': stub('stub-apple-export'),
    },
    { initialUrl: '/discover/connect' },
  );

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockConnected = true;
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  sources = [];
  m(decide.getServicesSummary).mockImplementation(async () => ({ sources, capabilities: { screenshot_import: true, listenbrainz_oauth: false } }));
  m(decide.getServiceCapabilities).mockResolvedValue({ screenshot_import: true, listenbrainz_oauth: false });
  m(decide.startAppleMusicLink).mockResolvedValue(LINK);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('Connect your music hub', () => {
  it('card order and copy', async () => {
    open();
    await screen.findByTestId('connect-card-screenshot');

    const ids = screen.getAllByTestId(CARD_ID).map((n) => n.props.testID as string);
    expect(ids).toEqual(CARDS.map((c) => `connect-card-${c}`));
    const copy: Record<string, [string, string]> = {
      screenshot: ['Screenshot your music app', 'Artists in seconds'],
      playlist: ['Paste a playlist link', 'Spotify or YouTube Music · seconds'],
      'spotify-export': ['Your Spotify history', 'Your whole listening history · takes Spotify 5–30 days'],
      listenbrainz: ['ListenBrainz', 'Keeps your picks fresh as you listen'],
      lastfm: ['Last.fm', 'Your scrobbles · a few minutes'],
      apple: ['Apple Music', 'Your library and recent plays · seconds'],
    };
    for (const [id, [title, detail]] of Object.entries(copy)) {
      const card = within(screen.getByTestId(`connect-card-${id}`));
      expect(card.getByText(title)).toBeTruthy();
      expect(card.getByText(detail)).toBeTruthy();
    }
    expect(screen.getByText('No Apple Music subscription? Import your play history instead')).toBeTruthy();
  });

  it('hides screenshot card when capability off', async () => {
    m(decide.getServiceCapabilities).mockResolvedValue({ screenshot_import: false, listenbrainz_oauth: false });
    open();
    await screen.findByTestId('connect-card-playlist');
    await waitFor(() => expect(decide.getServiceCapabilities).toHaveBeenCalled());

    expect(screen.queryByTestId('connect-card-screenshot')).toBeNull();
    expect(screen.getAllByTestId(CARD_ID)).toHaveLength(5);
  });

  it.each([
    ['screenshot', 'stub-screenshot'],
    ['playlist', 'stub-playlist'],
    ['spotify-export', 'stub-spotify-export'],
    ['listenbrainz', 'stub-listenbrainz'],
    ['lastfm', 'stub-lastfm'],
  ])('the %s card opens its screen', async (id, target) => {
    open();
    await waitFor(() => expect(screen.getByTestId(`connect-card-${id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`connect-card-${id}`));

    expect(await screen.findByTestId(target)).toBeTruthy();
  });

  it('the Apple Music card connects through MusicKit; its export link opens the export screen', async () => {
    open();
    fireEvent.press(await screen.findByTestId('connect-card-apple'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(LINK.connect_url));

    fireEvent.press(screen.getByTestId('connect-apple-export'));
    expect(await screen.findByTestId('stub-apple-export')).toBeTruthy();
  });

  it('shows which sources are connected, Apple Music from the services list', async () => {
    sources = [source({ source: 'lastfm' }), source({ source: 'spotify_playlist', connected: false })];
    m(decide.listMusicServices).mockResolvedValue([
      { service_type: 'apple_music', service_username: 'Apple Music', last_sync_at: '2026-10-22T16:00:00Z', sync_status: 'idle', sync_error: null, tracks_synced: 1, songs_synced: 9 },
    ]);
    open();

    expect(await screen.findByTestId('connect-card-lastfm-connected')).toBeTruthy();
    expect(await screen.findByTestId('connect-card-playlist-connected')).toBeTruthy();
    expect(await screen.findByTestId('connect-card-apple-connected')).toBeTruthy();
    expect(screen.queryByTestId('connect-card-listenbrainz-connected')).toBeNull();
  });

  it('offline: the cards stay, and Apple Music connect says you are offline', async () => {
    mockConnected = false;
    open();

    expect(await screen.findByTestId('connect-offline')).toBeTruthy();
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getAllByTestId(CARD_ID).length).toBeGreaterThanOrEqual(5);
    fireEvent.press(screen.getByTestId('connect-card-apple'));
    expect(decide.startAppleMusicLink).not.toHaveBeenCalled();
  });
});

describe('Improve your picks card', () => {
  const renderCard = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <IntlProvider locale="en">{children}</IntlProvider>
      </QueryClientProvider>
    );
    return render(<ImproveCard onAddArtists={jest.fn()} />, { wrapper: wrap });
  };

  it('has a Connect your music entry that opens the hub', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    renderCard();

    fireEvent.press(screen.getByTestId('discover-improve-connect'));

    expect(push).toHaveBeenCalledWith('/discover/connect');
    await waitFor(() => expect(decide.getServicesSummary).toHaveBeenCalled());
    expect(screen.queryByTestId('discover-improve-stale')).toBeNull();
  });

  it('stale source shows nudge', async () => {
    sources = [source({ status: 'stale' })];
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    renderCard();

    fireEvent.press(await screen.findByTestId('discover-improve-stale'));

    expect(screen.getByText('Connect Spotify to ListenBrainz so new listens arrive')).toBeTruthy();
    expect(push).toHaveBeenCalledWith('/discover/connect');
  });
});
