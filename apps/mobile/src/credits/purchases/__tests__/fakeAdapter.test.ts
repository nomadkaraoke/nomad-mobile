import { createFakeAdapter } from '../fakeAdapter';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

const ok = (body: unknown = { action: 'granted', credits: 3 }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

it('returns fixed US products for the known pack ids', async () => {
  const a = createFakeAdapter({ genUrl: 'http://127.0.0.1:8010', storefront: 'USA', store: 'APP_STORE' });
  await expect(a.products(['nomad_credits_3', 'nomad_credits_10', 'other'])).resolves.toEqual([
    { id: 'nomad_credits_3', priceString: '$23.99', price: 23.99, currency: 'USD' },
    { id: 'nomad_credits_10', priceString: '$59.99', price: 59.99, currency: 'USD' },
  ]);
});

it('a purchase posts the configured app_user_id to gen\'s fake-iap test route', async () => {
  fetchMock.mockResolvedValue(ok());
  const a = createFakeAdapter({ genUrl: 'http://127.0.0.1:8010/', storefront: 'USA', store: 'PLAY_STORE' });
  await a.configure('u-1');
  await expect(a.purchase('nomad_credits_3')).resolves.toEqual({ kind: 'purchased' });
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://127.0.0.1:8010/api/test/fake-iap/purchase');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toEqual({ product_id: 'nomad_credits_3', app_user_id: 'u-1', store: 'PLAY_STORE' });
});

it('fails without a signed-in user, or when gen refuses', async () => {
  const a = createFakeAdapter({ genUrl: 'http://127.0.0.1:8010', storefront: 'USA', store: 'APP_STORE' });
  await expect(a.purchase('nomad_credits_1')).resolves.toMatchObject({ kind: 'failed' });
  expect(fetchMock).not.toHaveBeenCalled();
  await a.configure('u-1');
  fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
  await expect(a.purchase('nomad_credits_1')).resolves.toMatchObject({ kind: 'failed' });
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  await expect(a.purchase('nomad_credits_1')).resolves.toMatchObject({ kind: 'failed' });
  await a.logOut();
  fetchMock.mockResolvedValue(ok());
  await expect(a.purchase('nomad_credits_1')).resolves.toMatchObject({ kind: 'failed' });
});

it('reports the configured storefront as alpha-3', async () => {
  const a = createFakeAdapter({ genUrl: 'http://127.0.0.1:8010', storefront: 'GBR', store: 'APP_STORE' });
  await expect(a.storefrontCountry()).resolves.toBe('GBR');
  const play = createFakeAdapter({ genUrl: 'http://127.0.0.1:8010', storefront: 'US', store: 'PLAY_STORE' });
  await expect(play.storefrontCountry()).resolves.toBe('USA');
});
