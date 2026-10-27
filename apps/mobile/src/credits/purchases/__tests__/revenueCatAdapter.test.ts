import Purchases, { PRODUCT_CATEGORY, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { createRevenueCatAdapter } from '../revenueCatAdapter';

jest.mock('react-native-purchases', () => {
  const Purchases = {
    configure: jest.fn(),
    logIn: jest.fn(async () => ({ created: false })),
    logOut: jest.fn(async () => ({})),
    getProducts: jest.fn(async () => []),
    purchaseStoreProduct: jest.fn(async () => ({})),
    getStorefront: jest.fn(async () => ({ countryCode: 'USA' })),
    getAppUserID: jest.fn(async () => 'u-1'),
  };
  return {
    __esModule: true,
    default: Purchases,
    PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION', SUBSCRIPTION: 'SUBSCRIPTION' },
    PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1', PAYMENT_PENDING_ERROR: '20' },
  };
});

const rc = Purchases as jest.Mocked<typeof Purchases>;
const product = (identifier: string, price: number) =>
  ({ identifier, price, priceString: `£${price}`, currencyCode: 'GBP' }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  rc.getAppUserID.mockResolvedValue('u-1');
});

/** A promise the test settles by hand. */
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

it('configures once with the platform key as the gen app_user_id, and logs in again only for another user', async () => {
  const a = createRevenueCatAdapter('appl_key');
  await a.configure('u-1');
  await a.configure('u-1');
  expect(rc.configure).toHaveBeenCalledTimes(1);
  expect(rc.configure).toHaveBeenCalledWith({ apiKey: 'appl_key', appUserID: 'u-1' });
  expect(rc.logIn).not.toHaveBeenCalled();
  await a.configure('u-2');
  expect(rc.logIn).toHaveBeenCalledWith('u-2');
  expect(rc.configure).toHaveBeenCalledTimes(1);
});

it('a product lookup before sign-in configures anonymously; the later sign-in logs in', async () => {
  const a = createRevenueCatAdapter('appl_key');
  await a.storefrontCountry();
  expect(rc.configure).toHaveBeenCalledWith({ apiKey: 'appl_key' });
  await a.configure('u-1');
  expect(rc.logIn).toHaveBeenCalledWith('u-1');
});

it('loads consumable products with the store price strings', async () => {
  rc.getProducts.mockResolvedValue([product('nomad_credits_3', 19.99)]);
  const a = createRevenueCatAdapter('k');
  await expect(a.products(['nomad_credits_3', 'nomad_credits_5'])).resolves.toEqual([
    { id: 'nomad_credits_3', priceString: '£19.99', price: 19.99, currency: 'GBP' },
  ]);
  expect(rc.getProducts).toHaveBeenCalledWith(['nomad_credits_3', 'nomad_credits_5'], PRODUCT_CATEGORY.NON_SUBSCRIPTION);
});

it('purchases the store product: purchased, cancelled or failed', async () => {
  rc.getProducts.mockResolvedValue([product('nomad_credits_1', 9.99)]);
  const a = createRevenueCatAdapter('k');
  await a.configure('u-1');
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'purchased' });
  expect(rc.purchaseStoreProduct).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'nomad_credits_1' }));

  rc.purchaseStoreProduct.mockRejectedValueOnce({ code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR, userCancelled: true });
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'cancelled' });

  rc.purchaseStoreProduct.mockRejectedValueOnce({ code: '2', message: 'store problem' });
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'failed', message: 'store problem' });
});

it('Ask to Buy / a deferred payment is pending, not a failure', async () => {
  rc.getProducts.mockResolvedValue([product('nomad_credits_1', 9.99)]);
  const a = createRevenueCatAdapter('k');
  await a.configure('u-1');
  rc.purchaseStoreProduct.mockRejectedValueOnce({ code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR, message: 'pending' });
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'pending' });
});

it('A → logOut → B: B\'s logIn waits for the native logOut, even when logOut resolves late', async () => {
  const a = createRevenueCatAdapter('k');
  await a.configure('u-A');
  const slowLogOut = deferred<object>();
  const order: string[] = [];
  rc.logOut.mockImplementationOnce(async () => {
    order.push('logOut:start');
    await slowLogOut.promise;
    order.push('logOut:end');
    return {} as never;
  });
  rc.logIn.mockImplementation(async (id: string) => {
    order.push(`logIn:${id}`);
    return { created: false } as never;
  });
  const out = a.logOut(); // sign-out fires this without awaiting
  const signIn = a.configure('u-B');
  await new Promise((r) => setTimeout(r, 10));
  expect(rc.logIn).not.toHaveBeenCalled();
  slowLogOut.resolve({});
  await Promise.all([out, signIn]);
  expect(order).toEqual(['logOut:start', 'logOut:end', 'logIn:u-B']);
});

