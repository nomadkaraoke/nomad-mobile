import {
  ApiError,
  configureClient,
  getPreferences,
  getQuizProgress,
  getQuizStatus,
  getRecommendationsV2,
  hideSong,
  isWarmingUp,
  listHiddenSongs,
  listLovedSongs,
  listMyArtists,
  loveSong,
  removeMyArtist,
  saveQuizProgress,
  searchArtists,
  smartQuizArtists,
  submitQuiz,
  unhideSong,
  unloveSong,
  updatePreferences,
} from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const last = (): Request => fetchMock.mock.calls.at(-1)[0];

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({
    baseUrl: 'https://decide.test',
    getToken: () => 'tok',
    getLocale: () => 'en',
    getDeviceId: () => 'dev-1',
    onUnauthorized: jest.fn(),
  });
});

const V2 = { sections: [], filters_applied: {}, next_cursor: null, has_profile: true, catalog_run: 'r1' };

it('getRecommendationsV2 sends repeated params and the cursor', async () => {
  fetchMock.mockImplementation(async () => json(V2));
  await expect(getRecommendationsV2({ genre: ['rock', 'pop'], energy: 'high', sort: 'popular' }, 'c1')).resolves.toEqual(V2);
  const u = new URL(last().url);
  expect(u.pathname).toBe('/api/my/recommendations/v2');
  expect(u.searchParams.getAll('genre')).toEqual(['rock', 'pop']);
  expect(u.searchParams.get('energy')).toBe('high');
  expect(u.searchParams.get('cursor')).toBe('c1');
  expect(last().headers.get('authorization')).toBe('Bearer tok');
});

it('getRecommendationsV2 omits the cursor when absent', async () => {
  fetchMock.mockImplementation(async () => json(V2));
  await getRecommendationsV2({});
  expect(new URL(last().url).searchParams.has('cursor')).toBe(false);
});

it('isWarmingUp is true only for a 503 warming_up ApiError', () => {
  expect(isWarmingUp(new ApiError(503, 'warming_up', 30))).toBe(true);
  expect(isWarmingUp(new ApiError(503, 'other'))).toBe(false);
  expect(isWarmingUp(new ApiError(500, 'warming_up'))).toBe(false);
  expect(isWarmingUp(new Error('warming_up'))).toBe(false);
  expect(isWarmingUp(null)).toBe(false);
});

it('a 503 warming_up response surfaces as warming-up', async () => {
  fetchMock.mockImplementation(async () => json({ detail: 'warming_up' }, 503));
  const err = await getRecommendationsV2({}).catch((e: unknown) => e);
  expect(isWarmingUp(err)).toBe(true);
});

it('hideSong encodes the key', async () => {
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
  await hideSong('ac/dc|back in black');
  expect(last().method).toBe('POST');
  expect(last().url.endsWith('/api/my/songs/ac%2Fdc%7Cback%20in%20black/hide')).toBe(true);
});

it('song keys with reserved characters, accents and Arabic survive encoding for every verb', async () => {
  const key = 'beyoncé & jay-z|crazy #1? 100% عمرو دياب';
  const enc = encodeURIComponent(key);
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
  await hideSong(key);
  expect(last().url).toBe(`https://decide.test/api/my/songs/${enc}/hide`);
  await unhideSong(key);
  expect(last().method).toBe('DELETE');
  expect(last().url).toBe(`https://decide.test/api/my/songs/${enc}/hide`);
  await loveSong(key);
  expect(last().url).toBe(`https://decide.test/api/my/songs/${enc}/love`);
  await unloveSong(key);
  expect(last().method).toBe('DELETE');
  expect(last().url).toBe(`https://decide.test/api/my/songs/${enc}/love`);
});

it('hideSong and loveSong send artist/title meta as the JSON body when given', async () => {
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
  await hideSong('k', { artist: 'A', title: 'T' });
  expect(await last().clone().json()).toEqual({ artist: 'A', title: 'T' });
  await loveSong('k', { artist: 'A', title: 'T' });
  expect(await last().clone().json()).toEqual({ artist: 'A', title: 'T' });
  await hideSong('k');
  expect(await last().clone().text()).toBe('');
});

it('listHiddenSongs and listLovedSongs unwrap the songs array', async () => {
  const song = { song_key: 'k', artist: 'A', title: 'T', created_at: null };
  fetchMock.mockImplementation(async () => json({ songs: [song] }));
  await expect(listHiddenSongs()).resolves.toEqual([song]);
  expect(new URL(last().url).pathname).toBe('/api/my/songs/hidden');
  await expect(listLovedSongs()).resolves.toEqual([song]);
  expect(new URL(last().url).pathname).toBe('/api/my/songs/loved');
});

it('getQuizProgress 204 → null; 200 → the document', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(getQuizProgress()).resolves.toBeNull();
  fetchMock.mockResolvedValueOnce(json({ step: 2, genres: ['rock'] }));
  await expect(getQuizProgress()).resolves.toEqual({ step: 2, genres: ['rock'] });
  expect(new URL(last().url).pathname).toBe('/api/quiz/progress');
});

it('quiz facades hit the right paths with bodies', async () => {
  fetchMock.mockImplementation(async () => json({}));
  await saveQuizProgress({ step: 2 });
  expect(last().method).toBe('PUT');
  expect(new URL(last().url).pathname).toBe('/api/quiz/progress');
  await submitQuiz({ genres: ['rock'] });
  expect(last().method).toBe('POST');
  expect(new URL(last().url).pathname).toBe('/api/quiz/submit');
  await getQuizStatus();
  expect(new URL(last().url).pathname).toBe('/api/quiz/status');
  await smartQuizArtists({ genres: ['rock'], decades: [], manual_artists: [], exclude: [], count: 12 });
  expect(new URL(last().url).pathname).toBe('/api/quiz/artists/smart');
  expect(await last().clone().json()).toMatchObject({ genres: ['rock'], count: 12 });
});

it('searchArtists defaults to limit 10; preferences and my-artists paths', async () => {
  fetchMock.mockImplementation(async () => json({}));
  await searchArtists('abba');
  expect(last().url).toBe('https://decide.test/api/catalog/artists?q=abba&limit=10');
  await getPreferences();
  expect(new URL(last().url).pathname).toBe('/api/my/data/preferences');
  await updatePreferences({ genres: ['pop'] });
  expect(last().method).toBe('PUT');
  expect(await last().clone().json()).toEqual({ genres: ['pop'] });
  await listMyArtists();
  expect(new URL(last().url).pathname).toBe('/api/my/data/artists');
  await removeMyArtist('Guns N/Roses');
  expect(last().method).toBe('DELETE');
  expect(last().url).toBe('https://decide.test/api/my/data/artists/Guns%20N%2FRoses');
});
