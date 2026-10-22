import { ApiError, configureClient, getSong, searchSongs } from '../index';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SONG = { id: 1, artist: 'A', title: 'T', brands: [], brand_count: 0, is_popular: false };
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];

it('hits baseUrl with query, locale header, and bearer token when present', async () => {
  fetchMock.mockResolvedValue(json(SONG));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => 'tok', getLocale: () => 'de', getDeviceId: () => 'dev-1', onUnauthorized: jest.fn() });
  await expect(getSong(1)).resolves.toEqual(SONG);
  const req = lastRequest();
  expect(req.url).toBe('https://decide.test/api/catalog/songs/1');
  expect(req.headers.get('accept-language')).toBe('de');
  expect(req.headers.get('authorization')).toBe('Bearer tok');
});

it('omits authorization when no token', async () => {
  fetchMock.mockResolvedValue(json(SONG));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', getDeviceId: () => 'dev-1', onUnauthorized: jest.fn() });
  await getSong(1);
  expect(lastRequest().headers.get('authorization')).toBeNull();
});

it('reconfiguring replaces (does not stack) the header interceptor', async () => {
  fetchMock.mockResolvedValue(json(SONG));
  configureClient({ baseUrl: 'https://a.test', getToken: () => 'one', getLocale: () => 'en', getDeviceId: () => 'dev-1', onUnauthorized: jest.fn() });
  configureClient({ baseUrl: 'https://b.test', getToken: () => null, getLocale: () => 'fr', getDeviceId: () => 'dev-1', onUnauthorized: jest.fn() });
  await getSong(1);
  expect(lastRequest().url.startsWith('https://b.test/')).toBe(true);
  expect(lastRequest().headers.get('authorization')).toBeNull();
  expect(lastRequest().headers.get('accept-language')).toBe('fr');
});

it('calls onUnauthorized once on 401 and throws ApiError', async () => {
  const onUnauthorized = jest.fn();
  fetchMock.mockResolvedValue(json({ detail: 'nope' }, 401));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => 'tok', getLocale: () => 'en', getDeviceId: () => 'dev-1', onUnauthorized });
  const err = await getSong(1).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 401, detail: 'nope' });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

it('surfaces FastAPI detail in errors without signing out', async () => {
  const onUnauthorized = jest.fn();
  fetchMock.mockResolvedValue(json({ detail: 'bad query' }, 422));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', getDeviceId: () => 'dev-1', onUnauthorized });
  await expect(getSong(1)).rejects.toMatchObject({ status: 422, detail: 'bad query', message: 'bad query' });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

it('getSong hits the catalog song path', async () => {
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', getDeviceId: () => 'dev-1', onUnauthorized: jest.fn() });
  fetchMock.mockResolvedValueOnce(json({ id: 7, artist: 'A', title: 'T', brands: [], brand_count: 0, is_popular: false }));
  await expect(getSong(7)).resolves.toMatchObject({ id: 7 });
  expect(lastRequest().url).toBe('https://decide.test/api/catalog/songs/7');
});

it('carries a numeric Retry-After (seconds) on the ApiError; an HTTP-date or none → null', async () => {
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', getDeviceId: () => 'dev-1', onUnauthorized: jest.fn() });
  const limited = (retryAfter?: string) =>
    new Response(JSON.stringify({ detail: 'slow down' }), {
      status: 429,
      headers: { 'content-type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) },
    });
  fetchMock.mockResolvedValueOnce(limited('7'));
  await expect(getSong(1)).rejects.toMatchObject({ status: 429, retryAfter: 7 });
  fetchMock.mockResolvedValueOnce(limited('Wed, 21 Oct 2026 07:28:00 GMT'));
  await expect(getSong(1)).rejects.toMatchObject({ status: 429, retryAfter: null });
  fetchMock.mockResolvedValueOnce(limited());
  await expect(getSong(1)).rejects.toMatchObject({ status: 429, retryAfter: null });
});

it('searchBaseUrl routes search to the search host while the main client keeps baseUrl', async () => {
  configureClient({
    baseUrl: 'https://decide.test',
    searchBaseUrl: 'https://search.test',
    getToken: () => 'tok',
    getLocale: () => 'en',
    getDeviceId: () => 'dev-1',
    onUnauthorized: jest.fn(),
  });
  fetchMock.mockResolvedValueOnce(json({ groups: [], identification: {}, index: {}, sid: 's' }));
  await searchSongs('abc');
  expect(lastRequest().url).toBe('https://search.test/api/search?q=abc');
  expect(lastRequest().headers.get('authorization')).toBe('Bearer tok');
  fetchMock.mockResolvedValueOnce(json(SONG));
  await getSong(1);
  expect(lastRequest().url).toBe('https://decide.test/api/catalog/songs/1');
});

it('search defaults to baseUrl when searchBaseUrl is omitted', async () => {
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', getDeviceId: () => 'dev-1', onUnauthorized: jest.fn() });
  fetchMock.mockResolvedValueOnce(json({ groups: [], identification: {}, index: {}, sid: 's' }));
  await searchSongs('abc');
  expect(lastRequest().url).toBe('https://decide.test/api/search?q=abc');
});
