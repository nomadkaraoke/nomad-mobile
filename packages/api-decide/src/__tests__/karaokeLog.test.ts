import { ApiError, configureClient, deleteKaraokeLog, listKaraokeLog, putKaraokeLog } from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];
const ENTRY = { id: 'app_1', user_id: 'u', source: 'app', state: 'sung', artist: 'A', title: 'T' };

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({
    baseUrl: 'https://decide.test',
    getToken: () => 'gen-tok',
    getLocale: () => 'en',
    getDeviceId: () => 'dev',
    onUnauthorized: jest.fn(),
  });
});

it('listKaraokeLog sends the query and the bearer token', async () => {
  fetchMock.mockResolvedValue(json({ entries: [ENTRY], next_cursor: 'c2' }));
  const page = await listKaraokeLog({ since: '2026-10-21T00:00:00Z', nightId: 'n1', limit: 50, cursor: 'c1' });
  expect(page).toEqual({ entries: [ENTRY], next_cursor: 'c2' });
  const url = new URL(lastRequest().url);
  expect(url.pathname).toBe('/api/my/karaoke-log');
  expect(url.searchParams.get('since')).toBe('2026-10-21T00:00:00Z');
  expect(url.searchParams.get('night_id')).toBe('n1');
  expect(url.searchParams.get('limit')).toBe('50');
  expect(url.searchParams.get('cursor')).toBe('c1');
  expect(lastRequest().headers.get('authorization')).toBe('Bearer gen-tok');
});

it('putKaraokeLog PUTs the patch as JSON to the id', async () => {
  fetchMock.mockResolvedValue(json(ENTRY));
  await expect(putKaraokeLog('kj_abc', { survey: { feel: 'great' } })).resolves.toEqual(ENTRY);
  const req = lastRequest();
  expect(req.method).toBe('PUT');
  expect(req.url).toBe('https://decide.test/api/my/karaoke-log/kj_abc');
  expect(await req.json()).toEqual({ survey: { feel: 'great' } });
});

it('deleteKaraokeLog DELETEs the id', async () => {
  fetchMock.mockResolvedValue(json({ ...ENTRY, deleted: true }));
  await expect(deleteKaraokeLog('app_1')).resolves.toMatchObject({ deleted: true });
  expect(lastRequest().method).toBe('DELETE');
  expect(lastRequest().url).toBe('https://decide.test/api/my/karaoke-log/app_1');
});

it('surfaces the error code as ApiError.detail', async () => {
  fetchMock.mockResolvedValue(json({ detail: 'not_owner' }, 403));
  const err = await putKaraokeLog('kj_abc', { state: 'sung' }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 403, detail: 'not_owner' });
});
