import { normalizeEmail } from '@nomad/core';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { GoogleAuth, GoogleAuthErrorCodes, isGoogleAuthError } from 'react-native-google-auth';

import { APPLE_SIGNIN_ENABLED, fakeSocialEnabled, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../config';
import { currentLocale } from '../locale';
import { exchangeAppleToken, exchangeGoogleToken, SignInError, toSignInError, type GenSession } from './authApi';

export type SocialResult = GenSession | 'cancelled';
/** Local stack / E2E only: the email the fake ID token signs in as (see fakeSocialEnabled()). */
export type SocialOptions = { fakeEmail?: string };

/** Fake mode: `fake:<email>` stands in for a native ID token (gen accepts it only with FAKE_WORKERS on). */
function fakeToken(opts: SocialOptions | undefined): string | null {
  if (!fakeSocialEnabled()) return null;
  const email = normalizeEmail(opts?.fakeEmail ?? '');
  if (!email) throw new Error('invalid_email');
  return `fake:${email}`;
}

async function exchange(fn: typeof exchangeGoogleToken, idToken: string): Promise<GenSession> {
  try {
    return await fn(idToken, currentLocale());
  } catch (e) {
    throw toSignInError(e);
  }
}

let googleConfigured: Promise<void> | null = null;

function configureGoogle(): Promise<void> {
  // Android (Credential Manager) asks for an ID token whose audience is the web client gen verifies;
  // iOS (Google Sign-In SDK) signs in with the iOS client.
  googleConfigured ??= GoogleAuth.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    ...(Platform.OS === 'ios' ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
    scopes: ['openid', 'email', 'profile'],
  }).catch((e: unknown) => {
    googleConfigured = null;
    throw e;
  });
  return googleConfigured;
}

/** Native Google sign-in (Android Credential Manager / iOS Google Sign-In SDK), exchanged for a gen session. */
export async function signInWithGoogle(opts?: SocialOptions): Promise<SocialResult> {
  const fake = fakeToken(opts);
  if (fake) return exchange(exchangeGoogleToken, fake);

  let idToken: string;
  try {
    await configureGoogle();
    const res = await GoogleAuth.signIn();
    if (res.type === 'cancelled') return 'cancelled';
    if (res.type !== 'success' || !res.data.idToken) throw new SignInError('failed');
    idToken = res.data.idToken;
  } catch (e) {
    if (isGoogleAuthError(e) && e.code === GoogleAuthErrorCodes.SIGN_IN_CANCELLED) return 'cancelled';
    throw e instanceof SignInError ? e : new SignInError('failed');
  }
  return exchange(exchangeGoogleToken, idToken);
}

/** Native Sign in with Apple (iOS), exchanged for a gen session. */
export async function signInWithApple(opts?: SocialOptions): Promise<SocialResult> {
  const fake = fakeToken(opts);
  if (fake) return exchange(exchangeAppleToken, fake);

  let idToken: string | null;
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    idToken = cred.identityToken;
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED') return 'cancelled';
    throw new SignInError('failed');
  }
  if (!idToken) throw new SignInError('failed');
  return exchange(exchangeAppleToken, idToken);
}

/** Apple's button shows only when enabled for this build, on iOS, on a device that supports it. */
export async function appleAvailable(): Promise<boolean> {
  if (!APPLE_SIGNIN_ENABLED || Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Account deletion: a fresh Sign in with Apple (no name or email asked) for its one-time `authorizationCode`, which
 * gen uses to revoke the app's Apple link. 'cancelled' when the person closes Apple's sheet; throws SignInError
 * ('failed') when Apple gives no code.
 */
export async function appleReauthorize(): Promise<string | 'cancelled'> {
  let code: string | null;
  try {
    const cred = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    code = cred.authorizationCode;
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED') return 'cancelled';
    throw new SignInError('failed');
  }
  if (!code) throw new SignInError('failed');
  return code;
}
