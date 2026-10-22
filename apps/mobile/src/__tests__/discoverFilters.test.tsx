// discoverFilters: the Discover filter bar, its sheets and the persisted filter store (Task E7, spec §8.1).
import * as decide from '@nomad/api-decide';
import { DECADES, DEFAULT_REC_FILTERS, GENRE_IDS } from '@nomad/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { useRecFilters } from '../discover/filtersStore';
import { useLibraryFilter } from '../find/library';
import { resetSearchCacheForTests } from '../find/useSearch';
import { appStorage } from '../storage';
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

const getRecs = decide.getRecommendationsV2 as jest.Mock;

const song = (artist: string, title: string): decide.RecSong => ({
  song_key: `${artist.toLowerCase()}|${title.toLowerCase()}`,
  artist,
  title,
  reason: '',
  reason_type: 'crowd_pleaser',
  reason_artist: null,
  score: 1,
  has_karaoke_version: true,
  karaoke: { community: false, commercial: true, karafun: false, brand_count: 1 },
  facets: { decade: '2000s', genres: ['rock'], mood: null, energy: null, lead_gender: null, duration_ms: null, popularity: 50, is_classic: false, explicit: false },
});
const section = (id: string, key: string, songs: decide.RecSong[]): decide.RecSection => ({
  id,
  title_key: `recs.section.${key}.title`,
  reason_key: `recs.section.${key}.reason`,
  title_params: {},
  songs,
});
const response = (sections: decide.RecSection[]) => ({
  sections,
  filters_applied: {},
  next_cursor: null,
  has_profile: true,
  catalog_run: 'r1',
});
const BEST = response([section('crowd_pleasers', 'crowd_pleasers', [song('Band A', 'Song A')])]);
const ALL = response([section('all', 'all', [song('Band B', 'Song B'), song('Band C', 'Song C')])]);

const lastQuery = () => getRecs.mock.calls[getRecs.mock.calls.length - 1][0] as Record<string, string | string[]>;

beforeEach(async () => {
  jest.clearAllMocks();
  resetSearchCacheForTests();
  appStorage.clearAll();
  act(() => useRecFilters.setState({ filters: DEFAULT_REC_FILTERS }));
  await useAuth.getState().signOut();
  act(() => useLibraryFilter.getState().set('any'));
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  (decide.popularSongs as jest.Mock).mockResolvedValue([]);
  getRecs.mockResolvedValue(BEST);
  await act(() => useAuth.getState().signInWithSession(session()));
});

const open = async () => {
  renderRouter(appRoutes(), { initialUrl: '/discover' });
  await screen.findByTestId('rec-section-crowd_pleasers');
};
const pick = (sheet: string, opt: string) => fireEvent.press(screen.getByTestId(`filter-opt-${sheet}-${opt}`));
/** Open a chip's sheet, press the options, apply; resolves once the refetch has been issued. */
async function apply(chip: string, options: string[]) {
  const calls = getRecs.mock.calls.length;
  fireEvent.press(screen.getByTestId(`filter-chip-${chip}`));
  expect(await screen.findByTestId(`filter-sheet-${chip}`)).toBeTruthy();
  options.forEach((o) => pick(chip, o));
  fireEvent.press(screen.getByTestId(`filter-apply-${chip}`));
  await waitFor(() => expect(getRecs.mock.calls.length).toBeGreaterThan(calls));
}

