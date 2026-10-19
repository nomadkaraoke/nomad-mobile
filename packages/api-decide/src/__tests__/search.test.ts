import {
  configureClient,
  getOfflineIndexManifest,
  getSongDetail,
  logSearchEvent,
  pingSearch,
  popularSongs,
  resolveQuery,
  searchSongs,
} from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({
    baseUrl: 'https://decide.test',
    getToken: () => null,
    getLocale: () => 'en',
    getDeviceId: () => 'dev-123',
    onUnauthorized: jest.fn(),
  });
});

const SEARCH = {
  identification: { status: 'none', kind: null, best: null, candidates: [] },
  groups: [],
  index: { run: 'r1', built_at: 't' },
  sid: 's1',
};

it('searchSongs hits /api/search with q and limit and sends X-Device-Id', async () => {
  fetchMock.mockResolvedValue(json(SEARCH));
  await expect(searchSongs('hello wor', { limit: 5 })).resolves.toEqual(SEARCH);
  const req = lastRequest();
  expect(req.url).toBe('https://decide.test/api/search?q=hello%20wor&limit=5');
  expect(req.headers.get('x-device-id')).toBe('dev-123');
  expect(req.headers.get('accept-language')).toBe('en');
});

it('searchSongs omits limit by default and forwards the abort signal', async () => {
  fetchMock.mockResolvedValue(json(SEARCH));
  const ctrl = new AbortController();
  await searchSongs('x', { signal: ctrl.signal });
  expect(lastRequest().url).toBe('https://decide.test/api/search?q=x');
  ctrl.abort();
  fetchMock.mockImplementation((req: Request) => (req.signal.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve(json(SEARCH))));
  await expect(searchSongs('y', { signal: ctrl.signal })).rejects.toBeDefined();
});

it('popularSongs, getSongDetail, resolveQuery and getOfflineIndexManifest hit the right paths', async () => {
  fetchMock.mockResolvedValueOnce(json([]));
  await expect(popularSongs(7)).resolves.toEqual([]);
  expect(lastRequest().url).toBe('https://decide.test/api/search/popular?limit=7');

  fetchMock.mockResolvedValueOnce(json({ song: {}, versions: [] }));
  await getSongDetail('adele|hello');
  expect(lastRequest().url).toBe('https://decide.test/api/search/song?key=adele%7Chello');

  fetchMock.mockResolvedValueOnce(json({ corrected: 'Adele - Hello' }));
  await expect(resolveQuery('adle helo')).resolves.toEqual({ corrected: 'Adele - Hello' });
  expect(lastRequest().url).toBe('https://decide.test/api/search/resolve?q=adle%20helo');

  const manifest = { run: 'r', schema: 1, normalizer: 3, url: 'https://x/idx', bytes: 10, sha256: 'ab' };
  fetchMock.mockResolvedValueOnce(json(manifest));
  await expect(getOfflineIndexManifest()).resolves.toEqual(manifest);
  expect(lastRequest().url).toBe('https://decide.test/api/search/offline-index');
});

it('logSearchEvent POSTs the event body', async () => {
  fetchMock.mockResolvedValue(json({ ok: true }));
  await logSearchEvent({ sid: 's1', type: 'tap', data: { rank: 2 } });
  const req = lastRequest();
  expect(req.method).toBe('POST');
  expect(req.url).toBe('https://decide.test/api/search/event');
  expect(await req.clone().json()).toEqual({ sid: 's1', type: 'tap', data: { rank: 2 } });
});

it('logSearchEvent never throws (network error or HTTP error)', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('network'));
  await expect(logSearchEvent({ sid: 's', type: 't' })).resolves.toBeUndefined();
  fetchMock.mockResolvedValueOnce(json({ detail: 'boom' }, 500));
  await expect(logSearchEvent({ sid: 's', type: 't' })).resolves.toBeUndefined();
});

it('pingSearch is true when ready, false on 503 or network error', async () => {
  fetchMock.mockResolvedValueOnce(json({ status: 'ok' }));
  await expect(pingSearch()).resolves.toBe(true);
  expect(lastRequest().url).toBe('https://decide.test/api/search/ready');
  fetchMock.mockResolvedValueOnce(json({ detail: 'loading' }, 503));
  await expect(pingSearch()).resolves.toBe(false);
  fetchMock.mockRejectedValueOnce(new TypeError('network'));
  await expect(pingSearch()).resolves.toBe(false);
});

it('search-service 401 and errors surface as ApiError via the shared interceptor', async () => {
  fetchMock.mockResolvedValue(json({ detail: 'bad' }, 422));
  await expect(searchSongs('x')).rejects.toMatchObject({ name: 'ApiError', status: 422, detail: 'bad' });
});
