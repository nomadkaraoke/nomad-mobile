import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { appRoutes } from '../test-utils/routes';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));

beforeEach(async () => {
  // renderRouter switches jest to fake timers; the mock auth API's delay needs real ones.
  jest.useRealTimers();
  await useAuth.getState().signOut();
  (decide.getSong as jest.Mock).mockResolvedValue({
    id: 2, artist: 'Adele', title: 'Hello', brands: [], brand_count: 1, is_popular: true,
  });
});

it('signed-out make → email → code → back on the song, now able to make', async () => {
  const app = renderRouter(appRoutes(), { initialUrl: '/song/2' });
  expect(await screen.findByText('Hello')).toBeTruthy();
  const make = screen.getByTestId('song-make');
  expect(screen.getByText('Sign in to make this song')).toBeTruthy();
  fireEvent.press(make);

  fireEvent.changeText(await screen.findByTestId('signin-email'), 'Me@Example.com');
  await act(async () => fireEvent.press(screen.getByTestId('signin-send')));

  expect(await screen.findByText('We sent a 6-digit code to me@example.com.', {}, { timeout: 2000 })).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('signin-code'), '123 456');
  await act(async () => fireEvent.press(screen.getByTestId('signin-verify')));

  expect(await screen.findByText('Make karaoke video', {}, { timeout: 2000 })).toBeTruthy();
  expect(app.getPathname()).toBe('/song/2');
});

it('shows validation errors for bad email and bad code', async () => {
  renderRouter(appRoutes(), { initialUrl: '/sign-in/email' });
  fireEvent.changeText(await screen.findByTestId('signin-email'), 'nope');
  await act(async () => fireEvent.press(screen.getByTestId('signin-send')));
  expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('signin-email'), 'me@example.com');
  await act(async () => fireEvent.press(screen.getByTestId('signin-send')));
  fireEvent.changeText(await screen.findByTestId('signin-code', {}, { timeout: 2000 }), '000000');
  await act(async () => fireEvent.press(screen.getByTestId('signin-verify')));
  expect(await screen.findByText('Enter the 6-digit code.', {}, { timeout: 2000 })).toBeTruthy();
});

it('account tab signs out', async () => {
  await useAuth.getState().requestCode('me@example.com');
  await useAuth.getState().verify('123456');
  renderRouter(appRoutes(), { initialUrl: '/account' });
  expect(await screen.findByText('Signed in as me@example.com')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('account-signout')));
  expect(await screen.findByTestId('account-signin')).toBeTruthy();
});
