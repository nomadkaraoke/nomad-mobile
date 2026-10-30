import { ApiError, deleteMyAccount } from '@nomad/api-gen';
import type { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { appleReauthorize } from '../auth/social';
import { useAuth } from '../auth/store';
import { fakeSocialEnabled } from '../config';
import { wipeLocal } from './wipeLocal';

/** Where a blocked deletion sends the person (mailto). */
export const SUPPORT_EMAIL = 'support@nomadkaraoke.com';

/** How long the app waits for gen's DELETE before offering a retry (gen resumes a deletion that was cut short). */
export const DELETE_TIMEOUT_MS = 60_000;

export type DeleteAccountResult =
  | { ok: true }
  /** gen refused (409, or 404 = deletion is off): ask the person to contact support. `code` may be unknown. */
  | { ok: false; reason: 'blocked'; code: string }
  /** Nothing changed on the phone. `partWay`: gen's 503, it stopped part-way and a retry picks up where it left off. */
  | { ok: false; reason: 'retry'; partWay: boolean }
  /** gen answered 401 (ruling R30): the session is gone, maybe because this account was just deleted. Wiped. */
  | { ok: false; reason: 'signedOut' };

const blockCode = (detail: unknown): string => {
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const code = (detail as { code: unknown }).code;
    if (typeof code === 'string' && code) return code;
  }
  return 'unknown';
};

/**
 * Deletes the signed-in account on gen, then (only on gen's 200) wipes this phone (wipeLocal). A 401 also wipes, as
 * the web does (R30). No connection, a timeout, a 503 or anything else keeps every bit of local data and asks for a
 * retry: the phone is never wiped before gen confirms.
 */
export async function deleteAccount(
  opts: { appleAuthorizationCode?: string; queryClient?: QueryClient } = {},
): Promise<DeleteAccountResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
  try {
    await deleteMyAccount({ appleAuthorizationCode: opts.appleAuthorizationCode, signal: controller.signal });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await wipeLocal({ queryClient: opts.queryClient });
      return { ok: false, reason: 'signedOut' };
    }
    if (e instanceof ApiError && e.status === 409) return { ok: false, reason: 'blocked', code: blockCode(e.detail) };
    if (e instanceof ApiError && e.status === 404) return { ok: false, reason: 'blocked', code: 'unavailable' };
    return { ok: false, reason: 'retry', partWay: e instanceof ApiError && e.status === 503 };
  } finally {
    clearTimeout(timer);
  }
  await wipeLocal({ queryClient: opts.queryClient });
  return { ok: true };
}

/**
 * The Apple re-confirmation deletion needs: on iOS, for a session that signed in with Apple, a fresh Sign in with
 * Apple's authorization code (gen revokes the Apple link with it). `null` = not needed (another platform or sign-in
 * method, or the fake sign-in of the local stack). 'cancelled' = the person closed Apple's sheet: delete nothing.
 * Throws SignInError when Apple fails.
 */
export async function appleCodeIfNeeded(): Promise<string | null | 'cancelled'> {
  const s = useAuth.getState().state;
  if (Platform.OS !== 'ios' || s.status !== 'signedIn' || s.session.method !== 'apple') return null;
  if (fakeSocialEnabled()) return null;
  return appleReauthorize();
}
