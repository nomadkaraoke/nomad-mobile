// musicProfile: Me -> "Your music profile" at /me/music-profile (Task E9, spec §8.3).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useAuth } from '../auth/store';
import { useRecFilters } from '../discover/filtersStore';
import { QUIZ_STORAGE_KEY, useQuizDraft } from '../discover/quizStore';
import { appStorage } from '../storage';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';
import { profileFromSelfReport, useVoiceStore, type LocalVoiceProfile } from '../voice/voiceStore';

// Router-rendered screens with optimistic edits run slowly on CI runners (5 s default timed out there).
jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  // Phase 3b: the Improve card and the profile's Connected section read the services summary.
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } })),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getRecommendationsV2: jest.fn(),
  getPreferences: jest.fn(),
  listMyArtists: jest.fn(),
  removeMyArtist: jest.fn(),
  listLovedSongs: jest.fn(),
  unloveSong: jest.fn(),
  listHiddenSongs: jest.fn(),
  unhideSong: jest.fn(),
  getQuizProgress: jest.fn(),
  saveQuizProgress: jest.fn(async () => ({ saved: true })),
  smartQuizArtists: jest.fn(async () => ({ artists: [], has_more: false })),
  searchSongs: jest.fn(),
  submitQuiz: jest.fn(async () => ({ message: 'ok', songs_added: 1, recommendations_ready: true })),
  loveSong: jest.fn(async () => undefined),
  listMusicServices: jest.fn(async () => []),
  getVoiceProfile: jest.fn(async () => null),
  putVoiceProfile: jest.fn(async () => ({})),
  deleteVoiceProfile: jest.fn(async () => undefined),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));

const m = (f: unknown) => f as jest.Mock;
const song = (artist: string, title: string) => ({ song_key: `${artist}|${title}`.toLowerCase(), artist, title });
const userArtist = (artist_name: string) => ({ artist_name, sources: ['quiz'] });

let artistRows: unknown[];
let lovedRows: unknown[];
let hiddenRows: unknown[];

const routes = () => ({
  ...appRoutes(),
  'review/[id]': () => <View testID="review-stub" />,
  'make/new': () => <View testID="make-stub" />,
  'song/[id]': () => <View testID="song-stub" />,
  'discover/voice': () => <View testID="voice-stub" />,
});
const open = (url = '/me/music-profile') => renderRouter(routes(), { initialUrl: url });
const signIn = () => act(() => useAuth.getState().signInWithSession(session()));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  act(() => useQuizDraft.getState().reset());
  appStorage.remove(QUIZ_STORAGE_KEY);
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  artistRows = [userArtist('Alpha Band'), userArtist('Beta Band')];
  lovedRows = [song('Gamma Group', 'Invented Song')];
  hiddenRows = [song('Delta Duo', 'Made Up Tune'), song('Echo Trio', 'Pretend Anthem')];
  m(decide.getPreferences).mockResolvedValue({ genres: ['rock', 'classic-rock'], decades: ['1990s'], energy_preference: 'high' });
  m(decide.listMyArtists).mockImplementation(async () => ({ artists: artistRows, total: artistRows.length, page: 1, per_page: 50, has_more: false }));
  m(decide.listLovedSongs).mockImplementation(async () => lovedRows);
  m(decide.listHiddenSongs).mockImplementation(async () => hiddenRows);
  m(decide.getRecommendationsV2).mockResolvedValue({ sections: [], filters_applied: {}, next_cursor: null, has_profile: true, catalog_run: 'r' });
  m(decide.getQuizProgress).mockResolvedValue(null);
  m(decide.removeMyArtist).mockImplementation(async (name: string) => {
    artistRows = artistRows.filter((a) => (a as { artist_name: string }).artist_name !== name);
  });
  m(decide.unhideSong).mockImplementation(async (key: string) => {
    hiddenRows = hiddenRows.filter((s) => (s as { song_key: string }).song_key !== key);
  });
  m(decide.unloveSong).mockImplementation(async (key: string) => {
    lovedRows = lovedRows.filter((s) => (s as { song_key: string }).song_key !== key);
  });
});

