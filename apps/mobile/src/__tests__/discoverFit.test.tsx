// discoverFit (Phase 3c Task 19): the Singable chip, the "Fits my voice" sort, fit badges on the picks rows, the
// Improve card's voice-test entry and the empty Singable state, with and without a voice profile on the phone.
import * as decide from '@nomad/api-decide';
import { DEFAULT_REC_FILTERS } from '@nomad/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useAuth } from '../auth/store';
import { useRecFilters } from '../discover/filtersStore';
import { useLibraryFilter } from '../find/library';
import { resetSearchCacheForTests } from '../find/useSearch';
import { appStorage } from '../storage';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';
import { profileFromSelfReport, useVoiceStore } from '../voice/voiceStore';

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
  getVoiceProfile: jest.fn(async () => null),
  putVoiceProfile: jest.fn(async () => ({})),
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

const song = (title: string, fit: decide.RecSong['fit'] = null): decide.RecSong => ({
  song_key: `band|${title.toLowerCase()}`,
  artist: 'Band',
  title,
  reason: '',
  reason_type: 'crowd_pleaser',
  reason_artist: null,
  score: 1,
  has_karaoke_version: true,
  karaoke: { community: false, commercial: true, karafun: false, brand_count: 1 },
  facets: { decade: '2000s', genres: ['rock'], mood: null, energy: null, lead_gender: null, duration_ms: null, popularity: 50, is_classic: false, explicit: false },
  fit,
});
const response = (songs: decide.RecSong[], voice?: decide.RecVoice) => ({
  sections: songs.length
    ? [{ id: 'crowd_pleasers', title_key: 'recs.section.crowd_pleasers.title', reason_key: 'recs.section.crowd_pleasers.reason', title_params: {}, songs }]
    : [],
  filters_applied: {},
  next_cursor: null,
  has_profile: true,
  catalog_run: 'r1',
  // Prod decide answers without `voice` until its deploy: the app must read it defensively.
  ...(voice ? { voice } : {}),
});
const FITTED = response(
  [
    song('Easy', { bucket: 'fits', transpose: 0, octave: 0, tier: 'measured' }),
    song('Lower', { bucket: 'fitsIn', transpose: -2, octave: 0, tier: 'notes' }),
    song('Far', { bucket: 'outside', transpose: 0, octave: 0, tier: 'rough' }),
    song('Unknown'),
  ],
  { has_profile: true, method: 'self' },
);

const lastQuery = () => getRecs.mock.calls[getRecs.mock.calls.length - 1][0] as Record<string, string | string[]>;
const withVoice = () => act(() => useVoiceStore.getState().adopt(profileFromSelfReport('baritone', '2026-10-22T10:00:00Z')));

const routes = () => ({ ...appRoutes(), 'discover/voice': () => <View testID="voice-stub" /> });
const open = async () => {
  const app = renderRouter(routes(), { initialUrl: '/discover' });
  await screen.findByTestId('rec-section-crowd_pleasers');
  return app;
};

