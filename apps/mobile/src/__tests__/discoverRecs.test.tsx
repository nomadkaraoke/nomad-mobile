// discoverRecs: the Discover tab's recommendations (Task E6, spec §8.1).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useAuth } from '../auth/store';
import { useLibraryFilter } from '../find/library';
import { resetSearchCacheForTests } from '../find/useSearch';
import { useMakeIntent } from '../make/intentStore';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  searchSongs: jest.fn(),
  popularSongs: jest.fn(),
  resolveQuery: jest.fn(async () => ({})),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  getSong: jest.fn(),
  configureClient: jest.fn(),
  getRecommendationsV2: jest.fn(),
  hideSong: jest.fn(async () => {}),
  unhideSong: jest.fn(async () => {}),
  loveSong: jest.fn(async () => {}),
  unloveSong: jest.fn(async () => {}),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));

const api = decide as jest.Mocked<typeof decide>;
const searchSongs = decide.searchSongs as jest.Mock;
const popularSongs = decide.popularSongs as jest.Mock;
const getRecs = decide.getRecommendationsV2 as jest.Mock;

type Song = decide.RecSong;
const song = (artist: string, title: string, over: Partial<Song> = {}): Song => ({
  song_key: `${artist.toLowerCase()}|${title.toLowerCase()}`,
  artist,
  title,
  reason: '',
  reason_type: 'crowd_pleaser',
  reason_artist: null,
  score: 1,
  has_karaoke_version: true,
  karaoke: { community: false, commercial: true, karafun: false, brand_count: 1 },
  facets: {
    decade: '2000s',
    genres: ['rock'],
    mood: null,
    energy: null,
    lead_gender: null,
    duration_ms: null,
    popularity: 50,
    is_classic: false,
    explicit: false,
  },
  ...over,
});
const section = (id: string, key: string, songs: Song[], params: Record<string, string> = {}): decide.RecSection => ({
  id,
  title_key: `recs.section.${key}.title`,
  reason_key: `recs.section.${key}.reason`,
  title_params: params,
  songs,
});
const recs = (sections: decide.RecSection[], over: Partial<decide.RecommendationsV2Response> = {}) => ({
  sections,
  filters_applied: {},
  next_cursor: null,
  has_profile: true,
  catalog_run: 'r1',
  ...over,
});

const FULL = recs([
  section('songs_you_know', 'songs_you_know', [
    song('Muse', 'Starlight', {
      reason_type: 'known_song',
      karaoke: { community: true, commercial: true, karafun: true, brand_count: 3 },
    }),
  ]),
  section('because_the killers', 'because', [song('Keane', 'Invented Song', { reason_type: 'similar_artist', reason_artist: 'The Killers' })], {
    artist: 'The Killers',
  }),
  section('crowd_pleasers', 'crowd_pleasers', [song('Band A', 'Song A'), song('Band B', 'Song B')]),
  section('make_it', 'make_it', [
    song('Strokes', 'Machu Picchu', { reason_type: 'make_it', has_karaoke_version: false }),
  ]),
]);

const group = (artist: string, title: string) => ({
  song_key: `${artist.toLowerCase()}|${title.toLowerCase()}`,
  artist,
  title,
  version_count: 2,
  versions: [],
});
const NONE = { status: 'none', kind: null, best: null, candidates: [] };

const routes = () => ({
  ...appRoutes(),
  'make/new': () => <View testID="make-stub" />,
  'song/[id]': () => <View testID="song-stub" />,
});
const open = () => renderRouter(routes(), { initialUrl: '/discover' });

const warming = () => new decide.ApiError(503, 'warming_up');

beforeEach(async () => {
  jest.clearAllMocks();
  resetSearchCacheForTests();
  await useAuth.getState().signOut();
  act(() => useLibraryFilter.getState().set('any'));
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  popularSongs.mockResolvedValue([group('Lionel Richie', 'Hello')]);
  searchSongs.mockResolvedValue({ identification: NONE, groups: [group('Adele', 'Hello')], index: { run: 'r', built_at: 1 }, sid: 's' });
  getRecs.mockResolvedValue(FULL);
});
afterEach(() => {
  jest.useRealTimers();
});