describe('musicProfile', () => {
  it('renders the quiz answers, artists, loved and hidden songs', async () => {
    await signIn();
    open();
    expect(await screen.findByTestId('profile-screen')).toBeTruthy();
    expect(await screen.findByText(/Alpha Band/)).toBeTruthy();
    expect(screen.getByTestId('profile-genres')).toHaveTextContent('Rock, Classic rock');
    expect(screen.getByTestId('profile-decades')).toHaveTextContent('1990s');
    expect(screen.getByTestId('profile-energy')).toHaveTextContent('Energy: Big energy');
    expect(screen.getByTestId('profile-artist-remove-1')).toBeTruthy();
    expect(screen.getByTestId('profile-loved-remove-0')).toBeTruthy();
    expect(screen.getByTestId('profile-hidden-unhide-1')).toBeTruthy();
  });

  it('unhide calls unhideSong(key), drops the row and refreshes the picks', async () => {
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('profile-hidden-unhide-0'));
    await waitFor(() => expect(decide.unhideSong).toHaveBeenCalledWith('delta duo|made up tune'));
    await waitFor(() => expect(screen.queryByText(/Delta Duo/)).toBeNull());
    expect(screen.getByText(/Echo Trio/)).toBeTruthy();
    expect(screen.getByTestId('profile-hidden-unhide-0')).toBeTruthy();
    expect(screen.queryByTestId('profile-hidden-unhide-1')).toBeNull();
  });

  it('removing an artist calls removeMyArtist(name)', async () => {
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('profile-artist-remove-0'));
    await waitFor(() => expect(decide.removeMyArtist).toHaveBeenCalledWith('Alpha Band'));
    await waitFor(() => expect(screen.queryByText(/Alpha Band/)).toBeNull());
    expect(screen.getByText(/Beta Band/)).toBeTruthy();
  });

  it('removing a loved song calls unloveSong(key)', async () => {
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('profile-loved-remove-0'));
    await waitFor(() => expect(decide.unloveSong).toHaveBeenCalledWith('gamma group|invented song'));
    await waitFor(() => expect(screen.queryByTestId('profile-loved-remove-0')).toBeNull());
  });

  it('puts the row back and says so when decide refuses', async () => {
    m(decide.unhideSong).mockRejectedValue(new Error('boom'));
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('profile-hidden-unhide-0'));
    expect(await screen.findByTestId('profile-error')).toBeTruthy();
    expect(await screen.findByText(/Delta Duo/)).toBeTruthy();
  });

  it('invalidates the picks and the profile after an edit', async () => {
    const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('profile-artist-remove-0'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recs'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['musicProfile'] });
    invalidate.mockRestore();
  });

  it('edit genres opens the quiz at step 1, edit decades at step 2', async () => {
    await signIn();
    const app = open();
    fireEvent.press(await screen.findByTestId('profile-edit-genres'));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/quiz'));
    expect(app.getSearchParams()).toEqual(expect.objectContaining({ step: '1' }));
    act(() => router.back());
    fireEvent.press(await screen.findByTestId('profile-edit-decades'));
    await waitFor(() => expect(app.getSearchParams()).toEqual(expect.objectContaining({ step: '2' })));
  });

  it('Me shows the entry row only when signed in', async () => {
    const app = open('/me');
    expect(await screen.findByTestId('me-signin')).toBeTruthy();
    expect(screen.queryByTestId('me-music-profile')).toBeNull();
    await signIn();
    fireEvent.press(await screen.findByTestId('me-music-profile'));
    await waitFor(() => expect(app.getPathname()).toBe('/me/music-profile'));
  });

  it("never shows the previous person's profile after signing in as someone else", async () => {
    await signIn();
    const app = open();
    expect(await screen.findByText(/Alpha Band/)).toBeTruthy();
    await act(() => useAuth.getState().signOut());
    // B's profile is still loading: A's cached rows must not stand in for it.
    m(decide.listMyArtists).mockImplementation(() => new Promise(() => {}));
    m(decide.listLovedSongs).mockImplementation(() => new Promise(() => {}));
    m(decide.listHiddenSongs).mockImplementation(() => new Promise(() => {}));
    m(decide.getPreferences).mockImplementation(() => new Promise(() => {}));
    gen.getMe.mockResolvedValue({ email: 'b@example.com', credits: 3 } as never);
    await act(() => useAuth.getState().signInWithSession(session('b@example.com')));
    act(() => router.push('/me/music-profile'));
    await waitFor(() => expect(app.getPathname()).toBe('/me/music-profile'));
    expect(await screen.findByTestId('profile-screen')).toBeTruthy();
    expect(screen.queryByText(/Alpha Band/)).toBeNull();
    expect(screen.queryByText(/Delta Duo/)).toBeNull();
    expect(screen.queryByText(/Classic rock/)).toBeNull();
  });

  describe('editing in the quiz', () => {
    const editQuiz = '/discover/quiz?step=4&from=profile';

    it('seeds the draft from the profile when there is no saved progress, and submit keeps it', async () => {
      await signIn();
      const app = open(editQuiz);
      fireEvent.press(await screen.findByTestId('quiz-finish'));
      await waitFor(() => expect(decide.submitQuiz).toHaveBeenCalled());
      expect(decide.submitQuiz).toHaveBeenCalledWith(
        expect.objectContaining({
          genres: ['rock', 'classic-rock'],
          decade_preferences: ['1990s'],
          energy_preference: 'high',
          artist_affinities: [
            { artist_name: 'Alpha Band', affinity: 'like' },
            { artist_name: 'Beta Band', affinity: 'like' },
          ],
        }),
      );
      expect(decide.loveSong).toHaveBeenCalledWith('gamma group|invented song', { artist: 'Gamma Group', title: 'Invented Song' });
      // Opened from the profile, finishing goes back to it.
      await waitFor(() => expect(app.getPathname()).toBe('/me/music-profile'));
    });

    it('untapping a loved song unloves it on finish', async () => {
      lovedRows = [song('Gamma Group', 'Invented Song'), song('Kappa Crew', 'Fake Ballad')];
      await signIn();
      open(editQuiz);
      fireEvent.press(await screen.findByTestId('quiz-picked-song-0'));
      await waitFor(() => expect(screen.queryByText(/Gamma Group/)).toBeNull());
      fireEvent.press(screen.getByTestId('quiz-finish'));
      await waitFor(() => expect(decide.unloveSong).toHaveBeenCalledWith('gamma group|invented song'));
      expect(decide.unloveSong).toHaveBeenCalledTimes(1);
      expect(decide.loveSong).not.toHaveBeenCalledWith('gamma group|invented song', expect.anything());
      expect(decide.loveSong).toHaveBeenCalledWith('kappa crew|fake ballad', { artist: 'Kappa Crew', title: 'Fake Ballad' });
    });

    it('keeps the love level of profile artists when the quiz is submitted (like only when decide has none)', async () => {
      artistRows = [
        { artist_name: 'Alpha Band', sources: ['quiz'], affinity: 'love' },
        { artist_name: 'Beta Band', sources: ['quiz'], affinity: 'occasionally' },
        { artist_name: 'Gamma Synced', sources: ['spotify'], affinity: null },
      ];
      await signIn();
      open(editQuiz);
      fireEvent.press(await screen.findByTestId('quiz-finish'));
      await waitFor(() => expect(decide.submitQuiz).toHaveBeenCalled());
      expect(decide.submitQuiz).toHaveBeenCalledWith(
        expect.objectContaining({
          artist_affinities: [
            { artist_name: 'Alpha Band', affinity: 'love' },
            { artist_name: 'Beta Band', affinity: 'like' },
            { artist_name: 'Gamma Synced', affinity: 'like' },
          ],
        }),
      );
    });

    it('finishing an edit opened from the profile shows the new answers there (no stale profile)', async () => {
      await signIn();
      const app = open();
      await waitFor(() => expect(screen.getByTestId('profile-genres')).toHaveTextContent('Rock, Classic rock'));
      fireEvent.press(screen.getByTestId('profile-edit-genres'));
      await waitFor(() => expect(app.getPathname()).toBe('/discover/quiz'));
      // decide now has the new answers (what the submit below saves).
      m(decide.getPreferences).mockResolvedValue({ genres: ['metal'], decades: ['1990s'], energy_preference: 'high' });
      act(() => useQuizDraft.getState().update((d) => ({ ...d, step: 4 })));
      fireEvent.press(await screen.findByTestId('quiz-finish'));
      await waitFor(() => expect(app.getPathname()).toBe('/me/music-profile'));
      await waitFor(() => expect(screen.getByTestId('profile-genres')).toHaveTextContent('Metal'));
    });

    it('an artist removed on the profile does not come back from a stale saved progress', async () => {
      m(decide.getQuizProgress).mockResolvedValue({
        step: 3,
        genres: ['pop'],
        decades: [],
        energy_preference: null,
        artist_affinities: [
          { artist_name: 'Alpha Band', affinity: 'love' },
          { artist_name: 'Gone Band', affinity: 'like' },
        ],
        manual_artists: [{ artist_name: 'Gone Band', mbid: 'mb-gone' }],
        enjoy_songs: [],
      });
      artistRows = [userArtist('Alpha Band')];
      await signIn();
      open(editQuiz);
      fireEvent.press(await screen.findByTestId('quiz-finish'));
      await waitFor(() => expect(decide.submitQuiz).toHaveBeenCalled());
      const body = m(decide.submitQuiz).mock.calls[0][0];
      // Current preferences win over the stale doc; the removed artist is gone from both lists.
      expect(body.genres).toEqual(['rock', 'classic-rock']);
      expect(body.artist_affinities).toEqual([{ artist_name: 'Alpha Band', affinity: 'love' }]);
      expect(JSON.stringify(body.manual_artists)).not.toContain('Gone Band');
    });
  });
});

