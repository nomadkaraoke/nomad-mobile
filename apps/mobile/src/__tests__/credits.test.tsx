import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { renderRouter } from 'expo-router/testing-library';

import * as credits from '../app/credits';
import { getPurchases } from '../credits/purchases';
import type { PurchasesAdapter } from '../credits/purchases/types';
import { pollConfig } from '../credits/useCheckout';
import { useAuth } from '../auth/store';
import * as observability from '../observability';
import { gen, session } from '../test-utils/genAuthMock';
import { makeRoutes } from '../test-utils/makeFixtures';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  // The Me home (signed in) loads the library, setlists, log mirror and services summary.
  getLibrary: jest.fn(async () => ({ status: 'ok', etag: 'e', items: [] })),
  listSetlists: jest.fn(async () => []),
  listKaraokeLog: jest.fn(async () => ({ entries: [] })),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: { screenshot_import: false, listenbrainz_oauth: false } })),
  getVoiceProfile: jest.fn(async () => null),
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getCreditCatalog: jest.fn(),
  createAppCheckout: jest.fn(),
  getMe: jest.fn(),
}));
jest.mock('../observability', () => ({ ...jest.requireActual('../observability'), track: jest.fn() }));
// IAP off (no RevenueCat key) unless a test hands the screen an adapter.
jest.mock('../credits/purchases', () => ({ getPurchases: jest.fn(() => null) }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), openBrowserAsync: jest.fn() }));

const browser = WebBrowser as jest.Mocked<typeof WebBrowser>;
const PACKAGES = [
  { id: '1_credit', credits: 1, priceCents: 1000, name: '1 Credit' },
  { id: '3_credits', credits: 3, priceCents: 2400, name: '3 Credits' },
  { id: '5_credits', credits: 5, priceCents: 3500, name: '5 Credits' },
  { id: '10_credits', credits: 10, priceCents: 6000, name: '10 Credits' },
];

const routes = () => ({ ...makeRoutes(), credits });
const openCredits = (url = '/credits?returnTo=/make/new') => renderRouter(routes(), { initialUrl: url });

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  pollConfig.intervalMs = 20;
  await useAuth.getState().signInWithSession(session());
  gen.getCreditCatalog.mockResolvedValue({ packages: PACKAGES });
  gen.createAppCheckout.mockResolvedValue('https://checkout.example/pay');
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
});

it('lists the packages with prices and badges, defaulting to 3 credits', async () => {
  openCredits();
  expect(await screen.findByTestId('credits-pkg-3_credits')).toBeTruthy();
  expect(screen.getByText('$24.00')).toBeTruthy();
  expect(screen.getByTestId('credits-badge-3_credits')).toHaveTextContent('Popular');
  expect(screen.getByTestId('credits-badge-10_credits')).toHaveTextContent('$6 each');
  expect(screen.getByTestId('credits-pkg-3_credits').props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByTestId('credits-pkg-5_credits'));
  expect(screen.getByTestId('credits-pkg-5_credits').props.accessibilityState.selected).toBe(true);
});

it('opens the in-app browser for the chosen package; a paid return waits for the credit, then goes back', async () => {
  const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
  const app = openCredits();
  // Push so there is history to go back to, as the make flow does.
  act(() => router.replace('/make/new'));
  act(() => router.push({ pathname: '/credits', params: { returnTo: '/make/new' } }));
  fireEvent.press(await screen.findByTestId('credits-pkg-5_credits'));
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'nomadkaraoke://checkout?status=success' });
  // The webhook lands on the third poll.
  gen.getMe
    .mockResolvedValueOnce({ email: 'me@example.com', credits: 1 }) // baseline
    .mockResolvedValueOnce({ email: 'me@example.com', credits: 1 })
    .mockResolvedValueOnce({ email: 'me@example.com', credits: 1 })
    .mockResolvedValue({ email: 'me@example.com', credits: 6 });
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));

  expect(gen.createAppCheckout).toHaveBeenCalledWith('5_credits', 'me@example.com');
  expect(browser.openAuthSessionAsync).toHaveBeenCalledWith('https://checkout.example/pay', 'nomadkaraoke://checkout');
  expect(await screen.findByTestId('credits-added', {}, { timeout: 6000 })).toHaveTextContent(/Credits added/); // after the tick icon's glyph
  expect(gen.getMe.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
  expect(observability.track).toHaveBeenCalledWith('purchase_started', { channel: 'web', package_id: '5_credits' });
  expect(observability.track).toHaveBeenCalledWith('purchase_completed', { channel: 'web' });
  await waitFor(() => expect(app.getPathname()).toBe('/make/new'), { timeout: 3000 });
  invalidate.mockRestore();
}, 15000);