describe('discoverFilters', () => {
  it('shows the six chips', async () => {
    await open();
    for (const c of ['sort', 'genre', 'decade', 'mood', 'energy', 'more']) expect(screen.getByTestId(`filter-chip-${c}`)).toBeTruthy();
  });

  it('genre: pick rock, apply -> genre=[rock], and the chip shows the count', async () => {
    await open();
    await apply('genre', ['rock']);
    expect(lastQuery()).toEqual({ genre: ['rock'] });
    expect(screen.getByTestId('filter-chip-genre').props.accessibilityLabel).toBe('Genre (1)');
  });

  it('nothing changes until Apply, and closing the sheet drops the draft', async () => {
    await open();
    fireEvent.press(screen.getByTestId('filter-chip-genre'));
    pick('genre', 'rock');
    fireEvent.press(screen.getByTestId('filter-sheet-genre-close'));
    expect(useRecFilters.getState().filters.genre).toEqual([]);
    fireEvent.press(screen.getByTestId('filter-chip-genre'));
    expect(screen.getByTestId('filter-opt-genre-rock').props.accessibilityState.selected).toBe(false);
  });

  it('sort newest -> sort=newest and one flat all section', async () => {
    await open();
    getRecs.mockResolvedValue(ALL);
    await apply('sort', ['newest']);
    expect(lastQuery()).toEqual({ sort: 'newest' });
    expect(await screen.findByTestId('rec-section-all')).toBeTruthy();
    expect(screen.getAllByTestId(/^rec-section-/)).toHaveLength(1);
  });

  it('More: Hide explicit -> explicit=exclude', async () => {
    await open();
    await apply('more', ['explicit-exclude']);
    expect(lastQuery()).toEqual({ explicit: 'exclude' });
  });

  it('every option maps to a query param', async () => {
    await open();
    await apply('genre', [...GENRE_IDS]);
    expect(lastQuery().genre).toEqual([...GENRE_IDS]);
    await apply('decade', [...DECADES]);
    expect(lastQuery().decade).toEqual([...DECADES]);
    await apply('mood', ['happy', 'chill', 'sad', 'intense']);
    expect(lastQuery().mood).toEqual(['happy', 'chill', 'sad', 'intense']);
    await apply('energy', ['high']);
    expect(lastQuery().energy).toBe('high');
  });

  it.each([
    ['sort', 'popular', { sort: 'popular' }],
    ['sort', 'oldest', { sort: 'oldest' }],
    ['sort', 'shortest', { sort: 'shortest' }],
    ['sort', 'az', { sort: 'az' }],
    ['energy', 'low', { energy: 'low' }],
    ['energy', 'mid', { energy: 'mid' }],
    ['more', 'popularity-50', { popularity: '50' }],
    ['more', 'popularity-70', { popularity: '70' }],
    ['more', 'lead-male', { lead_gender: 'male' }],
    ['more', 'lead-female', { lead_gender: 'female' }],
    ['more', 'lead-mixed', { lead_gender: 'mixed' }],
    ['more', 'duration-short', { duration: 'short' }],
    ['more', 'duration-medium', { duration: 'medium' }],
    ['more', 'duration-long', { duration: 'long' }],
    ['more', 'classic', { classic: 'true' }],
    ['more', 'karaoke-yes', { has_karaoke: 'yes' }],
    ['more', 'karaoke-make', { has_karaoke: 'make' }],
  ])('%s option %s maps to its query param', async (sheet, opt, expected) => {
    await open();
    await apply(sheet, [opt]);
    expect(lastQuery()).toEqual(expected);
  });

  it('single-choice groups can go back to Any', async () => {
    await open();
    await apply('energy', ['high']);
    await apply('energy', ['any']);
    expect(lastQuery()).toEqual({});
  });

  it('merges with the library filter', async () => {
    await open();
    act(() => useLibraryFilter.getState().set('karafun'));
    await waitFor(() => expect(lastQuery()).toEqual({ library: 'karafun' }));
    await apply('genre', ['rock']);
    expect(lastQuery()).toEqual({ genre: ['rock'], library: 'karafun' });
  });

  it('the sheet Clear button resets that sheet to its defaults', async () => {
    await open();
    await apply('genre', ['rock', 'pop']);
    fireEvent.press(screen.getByTestId('filter-chip-genre'));
    fireEvent.press(await screen.findByTestId('filter-clear-genre'));
    fireEvent.press(screen.getByTestId('filter-apply-genre'));
    await waitFor(() => expect(lastQuery()).toEqual({}));
  });

  it('persists to storage as discover.filters.v1 and reloads it, ignoring junk', async () => {
    useRecFilters.getState().set({ genre: ['jazz'], sort: 'az' });
    expect(JSON.parse(appStorage.getString('discover.filters.v1') as string)).toEqual(
      expect.objectContaining({ genre: ['jazz'], sort: 'az' }),
    );
    jest.isolateModules(() => {
      const fresh = (require('../discover/filtersStore') as typeof import('../discover/filtersStore')).useRecFilters;
      expect(fresh.getState().filters).toEqual({ ...DEFAULT_REC_FILTERS, genre: ['jazz'], sort: 'az' });
    });
    appStorage.set('discover.filters.v1', '{"genre":"nope","sort":"bogus","energy":"x"}');
    jest.isolateModules(() => {
      const fresh = (require('../discover/filtersStore') as typeof import('../discover/filtersStore')).useRecFilters;
      expect(fresh.getState().filters).toEqual(DEFAULT_REC_FILTERS);
    });
  });

  it('Clear filters on the empty state resets both the filter store and the library', async () => {
    await open();
    act(() => useLibraryFilter.getState().set('community'));
    await apply('genre', ['rock']);
    getRecs.mockResolvedValue(response([]));
    await apply('decade', ['1980s']);
    fireEvent.press(await screen.findByTestId('discover-picks-clear'));
    await waitFor(() => expect(useRecFilters.getState().filters).toEqual(DEFAULT_REC_FILTERS));
    expect(useLibraryFilter.getState().filter).toBe('any');
  });
});
