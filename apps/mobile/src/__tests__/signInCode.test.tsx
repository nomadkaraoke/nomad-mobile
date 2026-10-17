import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { signInRoutes } from '../test-utils/signInRoutes';

jest.mock('@nomad/api-decide', () => ({ configureClient: jest.fn(), popularSongs: jest.fn(async () => []) }));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  sendCode: jest.fn(),
  verifyCode: jest.fn(),
}));

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  gen.sendCode.mockResolvedValue(undefined);
  gen.verifyCode.mockImplementation(async (email) => session(email));
  await useAuth.getState().requestCode('me@example.com');
});

const openCode = () => renderRouter(signInRoutes(), { initialUrl: '/sign-in/code?returnTo=/make' });
const enter = async (code: string) => {
  fireEvent.changeText(screen.getByTestId('signin-code'), code.slice(0, 5));
  await act(async () => fireEvent.changeText(screen.getByTestId('signin-code'), code));
};

it('a wrong code says how many tries are left', async () => {
  gen.verifyCode.mockRejectedValue(apiError(401, 'invalid_code'));
  openCode();
  await screen.findByTestId('signin-code');
  await enter('000000');
  expect(screen.getByTestId('signin-error')).toHaveTextContent("That code isn't right (4 tries left)");
  await enter('111111');
  await enter('222222');
  await enter('333333');
  expect(screen.getByTestId('signin-error')).toHaveTextContent("That code isn't right (1 try left)");
});

it('429 too_many_attempts shows the locked message; Send a new code resends and resets the attempts', async () => {
  gen.verifyCode.mockRejectedValueOnce(apiError(429, 'too_many_attempts'));
  const app = openCode();
  await screen.findByTestId('signin-code');
  await enter('000000');
  expect(screen.getByTestId('signin-error')).toHaveTextContent('Too many tries. Send a new code to try again.');
  expect(screen.getByTestId('signin-verify')).toBeDisabled();

  await act(async () => fireEvent.press(screen.getByTestId('signin-resend')));
  expect(gen.sendCode).toHaveBeenCalledTimes(2);
  expect(gen.sendCode).toHaveBeenLastCalledWith('me@example.com', 'en');
  expect(useAuth.getState().attemptsLeft).toBe(5);
  expect(screen.getByText('We sent a new code to me@example.com.')).toBeTruthy();
  expect(screen.queryByTestId('signin-error')).toBeNull();
  expect(screen.getByTestId('signin-verify')).not.toBeDisabled();

  await enter('123456');
  expect(await screen.findByTestId('make-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/make');
});

it('an expired code offers a new one; a throttled resend says so', async () => {
  gen.verifyCode.mockRejectedValueOnce(apiError(401, 'expired'));
  openCode();
  await screen.findByTestId('signin-code');
  await enter('000000');
  expect(screen.getByTestId('signin-error')).toHaveTextContent('That code has expired. Send a new code to try again.');
  gen.sendCode.mockRejectedValueOnce(apiError(429, 'too_many_codes'));
  await act(async () => fireEvent.press(screen.getByTestId('signin-resend')));
  expect(screen.getByTestId('signin-error')).toHaveTextContent('Too many codes requested, try again in a bit');
});

it('the Sign in button verifies too, and a network failure is explained', async () => {
  gen.verifyCode.mockRejectedValueOnce(new TypeError('Network request failed'));
  openCode();
  fireEvent.changeText(await screen.findByTestId('signin-code'), '12345');
  await act(async () => fireEvent.press(screen.getByTestId('signin-verify')));
  expect(screen.getByTestId('signin-error')).toHaveTextContent('Enter the 6-digit code.');
  fireEvent.changeText(screen.getByTestId('signin-code'), '12345');
  await act(async () => fireEvent.changeText(screen.getByTestId('signin-code'), '123456'));
  expect(screen.getByTestId('signin-error')).toHaveTextContent("Couldn't connect. Check your connection and try again.");
});