it.each([
  ['cancelled status', { type: 'success', url: 'nomadkaraoke://checkout?status=cancelled' }],
  ['dismiss', { type: 'dismiss' }],
  ['cancel', { type: 'cancel' }],
] as const)('%s shows the neutral banner and stays', async (_n, result) => {
  openCredits();
  browser.openAuthSessionAsync.mockResolvedValue(result as WebBrowser.WebBrowserAuthSessionResult);
  await screen.findByTestId('credits-pkg-3_credits');
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  expect(await screen.findByTestId('credits-no-payment')).toHaveTextContent('No payment made');
  expect(screen.getByTestId('credits-screen')).toBeTruthy();
  expect(screen.queryByTestId('credits-added')).toBeNull();
  expect(observability.track).not.toHaveBeenCalledWith('purchase_completed', expect.anything());
});

it('a webhook that never lands says credits are on their way, with a refresh that can succeed', async () => {
  openCredits();
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'nomadkaraoke://checkout?status=success' });
  await screen.findByTestId('credits-pkg-3_credits');
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  await screen.findByTestId('credits-pending', {}, { timeout: 3000 });
  expect(screen.getByTestId('credits-checkout').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('credits-pkg-5_credits').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('credits-pending')).toHaveTextContent(/Payment received, credits are on their way/);
  expect(screen.queryByTestId('credits-failed')).toBeNull();

  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 4 });
  await act(async () => fireEvent.press(screen.getByTestId('credits-refresh')));
  expect(screen.getByTestId('credits-added')).toBeTruthy();
});

it('uses a fresh balance as the baseline, so a stale low cache is not a false "Credits added"', async () => {
  openCredits();
  // The cache says 0, the server (really) says 5 and never changes.
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 5 });
  await screen.findByTestId('credits-pkg-3_credits');
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'nomadkaraoke://checkout?status=success' });
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  await screen.findByTestId('credits-pending', {}, { timeout: 3000 });
  expect(screen.queryByTestId('credits-added')).toBeNull();
  expect(screen.getByTestId('credits-pending')).toBeTruthy();
});

it('a dismissed browser whose balance already rose counts as paid', async () => {
  openCredits();
  await screen.findByTestId('credits-pkg-3_credits');
  gen.getMe.mockResolvedValueOnce({ email: 'me@example.com', credits: 1 }).mockResolvedValue({ email: 'me@example.com', credits: 4 });
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  expect(await screen.findByTestId('credits-added')).toBeTruthy();
});

// The app's launch session check (useSessionCheck) also reads the balance; let it land before counting.
const settleLaunchCheck = async () => {
  await waitFor(() => expect(gen.getMe).toHaveBeenCalled());
  gen.getMe.mockClear();
};

it('a dismissed browser re-checks the balance a few times before saying no payment was made', async () => {
  openCredits();
  await screen.findByTestId('credits-pkg-3_credits');
  await settleLaunchCheck();
  // Baseline, then two unchanged reads; the webhook lands on the third check.
  gen.getMe
    .mockResolvedValueOnce({ email: 'me@example.com', credits: 1 })
    .mockResolvedValueOnce({ email: 'me@example.com', credits: 1 })
    .mockResolvedValueOnce({ email: 'me@example.com', credits: 1 })
    .mockResolvedValue({ email: 'me@example.com', credits: 4 });
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  expect(await screen.findByTestId('credits-added')).toBeTruthy();
  expect(screen.queryByTestId('credits-no-payment')).toBeNull();
});

it('a dismissed browser checks the balance 3 times (not forever) before "No payment made"', async () => {
  openCredits();
  await screen.findByTestId('credits-pkg-3_credits');
  await settleLaunchCheck();
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  expect(await screen.findByTestId('credits-no-payment')).toBeTruthy();
  const afterOpen = gen.getMe.mock.calls.length;
  expect(afterOpen).toBe(1 + 3); // the baseline, then three checks
});

