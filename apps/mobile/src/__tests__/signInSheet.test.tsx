import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Apple from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';
import { GoogleAuth } from 'react-native-google-auth';

import { useAuth } from '../auth/store';
import { useMakeIntent } from '../make/intentStore';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { signInRoutes } from '../test-utils/signInRoutes';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  sendCode: jest.fn(),
  verifyCode: jest.fn(),
  exchangeGoogleToken: jest.fn(),
  exchangeAppleToken: jest.fn(),
}));
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  APPLE_SIGNIN_ENABLED: true,
  fakeSocialEnabled: jest.fn(() => false),
}));

const config = jest.requireMock('../config') as { fakeSocialEnabled: jest.Mock };
const google = GoogleAuth as jest.Mocked<typeof GoogleAuth>;
const apple = Apple as jest.Mocked<typeof Apple>;

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  useMakeIntent.getState().set({ artist: 'Lionel Richie', title: 'Starlight', decideSongId: 1, createdAt: Date.now() });
  config.fakeSocialEnabled.mockReturnValue(false);
  apple.isAvailableAsync.mockResolvedValue(true);
  gen.sendCode.mockResolvedValue(undefined);
  gen.verifyCode.mockImplementation(async (email) => session(email));
  gen.exchangeGoogleToken.mockResolvedValue(session('g@example.com'));
  (decide.getSong as jest.Mock).mockResolvedValue({ id: 2, artist: 'Adele', title: 'Hello', brands: [], brand_count: 1, is_popular: true });
});

const openSheet = () => renderRouter(signInRoutes(), { initialUrl: '/sign-in?returnTo=/make' });

it('is titled with the song being made and offers Google, Apple and email', async () => {
  openSheet();
  expect(await screen.findByText('Sign in to make Starlight')).toBeTruthy();
  expect(screen.getByText('Continue with Google')).toBeTruthy();
  expect(screen.getByText('Continue with email')).toBeTruthy();
  expect(await screen.findByText('Continue with Apple')).toBeTruthy();
  expect(screen.queryByTestId('signin-fake-email')).toBeNull();
});

it('hides Apple when appleAvailable() is false, and uses a generic title without a fresh intent', async () => {
  apple.isAvailableAsync.mockResolvedValue(false);
  useMakeIntent.getState().set({ artist: 'A', title: 'Old', createdAt: Date.now() - 31 * 60 * 1000 });
  openSheet();
  expect(await screen.findByText('Sign in to Nomad Karaoke')).toBeTruthy();
  await waitFor(() => expect(apple.isAvailableAsync).toHaveBeenCalled());
  expect(screen.queryByTestId('signin-apple')).toBeNull();
});

it('email → code → signed in → back in the make flow', async () => {
  const app = openSheet();
  fireEvent.press(await screen.findByTestId('signin-email-start'));
  fireEvent.changeText(await screen.findByTestId('signin-email'), 'Me@Example.com');
  await act(async () => fireEvent.press(screen.getByTestId('signin-send')));
  expect(await screen.findByText('We sent a 6-digit code to me@example.com.')).toBeTruthy();
  // Typing the 6th digit submits (as does one-time-code autofill).
  await act(async () => fireEvent.changeText(screen.getByTestId('signin-code'), '123456'));
  expect(await screen.findByTestId('make-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/make');
  expect(gen.verifyCode).toHaveBeenCalledWith('me@example.com', '123456');
  expect(useAuth.getState().getToken()).toBe('tok-me@example.com');
  expect(useMakeIntent.getState().get()).toMatchObject({ title: 'Starlight' });
});

it('email errors: invalid address, throttled sends, disposable inboxes', async () => {
  renderRouter(signInRoutes(), { initialUrl: '/sign-in/email?returnTo=/make' });
  fireEvent.changeText(await screen.findByTestId('signin-email'), 'nope');
  await act(async () => fireEvent.press(screen.getByTestId('signin-send')));
  expect(screen.getByTestId('signin-error')).toHaveTextContent('Enter a valid email address.');

  fireEvent.changeText(screen.getByTestId('signin-email'), 'me@example.com');
  gen.sendCode.mockRejectedValueOnce(apiError(429, 'too_many_codes'));
  await act(async () => fireEvent.press(screen.getByTestId('signin-send')));
  expect(screen.getByTestId('signin-error')).toHaveTextContent('Too many codes requested, try again in a bit');

  gen.sendCode.mockRejectedValueOnce(apiError(422, 'Disposable email addresses are not allowed'));
  await act(async () => fireEvent.press(screen.getByTestId('signin-send')));
  expect(screen.getByTestId('signin-error')).toHaveTextContent(/temporary email address/);
});

it('Google cancelled → stays on the sheet with no error', async () => {
  google.signIn.mockResolvedValueOnce({ type: 'cancelled' } as never);
  const app = openSheet();
  await act(async () => fireEvent.press(await screen.findByTestId('signin-google')));
  expect(app.getPathname()).toBe('/sign-in');
  expect(screen.queryByTestId('signin-error')).toBeNull();
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it('Google success → session stored → make flow', async () => {
  google.signIn.mockResolvedValueOnce({ type: 'success', data: { idToken: 'gid' } } as never);
  const app = openSheet();
  await act(async () => fireEvent.press(await screen.findByTestId('signin-google')));
  expect(await screen.findByTestId('make-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/make');
  expect(gen.exchangeGoogleToken).toHaveBeenCalledWith('gid', 'en');
  expect(useAuth.getState().getToken()).toBe('tok-g@example.com');
  expect(SecureStore.setItemAsync).toHaveBeenCalled();
});

it('Google refused by gen → error on the sheet', async () => {
  google.signIn.mockResolvedValueOnce({ type: 'success', data: { idToken: 'gid' } } as never);
  gen.exchangeGoogleToken.mockRejectedValueOnce(apiError(401, 'invalid_token'));
  openSheet();
  await act(async () => fireEvent.press(await screen.findByTestId('signin-google')));
  expect(await screen.findByTestId('signin-error')).toHaveTextContent("Couldn't sign in with Google. Try again, or continue with email.");
});

it('fake mode: a test email field, and Google sends fake:<email>', async () => {
  config.fakeSocialEnabled.mockReturnValue(true);
  openSheet();
  fireEvent.changeText(await screen.findByTestId('signin-fake-email'), 'tester@example.com');
  await act(async () => fireEvent.press(screen.getByTestId('signin-google')));
  expect(await screen.findByTestId('make-stub')).toBeTruthy();
  expect(gen.exchangeGoogleToken).toHaveBeenCalledWith('fake:tester@example.com', 'en');
  expect(google.signIn).not.toHaveBeenCalled();
});

it('signed-out "make" on a song opens the sheet; account tab signs in and out', async () => {
  renderRouter(signInRoutes(), { initialUrl: '/song/2' });
  fireEvent.press(await screen.findByTestId('song-make'));
  expect(await screen.findByTestId('signin-sheet')).toBeTruthy();
});

it('account: sign in returns to the account tab, then sign out', async () => {
  google.signIn.mockResolvedValueOnce({ type: 'success', data: { idToken: 'gid' } } as never);
  const app = renderRouter(signInRoutes(), { initialUrl: '/account' });
  fireEvent.press(await screen.findByTestId('account-signin'));
  await act(async () => fireEvent.press(await screen.findByTestId('signin-google')));
  expect(await screen.findByText('Signed in as g@example.com')).toBeTruthy();
  expect(app.getPathname()).toBe('/account');
  await act(async () => fireEvent.press(screen.getByTestId('account-signout')));
  expect(await screen.findByTestId('account-signin')).toBeTruthy();
});
