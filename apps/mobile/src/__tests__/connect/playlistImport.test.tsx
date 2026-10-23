// Connect -> Playlist link import: Spotify embed + YouTube Music (Phase 3b Task 20).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
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
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn() }));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  importSpotifyPlaylist: jest.fn(),
  importYouTubeMusicPlaylist: jest.fn(),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: {} })),
  getServiceCapabilities: jest.fn(async () => ({ screenshot_import: true, listenbrainz_oauth: false })),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const m = (f: unknown) => f as jest.Mock;
const SPOTIFY = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const YT = 'https://music.youtube.com/playlist?list=PLfixtureplaylist0001';

const open = async () => {
  renderRouter(appRoutes(), { initialUrl: '/discover/connect/playlist' });
  return screen.findByTestId('connect-playlist-input');
};
const submit = async (text: string) => {
  const input = await open();
  await act(async () => fireEvent.changeText(input, text));
  await act(async () => fireEvent.press(screen.getByTestId('connect-playlist-submit')));
};

beforeEach(async () => {
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  const ok = { playlist_title: 'Fixture Mix', tracks_fetched: 12, tracks_matched: 9 };
  m(decide.importSpotifyPlaylist).mockResolvedValue(ok);
  m(decide.importYouTubeMusicPlaylist).mockResolvedValue(ok);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('Playlist link import', () => {
  it('routes spotify vs youtube', async () => {
    await submit(SPOTIFY);
    expect(await screen.findByText('9 of 12 have karaoke versions')).toBeTruthy();
    expect(screen.getByText('Imported Fixture Mix')).toBeTruthy();
    expect(decide.importSpotifyPlaylist).toHaveBeenCalledWith(SPOTIFY);
    expect(decide.importYouTubeMusicPlaylist).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByTestId('connect-playlist-again')));
    const input = await screen.findByTestId('connect-playlist-input');
    await act(async () => fireEvent.changeText(input, YT));
    await act(async () => fireEvent.press(screen.getByTestId('connect-playlist-submit')));
    await waitFor(() => expect(decide.importYouTubeMusicPlaylist).toHaveBeenCalledWith(YT));
    expect(decide.importSpotifyPlaylist).toHaveBeenCalledTimes(1);
  });

  it('junk shows inline error and no request', async () => {
    await submit('https://example.com/not-a-playlist');
    expect(await screen.findByText("That isn't a Spotify or YouTube Music playlist link")).toBeTruthy();
    expect(decide.importSpotifyPlaylist).not.toHaveBeenCalled();
    expect(decide.importYouTubeMusicPlaylist).not.toHaveBeenCalled();
  });

  it('paste fills field', async () => {
    m(Clipboard.getStringAsync).mockResolvedValue(`  ${SPOTIFY}\n`);
    await open();
    await act(async () => fireEvent.press(screen.getByTestId('connect-playlist-paste')));
    await waitFor(() => expect(screen.getByTestId('connect-playlist-input').props.value).toBe(SPOTIFY));
  });

  it('a clipboard failure is ignored quietly', async () => {
    m(Clipboard.getStringAsync).mockRejectedValue(new Error('clipboard unavailable'));
    await open();
    await act(async () => fireEvent.press(screen.getByTestId('connect-playlist-paste')));
    expect(screen.getByTestId('connect-playlist-input').props.value).toBe('');
  });

  it('a Spotify 422 is always "unparseable", even if the detail mentions liked', async () => {
    m(decide.importSpotifyPlaylist).mockRejectedValue(new decide.ApiError(422, 'liked songs embed unreadable'));
    await submit(SPOTIFY);
    expect(await screen.findByText(/We couldn't read that playlist right now/)).toBeTruthy();
  });

  it('spotify 422 copy', async () => {
    m(decide.importSpotifyPlaylist).mockRejectedValue(new decide.ApiError(422, 'embed_unparseable'));
    await submit(SPOTIFY);
    expect(
      await screen.findByText("We couldn't read that playlist right now. Try a YouTube Music link or a screenshot instead."),
    ).toBeTruthy();
  });

  it('youtube 422 says Liked Music is private', async () => {
    m(decide.importYouTubeMusicPlaylist).mockRejectedValue(new decide.ApiError(422, 'private_playlist'));
    await submit(YT);
    expect(await screen.findByText(/Liked Music is always private/)).toBeTruthy();
  });

  it('how-to expands with the share steps', async () => {
    await open();
    expect(screen.queryByTestId('connect-playlist-howto-body')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('connect-playlist-howto')));
    expect(screen.getByText(/^1\. On music\.youtube\.com.*Library → Liked Music/)).toBeTruthy();
    expect(screen.getByText(/^4\. Open the new playlist/)).toBeTruthy();
  });
});
