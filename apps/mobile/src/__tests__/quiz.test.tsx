// quiz: "Get your picks in 30 seconds" at /discover/quiz (Task E8, spec §8.2).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { BackHandler, View } from 'react-native';

import { useAuth } from '../auth/store';
import { QUIZ_STORAGE_KEY, useQuizDraft } from '../discover/quizStore';
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
  configureClient: jest.fn(),
  getRecommendationsV2: jest.fn(),
  getQuizProgress: jest.fn(),
  saveQuizProgress: jest.fn(),
  smartQuizArtists: jest.fn(),
  searchArtists: jest.fn(),
  submitQuiz: jest.fn(),
  loveSong: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));

const getProgress = decide.getQuizProgress as jest.Mock;
const saveProgress = decide.saveQuizProgress as jest.Mock;
const smart = decide.smartQuizArtists as jest.Mock;
const searchArtists = decide.searchArtists as jest.Mock;
const submitQuiz = decide.submitQuiz as jest.Mock;
const loveSong = decide.loveSong as jest.Mock;
const getRecs = decide.getRecommendationsV2 as jest.Mock;
const popularSongs = decide.popularSongs as jest.Mock;
const searchSongs = decide.searchSongs as jest.Mock;

const artist = (name: string, why: string | null = `Based on rock`): decide.QuizArtistResponse => ({
  name,
  mbid: `mb-${name}`,
  song_count: 10,
  top_songs: [],
  total_brand_count: 3,
  primary_decade: '1990s',
  genres: [],
  tags: [],
  suggestion_reason: why ? { type: 'genre_match', display_text: why } : null,
});
const group = (artist: string, title: string) => ({
  song_key: `${artist.toLowerCase()}|${title.toLowerCase()}`,
  artist,
  title,
  version_count: 2,
  versions: [],
});
const recs = (hasProfile: boolean) => ({
  sections: [],
  filters_applied: {},
  next_cursor: null,
  has_profile: hasProfile,
  catalog_run: 'r1',
});

