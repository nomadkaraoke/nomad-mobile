import { ApiError, configureClient, getSong, popularSongs, searchSongs } from '../index';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const EMPTY = { songs: [], total: 0, page: 1, per_page: 20, has_more: false };
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];

it('hits baseUrl with query, locale header, and bearer token when present', async () => {
  fetchMock.mockResolvedValue(json(EMPTY));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => 'tok', getLocale: () => 'de', onUnauthorized: jest.fn() });
  await expect(searchSongs('hello')).resolves.toEqual(EMPTY);
  const req = lastRequest();
  expect(req.url).toBe('https://decide.test/api/catalog/songs?q=hello&page=1&per_page=20');
  expect(req.headers.get('accept-language')).toBe('de');
  expect(req.headers.get('authorization')).toBe('Bearer tok');
});

it('omits authorization when no token', async () => {
  fetchMock.mockResolvedValue(json(EMPTY));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', onUnauthorized: jest.fn() });
  await searchSongs('x');
  expect(lastRequest().headers.get('authorization')).toBeNull();
});

it('reconfiguring replaces (does not stack) the header interceptor', async () => {
  fetchMock.mockResolvedValue(json(EMPTY));
  configureClient({ baseUrl: 'https://a.test', getToken: () => 'one', getLocale: () => 'en', onUnauthorized: jest.fn() });
  configureClient({ baseUrl: 'https://b.test', getToken: () => null, getLocale: () => 'fr', onUnauthorized: jest.fn() });
  await searchSongs('x');
  expect(lastRequest().url.startsWith('https://b.test/')).toBe(true);
  expect(lastRequest().headers.get('authorization')).toBeNull();
  expect(lastRequest().headers.get('accept-language')).toBe('fr');
});

it('calls onUnauthorized once on 401 and throws ApiError', async () => {
  const onUnauthorized = jest.fn();
  fetchMock.mockResolvedValue(json({ detail: 'nope' }, 401));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => 'tok', getLocale: () => 'en', onUnauthorized });
  const err = await searchSongs('x').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 401, detail: 'nope' });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

it('surfaces FastAPI detail in errors without signing out', async () => {
  const onUnauthorized = jest.fn();
  fetchMock.mockResolvedValue(json({ detail: 'bad query' }, 422));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', onUnauthorized });
  await expect(searchSongs('x')).rejects.toMatchObject({ status: 422, detail: 'bad query', message: 'bad query' });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

it('popularSongs and getSong hit the right paths', async () => {
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', onUnauthorized: jest.fn() });
  fetchMock.mockResolvedValueOnce(json([]));
  await popularSongs(5);
  expect(lastRequest().url).toBe('https://decide.test/api/catalog/songs/popular?limit=5');
  fetchMock.mockResolvedValueOnce(json({ id: 7, artist: 'A', title: 'T', brands: [], brand_count: 0, is_popular: false }));
  await expect(getSong(7)).resolves.toMatchObject({ id: 7 });
  expect(lastRequest().url).toBe('https://decide.test/api/catalog/songs/7');
});
