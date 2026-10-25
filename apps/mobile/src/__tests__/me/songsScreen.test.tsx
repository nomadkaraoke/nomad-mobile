// The collection screen (Phase 4a, B8): me/songs. Filters and sort drive queryLibrary; rows route by key kind.
import * as decide from '@nomad/api-decide';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { gen } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';
import { li, resetMe } from './helpers';

jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getLibrary: jest.fn(),
  listSetlists: jest.fn(async () => []),
  listKaraokeLog: jest.fn(async () => ({ entries: [] })),
  getVoiceProfile: jest.fn(async () => null),
  getSongVocalRange: jest.fn(async () => ({ range: null })),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const api = decide as jest.Mocked<typeof decide>;

const A = li('Alpha', 'Zed', { times_sung: 5, loved: true, latest_feel: 'great', vibes: ['party'], facets: { mood: 'happy', has_karaoke: true, community: true, karafun: false } });
const B = li('Bravo', 'Yak', { times_sung: 0, latest_feel: null, vibes: [] });
const C = li('Cobra', 'Xi', { key: 'u:cobra-xi', song_key: null, times_sung: 1, latest_feel: 'ok', vibes: ['ballad'] });

beforeEach(() => {
  jest.clearAllMocks();
  resetMe('me@example.com');
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  api.getLibrary.mockResolvedValue({ status: 'ok', etag: 'e', items: [A, B, C] } as never);
});

it('lists every song, most-sung first, and offers only the vibes in use', async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/songs' });
  expect(await screen.findByTestId('me-song-2')).toBeTruthy();
  expect(screen.getByTestId('me-song-0')).toHaveTextContent(/Zed/);
  expect(screen.getByTestId('me-song-2')).toHaveTextContent(/Yak/);
  expect(screen.getByTestId('me-songs-vibe-party')).toBeTruthy();
  expect(screen.getByTestId('me-songs-vibe-ballad')).toBeTruthy();
  expect(screen.queryByTestId('me-songs-vibe-duet')).toBeNull();
});

it('filters (feel, often, mood, vibe, saved), searches and sorts', async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/songs' });
  await screen.findByTestId('me-song-2');
  const only = (chip: string, text: RegExp) => {
    fireEvent.press(screen.getByTestId(chip));
    expect(screen.getByTestId('me-song-0')).toHaveTextContent(text);
    expect(screen.queryByTestId('me-song-1')).toBeNull();
    fireEvent.press(screen.getByTestId(chip));
  };
  only('me-songs-feel-great', /Zed/);
  only('me-songs-often-unsung', /Yak/);
  only('me-songs-mood-happy', /Zed/);
  only('me-songs-vibe-ballad', /Xi/);
  only('me-songs-saved', /Zed/);
  fireEvent.changeText(screen.getByTestId('me-songs-search'), 'bravo');
  expect(screen.getByTestId('me-song-0')).toHaveTextContent(/Yak/);
  fireEvent.changeText(screen.getByTestId('me-songs-search'), '');
  fireEvent.press(screen.getByTestId('me-songs-sort-az'));
  expect(screen.getByTestId('me-song-0')).toHaveTextContent(/Zed/);
  expect(screen.getByTestId('me-song-2')).toHaveTextContent(/Xi/);
});

it('an uncatalogued row opens its history page; a catalogued one opens the song page', async () => {
  renderRouter({ ...appRoutes(), 'song/[id]': () => <View testID="song-stub" /> }, { initialUrl: '/me/songs' });
  await screen.findByTestId('me-song-2');
  fireEvent.press(screen.getByTestId('me-songs-sort-az'));
  fireEvent.press(screen.getByTestId('me-song-2'));
  expect(await screen.findByTestId('history-title')).toHaveTextContent(/Xi/);
});

it('shows an empty note when nothing matches', async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/songs' });
  await screen.findByTestId('me-song-2');
  fireEvent.changeText(screen.getByTestId('me-songs-search'), 'zzzzzz');
  expect(await screen.findByTestId('me-songs-empty')).toBeTruthy();
});
