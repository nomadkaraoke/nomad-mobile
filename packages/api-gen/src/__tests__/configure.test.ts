import { ApiError, configureClient, getMe, listCreditPackages } from '../index';

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
  await expect(getMe()).resolves.toEqual(ME);
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