describe('Your voice (Phase 3c)', () => {
  const MIC: LocalVoiceProfile = {
    lowMidi: 43, highMidi: 67, comfortLow: 48, comfortHigh: 62, voiceType: 'baritone', voiceTypeBetween: null,
    register: null, confidence: 'high', method: 'mic', measuredAt: '2026-10-22T10:00:00Z',
  };
  beforeEach(() => act(() => useVoiceStore.getState().clear()));

  it('no profile: says so and offers the voice test', async () => {
    await signIn();
    const app = open();
    expect(await screen.findByTestId('voice-section')).toHaveTextContent(/No voice profile yet/);
    fireEvent.press(screen.getByTestId('voice-test'));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/voice'));
  });

  it('a mic profile: type, range on the keyboard, how it was measured, and Redo', async () => {
    act(() => useVoiceStore.getState().adopt(MIC));
    await signIn();
    const app = open();
    expect(await screen.findByTestId('voice-section-type')).toHaveTextContent('Likely Baritone');
    expect(screen.getByTestId('voice-section-range')).toHaveTextContent(/G2.*G4/);
    expect(screen.getByTestId('voice-section-keys')).toBeTruthy();
    expect(screen.getByTestId('voice-section-method')).toHaveTextContent('Measured with the mic test');
    fireEvent.press(screen.getByTestId('voice-redo'));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/voice'));
  });

  it('a self-reported profile says it was not measured', async () => {
    act(() => useVoiceStore.getState().adopt(profileFromSelfReport('tenor', '2026-10-22T10:00:00Z')));
    await signIn();
    open();
    expect(await screen.findByTestId('voice-section-method')).toHaveTextContent('From your pick, not measured');
  });

  it('remove: DELETEs on decide, clears the phone copy and the voice filters', async () => {
    act(() => useVoiceStore.getState().adopt(MIC));
    act(() => useRecFilters.getState().set({ singable: true, sort: 'fit' }));
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('voice-remove'));
    await waitFor(() => expect(decide.deleteVoiceProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useVoiceStore.getState().profile).toBeNull());
    expect(useRecFilters.getState().filters).toMatchObject({ singable: false, sort: 'best' });
    expect(await screen.findByTestId('voice-test')).toBeTruthy();
  });

  it('remove fails: says so and keeps the profile', async () => {
    m(decide.deleteVoiceProfile).mockRejectedValueOnce(new Error('offline'));
    act(() => useVoiceStore.getState().adopt(MIC));
    await signIn();
    open();
    fireEvent.press(await screen.findByTestId('voice-remove'));
    expect(await screen.findByTestId('voice-remove-error')).toBeTruthy();
    expect(useVoiceStore.getState().profile).not.toBeNull();
  });
});