const routes = () => ({
  ...appRoutes(),
  'review/[id]': () => <View testID="review-stub" />,
  'make/new': () => <View testID="make-stub" />,
  'song/[id]': () => <View testID="song-stub" />,
});
const open = (url = '/discover/quiz') => renderRouter(routes(), { initialUrl: url });
const signIn = () => act(() => useAuth.getState().signInWithSession(session()));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  resetSearchCacheForTests();
  act(() => useQuizDraft.getState().reset());
  appStorage.remove(QUIZ_STORAGE_KEY);
  await useAuth.getState().signOut();
  act(() => useLibraryFilter.getState().set('any'));
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  popularSongs.mockResolvedValue([group('Band One', 'Invented Song'), group('Band Two', 'Made Up Tune')]);
  searchSongs.mockResolvedValue({
    identification: { status: 'none', kind: null, best: null, candidates: [] },
    groups: [group('Band One', 'Invented Song')],
    index: { run: 'r', built_at: 1 },
    sid: 's',
  });
  getRecs.mockResolvedValue(recs(false));
  getProgress.mockResolvedValue(null);
  saveProgress.mockResolvedValue({ saved: true });
  smart.mockResolvedValue({
    artists: [artist('Alpha Band'), artist('Beta Band', 'Fans of Gamma also like')],
    has_more: true,
  });
  searchArtists.mockResolvedValue({ artists: [], total: 0 });
  submitQuiz.mockResolvedValue({ message: 'ok', songs_added: 5, recommendations_ready: true });
  loveSong.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('quiz', () => {
  it('signed out opens sign-in and comes back to the quiz', async () => {
    const app = open();
    await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
    expect(app.getSearchParams()).toEqual(expect.objectContaining({ returnTo: '/discover/quiz' }));
    expect(getProgress).not.toHaveBeenCalled();
    expect(screen.getByTestId('quiz-signin', { includeHiddenElements: true })).toBeTruthy();
  });

  it('next is disabled without a genre', async () => {
    await signIn();
    open();
    expect(await screen.findByTestId('quiz-genre-pop')).toBeTruthy();
    expect(screen.getByTestId('quiz-genre-other')).toBeTruthy();
    expect(screen.queryByTestId('quiz-skip')).toBeNull();
    expect(screen.getByTestId('quiz-next')).toBeDisabled();
    fireEvent.press(screen.getByTestId('quiz-genre-rock'));
    expect(screen.getByTestId('quiz-next')).toBeEnabled();
    fireEvent.press(screen.getByTestId('quiz-next'));
    expect(await screen.findByTestId('quiz-decade-1990s')).toBeTruthy();
    expect(screen.getByTestId('quiz-energy-chill')).toBeTruthy();
    expect(screen.getByText('Big energy')).toBeTruthy();
    expect(screen.getByTestId('quiz-skip')).toBeTruthy();
  });

  it('resumes from saved progress at step 3', async () => {
    await signIn();
    getProgress.mockResolvedValue({
      step: 3,
      genres: ['rock'],
      decades: ['1990s'],
      energy_preference: 'high',
      artist_affinities: [{ artist_name: 'Saved Artist', affinity: 'love' }],
    });
    open();
    expect(await screen.findByTestId('quiz-artist-search')).toBeTruthy();
    // The picked artist shows (loved), and suggestions load for the resumed step.
    expect(within(screen.getByTestId('quiz-picked-artist-0')).getByText('♥ Love')).toBeTruthy();
    expect(await screen.findByTestId('quiz-artist-suggestion-0')).toBeTruthy();
    expect(smart).toHaveBeenCalledWith(
      expect.objectContaining({ genres: ['rock'], decades: ['1990s'], manual_artists: ['Saved Artist'] }),
    );
  });

  it('opens the step from the route param', async () => {
    await signIn();
    getProgress.mockResolvedValue({ step: 1, genres: ['pop'], decades: [] });
    open('/discover/quiz?step=3');
    expect(await screen.findByTestId('quiz-artist-search')).toBeTruthy();
  });

  it('falls back to the copy on this phone when decide has no progress', async () => {
    await signIn();
    appStorage.set(
      QUIZ_STORAGE_KEY,
      JSON.stringify({ owner: 'me@example.com', progress: { step: 2, genres: ['jazz'], decades: ['1960s'] } }),
    );
    open();
    expect(await screen.findByTestId('quiz-decade-1960s')).toBeSelected();
  });

  it("ignores another account's copy on this phone", async () => {
    await signIn();
    appStorage.set(
      QUIZ_STORAGE_KEY,
      JSON.stringify({ owner: 'someone@example.com', progress: { step: 2, genres: ['jazz'], decades: [] } }),
    );
    open();
    expect(await screen.findByTestId('quiz-genre-jazz')).not.toBeSelected();
  });

  it('artist tap cycles like/love/off', async () => {
    await signIn();
    getProgress.mockResolvedValue({ step: 3, genres: ['rock'], decades: [] });
    open();
    const tile = () => screen.getByTestId('quiz-artist-suggestion-0');
    expect(await screen.findByTestId('quiz-artist-suggestion-0')).toBeTruthy();
    // Every suggestion says why it is there.
    expect(within(tile()).getByText('Based on rock')).toBeTruthy();
    expect(within(screen.getByTestId('quiz-artist-suggestion-1')).getByText('Fans of Gamma also like')).toBeTruthy();
    expect(tile()).not.toBeSelected();

    smart.mockResolvedValue({ artists: [artist('Delta Band')], has_more: true });
    fireEvent.press(tile());
    expect(tile()).toBeSelected();
    expect(within(tile()).getByText('✓ Like')).toBeTruthy();
    fireEvent.press(tile());
    expect(within(tile()).getByText('♥ Love')).toBeTruthy();
    fireEvent.press(tile());
    expect(tile()).not.toBeSelected();
    expect(within(tile()).queryByText('♥ Love')).toBeNull();

    // A new pick asks for more: shown names are excluded and nothing already shown goes away.
    expect(await screen.findByText('Delta Band')).toBeTruthy();
    expect(smart).toHaveBeenLastCalledWith(
      expect.objectContaining({ exclude: expect.arrayContaining(['Alpha Band', 'Beta Band']) }),
    );
    expect(screen.getByText('Alpha Band')).toBeTruthy();
    expect(screen.getByText('Beta Band')).toBeTruthy();
    expect(useQuizDraft.getState().draft.artists).toEqual([]);
  });

  it('artist search adds a found artist (never free text)', async () => {
    await signIn();
    getProgress.mockResolvedValue({ step: 3, genres: ['rock'], decades: [] });
    searchArtists.mockResolvedValue({
      artists: [
        {
          name: 'Found Artist',
          mbid: 'mb-found',
          spotify_id: 'sp-found',
          artist_id: 'sp-found',
          artist_name: 'Found Artist',
        },
      ],
      total: 1,
    });
    open();
    fireEvent.changeText(await screen.findByTestId('quiz-artist-search'), 'found');
    fireEvent.press(await screen.findByTestId('quiz-artist-result-0'));
    expect(searchArtists).toHaveBeenCalledWith('found', expect.any(Number));
    expect(useQuizDraft.getState().draft.artists).toEqual([
      { name: 'Found Artist', mbid: 'mb-found', artistId: 'sp-found', affinity: 'like' },
    ]);
    expect(within(screen.getByTestId('quiz-picked-artist-0')).getByText('Found Artist')).toBeTruthy();
    // Love, then off: it stays listed (unpicked) so it can be tapped again.
    fireEvent.press(screen.getByTestId('quiz-picked-artist-0'));
    fireEvent.press(screen.getByTestId('quiz-picked-artist-0'));
    expect(screen.getByTestId('quiz-picked-artist-0')).not.toBeSelected();
    fireEvent.press(screen.getByTestId('quiz-picked-artist-0'));
    expect(screen.getByTestId('quiz-picked-artist-0')).toBeSelected();

    // Off again, then leave step 3 and come back: it is still listed.
    fireEvent.press(screen.getByTestId('quiz-picked-artist-0'));
    fireEvent.press(screen.getByTestId('quiz-picked-artist-0'));
    expect(useQuizDraft.getState().draft.artists).toEqual([]);
    fireEvent.press(screen.getByTestId('quiz-back'));
    fireEvent.press(await screen.findByTestId('quiz-skip'));
    expect(within(await screen.findByTestId('quiz-picked-artist-0')).getByText('Found Artist')).toBeTruthy();

    // A query with no match adds nothing.
    searchArtists.mockResolvedValue({ artists: [], total: 0 });
    fireEvent.changeText(screen.getByTestId('quiz-artist-search'), 'zzzz nobody');
    expect(await screen.findByTestId('quiz-artist-no-results')).toBeTruthy();
    expect(useQuizDraft.getState().draft.artists).toEqual([]);
  });

  it('suggestions prefetch when leaving step 2', async () => {
    await signIn();
    let step3WasUp: boolean | null = null;
    smart.mockImplementation(() => {
      step3WasUp = screen.queryByTestId('quiz-artist-search') !== null;
      return new Promise(() => {});
    });
    open();
    fireEvent.press(await screen.findByTestId('quiz-genre-punk'));
    fireEvent.press(screen.getByTestId('quiz-next'));
    fireEvent.press(await screen.findByTestId('quiz-decade-2000s'));
    expect(smart).not.toHaveBeenCalled();
    // Answered: the button says Next (Skip only while the step has no answer).
    expect(screen.queryByTestId('quiz-skip')).toBeNull();
    fireEvent.press(screen.getByTestId('quiz-next'));
    expect(await screen.findByTestId('quiz-artist-search')).toBeTruthy();
    expect(smart).toHaveBeenCalledTimes(1);
    expect(smart).toHaveBeenCalledWith(expect.objectContaining({ genres: ['punk'], decades: ['2000s'] }));
    expect(step3WasUp).toBe(false);
    expect(screen.getByTestId('quiz-suggestions-loading')).toBeTruthy();
  });

  it('says so when no suggestions came back (a failed call), instead of an empty grid', async () => {
    await signIn();
    smart.mockRejectedValue(new Error('500'));
    open();
    fireEvent.press(await screen.findByTestId('quiz-genre-punk'));
    fireEvent.press(screen.getByTestId('quiz-next'));
    fireEvent.press(await screen.findByTestId('quiz-skip'));
    expect(await screen.findByTestId('quiz-suggestions-none')).toBeTruthy();
    expect(screen.queryByTestId('quiz-suggestions-loading')).toBeNull();
    // Skippable: the step has no answer.
    expect(screen.getByTestId('quiz-skip')).toBeTruthy();
  });

  it('finish submits, loves songs and returns to Discover', async () => {
    await signIn();
    getProgress.mockResolvedValue({
      step: 4,
      genres: ['rock'],
      decades: ['1990s'],
      energy_preference: 'medium',
      vocal_comfort_pref: 'easy',
      artist_affinities: [{ artist_name: 'Saved Artist', affinity: 'like' }],
      enjoy_songs: [{ song_id: 'old|song', artist: 'Old', title: 'Song' }],
    });
    const app = open();
    // Step 4: tap a song from the list to add it.
    fireEvent.press(await screen.findByTestId('quiz-song-1'));
    expect(screen.getByTestId('quiz-song-1')).toBeSelected();
    getRecs.mockResolvedValue(recs(true));
    fireEvent.press(screen.getByTestId('quiz-finish'));

    await waitFor(() => expect(app.getPathname()).toBe('/discover'));
    expect(submitQuiz).toHaveBeenCalledWith({
      genres: ['rock'],
      decade_preferences: ['1990s'],
      energy_preference: 'medium',
      artist_affinities: [{ artist_name: 'Saved Artist', affinity: 'like' }],
      manual_artists: [],
      known_song_ids: [],
      vocal_comfort_pref: 'easy',
    });
    expect(loveSong).toHaveBeenCalledWith('old|song', { artist: 'Old', title: 'Song' });
    expect(loveSong).toHaveBeenCalledWith('band two|made up tune', { artist: 'Band Two', title: 'Made Up Tune' });
    expect(submitQuiz.mock.invocationCallOrder[0]).toBeLessThan(loveSong.mock.invocationCallOrder[0] as number);
    // Recommendations load again for the new profile; the draft is cleared.
    await waitFor(() => expect(getRecs).toHaveBeenCalled());
    expect(appStorage.getString(QUIZ_STORAGE_KEY)).toBeUndefined();
  });

  it("step 4 searches every song, not just the venue library's", async () => {
    act(() => useLibraryFilter.getState().set('karafun'));
    await signIn();
    getProgress.mockResolvedValue({ step: 4, genres: ['rock'], decades: [] });
    open();
    await screen.findByTestId('quiz-song-1');
    expect(popularSongs).toHaveBeenCalledWith(expect.any(Number), 'any');
    expect(popularSongs).not.toHaveBeenCalledWith(expect.any(Number), 'karafun');
    fireEvent.changeText(screen.getByTestId('quiz-song-search'), 'invented');
    await waitFor(() => expect(searchSongs).toHaveBeenCalled());
    expect(searchSongs).toHaveBeenCalledWith('invented', expect.objectContaining({ library: 'any' }));
  });

  it('a failed submit stays on the quiz with an error', async () => {
    await signIn();
    getProgress.mockResolvedValue({ step: 4, genres: ['rock'], decades: [] });
    submitQuiz.mockRejectedValue(new decide.ApiError(500, 'boom'));
    const app = open();
    fireEvent.press(await screen.findByTestId('quiz-finish'));
    expect(await screen.findByTestId('quiz-error')).toBeTruthy();
    expect(app.getPathname()).toBe('/discover/quiz');
    expect(loveSong).not.toHaveBeenCalled();
  });

  it('autosave debounced', async () => {
    await signIn();
    getProgress.mockResolvedValue({ step: 1, genres: [], decades: [], vocal_comfort_pref: 'any' });
    open();
    expect(await screen.findByTestId('quiz-genre-pop')).toBeTruthy();
    jest.useFakeTimers();
    fireEvent.press(screen.getByTestId('quiz-genre-pop'));
    act(() => jest.advanceTimersByTime(300));
    fireEvent.press(screen.getByTestId('quiz-genre-rock'));
    act(() => jest.advanceTimersByTime(300));
    fireEvent.press(screen.getByTestId('quiz-genre-ska'));
    act(() => jest.advanceTimersByTime(999));
    expect(saveProgress).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(saveProgress).toHaveBeenCalledTimes(1);
    // The web-only answer saved earlier is kept (decide replaces the whole progress doc).
    expect(saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ step: 1, genres: ['pop', 'rock', 'ska'], vocal_comfort_pref: 'any' }),
    );
  });

  it('the picked artist ids reach the saved progress and the submit', async () => {
    await signIn();
    getProgress.mockResolvedValue({
      step: 3,
      genres: ['rock'],
      decades: [],
      artist_affinities: [],
      manual_artists: [{ artist_name: 'Web Only Band', artist_id: 'sp-web' }],
    });
    searchArtists.mockResolvedValue({
      artists: [{ name: 'Found Artist', spotify_id: 'sp-found', artist_id: 'sp-found', artist_name: 'Found Artist' }],
      total: 1,
    });
    open();
    fireEvent.changeText(await screen.findByTestId('quiz-artist-search'), 'found');
    fireEvent.press(await screen.findByTestId('quiz-artist-result-0'));
    fireEvent.press(screen.getByTestId('quiz-next'));
    fireEvent.press(await screen.findByTestId('quiz-finish'));
    await waitFor(() => expect(submitQuiz).toHaveBeenCalled());
    const manual = [
      { artist_name: 'Web Only Band', artist_id: 'sp-web' },
      { artist_name: 'Found Artist', artist_id: 'sp-found' },
    ];
    expect(submitQuiz.mock.calls[0][0].manual_artists).toEqual(manual);
    expect(saveProgress).toHaveBeenLastCalledWith(expect.objectContaining({ manual_artists: manual }));
  });

  it('suggests again when genres or decades changed since the last suggestions', async () => {
    await signIn();
    getProgress.mockResolvedValue({ step: 3, genres: ['rock'], decades: [] });
    open();
    expect(await screen.findByTestId('quiz-artist-suggestion-1')).toBeTruthy();
    expect(smart).toHaveBeenCalledTimes(1);
    // Back to step 2 and forward again with nothing changed: no new call.
    fireEvent.press(screen.getByTestId('quiz-back'));
    fireEvent.press(await screen.findByTestId('quiz-skip'));
    expect(await screen.findByTestId('quiz-artist-suggestion-1')).toBeTruthy();
    expect(smart).toHaveBeenCalledTimes(1);
    // Add a decade: leaving step 2 asks again, and the earlier suggestions stay.
    smart.mockResolvedValue({ artists: [artist('Decade Band')], has_more: true });
    fireEvent.press(screen.getByTestId('quiz-back'));
    fireEvent.press(await screen.findByTestId('quiz-decade-1980s'));
    fireEvent.press(screen.getByTestId('quiz-next'));
    expect(await screen.findByText('Decade Band')).toBeTruthy();
    expect(smart).toHaveBeenCalledTimes(2);
    expect(smart).toHaveBeenLastCalledWith(
      expect.objectContaining({ decades: ['1980s'], exclude: expect.arrayContaining(['Alpha Band', 'Beta Band']) }),
    );
    expect(screen.getByText('Alpha Band')).toBeTruthy();
  });

  it('Android back goes to the previous step, and closes the quiz from step 1', async () => {
    await signIn();
    type Handler = () => boolean | null | undefined;
    const handlers: Handler[] = [];
    const add = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h as Handler);
      return { remove: () => void handlers.splice(handlers.indexOf(h as Handler), 1) };
    });
    getProgress.mockResolvedValue({ step: 2, genres: ['rock'], decades: [] });
    open();
    expect(await screen.findByTestId('quiz-decade-1990s')).toBeTruthy();
    const press = () => handlers.reduceRight<boolean>((done, h) => done || Boolean(h()), false);
    let handled = false;
    act(() => {
      handled = press();
    });
    expect(handled).toBe(true);
    expect(await screen.findByTestId('quiz-genre-rock')).toBeTruthy();
    act(() => {
      handled = press();
    });
    expect(handled).toBe(false);
    add.mockRestore();
  });

  it('finishing does not flash the loader while the quiz closes', async () => {
    await signIn();
    getProgress.mockResolvedValue({ step: 4, genres: ['rock'], decades: [] });
    const app = open();
    fireEvent.press(await screen.findByTestId('quiz-finish'));
    await waitFor(() => expect(app.getPathname()).toBe('/discover'));
    expect(screen.queryByTestId('quiz-loading', { includeHiddenElements: true })).toBeNull();
    expect(useQuizDraft.getState().owner).toBe('me@example.com');
  });
});
