import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { renderRouter } from 'expo-router/testing-library';

import * as credits from '../app/credits';
import { pollConfig } from '../credits/useCheckout';
import { useAuth } from '../auth/store';
import { gen, session } from '../test-utils/genAuthMock';
import { makeRoutes } from '../test-utils/makeFixtures';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  listCreditPackages: jest.fn(),
  createAppCheckout: jest.fn(),
  getMe: jest.fn(),
}));
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
  gen.listCreditPackages.mockResolvedValue(PACKAGES);
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

it('shows a retry when the packages fail to load', async () => {
  gen.listCreditPackages.mockRejectedValue(new Error('boom'));
  openCredits();
  const retry = await screen.findByTestId('credits-retry', {}, { timeout: 4000 });
  gen.listCreditPackages.mockResolvedValue(PACKAGES);
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
