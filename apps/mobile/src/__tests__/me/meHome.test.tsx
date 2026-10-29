// The Me home (Phase 4a, B8): profile card, go-tos, setlists, All your songs, stats; signed out shows sign-in.
import * as decide from '@nomad/api-decide';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { userKeyFor } from '../../auth/userKey';
import { goTosStorageKey } from '../../me/account';
import { appStorage } from '../../storage';
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
  putKaraokeLog: jest.fn(async () => ({})),
  getServicesSummary: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getVoiceProfile: jest.fn(async () => null),
  getVoiceFlags: jest.fn(async () => ({ session_enabled: false, is_admin: false, voice_data: false })),
  popularSongs: jest.fn(async () => []),
  getRecommendationsV2: jest.fn(),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  // By default an older box (no history routes): "Were these you?" stays hidden.
  getHistorySuggestions: jest.fn(async () => {
    const { KjboxError } = jest.requireActual('@nomad/api-kjbox');
    throw new KjboxError('not_found', 404);
  }),
}));

const api = decide as jest.Mocked<typeof decide>;

const goTo = (n: number) => li(`Band ${n}`, `Song ${n}`, { times_sung: 10 - n, latest_feel: 'great', feel_counts: { great: 1 } });

/** A recs row as decide sends it (only what the shelf reads matters). */
const rec = (artist: string, title: string, o: Record<string, unknown> = {}) => ({
  song_key: `k_${title}`, artist, title, reason: "You've sung this", reason_type: 'sung_before', reason_artist: null,
  score: 1, has_karaoke_version: true, karaoke: { community: true, karafun: false }, fit: null, ...o,
});
const recsWith = (sections: { id: string; songs: unknown[] }[]) => ({
  sections: sections.map((s) => ({ title_key: `recs.section.${s.id}.title`, reason_key: null, ...s })),
  filters_applied: {}, next_cursor: null, has_profile: true, catalog_run: 'r',
});
/** An uncatalogued go-to: no song_key, the `u:` identity. */
const pubSong = li('Bar Band', 'Pub Song', { key: 'u:bar band|pub song', song_key: null, times_sung: 3, latest_feel: 'ok' });

beforeEach(() => {
  jest.clearAllMocks();
  api.getRecommendationsV2.mockRejectedValue(new decide.ApiError(503, 'warming_up'));
  resetMe('me@example.com');
  useVoiceStore.getState().clear();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  api.getServicesSummary.mockResolvedValue({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } } as never);
  api.getLibrary.mockResolvedValue({
    status: 'ok', etag: 'e',
    items: [1, 2, 3, 4, 5, 6, 7].map(goTo).concat([li('Solo', 'Once', { times_sung: 1 })]),
  } as never);
});