beforeEach(async () => {
  jest.clearAllMocks();
  resetSearchCacheForTests();
  appStorage.clearAll();
  act(() => useRecFilters.setState({ filters: DEFAULT_REC_FILTERS }));
  act(() => useVoiceStore.getState().clear());
  await useAuth.getState().signOut();
  act(() => useLibraryFilter.getState().set('any'));
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  (decide.popularSongs as jest.Mock).mockResolvedValue([]);
  getRecs.mockResolvedValue(FITTED);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('fit badges on the picks', () => {
  it('rows render fit-badge-<sectionId>-<i> from RecSong.fit; outside and no fit show none', async () => {
    withVoice();
    await open();
    expect(screen.getByTestId('fit-badge-crowd_pleasers-0')).toHaveTextContent('Fits your voice');
    expect(screen.getByTestId('fit-badge-crowd_pleasers-1')).toHaveTextContent('Try it 2 keys down');
    expect(screen.queryByTestId('fit-badge-crowd_pleasers-2')).toBeNull();
    expect(screen.queryByTestId('fit-badge-crowd_pleasers-3')).toBeNull();
  });
});

describe('a new voice profile reaching decide', () => {
  it('reloads the picks once decide has it (so rows get their fit)', async () => {
    await open();
    const calls = getRecs.mock.calls.length;
    act(() => useVoiceStore.getState().save(profileFromSelfReport('baritone', '2026-10-22T11:00:00Z')));
    // Saved on the phone but not yet on decide: nothing to reload.
    expect(getRecs.mock.calls.length).toBe(calls);
    act(() => useVoiceStore.getState().markSynced('2026-10-22T11:00:00Z'));
    await waitFor(() => expect(getRecs.mock.calls.length).toBeGreaterThan(calls));
  });
});

describe('the Singable chip', () => {
  it('with a voice profile: tapping it asks recs v2 for singable=true, and again turns it off', async () => {
    withVoice();
    await open();
    const calls = getRecs.mock.calls.length;
    fireEvent.press(screen.getByTestId('filter-chip-singable'));
    await waitFor(() => expect(getRecs.mock.calls.length).toBeGreaterThan(calls));
    expect(lastQuery()).toEqual({ singable: 'true' });
    expect(screen.getByTestId('filter-chip-singable').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId('filter-chip-singable'));
    await waitFor(() => expect(lastQuery()).toEqual({}));
  });

  it('without a profile: the chip is the voice-test CTA and opens /discover/voice', async () => {
    const app = await open();
    expect(screen.queryByTestId('filter-chip-singable')).toBeNull();
    fireEvent.press(screen.getByTestId('filter-chip-singable-cta'));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/voice'));
  });

  it('a stored Singable / fit sort is not sent once the phone has no profile', async () => {
    act(() => useRecFilters.getState().set({ singable: true, sort: 'fit' }));
    await open();
    expect(lastQuery()).toEqual({});
  });

  it('Singable on, nothing back and decide has the profile: "no range data yet", not "nothing fits"', async () => {
    withVoice();
    act(() => useRecFilters.getState().set({ singable: true }));
    getRecs.mockResolvedValue(response([], { has_profile: true, method: 'mic' }));
    renderRouter(routes(), { initialUrl: '/discover' });
    expect(await screen.findByTestId('discover-picks-singable-empty')).toHaveTextContent(/No range data for these songs yet/);
    expect(screen.queryByTestId('discover-picks-empty')).toBeNull();
    getRecs.mockResolvedValue(FITTED);
    fireEvent.press(screen.getByTestId('fit-singable-off'));
    await waitFor(() => expect(lastQuery()).toEqual({}));
    expect(useRecFilters.getState().filters.singable).toBe(false);
  });

  it('Singable on, nothing back, decide has no profile yet (or an old response without voice): the usual empty state', async () => {
    withVoice();
    act(() => useRecFilters.getState().set({ singable: true }));
    getRecs.mockResolvedValue(response([]));
    renderRouter(routes(), { initialUrl: '/discover' });
    expect(await screen.findByTestId('discover-picks-empty')).toBeTruthy();
    expect(screen.queryByTestId('discover-picks-singable-empty')).toBeNull();
  });
});

describe('the "Fits my voice" sort', () => {
  it('with a profile: sort=fit', async () => {
    withVoice();
    await open();
    fireEvent.press(screen.getByTestId('filter-chip-sort'));
    fireEvent.press(await screen.findByTestId('filter-opt-sort-fit'));
    const calls = getRecs.mock.calls.length;
    fireEvent.press(screen.getByTestId('filter-apply-sort'));
    await waitFor(() => expect(getRecs.mock.calls.length).toBeGreaterThan(calls));
    expect(lastQuery()).toEqual({ sort: 'fit' });
  });

  it('without a profile: no fit option; its CTA opens the voice test', async () => {
    const app = await open();
    fireEvent.press(screen.getByTestId('filter-chip-sort'));
    expect(await screen.findByTestId('filter-sheet-sort')).toBeTruthy();
    expect(screen.queryByTestId('filter-opt-sort-fit')).toBeNull();
    fireEvent.press(screen.getByTestId('filter-sort-fit-cta'));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/voice'));
  });
});

describe('the Improve card', () => {
  it('offers the voice test without a profile', async () => {
    const app = await open();
    fireEvent.press(await screen.findByTestId('discover-improve-voice'));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/voice'));
  });

  it('hides it once there is a profile', async () => {
    withVoice();
    await open();
    expect(await screen.findByTestId('discover-improve-artists')).toBeTruthy();
    expect(screen.queryByTestId('discover-improve-voice')).toBeNull();
  });
});
