import { ApiError, configureClient, getMe, listCreditPackages } from '../index';
import { MAX_RETRY_AFTER_S, parseRetryAfter } from '../configure';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];
const ME = { user: { email: 'a@b.co', credits: 2 } };

it('sends bearer token and locale to /api/users/me', async () => {
  fetchMock.mockResolvedValue(json(ME));
  configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'ja', onUnauthorized: jest.fn() });
  await expect(getMe()).resolves.toEqual({ email: 'a@b.co', credits: 2 });
  const req = lastRequest();
  expect(req.url).toBe('https://gen.test/api/users/me');
  expect(req.headers.get('authorization')).toBe('Bearer tok');
  expect(req.headers.get('accept-language')).toBe('ja');
});

it('omits authorization when no token', async () => {
  fetchMock.mockResolvedValue(json({ packages: [] }));
  configureClient({ baseUrl: 'https://gen.test', getToken: () => null, getLocale: () => 'en', onUnauthorized: jest.fn() });
  await listCreditPackages();
  expect(lastRequest().url).toBe('https://gen.test/api/users/credits/packages');
  expect(lastRequest().headers.get('authorization')).toBeNull();
});

it('calls onUnauthorized once on 401 and throws ApiError', async () => {
  const onUnauthorized = jest.fn();
  fetchMock.mockResolvedValue(json({ detail: 'Invalid session' }, 401));
  configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'en', onUnauthorized });
  const err = await getMe().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 401, detail: 'Invalid session' });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

it('surfaces FastAPI detail on other errors', async () => {
  const onUnauthorized = jest.fn();
  fetchMock.mockResolvedValue(json({ detail: 'boom' }, 500));
  configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'en', onUnauthorized });
  await expect(getMe()).rejects.toMatchObject({ status: 500, detail: 'boom' });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

describe('Retry-After', () => {
  const withRetryAfter = async (value: string) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'slow down' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': value },
      }),
    );
    configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'en', onUnauthorized: jest.fn() });
    return (await getMe().catch((e: unknown) => e)) as ApiError;
  };

  it('a 429 with Retry-After: 7 carries retryAfter 7', async () => {
    expect(await withRetryAfter('7')).toMatchObject({ status: 429, retryAfter: 7 });
  });

  it('garbage is null', async () => {
    expect((await withRetryAfter('soon')).retryAfter).toBeNull();
  });

  it('a huge value is capped at 300 s', async () => {
    expect((await withRetryAfter('100000')).retryAfter).toBe(300);
  });

  it('no header is null', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'busy' }, 503));
    configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'en', onUnauthorized: jest.fn() });
    expect(((await getMe().catch((e: unknown) => e)) as ApiError).retryAfter).toBeNull();
  });

  it.each([
    [null, null],
    ['', null],
    ['0', null],
    ['-3', null],
    ['Infinity', null],
    ['1e400', null],
    ['Wed, 21 Oct 2026 07:28:00 GMT', null],
    ['2.5', 2.5],
    ['300', 300],
    ['301', MAX_RETRY_AFTER_S],
  ])('parseRetryAfter(%p) → %p', (value, expected) => {
    expect(parseRetryAfter(value)).toBe(expected);
  });
});
