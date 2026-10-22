import * as Apple from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { GoogleAuth, GoogleAuthError } from 'react-native-google-auth';

import { apiError, gen, session } from '../test-utils/genAuthMock';

jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  exchangeGoogleToken: jest.fn(),
  exchangeAppleToken: jest.fn(),
}));

const google = GoogleAuth as jest.Mocked<typeof GoogleAuth>;
const apple = Apple as jest.Mocked<typeof Apple>;

const ENV = ['EXPO_PUBLIC_GEN_API_URL', 'EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN', 'EXPO_PUBLIC_APPLE_SIGNIN'] as const;

// config.ts reads env at import; load social.ts (and its config) fresh after setting env.
const load = () => {
  let mod!: typeof import('../auth/social');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../auth/social');
  });
  return mod;
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV) delete process.env[k];
  gen.exchangeGoogleToken.mockResolvedValue(session('g@example.com'));
  gen.exchangeAppleToken.mockResolvedValue(session('a@example.com'));
});

describe('Google', () => {
  it('exchanges the native ID token for a gen session', async () => {
    google.signIn.mockResolvedValueOnce({
      type: 'success',
      data: { idToken: 'gid', accessToken: null, user: { id: '1', email: 'g@example.com' } },
    } as never);
    await expect(load().signInWithGoogle()).resolves.toEqual(session('g@example.com'));
    expect(google.configure).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: '718638054799-fush0smd1e4icq9pt0immp8n59jjlebh.apps.googleusercontent.com' }),
    );
    expect(gen.exchangeGoogleToken).toHaveBeenCalledWith('gid', 'en');
  });

  it('passes the iOS client id on iOS only', async () => {
    const social = load();
    await social.signInWithGoogle();
    expect(google.configure).toHaveBeenCalledWith(
      expect.objectContaining({ iosClientId: '718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com' }),
    );
    // configured once per launch
    await social.signInWithGoogle();
    expect(google.configure).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a cancelled response', () => google.signIn.mockResolvedValueOnce({ type: 'cancelled' } as never)],
    ['a SIGN_IN_CANCELLED error', () => google.signIn.mockRejectedValueOnce(new GoogleAuthError('SIGN_IN_CANCELLED' as never, 'x'))],
  ])('returns "cancelled" on %s, without calling gen', async (_name, arrange) => {
    arrange();
    await expect(load().signInWithGoogle()).resolves.toBe('cancelled');
    expect(gen.exchangeGoogleToken).not.toHaveBeenCalled();
  });

  it('a native failure or no account is a "failed" SignInError', async () => {
    google.signIn.mockResolvedValueOnce({ type: 'noSavedCredentialFound' } as never);
    await expect(load().signInWithGoogle()).rejects.toMatchObject({ kind: 'failed' });
    google.signIn.mockRejectedValueOnce(new Error('boom'));
    await expect(load().signInWithGoogle()).rejects.toMatchObject({ kind: 'failed' });
  });

  it('maps gen refusals (signup cap)', async () => {
    google.signIn.mockResolvedValueOnce({ type: 'success', data: { idToken: 'gid' } } as never);
    gen.exchangeGoogleToken.mockRejectedValueOnce(apiError(429, 'signup_rate_limited'));
    await expect(load().signInWithGoogle()).rejects.toMatchObject({ kind: 'signupLimited' });
  });
});

describe('Apple', () => {
  it('exchanges the identity token; cancel is "cancelled"', async () => {
    apple.signInAsync.mockResolvedValueOnce({ identityToken: 'aid' } as never);
    await expect(load().signInWithApple()).resolves.toEqual(session('a@example.com'));
    expect(gen.exchangeAppleToken).toHaveBeenCalledWith('aid', 'en');

    apple.signInAsync.mockRejectedValueOnce(Object.assign(new Error('c'), { code: 'ERR_REQUEST_CANCELED' }));
    await expect(load().signInWithApple()).resolves.toBe('cancelled');

    apple.signInAsync.mockResolvedValueOnce({ identityToken: null } as never);
    await expect(load().signInWithApple()).rejects.toMatchObject({ kind: 'failed' });
  });

  it('appleAvailable needs the build flag, iOS and device support', async () => {
    process.env.EXPO_PUBLIC_APPLE_SIGNIN = '0';
    expect(await load().appleAvailable()).toBe(false);
    delete process.env.EXPO_PUBLIC_APPLE_SIGNIN;
    expect(await load().appleAvailable()).toBe(true);
    apple.isAvailableAsync.mockResolvedValueOnce(false);
    expect(await load().appleAvailable()).toBe(false);
    const os = Platform.OS;
    Platform.OS = 'android';
    try {
      expect(await load().appleAvailable()).toBe(false);
    } finally {
      Platform.OS = os;
    }
  });
});

describe('fake social sign-in (local stack only)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
    process.env.EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN = '1';
  });

  it('sends fake:<email> instead of calling the native SDKs', async () => {
    const social = load();
    await social.signInWithGoogle({ fakeEmail: ' Tester@Example.com ' });
    expect(gen.exchangeGoogleToken).toHaveBeenCalledWith('fake:tester@example.com', 'en');
    await social.signInWithApple({ fakeEmail: 'tester@example.com' });
    expect(gen.exchangeAppleToken).toHaveBeenCalledWith('fake:tester@example.com', 'en');
    expect(google.signIn).not.toHaveBeenCalled();
    expect(apple.signInAsync).not.toHaveBeenCalled();
  });

  it('needs a valid test email', async () => {
    await expect(load().signInWithGoogle({ fakeEmail: 'nope' })).rejects.toThrow('invalid_email');
  });

  it('is ignored against prod gen: the native SDK runs', async () => {
    process.env.EXPO_PUBLIC_GEN_API_URL = 'https://api.nomadkaraoke.com';
    await expect(load().signInWithGoogle({ fakeEmail: 'tester@example.com' })).resolves.toBe('cancelled');
    expect(google.signIn).toHaveBeenCalled();
    expect(gen.exchangeGoogleToken).not.toHaveBeenCalled();
  });
});