describe('Me home', () => {
  it('lists up to 5 go-tos, the all-songs row, stats, and keeps the existing rows', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    expect(await screen.findByTestId('me-gotos')).toBeTruthy();
    expect(await screen.findByTestId('me-goto-4')).toBeTruthy();
    expect(screen.queryByTestId('me-goto-5')).toBeNull();
    expect(await screen.findByTestId('me-all-songs')).toHaveTextContent(/8/);
    expect(screen.getByTestId('me-stats')).toBeTruthy();
    for (const id of ['me-credits', 'me-buy', 'me-music-profile', 'me-signout', 'me-offline', 'me-language']) {
      expect(await screen.findByTestId(id)).toBeTruthy();
    }
    fireEvent.press(screen.getByTestId('me-all-songs'));
    expect(await screen.findByTestId('me-songs')).toBeTruthy();
  });

  it('puts the profile card first, then go-tos, setlists, all-songs, stats', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await screen.findByTestId('me-credits');
    await screen.findByTestId('me-goto-0');
    const order = ['me-profile-card', 'me-gotos', 'me-setlists', 'me-all-songs', 'me-stats', 'me-credits'];
    const json = JSON.stringify(screen.toJSON());
    const at = order.map((id) => json.indexOf(`"testID":"${id}"`));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('"Were these you?" sits between the profile card and the go-tos, only with suggestions', async () => {
    const kj = jest.requireMock<{ getHistorySuggestions: jest.Mock }>('@nomad/api-kjbox');
    kj.getHistorySuggestions.mockResolvedValueOnce({
      api_version: '1.0',
      more_nights: 0,
      nights: [{ night_id: 'n1', date: '2026-10-10', venue: null, names: ['Wren'], unmatched: 0,
        songs: [{ entry_id: 1, singer_name: 'Wren', members: ['Wren'], artist: 'Muse', title: 'Starlight', started_at: null, state: 'sung_unplayed' }] }],
    });
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await screen.findByTestId('me-claim-night-0');
    await screen.findByTestId('me-goto-0');
    const order = ['me-profile-card', 'me-claim', 'me-gotos'];
    const json = JSON.stringify(screen.toJSON());
    const at = order.map((id) => json.indexOf(`"testID":"${id}"`));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('no "Were these you?" on an older box', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await screen.findByTestId('me-goto-0');
    expect(screen.queryByTestId('me-claim')).toBeNull();
  });

  it('profile card: voice CTA and connect CTA with nothing set up; manage opens the music profile', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    const card = await screen.findByTestId('me-profile-card');
    expect(within(card).getByTestId('me-profile-voice-cta')).toBeTruthy();
    expect(await within(card).findByTestId('me-profile-connect')).toBeTruthy();
    fireEvent.press(within(card).getByTestId('me-profile-manage'));
    expect(await screen.findByTestId('profile-screen')).toBeTruthy();
  });

  it('profile card: voice range keys and source icons when set up', async () => {
    useVoiceStore.getState().save({
      lowMidi: 45, highMidi: 69, comfortLow: 48, comfortHigh: 66, voiceType: 'baritone', voiceTypeBetween: null,
      register: null, confidence: 'high', method: 'mic', measuredAt: '2026-10-01T00:00:00Z',
    });
    api.getServicesSummary.mockResolvedValue({
      sources: [{ source: 'spotify', connected: true, songs: 120 }],
      capabilities: { screenshot_import: false, listenbrainz_oauth: false },
    } as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    const card = await screen.findByTestId('me-profile-card');
    expect(within(card).getByTestId('me-profile-keys')).toBeTruthy();
    expect(within(card).queryByTestId('me-profile-voice-cta')).toBeNull();
    expect(await within(card).findByTestId('me-profile-source-spotify', { includeHiddenElements: true })).toBeTruthy();
    expect(within(card).queryByTestId('me-profile-known')).toBeNull();
    expect(within(card).getByTestId('me-profile-sung')).toHaveTextContent(/8/);
  });

  it('profile card: songs known comes from decide (deduped), and is hidden when decide does not send it', async () => {
    api.getServicesSummary.mockResolvedValue({
      sources: [{ source: 'spotify', connected: true, songs: 120 }, { source: 'lastfm', connected: true, songs: 300 }],
      capabilities: { screenshot_import: false, listenbrainz_oauth: false },
      known_songs: 340,
    } as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    const card = await screen.findByTestId('me-profile-card');
    // decide's deduplicated total, not the per-source sum (420)
    expect(await within(card).findByTestId('me-profile-known')).toHaveTextContent('340 songs known');
  });

  it('profile card: each source mark is announced by its service name (a mark alone says nothing)', async () => {
    api.getServicesSummary.mockResolvedValue({
      sources: [
        { source: 'lastfm', connected: true, songs: 2 },
        { source: 'spotify_export', connected: true, songs: 5 },
        { source: 'spotify_playlist', connected: true, songs: 9 },
      ],
      capabilities: { screenshot_import: false, listenbrainz_oauth: false },
    } as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    const card = await screen.findByTestId('me-profile-card');
    const lastfm = await within(card).findByTestId('me-profile-source-lastfm');
    expect(lastfm).toHaveProp('accessibilityLabel', 'Last.fm');
    expect(lastfm).toHaveProp('accessible', true);
    // One mark per brand, named for the brand rather than one of its sources.
    expect(within(card).getByTestId('me-profile-source-spotify')).toHaveProp('accessibilityLabel', 'Spotify');
    expect(within(card).getAllByLabelText('Spotify')).toHaveLength(1);
  });

  it('recs go_tos come first with their fit badge, then the local uncatalogued go-tos (no other local ones)', async () => {
    api.getLibrary.mockResolvedValue({
      status: 'ok', etag: 'e',
      items: [goTo(1), goTo(2), pubSong, li('Recs Artist', 'Recs Hit', { times_sung: 2 })],
    } as never);
    api.getRecommendationsV2.mockResolvedValue(recsWith([
      { id: 'go_tos', songs: [rec('Recs Artist', 'Recs Hit', { fit: { bucket: 'fitsIn', transpose: -2, octave: 0 } })] },
      { id: 'songs_you_know', songs: [rec('Band 1', 'Song 1')] },
    ]) as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await waitFor(() => expect(screen.getByTestId('me-goto-0')).toHaveTextContent(/Recs Hit/));
    expect(screen.getByTestId('me-goto-fit-0')).toBeTruthy();
    expect(screen.getByTestId('me-goto-1')).toHaveTextContent(/Pub Song/);
    expect(screen.queryByTestId('me-goto-fit-1')).toBeNull();
    // Catalogued go-tos come from recs only (songs_you_know is not the go-tos section).
    expect(screen.queryByTestId('me-goto-2')).toBeNull();
    // Defaults, any venue library: the shelf never inherits Discover's filters.
    expect(api.getRecommendationsV2).toHaveBeenCalledWith({});
    // Kept per account for offline.
    await waitFor(() => expect(appStorage.getString(goTosStorageKey(userKeyFor('me@example.com')))).toMatch(/Recs Hit/));
  });

  it('a recs go-to the phone now knows is hidden or "not for me" is left out; duplicates show once', async () => {
    api.getLibrary.mockResolvedValue({
      status: 'ok', etag: 'e',
      items: [pubSong, li('A', 'Gone Bad', { times_sung: 4, latest_feel: 'bad' }), li('B', 'Kept', { times_sung: 2 })],
    } as never);
    api.getRecommendationsV2.mockResolvedValue(recsWith([
      { id: 'go_tos', songs: [rec('A', 'Gone Bad'), rec('B', 'Kept'), rec('B', 'Kept')] },
    ]) as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await waitFor(() => expect(screen.getByTestId('me-goto-0')).toHaveTextContent(/Kept/));
    expect(screen.getByTestId('me-goto-1')).toHaveTextContent(/Pub Song/);
    expect(screen.queryByTestId('me-goto-2')).toBeNull();
  });

  it('without a recs go_tos section the local go-tos are used (catalogued ones included)', async () => {
    api.getLibrary.mockResolvedValue({ status: 'ok', etag: 'e', items: [goTo(1), pubSong] } as never);
    api.getRecommendationsV2.mockResolvedValue(recsWith([{ id: 'songs_you_know', songs: [rec('Band 1', 'Song 1')] }]) as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await waitFor(() => expect(api.getRecommendationsV2).toHaveBeenCalled());
    expect(await screen.findByTestId('me-goto-1')).toBeTruthy();
    expect(screen.getByTestId('me-goto-0')).toHaveTextContent(/Song 1/);
    expect(screen.getByTestId('me-goto-1')).toHaveTextContent(/Pub Song/);
    expect(screen.queryByTestId('me-goto-fit-0')).toBeNull();
  });

  it('offline (decide unreachable), the last recs go-tos cached for this account still show', async () => {
    api.getLibrary.mockResolvedValue({ status: 'ok', etag: 'e', items: [goTo(1)] } as never);
    appStorage.set(
      goTosStorageKey(userKeyFor('me@example.com')),
      JSON.stringify({ songs: [rec('Recs Artist', 'Recs Hit')], savedAt: Date.now() }),
    );
    api.getRecommendationsV2.mockRejectedValue(new decide.ApiError(0, 'network'));
    renderRouter(appRoutes(), { initialUrl: '/me' });
    await waitFor(() => expect(screen.getByTestId('me-goto-0')).toHaveTextContent(/Recs Hit/));
    expect(screen.queryByTestId('me-goto-1')).toBeNull();
  });

  it('empty go-tos open the bulk picker; New setlist opens a named setlist', async () => {
    api.getLibrary.mockResolvedValue({ status: 'ok', etag: 'e', items: [] } as never);
    renderRouter(appRoutes(), { initialUrl: '/me' });
    fireEvent.press(await screen.findByTestId('me-gotos-empty-cta'));
    expect(await screen.findByTestId('sung-before')).toBeTruthy();
  });

  it('creating a setlist from the shelf navigates to it', async () => {
    renderRouter(appRoutes(), { initialUrl: '/me' });
    fireEvent.press(await screen.findByTestId('me-setlist-new'));
    fireEvent.changeText(await screen.findByTestId('setlist-name-input'), 'Friday');
    fireEvent.press(screen.getByTestId('setlist-name-save'));
    expect(await screen.findByTestId('setlist')).toBeTruthy();
  });
});

it('signed out shows only sign-in', async () => {
  useAuth.setState({ state: { status: 'signedOut' } as never, hydrated: true });
  renderRouter(appRoutes(), { initialUrl: '/me' });
  expect(await screen.findByTestId('me-signin')).toBeTruthy();
  expect(screen.queryByTestId('me-profile-card')).toBeNull();
  expect(screen.queryByTestId('me-gotos')).toBeNull();
});
