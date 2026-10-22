import {
  KjboxError,
  MAKE_TIMEOUT_MS,
  cancelRequest,
  claimTip,
  configureKjbox,
  getMe,
  getNight,
  getNow,
  getRotation,
  getTips,
  joinNight,
  makeSearch,
  previewResolve,
  reorder,
  searchSongs,
  submitRequest,
  useQuick,
} from '../index';

const fetchMock = jest.fn();
const onUnauthorized = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  onUnauthorized.mockReset();
  global.fetch = fetchMock as never;
  configureKjbox({ baseUrl: 'https://sing.test/', getToken: () => 'tok', getLocale: () => 'de', onUnauthorized } as never);
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const last = (): Request => fetchMock.mock.calls.at(-1)[0];
const lastBody = async () => JSON.parse(await last().clone().text());

it('sends bearer and t', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0' }));
  await getNight('2121', 'n1');
  const url = new URL(last().url);
  expect(url.origin + url.pathname).toBe('https://sing.test/api/v1/night');
  expect(url.searchParams.get('t')).toBe('2121');
  expect(url.searchParams.get('night_id')).toBe('n1');
  expect(last().headers.get('authorization')).toBe('Bearer tok');
  expect(last().headers.get('accept-language')).toBe('de');
});

it('maps error body to KjboxError', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0', error: 'night_changed', night_id: 'n2', retry_after: 3 }, 409));
  const err = await getMe('2121', 'n1').catch((e) => e);
  expect(err).toBeInstanceOf(KjboxError);
  expect(err).toMatchObject({ code: 'night_changed', status: 409, retryAfter: 3, nightId: 'n2' });
});

it('maps a non-JSON failure to code internal', async () => {
  fetchMock.mockImplementation(async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'Retry-After': '7' } }));
  const err = await getNow('2121').catch((e) => e);
  expect(err).toMatchObject({ code: 'internal', status: 502, retryAfter: 7 });
});

it('rotation 304 → notModified', async () => {
  fetchMock.mockImplementation(async () => new Response(null, { status: 304, headers: { ETag: '"5"' } }));
  await expect(getRotation('2121', '"5"')).resolves.toEqual({ notModified: true });
  expect(last().headers.get('if-none-match')).toBe('"5"');
});

it('rotation 200 returns etag and data; errors still throw', async () => {
  fetchMock.mockResolvedValueOnce(json({ api_version: '1.0', entries: [] }, 200, { ETag: '"6"' }));
  await expect(getRotation('2121')).resolves.toEqual({ etag: '"6"', data: { api_version: '1.0', entries: [] } });
  expect(last().headers.get('if-none-match')).toBeNull();
  fetchMock.mockResolvedValueOnce(json({ api_version: '1.0', error: 'not_open' }, 403));
  await expect(getRotation('2121')).rejects.toMatchObject({ code: 'not_open', status: 403 });
});

it('401 does not call onUnauthorized', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0', error: 'unauthenticated' }, 401));
  await expect(getMe('2121')).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

it('POST facades put t, night_id and fields in the JSON body', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0' }));
  await joinNight('2121', 'Sam', 'n1');
  expect(last().method).toBe('POST');
  expect(await lastBody()).toEqual({ t: '2121', night_id: 'n1', name: 'Sam' });
  await submitRequest('2121', { client_request_id: 'c-1', source_type: 'local', song_artist: 'A', song_title: 'T' });
  expect(await lastBody()).toMatchObject({ t: '2121', client_request_id: 'c-1', song_title: 'T' });
});

it('request-management facades hit the right path and method', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0' }));
  await cancelRequest('2121', 7);
  expect(new URL(last().url).pathname).toBe('/api/v1/requests/7/cancel');
  await reorder('2121', [{ id: 1 }, { id: 2 }]);
  expect(new URL(last().url).pathname).toBe('/api/v1/requests/reorder');
  expect((await lastBody()).items).toEqual([{ id: 1 }, { id: 2 }]);
});

it('search facade sends q and sid as query params', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0' }));
  await searchSongs('2121', 'abba', 'sid-1');
  const p = new URL(last().url).searchParams;
  expect([p.get('t'), p.get('q'), p.get('sid')]).toEqual(['2121', 'abba', 'sid-1']);
});

