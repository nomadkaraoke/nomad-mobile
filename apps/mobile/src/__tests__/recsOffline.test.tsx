// recsOffline: Discover offline shows the last picks (Task E10, spec §8.4).
import * as decide from '@nomad/api-decide';
import { useNetInfo } from '@react-native-community/netinfo';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useAuth } from '../auth/store';
import { clearRecsSnapshot, loadRecsSnapshot, recsSnapshotKey, saveRecsSnapshot } from '../discover/recsSnapshot';
import { useLibraryFilter } from '../find/library';
import { resetSearchCacheForTests } from '../find/useSearch';
import { appStorage } from '../storage';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  // Phase 3b: the Improve card and the profile's Connected section read the services summary.
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } })),
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
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
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: jest.fn() }));

const getRecs = decide.getRecommendationsV2 as jest.Mock;
const hideSong = decide.hideSong as jest.Mock;
const DAY = 24 * 60 * 60 * 1000;
const EMAIL = 'me@example.com';

type Song = decide.RecSong;
const song = (artist: string, title: string, karafun = false): Song => ({
  song_key: `${artist.toLowerCase()}|${title.toLowerCase()}`,
  artist,
  title,
  reason: '',
  reason_type: 'crowd_pleaser',
  reason_artist: null,
  score: 1,
  has_karaoke_version: true,
  karaoke: { community: false, commercial: true, karafun, brand_count: 1 },
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
});
const recs = (songs: Song[]): decide.RecommendationsV2Response => ({
  sections: [
    {
      id: 'crowd_pleasers',
      title_key: 'recs.section.crowd_pleasers.title',
      reason_key: 'recs.section.crowd_pleasers.reason',
      title_params: {},
      songs,
    },
  ],
  filters_applied: {},
  next_cursor: null,
  has_profile: true,
  catalog_run: 'r1',
});

const SAVED = recs([song('Band A', 'Song A', true), song('Band B', 'Song B', false)]);
const seed = (over: { email?: string; age?: number } = {}) =>
  saveRecsSnapshot(recsSnapshotKey(over.email ?? EMAIL, '{}|any'), SAVED, Date.now() - (over.age ?? DAY));

const setNet = (connected: boolean) =>
  (useNetInfo as jest.Mock).mockReturnValue({ isConnected: connected, isInternetReachable: connected });
const open = () =>
  renderRouter(
    { ...appRoutes(), 'make/new': () => <View />, 'song/[id]': () => <View /> },
    { initialUrl: '/discover' },
  );
const signIn = () => act(() => useAuth.getState().signInWithSession(session(EMAIL)));

beforeEach(async () => {
  jest.clearAllMocks();
  resetSearchCacheForTests();
  clearRecsSnapshot();
  await useAuth.getState().signOut();
  act(() => useLibraryFilter.getState().set('any'));
  gen.getMe.mockResolvedValue({ email: EMAIL, credits: 3 } as never);
  getRecs.mockResolvedValue(recs([song('Band A', 'Song A')]));
  setNet(true);
});