it('shows a plain failure (not a crash) when checkout cannot start', async () => {
  openCredits();
  await screen.findByTestId('credits-pkg-3_credits');
  gen.createAppCheckout.mockRejectedValue(new Error('boom'));
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  expect(await screen.findByTestId('credits-failed')).toHaveTextContent(/start checkout/);
  expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
});

it('an invalid returnTo falls back to the Me tab after a purchase', async () => {
  const app = openCredits('/credits?returnTo=https://evil.example');
  await screen.findByTestId('credits-pkg-3_credits');
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'nomadkaraoke://checkout?status=success' });
  gen.getMe.mockResolvedValueOnce({ email: 'me@example.com', credits: 1 }).mockResolvedValue({ email: 'me@example.com', credits: 4 });
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  await waitFor(() => expect(app.getPathname()).toBe('/me'), { timeout: 3000 });
});

it('opened from Me (no returnTo): a purchase goes back to Me without stacking a second set of tabs', async () => {
  const app = renderRouter(routes(), { initialUrl: '/me' });
  await screen.findByTestId('me-screen');
  act(() => router.push('/credits'));
  await screen.findByTestId('credits-pkg-3_credits');
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'nomadkaraoke://checkout?status=success' });
  gen.getMe.mockResolvedValueOnce({ email: 'me@example.com', credits: 1 }).mockResolvedValue({ email: 'me@example.com', credits: 4 });
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  await waitFor(() => expect(app.getPathname()).toBe('/me'), { timeout: 3000 });
  const root = app.getRouterState()?.routes[0]?.state;
  expect(root?.routes?.map((r) => r.name)).toEqual(['(tabs)']);
});

it('shows a retry when the packages fail to load', async () => {
  gen.getCreditCatalog.mockRejectedValue(new Error('boom'));
  openCredits();
  const retry = await screen.findByTestId('credits-retry', {}, { timeout: 4000 });
  gen.getCreditCatalog.mockResolvedValue({ packages: PACKAGES });
  fireEvent.press(retry);
  expect(await screen.findByTestId('credits-pkg-3_credits')).toBeTruthy();
}, 10000);

it('opens the sign-in sheet when signed out', async () => {
  await useAuth.getState().signOut();
  const app = openCredits('/credits');
  await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
  expect(app.getSearchParams()).toEqual({ returnTo: '/credits' });
});

it('keeps the original returnTo through sign-in', async () => {
  await useAuth.getState().signOut();
  const app = openCredits('/credits?returnTo=/make/new');
  await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
  expect(app.getSearchParams()).toEqual({ returnTo: '/credits?returnTo=/make/new' });
});

it('signed out with the sign-in sheet dismissed: a Sign in button reopens it, keeping returnTo', async () => {
  await useAuth.getState().signOut();
  const app = renderRouter(routes(), { initialUrl: '/me' });
  await screen.findByTestId('me-screen');
  act(() => router.push({ pathname: '/credits', params: { returnTo: '/make/new' } }));
  await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
  act(() => router.back());
  fireEvent.press(await screen.findByTestId('credits-signin'));
  await waitFor(() => expect(app.getPathname()).toBe('/sign-in'));
  expect(app.getSearchParams()).toEqual({ returnTo: '/credits?returnTo=/make/new' });
});

it('negative balance shows 0 (a store refund after the credits were spent)', async () => {
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: -2 });
  openCredits();
  expect(await screen.findByTestId('credits-balance')).toHaveTextContent('You have 0 credits');
});

