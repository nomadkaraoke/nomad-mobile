jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: { configure: jest.fn() },
  PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION' },
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
}));

const ENV = [
  'EXPO_PUBLIC_GEN_API_URL',
  'EXPO_PUBLIC_FAKE_IAP',
  'EXPO_PUBLIC_FAKE_STOREFRONT',
  'EXPO_PUBLIC_REVENUECAT_IOS_KEY',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY',
] as const;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
});
afterEach(() => jest.restoreAllMocks());

// config.ts reads env at import time: load a fresh module graph after setting env.
const load = (os: 'ios' | 'android' = 'ios') => {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  jest.replaceProperty((require('react-native') as typeof import('react-native')).Platform, 'OS', os);
  const index = require('../index') as typeof import('../index');
  const fake = require('../fakeAdapter') as typeof import('../fakeAdapter');
  const rc = require('../revenueCatAdapter') as typeof import('../revenueCatAdapter');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { index, fake, rc };
};

it('is off (null = web checkout) without a RevenueCat key', () => {
  expect(load().index.getPurchases()).toBeNull();
});

it('uses RevenueCat with the platform key, once per launch', () => {
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_x';
  const { index, rc } = load();
  const spy = jest.spyOn(rc, 'createRevenueCatAdapter');
  const a = index.getPurchases();
  expect(a).not.toBeNull();
  expect(index.getPurchases()).toBe(a);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith('appl_x');
});

it('android reads the android key only', () => {
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_x';
  expect(load('android').index.getPurchases()).toBeNull();
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_x';
  const { index, rc } = load('android');
  const spy = jest.spyOn(rc, 'createRevenueCatAdapter');
  expect(index.getPurchases()).not.toBeNull();
  expect(spy).toHaveBeenCalledWith('goog_x');
});

it('FAKE_IAP against a local gen swaps in the fake (storefront default USA), even with a real key', () => {
  process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
  process.env.EXPO_PUBLIC_FAKE_IAP = '1';
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_x';
  const { index, fake, rc } = load();
  const fakeSpy = jest.spyOn(fake, 'createFakeAdapter');
  const rcSpy = jest.spyOn(rc, 'createRevenueCatAdapter');
  expect(index.getPurchases()).not.toBeNull();
  expect(fakeSpy).toHaveBeenCalledWith({ genUrl: 'http://127.0.0.1:8010', storefront: 'USA', store: 'APP_STORE' });
  expect(rcSpy).not.toHaveBeenCalled();
});

it('FAKE_STOREFRONT picks the fake storefront', () => {
  process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
  process.env.EXPO_PUBLIC_FAKE_IAP = '1';
  process.env.EXPO_PUBLIC_FAKE_STOREFRONT = 'GBR';
  const { index, fake } = load();
  const spy = jest.spyOn(fake, 'createFakeAdapter');
  index.getPurchases();
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ storefront: 'GBR' }));
});

it('ignores FAKE_IAP against a deployed gen', () => {
  process.env.EXPO_PUBLIC_FAKE_IAP = '1';
  expect(load().index.getPurchases()).toBeNull();
  process.env.EXPO_PUBLIC_GEN_API_URL = 'https://api.nomadkaraoke.com';
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_x';
  const { index, fake } = load();
  const spy = jest.spyOn(fake, 'createFakeAdapter');
  expect(index.getPurchases()).not.toBeNull();
  expect(spy).not.toHaveBeenCalled();
});