const signIn = () => act(() => useAuth.getState().signInWithSession(session()));

describe('discoverRecs', () => {
  it('signed out shows sign-in card and popular list', async () => {
    const app = open();
    expect(await screen.findByTestId('discover-signin-card')).toBeTruthy();
    expect(await screen.findByText('Lionel Richie')).toBeTruthy();
    expect(screen.getByTestId('library-filter')).toBeTruthy();
    expect(getRecs).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('discover-signin'));
    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(app.getSearchParams()).toEqual(expect.objectContaining({ returnTo: '/discover' }));
  });

  it('signed in without profile shows quiz card', async () => {
    await signIn();
    getRecs.mockResolvedValue(recs([], { has_profile: false }));
    open();
    expect(await screen.findByTestId('discover-quiz-card')).toBeTruthy();
    expect(screen.getByText('Get your picks in 30 seconds')).toBeTruthy();
    expect(await screen.findByText('Lionel Richie')).toBeTruthy();
    expect(screen.queryByTestId('discover-signin-card')).toBeNull();
    expect(screen.getByTestId('discover-quiz-start')).toBeTruthy();
  });

  it('signed in renders sections in order with reason chips and badges', async () => {
    await signIn();
    open();
    expect(await screen.findByTestId('rec-section-songs_you_know')).toBeTruthy();
    expect(getRecs).toHaveBeenCalledWith({}, undefined);
    // Section ids can carry spaces / non-ASCII (because_<artist_key>): the testID is sanitised.
    const ids = ['songs_you_know', 'because_the-20-killers', 'crowd_pleasers', 'make_it'];
    const headers = screen.getAllByTestId(/^rec-section-/).map((n) => n.props.testID as string);
    expect(headers).toEqual(ids.map((id) => `rec-section-${id}`));
    expect(screen.getByText('Because you like \u2068The Killers\u2069')).toBeTruthy();
    const known = screen.getByTestId('rec-row-songs_you_know-0');
    expect(within(known).getByText('Starlight')).toBeTruthy();
    expect(within(known).getByText('Muse')).toBeTruthy();
    expect(within(known).getByText('You know this')).toBeTruthy();
    expect(within(known).getByTestId('library-badge-karafun')).toBeTruthy();
    expect(within(known).getByTestId('library-badge-community')).toBeTruthy();
    expect(within(screen.getByTestId('rec-row-because_the-20-killers-0')).getByText('Like \u2068The Killers\u2069')).toBeTruthy();
    expect(within(screen.getByTestId('rec-row-crowd_pleasers-1')).getByText('Crowd pleaser')).toBeTruthy();
    expect(within(screen.getByTestId('rec-row-make_it-0')).getByText('No karaoke version yet')).toBeTruthy();
    expect(screen.getByTestId('discover-improve-card')).toBeTruthy();
    // With picks, the popular list makes way.
    expect(screen.queryByText('Lionel Richie')).toBeNull();
  });

  it('tapping a picks row opens the song page', async () => {
    await signIn();
    const app = open();
    fireEvent.press(await screen.findByTestId('rec-row-crowd_pleasers-0'));
    expect(await screen.findByTestId('song-stub')).toBeTruthy();
    expect(app.getSearchParams()).toEqual(expect.objectContaining({ id: 'band a|song a' }));
  });

  it('warming shows getting-ready and polls', async () => {
    await signIn();
    getRecs.mockRejectedValue(warming());
    open();
    expect(await screen.findByTestId('discover-picks-warming')).toBeTruthy();
    expect(screen.getByText('Getting your picks ready…')).toBeTruthy();
    expect(getRecs).toHaveBeenCalledTimes(1); // no retry on a 503
    getRecs.mockResolvedValue(FULL);
    await act(() => jest.advanceTimersByTimeAsync(15_000));
    expect(await screen.findByTestId('rec-section-songs_you_know')).toBeTruthy();
    expect(screen.queryByTestId('discover-picks-warming')).toBeNull();
  });

  it('recs error shows retry; search still renders', async () => {
    await signIn();
    getRecs.mockRejectedValue(new decide.ApiError(500, 'boom'));
    open();
    expect(await screen.findByTestId('discover-picks-error', {}, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText('Lionel Richie')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('discover-search-input'), 'hello');
    expect(await screen.findByText('Adele', {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('discover-search-input'), '');
    getRecs.mockResolvedValue(FULL);
    fireEvent.press(await screen.findByTestId('discover-picks-retry'));
    expect(await screen.findByTestId('rec-section-songs_you_know')).toBeTruthy();
  });

  it('a decide 401 shows retry and never signs out', async () => {
    await signIn();
    getRecs.mockRejectedValue(new decide.ApiError(401, 'unauthorized'));
    open();
    expect(await screen.findByTestId('discover-picks-error')).toBeTruthy();
    expect(useAuth.getState().state.status).toBe('signedIn');
  });

  it('empty state offers clear filters', async () => {
    await signIn();
    act(() => useLibraryFilter.getState().set('karafun'));
    getRecs.mockResolvedValue(recs([]));
    open();
    expect(await screen.findByTestId('discover-picks-empty')).toBeTruthy();
    expect(screen.getByText('No picks match these filters')).toBeTruthy();
    expect(getRecs).toHaveBeenLastCalledWith({ library: 'karafun' }, undefined);
    getRecs.mockResolvedValue(FULL);
    fireEvent.press(screen.getByTestId('discover-picks-clear'));
    expect(await screen.findByTestId('rec-section-songs_you_know')).toBeTruthy();
    expect(useLibraryFilter.getState().filter).toBe('any');
    expect(getRecs).toHaveBeenLastCalledWith({}, undefined);
  });

  it('Not for me removes the row and undo restores it', async () => {
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('rec-menu-crowd_pleasers-0'));
    fireEvent.press(await screen.findByTestId('song-menu-hide'));
    await waitFor(() => expect(screen.queryByText('Song A')).toBeNull());
    expect(api.hideSong).toHaveBeenCalledWith('band a|song a', { artist: 'Band A', title: 'Song A' });
    expect(screen.getByTestId('discover-hidden-toast')).toBeTruthy();
    fireEvent.press(screen.getByTestId('discover-hidden-undo'));
    expect(await screen.findByText('Song A')).toBeTruthy();
    expect(api.unhideSong).toHaveBeenCalledWith('band a|song a');
    // Back in its place, ahead of Song B.
    expect(within(screen.getByTestId('rec-row-crowd_pleasers-0')).getByText('Song A')).toBeTruthy();
  });

  it('a failed hide puts the row back', async () => {
    await signIn();
    api.hideSong.mockRejectedValueOnce(new Error('offline'));
    open();
    fireEvent.press(await screen.findByTestId('rec-menu-crowd_pleasers-0'));
    fireEvent.press(await screen.findByTestId('song-menu-hide'));
    await waitFor(() => expect(api.hideSong).toHaveBeenCalled());
    expect(await screen.findByText('Song A')).toBeTruthy();
    expect(screen.queryByTestId('discover-hidden-toast')).toBeNull();
  });

  it('Love it calls loveSong and marks the row loved', async () => {
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('rec-menu-crowd_pleasers-1'));
    fireEvent.press(await screen.findByTestId('song-menu-love'));
    expect(await screen.findByTestId('rec-loved-crowd_pleasers-1')).toBeTruthy();
    expect(api.loveSong).toHaveBeenCalledWith('band b|song b', { artist: 'Band B', title: 'Song B' });
  });

  it('make_it row opens the make flow', async () => {
    await signIn();
    const app = open();
    fireEvent.press(await screen.findByTestId('rec-row-make_it-0'));
    await waitFor(() => expect(app.getPathname()).toBe('/make/new'));
    expect(useMakeIntent.getState().intent).toEqual(
      expect.objectContaining({ artist: 'Strokes', title: 'Machu Picchu', songKey: 'strokes|machu picchu', source: 'identified' }),
    );
  });

  it('typing a query hides recommendations', async () => {
    await signIn();
    open();
    expect(await screen.findByTestId('rec-section-songs_you_know')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('discover-search-input'), 'hello');
    expect(await screen.findByText('Adele', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByTestId('rec-section-songs_you_know')).toBeNull();
    expect(screen.getByTestId('library-filter')).toBeTruthy();
  });
});