describe('in-app purchases', () => {
  const STORE_PRICES: Record<string, string> = {
    nomad_credits_1: '£8.99',
    nomad_credits_3: '£19.99',
    nomad_credits_5: '£29.99',
    nomad_credits_10: '£49.99',
  };
  const STORE_PACKAGES = PACKAGES.map((p) => ({ ...p, storeProductId: `nomad_credits_${p.credits}` }));
  const WEB_LINK = { showFor: { ios: ['USA'], android: [] as string[] }, copyKey: 'credits.webLink.default' };
  const adapter = {
    configure: jest.fn(async () => {}),
    logOut: jest.fn(async () => {}),
    products: jest.fn(async (ids: string[]) =>
      ids.filter((id) => STORE_PRICES[id]).map((id) => ({ id, priceString: STORE_PRICES[id]!, price: 1, currency: 'GBP' })),
    ),
    purchase: jest.fn<ReturnType<PurchasesAdapter['purchase']>, [string]>(async () => ({ kind: 'purchased' })),
    storefrontCountry: jest.fn(async (): Promise<string | null> => 'USA'),
  };
  const me = (credits: number, extra: object = {}) => ({ email: 'me@example.com', credits, appUserId: 'u-1', ...extra });

  beforeEach(() => {
    (getPurchases as jest.Mock).mockReturnValue(adapter);
    gen.getCreditCatalog.mockResolvedValue({ packages: STORE_PACKAGES, webLink: WEB_LINK });
    gen.getMe.mockResolvedValue(me(1));
    adapter.storefrontCountry.mockResolvedValue('USA');
  });
  afterEach(() => jest.restoreAllMocks()); // Platform.OS
  afterAll(() => (getPurchases as jest.Mock).mockReturnValue(null));

  it('shows store price strings when IAP on', async () => {
    openCredits();
    expect(await screen.findByText('£19.99')).toBeTruthy();
    expect(screen.queryByText('$24.00')).toBeNull();
    expect(adapter.products).toHaveBeenCalledWith(['nomad_credits_1', 'nomad_credits_3', 'nomad_credits_5', 'nomad_credits_10']);
    expect(screen.getByTestId('credits-buy')).toBeTruthy();
    expect(screen.queryByTestId('credits-checkout')).toBeNull();
  });

  it('hides packages the store does not sell (no store product id, or unknown to the store)', async () => {
    gen.getCreditCatalog.mockResolvedValue({
      packages: [...STORE_PACKAGES, { id: 'web_only', credits: 2, priceCents: 1800, name: '2', storeProductId: undefined }],
      webLink: WEB_LINK,
    });
    delete STORE_PRICES.nomad_credits_5;
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    expect(screen.queryByTestId('credits-pkg-5_credits')).toBeNull();
    expect(screen.queryByTestId('credits-pkg-web_only')).toBeNull();
    STORE_PRICES.nomad_credits_5 = '£29.99';
  });

  it('buy calls purchase then polls /me until credits rise', async () => {
    openCredits();
    fireEvent.press(await screen.findByTestId('credits-pkg-5_credits'));
    adapter.purchase.mockImplementationOnce(async () => {
      gen.getMe.mockClear();
      // The webhook lands on the second poll.
      gen.getMe.mockResolvedValueOnce(me(1)).mockResolvedValue(me(6));
      return { kind: 'purchased' };
    });
    await act(async () => fireEvent.press(screen.getByTestId('credits-buy')));

    expect(adapter.configure).toHaveBeenCalledWith('u-1');
    expect(adapter.purchase).toHaveBeenCalledWith('nomad_credits_5');
    expect(await screen.findByTestId('credits-added', {}, { timeout: 3000 })).toHaveTextContent(/Credits added/);
    expect(gen.getMe.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(gen.createAppCheckout).not.toHaveBeenCalled();
    expect(observability.track).toHaveBeenCalledWith('purchase_started', { channel: 'iap', package_id: '5_credits' });
    expect(observability.track).toHaveBeenCalledWith('purchase_store_confirmed', { channel: 'iap', package_id: '5_credits' });
    expect(observability.track).toHaveBeenCalledWith('purchase_completed', { channel: 'iap', package_id: '5_credits' });
  });

  it('a purchase whose credit never lands says it is on its way', async () => {
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    await act(async () => fireEvent.press(screen.getByTestId('credits-buy')));
    expect(await screen.findByTestId('credits-pending', {}, { timeout: 3000 })).toBeTruthy();
    expect(observability.track).not.toHaveBeenCalledWith('purchase_completed', expect.anything());
  });

  it('cancelled purchase shows nothing and re-enables', async () => {
    adapter.purchase.mockResolvedValueOnce({ kind: 'cancelled' });
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    await act(async () => fireEvent.press(screen.getByTestId('credits-buy')));
    await waitFor(() => expect(screen.getByTestId('credits-buy').props.accessibilityState.disabled).toBe(false));
    expect(adapter.purchase).toHaveBeenCalledWith('nomad_credits_3');
    for (const id of ['credits-added', 'credits-failed', 'credits-no-payment', 'credits-pending']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(observability.track).not.toHaveBeenCalledWith('purchase_completed', expect.anything());
  });

  it('a failed purchase says so and can be tried again', async () => {
    adapter.purchase.mockResolvedValueOnce({ kind: 'failed', message: 'store problem' });
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    await act(async () => fireEvent.press(screen.getByTestId('credits-buy')));
    expect(await screen.findByTestId('credits-failed')).toHaveTextContent(/purchase didn't go through/);
    expect(screen.getByTestId('credits-buy').props.accessibilityState.disabled).toBe(false);
  });

  it('never buys for an anonymous store customer: no app_user_id from gen fails before the store sheet', async () => {
    gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    await act(async () => fireEvent.press(screen.getByTestId('credits-buy')));
    expect(await screen.findByTestId('credits-failed')).toBeTruthy();
    expect(adapter.purchase).not.toHaveBeenCalled();
  });

  it('US iOS storefront shows web link; it runs the Stripe checkout', async () => {
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    const link = await screen.findByTestId('credits-web-link');
    expect(link).toHaveTextContent('Buy on the web');
    browser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'nomadkaraoke://checkout?status=cancelled' });
    await act(async () => fireEvent.press(link));
    expect(gen.createAppCheckout).toHaveBeenCalledWith('3_credits', 'me@example.com');
    expect(await screen.findByTestId('credits-no-payment')).toBeTruthy();
    expect(adapter.purchase).not.toHaveBeenCalled();
  });

  it('non-US storefront hides the web link', async () => {
    adapter.storefrontCountry.mockResolvedValue('GBR');
    openCredits();
    await screen.findByTestId('credits-buy');
    await waitFor(() => expect(adapter.storefrontCountry).toHaveBeenCalled());
    expect(screen.queryByTestId('credits-web-link')).toBeNull();
  });

  it('android hidden while show_for.android empty', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    openCredits();
    await screen.findByTestId('credits-buy');
    await waitFor(() => expect(adapter.storefrontCountry).toHaveBeenCalled());
    expect(screen.queryByTestId('credits-web-link')).toBeNull();
  });

  it('android shows the web link when gen enables its storefront', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    gen.getCreditCatalog.mockResolvedValue({ packages: STORE_PACKAGES, webLink: { ...WEB_LINK, showFor: { ios: [], android: ['USA'] } } });
    openCredits();
    expect(await screen.findByTestId('credits-web-link')).toBeTruthy();
  });

  it('no web_link from an older gen: no web link', async () => {
    gen.getCreditCatalog.mockResolvedValue({ packages: STORE_PACKAGES });
    openCredits();
    await screen.findByTestId('credits-buy');
    await waitFor(() => expect(adapter.storefrontCountry).toHaveBeenCalled());
    expect(screen.queryByTestId('credits-web-link')).toBeNull();
  });

  it('a double tap buys once', async () => {
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    await act(async () => {
      fireEvent.press(screen.getByTestId('credits-buy'));
      fireEvent.press(screen.getByTestId('credits-buy'));
    });
    await waitFor(() => expect(adapter.purchase).toHaveBeenCalled());
    expect(adapter.purchase).toHaveBeenCalledTimes(1);
  });

  it('Buy and the web link pressed together start only one payment', async () => {
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    const link = await screen.findByTestId('credits-web-link');
    await act(async () => {
      fireEvent.press(screen.getByTestId('credits-buy'));
      fireEvent.press(link);
    });
    await waitFor(() => expect(adapter.purchase).toHaveBeenCalled());
    expect(gen.createAppCheckout).not.toHaveBeenCalled();
  });

  it('Ask to Buy: waiting for approval, not a failure, and the buttons re-enable', async () => {
    adapter.purchase.mockResolvedValueOnce({ kind: 'pending' });
    openCredits();
    await screen.findByTestId('credits-pkg-3_credits');
    await act(async () => fireEvent.press(screen.getByTestId('credits-buy')));
    expect(await screen.findByTestId('credits-awaiting-approval')).toHaveTextContent(
      'Waiting for approval. Your credits will appear once the purchase is approved.',
    );
    expect(screen.queryByTestId('credits-failed')).toBeNull();
    expect(screen.getByTestId('credits-buy').props.accessibilityState.disabled).toBe(false);
    expect(observability.track).not.toHaveBeenCalledWith('purchase_store_confirmed', expect.anything());
  });

  it('an older gen without store product ids keeps the web checkout', async () => {
    gen.getCreditCatalog.mockResolvedValue({ packages: PACKAGES });
    openCredits();
    expect(await screen.findByText('$24.00')).toBeTruthy();
    expect(screen.getByTestId('credits-checkout')).toBeTruthy();
    expect(screen.queryByTestId('credits-buy')).toBeNull();
    expect(screen.queryByText("Couldn't load the credit packages.")).toBeNull();
  });

  it('store returns zero products → web checkout (products not created in the store yet), warning once', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.products.mockResolvedValueOnce([]);
    openCredits();
    expect(await screen.findByText('$24.00')).toBeTruthy();
    expect(screen.getByTestId('credits-checkout')).toBeTruthy();
    expect(screen.queryByTestId('credits-buy')).toBeNull();
    expect(screen.queryByTestId('credits-retry')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('none of 4 product ids');
    browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
    await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
    expect(gen.createAppCheckout).toHaveBeenCalledWith('3_credits', 'me@example.com');
    expect(adapter.purchase).not.toHaveBeenCalled();
  });

  it('a failed store product lookup still offers a retry', async () => {
    adapter.products.mockRejectedValueOnce(new Error('store down')).mockRejectedValueOnce(new Error('store down'));
    openCredits();
    expect(await screen.findByTestId('credits-retry', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByTestId('credits-checkout')).toBeNull();
  });

  it('the per-credit badge uses the store currency\'s own digits', async () => {
    adapter.products.mockImplementationOnce(async (ids: string[]) =>
      ids.map((id) => ({ id, priceString: `¥${id}`, price: id === 'nomad_credits_10' ? 6000 : 1000, currency: 'JPY' })),
    );
    openCredits();
    expect(await screen.findByTestId('credits-badge-10_credits')).toHaveTextContent('¥600 each');
  });

  it('a referral discount with a non-US storefront shows no note (no web link to point at)', async () => {
    adapter.storefrontCountry.mockResolvedValue('GBR');
    gen.getMe.mockResolvedValue(me(1, { referralDiscountPercent: 15 }));
    openCredits();
    await screen.findByTestId('credits-buy');
    await waitFor(() => expect(adapter.storefrontCountry).toHaveBeenCalled());
    await screen.findByTestId('credits-balance');
    expect(screen.queryByTestId('credits-referral-note')).toBeNull();
  });

  it('referral discount note shown when /me has active discount', async () => {
    gen.getMe.mockResolvedValue(me(1, { referralDiscountPercent: 15 }));
    openCredits();
    expect(await screen.findByTestId('credits-referral-note')).toHaveTextContent(
      'Your 15% referral discount applies when you buy on the web.',
    );
  });

  it('no referral note without an active discount', async () => {
    openCredits();
    await screen.findByTestId('credits-buy');
    expect(screen.queryByTestId('credits-referral-note')).toBeNull();
  });

  it('negative balance shows 0 with IAP on too', async () => {
    gen.getMe.mockResolvedValue(me(-3));
    openCredits();
    expect(await screen.findByTestId('credits-balance')).toHaveTextContent('You have 0 credits');
  });
});

it('IAP off falls back to web checkout', async () => {
  (getPurchases as jest.Mock).mockReturnValue(null);
  openCredits();
  expect(await screen.findByText('$24.00')).toBeTruthy();
  expect(screen.queryByTestId('credits-buy')).toBeNull();
  expect(screen.queryByTestId('credits-web-link')).toBeNull();
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
  await act(async () => fireEvent.press(screen.getByTestId('credits-checkout')));
  expect(gen.createAppCheckout).toHaveBeenCalledWith('3_credits', 'me@example.com');
});

it('a double tap on the web checkout opens it once', async () => {
  (getPurchases as jest.Mock).mockReturnValue(null);
  openCredits();
  await screen.findByTestId('credits-pkg-3_credits');
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
  await act(async () => {
    fireEvent.press(screen.getByTestId('credits-checkout'));
    fireEvent.press(screen.getByTestId('credits-checkout'));
  });
  await screen.findByTestId('credits-no-payment');
  expect(gen.createAppCheckout).toHaveBeenCalledTimes(1);
});
