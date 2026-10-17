import { isApiError } from '@nomad/api-gen';
import { normalizeCode, normalizeEmail, type AuthState, type Session } from '@nomad/core';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { currentLocale } from '../locale';
import { appStorage } from '../storage';
import { MAX_CODE_ATTEMPTS, sendCode, SignInError, toSignInError, verifyCode, type GenSession } from './authApi';

const KEY = 'nomad.session.v1';
// iOS keeps Keychain items (SecureStore) across uninstall; this app-sandbox marker does not survive,
// so a session found without it belongs to a previous install and is discarded.
const INSTALL_MARKER = 'install.marker.v1';

type AuthStore = {
  state: AuthState;
  hydrated: boolean;
  /** Wrong codes gen still accepts for the pending code (counted here; gen allows 5). */
  attemptsLeft: number;
  hydrate(): Promise<void>;
  /** Emails a code (also used to resend one). Throws Error('invalid_email') or SignInError. */
  requestCode(email: string): Promise<void>;
  /** Signs in with the emailed code. Throws Error('invalid_code_format') or SignInError. */
  verify(code: string): Promise<void>;
  /** Stores a session from any sign-in method (email code, Google, Apple). */
  signInWithSession(s: GenSession): Promise<void>;
  signOut(): Promise<void>;
  getToken(): string | null;
};

/** A stored session, or null if missing or not the shape we wrote (corrupt / older format). */
function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') {
      const { token, email, createdAt } = v as Record<string, unknown>;
      if (typeof token === 'string' && token && typeof email === 'string') {
        return { token, email, createdAt: typeof createdAt === 'number' ? createdAt : 0 };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/** Gen session (identity of record, spec §4) persisted in SecureStore. */
export const useAuth = create<AuthStore>((set, get) => ({
  state: { status: 'signedOut' },
  hydrated: false,
  attemptsLeft: MAX_CODE_ATTEMPTS,

  async hydrate() {
    // Never leave the app un-hydrated (AppProviders renders nothing until then): any storage failure,
    // e.g. iOS Keychain unreadable during a locked-device launch, falls back to signed out.
    let state: AuthState = { status: 'signedOut' };
    try {
      if (!appStorage.getBoolean(INSTALL_MARKER)) {
        await SecureStore.deleteItemAsync(KEY);
        appStorage.set(INSTALL_MARKER, true);
      }
      const session = parseSession(await SecureStore.getItemAsync(KEY));
      if (session) state = { status: 'signedIn', session };
      else await SecureStore.deleteItemAsync(KEY);
    } catch {
      // Keep signed out; the next sign-in overwrites whatever is stored.
    }
    set({ state, hydrated: true });
  },

  async requestCode(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new Error('invalid_email');
    try {
      await sendCode(email, currentLocale());
    } catch (e) {
      throw toSignInError(e);
    }
    // A new code replaces the old one on gen, so its attempt budget starts over.
    set({ state: { status: 'codeSent', email }, attemptsLeft: MAX_CODE_ATTEMPTS });
  },

  async verify(rawCode) {
    const s = get().state;
    if (s.status !== 'codeSent') throw new Error('no_pending_code');
    const code = normalizeCode(rawCode);
    if (!code) throw new Error('invalid_code_format');
    if (get().attemptsLeft <= 0) throw new SignInError('locked', 0);
    let session: GenSession;
    try {
      session = await verifyCode(s.email, code);
    } catch (e) {
      if (isApiError(e, 401, 'invalid_code')) {
        const attemptsLeft = Math.max(0, get().attemptsLeft - 1);
        set({ attemptsLeft });
        // The next try would be gen's 6th: locked whatever the code, so say so now.
        throw attemptsLeft === 0 ? new SignInError('locked', 0) : new SignInError('invalid', attemptsLeft);
      }
      const err = toSignInError(e);
      if (err.kind === 'locked') set({ attemptsLeft: 0 });
      throw err;
    }
    await get().signInWithSession(session);
  },

  async signInWithSession({ token, email }) {
    const session: Session = { token, email, createdAt: Date.now() };
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    appStorage.set(INSTALL_MARKER, true);
    set({ state: { status: 'signedIn', session }, attemptsLeft: MAX_CODE_ATTEMPTS });
  },

  async signOut() {
    // Flip state synchronously first so a burst of 401s only clears storage once. The make intent
    // (make/intentStore) is deliberately left alone: an expired session mid-make resumes after sign-in.
    if (get().hydrated && get().state.status === 'signedOut') return;
    set({ state: { status: 'signedOut' }, hydrated: true });
    await SecureStore.deleteItemAsync(KEY);
  },

  getToken() {
    const s = get().state;
    return s.status === 'signedIn' ? s.session.token : null;
  },
}));
