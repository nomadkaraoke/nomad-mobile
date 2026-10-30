import { isApiError } from '@nomad/api-gen';
import { normalizeCode, normalizeEmail, type AuthState, type Session, type SignInMethod } from '@nomad/core';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { getPurchases } from '../credits/purchases';
import { currentLocale } from '../locale';
import { resetObservability, track } from '../observability';
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
  /** Stores a session from any sign-in method (email code, Google, Apple), remembering which one. */
  signInWithSession(s: GenSession, method?: SignInMethod): Promise<void>;
  /**
   * Signs out. Runs the before-sign-out hooks first while the session still works (push unregister needs it), unless
   * `sessionDead` (a gen 401: those calls would only 401 again).
   */
  signOut(opts?: { sessionDead?: boolean }): Promise<void>;
  getToken(): string | null;
};

/** A stored session, or null if missing or not the shape we wrote (corrupt / older format). */
function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') {
      const { token, email, createdAt, method } = v as Record<string, unknown>;
      if (typeof token === 'string' && token && typeof email === 'string') {
        return {
          token,
          email,
          createdAt: typeof createdAt === 'number' ? createdAt : 0,
          ...(method === 'apple' || method === 'google' || method === 'email' ? { method } : {}),
        };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/** How long sign-out waits for its hooks (offline, a hung request) before signing out anyway. */
export const BEFORE_SIGN_OUT_TIMEOUT_MS = 4_000;

type BeforeSignOut = () => Promise<void>;
const beforeSignOutHooks = new Set<BeforeSignOut>();

/**
 * Work that needs the session one last time before sign-out clears it (e.g. unregistering this device's push token:
 * gen's DELETE needs auth). Registered by the module that owns it, so this store imports none of them. Best-effort:
 * a hook's failure never blocks sign-out, and each gets BEFORE_SIGN_OUT_TIMEOUT_MS. Returns the unregister function.
 */
export function onBeforeSignOut(hook: BeforeSignOut): () => void {
  beforeSignOutHooks.add(hook);
  return () => beforeSignOutHooks.delete(hook);
}

const bounded = (p: Promise<void>) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, BEFORE_SIGN_OUT_TIMEOUT_MS);
    p.catch(() => {}).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });

const runBeforeSignOut = () =>
  Promise.all(
    [...beforeSignOutHooks].map((hook) => {
      try {
        return bounded(hook());
      } catch {
        return Promise.resolve();
      }
    }),
  );

// One sign-out at a time: a burst of 401s, or taps while the hooks run, share it.
let signingOut: Promise<void> | null = null;

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
    await get().signInWithSession(session, 'email');
  },

  async signInWithSession({ token, email }, method) {
    const session: Session = { token, email, createdAt: Date.now(), ...(method ? { method } : {}) };
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    appStorage.set(INSTALL_MARKER, true);
    set({ state: { status: 'signedIn', session }, attemptsLeft: MAX_CODE_ATTEMPTS });
    track('signed_in');
  },

  signOut(opts) {
    // The make intent (make/intentStore) is deliberately left alone: an expired session mid-make resumes after sign-in.
    if (get().hydrated && get().state.status === 'signedOut') return Promise.resolve();
    if (signingOut) return signingOut;
    const signedIn = get().state.status === 'signedIn';
    signingOut = (async () => {
      // While the session still works (unless it is already dead), so e.g. gen's push-token DELETE is authorised.
      if (signedIn && !opts?.sessionDead) await runBeforeSignOut();
      set({ state: { status: 'signedOut' }, hydrated: true });
      // Forget the crash-report user and start analytics over with a new anonymous id (privacy-inventory row 16).
      resetObservability();
      // The store customer belongs to the person signing out (RevenueCat logOut); best-effort, never blocks sign-out.
      getPurchases()?.logOut().catch(() => {});
      await SecureStore.deleteItemAsync(KEY);
    })().finally(() => {
      signingOut = null;
    });
    return signingOut;
  },

  getToken() {
    const s = get().state;
    return s.status === 'signedIn' ? s.session.token : null;
  },
}));

/**
 * Account deletion (and a session that died during it): signs out with `sessionDead` semantics (no before-sign-out
 * hooks, so nothing calls a server for an account that no longer exists) and makes sure the stored session is gone.
 * The caller (account/wipeLocal.ts) wipes the rest of this phone's data; this store imports none of it.
 */
export async function signOutAndWipe(): Promise<void> {
  await useAuth.getState().signOut({ sessionDead: true });
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Best-effort: the next launch discards a session whose install marker is gone (MMKV is wiped too).
  }
}