it('preview, tips, make and quick facades', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0' }));
  await previewResolve('2121', 'local', 4);
  expect(new URL(last().url).pathname).toBe('/api/v1/preview/resolve');
  expect(await lastBody()).toMatchObject({ t: '2121', source: 'local', entry_id: 4 });
  await previewResolve('2121', 'divebar', undefined, 'n1', { file_id: 'f1', format: 'mp4', title: 'T', t: 'spoof' });
  expect(await lastBody()).toMatchObject({ t: '2121', night_id: 'n1', source: 'divebar', file_id: 'f1', format: 'mp4', title: 'T' });
  await getTips('2121');
  expect(new URL(last().url).pathname).toBe('/api/v1/tips');
  await claimTip('2121', { amount: 5, client_request_id: 'c-2' });
  expect(await lastBody()).toMatchObject({ t: '2121', amount: 5, client_request_id: 'c-2' });
  await makeSearch('2121', 'A', 'T');
  expect(new URL(last().url).pathname).toBe('/api/v1/make/search');
  await useQuick('2121', 9);
  expect(new URL(last().url).pathname).toBe('/api/v1/make/use-quick/9');
});

it('reconfiguring replaces (does not stack) the interceptors', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0' }));
  configureKjbox({ baseUrl: 'https://b.test', getToken: () => null, getLocale: () => 'fr' });
  await getNow('2121');
  expect(last().url.startsWith('https://b.test/api/v1/now')).toBe(true);
  expect(last().headers.get('authorization')).toBeNull();
  expect(last().headers.get('accept-language')).toBe('fr');
});

describe('unreachable signal', () => {
  it('fetch rejecting → unreachable, status 0, code internal', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });
    const err = await getNow('2121').catch((e) => e);
    expect(err).toBeInstanceOf(KjboxError);
    expect(err).toMatchObject({ unreachable: true, status: 0, code: 'internal' });
  });
  it('530 with an HTML body → unreachable', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>tunnel down</html>', { status: 530 }));
    await expect(getNow('2121')).rejects.toMatchObject({ unreachable: true, code: 'internal', status: 530 });
  });
  it('JSON 503 gen_unavailable → not unreachable', async () => {
    fetchMock.mockImplementation(async () => json({ api_version: '1.0', error: 'gen_unavailable' }, 503));
    await expect(getNow('2121')).rejects.toMatchObject({ unreachable: false, code: 'gen_unavailable' });
  });
  it('a hung request aborts after 10 s as unreachable', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (req: Request, init: RequestInit) =>
          new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
      );
      const p = getNow('2121').catch((e) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(await p).toMatchObject({ unreachable: true, status: 0 });
    } finally {
      jest.useRealTimers();
    }
  });
  it('make search and a make submit wait longer than 10 s (gen search ~45 s, create-job up to minutes)', async () => {
    jest.useFakeTimers();
    try {
      let aborted = 0;
      fetchMock.mockImplementation(
        (req: Request, init: RequestInit) =>
          new Promise((_, rej) =>
            init.signal?.addEventListener('abort', () => {
              aborted += 1;
              rej(new DOMException('aborted', 'AbortError'));
            }),
          ),
      );
      const search = makeSearch('2121', 'Muse', 'Starlight').catch((e) => e);
      const submit = submitRequest('2121', { client_request_id: 'c', source_type: 'make' }).catch((e) => e);
      const plain = submitRequest('2121', { client_request_id: 'd', source_type: 'local' }).catch((e) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(await plain).toMatchObject({ unreachable: true });
      expect(aborted).toBe(1);
      await jest.advanceTimersByTimeAsync(MAKE_TIMEOUT_MS - 10_000);
      expect(await search).toMatchObject({ unreachable: true, status: 0 });
      expect(await submit).toMatchObject({ unreachable: true, status: 0 });
    } finally {
      jest.useRealTimers();
    }
  });
  it('getRotation rethrows a network error', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(getRotation('2121')).rejects.toMatchObject({ unreachable: true });
  });
});

it('night_changed carries nightId on submitRequest', async () => {
  fetchMock.mockImplementation(async () => json({ api_version: '1.0', error: 'night_changed', night_id: 'n9' }, 409));
  await expect(submitRequest('2121', { client_request_id: 'c', source_type: 'local' })).rejects.toMatchObject({
    code: 'night_changed',
    nightId: 'n9',
  });
});
