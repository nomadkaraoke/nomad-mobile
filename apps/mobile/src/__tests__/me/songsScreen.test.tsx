// The collection screen (Phase 4a, B8): me/songs. Filters and sort drive queryLibrary; rows route by key kind.
import * as decide from '@nomad/api-decide';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useVoiceStore } from '../../voice/voiceStore';
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
  useVoiceStore.getState().clear();
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

it('a saved song nobody has sung yet shows no "0×" pill; sung songs keep theirs', async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/songs' });
  await screen.findByTestId('me-song-2');
  expect(screen.getByTestId('me-song-times-0')).toHaveTextContent('5×');
  expect(screen.getByTestId('me-song-2')).toHaveTextContent(/Yak/);
  expect(screen.queryByTestId('me-song-times-2')).toBeNull();
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

it('a catalogued row opens the song page', async () => {
  renderRouter({ ...appRoutes(), 'song/[id]': () => <View testID="song-stub" /> }, { initialUrl: '/me/songs' });
  await screen.findByTestId('me-song-2');
  fireEvent.press(screen.getByTestId('me-song-0'));
  expect(await screen.findByTestId('song-stub')).toBeTruthy();
});

describe('voice fit lookups', () => {
  const withRange = li('Delta', 'Wolf', { times_sung: 9, facets: { vr_tier: 'high', has_karaoke: true, community: false, karafun: false } });
  const profile = {
    lowMidi: 45, highMidi: 69, comfortLow: 48, comfortHigh: 66, voiceType: 'baritone' as const, voiceTypeBetween: null,
    register: null, confidence: 'high' as const, method: 'mic' as const, measuredAt: '2026-10-01T00:00:00Z',
  };

  it('makes no range request without a voice profile', async () => {
    api.getLibrary.mockResolvedValue({ status: 'ok', etag: 'e', items: [withRange] } as never);
    renderRouter(appRoutes(), { initialUrl: '/me/songs' });
    await screen.findByTestId('me-song-0');
    expect(api.getSongVocalRange).not.toHaveBeenCalled();
  });

  it('with a profile, asks only for songs that have range data', async () => {
    useVoiceStore.getState().save(profile);
    api.getLibrary.mockResolvedValue({ status: 'ok', etag: 'e', items: [withRange, B] } as never);
    renderRouter(appRoutes(), { initialUrl: '/me/songs' });
    await screen.findByTestId('me-song-1');
    await waitFor(() => expect(api.getSongVocalRange).toHaveBeenCalledTimes(1));
    expect(api.getSongVocalRange).toHaveBeenCalledWith('k_Wolf');
  });
});