it('right before the store sheet, an SDK that is not the expected user logs in again', async () => {
  rc.getProducts.mockResolvedValue([product('nomad_credits_1', 9.99)]);
  const a = createRevenueCatAdapter('k');
  await a.configure('u-1');
  rc.getAppUserID.mockResolvedValueOnce('$RCAnonymousID:x').mockResolvedValueOnce('u-1');
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'purchased' });
  expect(rc.logIn).toHaveBeenCalledWith('u-1');
  expect(rc.purchaseStoreProduct).toHaveBeenCalledTimes(1);
});

it('never opens the store sheet as the wrong customer: still not the user after logIn fails clearly', async () => {
  rc.getProducts.mockResolvedValue([product('nomad_credits_1', 9.99)]);
  const a = createRevenueCatAdapter('k');
  await a.configure('u-1');
  rc.getAppUserID.mockResolvedValue('someone-else');
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'failed', message: 'identity_mismatch' });
  expect(rc.purchaseStoreProduct).not.toHaveBeenCalled();
});

it.each([
  ['signed out', (a: ReturnType<typeof createRevenueCatAdapter>) => a.logOut()],
  ['another account signed in', (a: ReturnType<typeof createRevenueCatAdapter>) => a.configure('u-2')],
])('%s between the tap and the store sheet: identity_mismatch, no logIn back to the old user', async (_name, change) => {
  const lookup = deferred<never[]>();
  rc.getProducts.mockReturnValueOnce(lookup.promise);
  const a = createRevenueCatAdapter('k');
  await a.configure('u-1');
  const buying = a.purchase('nomad_credits_1');
  await new Promise((r) => setTimeout(r, 0));
  await change(a);
  rc.logIn.mockClear();
  lookup.resolve([product('nomad_credits_1', 9.99)] as never[]);
  await expect(buying).resolves.toEqual({ kind: 'failed', message: 'identity_mismatch' });
  expect(rc.logIn).not.toHaveBeenCalledWith('u-1');
  expect(rc.purchaseStoreProduct).not.toHaveBeenCalled();
});

it('never purchases before a gen user is identified', async () => {
  rc.getProducts.mockResolvedValue([product('nomad_credits_1', 9.99)]);
  const a = createRevenueCatAdapter('k');
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'failed', message: 'not_identified' });
  await a.configure('u-1');
  await a.logOut();
  await expect(a.purchase('nomad_credits_1')).resolves.toEqual({ kind: 'failed', message: 'not_identified' });
  expect(rc.purchaseStoreProduct).not.toHaveBeenCalled();
});

it('a product the store does not know fails without opening the store sheet', async () => {
  rc.getProducts.mockResolvedValue([]);
  const a = createRevenueCatAdapter('k');
  await a.configure('u-1');
  await expect(a.purchase('nomad_credits_9')).resolves.toEqual({ kind: 'failed', message: 'unknown_product' });
  expect(rc.purchaseStoreProduct).not.toHaveBeenCalled();
});

it('logOut forgets the identified customer, and is a no-op when nobody signed in', async () => {
  const a = createRevenueCatAdapter('k');
  await a.logOut();
  expect(rc.logOut).not.toHaveBeenCalled();
  await a.configure('u-1');
  await a.logOut();
  expect(rc.logOut).toHaveBeenCalledTimes(1);
  await a.logOut();
  expect(rc.logOut).toHaveBeenCalledTimes(1);
});

it('reports the storefront country as alpha-3 (Play\'s alpha-2 mapped, unknown passed through), or null', async () => {
  const a = createRevenueCatAdapter('k');
  await expect(a.storefrontCountry()).resolves.toBe('USA');
  rc.getStorefront.mockResolvedValueOnce({ countryCode: 'US' });
  await expect(a.storefrontCountry()).resolves.toBe('USA');
  rc.getStorefront.mockResolvedValueOnce({ countryCode: 'gb' });
  await expect(a.storefrontCountry()).resolves.toBe('GBR');
  rc.getStorefront.mockResolvedValueOnce({ countryCode: 'XKX' });
  await expect(a.storefrontCountry()).resolves.toBe('XKX');
  rc.getStorefront.mockResolvedValueOnce(null);
  await expect(a.storefrontCountry()).resolves.toBeNull();
});