describe('recsOffline', () => {
  it('a successful load saves the snapshot for that user', async () => {
    await signIn();
    open();
    expect(await screen.findByTestId('rec-row-crowd_pleasers-0')).toBeTruthy();
    await waitFor(() => expect(loadRecsSnapshot()?.data.sections[0]?.songs[0]?.title).toBe('Song A'));
    expect(loadRecsSnapshot()?.key.startsWith(`${EMAIL}\n`)).toBe(true);
    expect(screen.queryByTestId('discover-offline-picks')).toBeNull();
  });

  it('offline shows the banner and the saved sections without calling decide', async () => {
    seed();
    setNet(false);
    await signIn();
    open();
    expect(await screen.findByTestId('discover-offline-picks')).toBeTruthy();
    expect(screen.getByText('Offline: showing your last picks')).toBeTruthy();
    expect(screen.getByTestId('rec-row-crowd_pleasers-0')).toBeTruthy();
    expect(screen.getByTestId('rec-row-crowd_pleasers-1')).toBeTruthy();
    expect(getRecs).not.toHaveBeenCalled();
  });

  it('a snapshot older than 7 days shows the offline empty state, not stale picks', async () => {
    seed({ age: 8 * DAY });
    setNet(false);
    await signIn();
    open();
    expect(await screen.findByTestId('discover-picks-offline')).toBeTruthy();
    expect(screen.queryByTestId('rec-row-crowd_pleasers-0')).toBeNull();
    expect(screen.queryByTestId('discover-offline-picks')).toBeNull();
  });

  it("never shows another user's snapshot", async () => {
    seed({ email: 'someone.else@example.com' });
    setNet(false);
    await signIn();
    open();
    expect(await screen.findByTestId('discover-picks-offline')).toBeTruthy();
    expect(screen.queryByTestId('rec-row-crowd_pleasers-0')).toBeNull();
  });

  it('applies the library filter to the saved rows', async () => {
    seed();
    setNet(false);
    act(() => useLibraryFilter.getState().set('karafun'));
    await signIn();
    open();
    expect(await screen.findByTestId('rec-row-crowd_pleasers-0')).toBeTruthy();
    expect(screen.getByText('Song A')).toBeTruthy();
    expect(screen.queryByText('Song B')).toBeNull();
  });

  it('serves the snapshot when the request fails with a network error', async () => {
    seed();
    getRecs.mockRejectedValue(new TypeError('Network request failed'));
    await signIn();
    open();
    // The query retries once (1 s) before it gives up.
    expect(await screen.findByTestId('discover-offline-picks', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByTestId('rec-row-crowd_pleasers-1')).toBeTruthy();
  });

  it('serves the snapshot when decide is unreachable (the client wraps it as ApiError 0), after one retry', async () => {
    seed();
    getRecs.mockRejectedValue(new decide.ApiError(0, 'Network request failed'));
    await signIn();
    open();
    expect(await screen.findByTestId('discover-offline-picks', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByTestId('rec-row-crowd_pleasers-1')).toBeTruthy();
    expect(getRecs).toHaveBeenCalledTimes(2);
  });

  it('a server error (500) is not treated as offline', async () => {
    seed();
    getRecs.mockRejectedValue(new decide.ApiError(500, 'boom'));
    await signIn();
    open();
    await waitFor(() => expect(getRecs).toHaveBeenCalledTimes(2), { timeout: 4000 });
    await act(async () => {});
    expect(screen.queryByTestId('discover-offline-picks')).toBeNull();
  });

  it('song feedback is disabled while offline', async () => {
    seed();
    setNet(false);
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('rec-menu-crowd_pleasers-0'));
    fireEvent.press(await screen.findByTestId('song-menu-hide'));
    expect(hideSong).not.toHaveBeenCalled();
  });

  it('signing out removes the snapshot', async () => {
    await signIn();
    open();
    await screen.findByTestId('rec-row-crowd_pleasers-0');
    await waitFor(() => expect(loadRecsSnapshot()).not.toBeNull());
    await act(() => useAuth.getState().signOut());
    await waitFor(() => expect(loadRecsSnapshot()).toBeNull());
  });
});

describe('loadRecsSnapshot', () => {
  it('returns null for garbage and wrong shapes', () => {
    appStorage.set('discover.recs.v1', '{not json');
    expect(loadRecsSnapshot()).toBeNull();
    appStorage.set('discover.recs.v1', JSON.stringify({ key: 'k', savedAt: Date.now(), data: { sections: 'x' } }));
    expect(loadRecsSnapshot()).toBeNull();
    appStorage.set('discover.recs.v1', JSON.stringify([1, 2]));
    expect(loadRecsSnapshot()).toBeNull();
  });

  it('round-trips a fresh snapshot and expires it after 7 days', () => {
    const now = 1_000_000_000_000;
    saveRecsSnapshot('k', SAVED, now);
    expect(loadRecsSnapshot(now + DAY)?.data).toEqual(SAVED);
    expect(loadRecsSnapshot(now + 8 * DAY)).toBeNull();
  });
});
