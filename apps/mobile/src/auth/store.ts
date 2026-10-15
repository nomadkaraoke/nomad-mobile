import { normalizeCode, normalizeEmail, type AuthState, type Session } from '@nomad/core';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { currentLocale } from '../locale';
import { appStorage } from '../storage';
import { getAuthApi } from './authApi';

const KEY = 'nomad.session.v1';
// iOS keeps Keychain items (SecureStore) across uninstall; this app-sandbox marker does not survive,
// so a session found without it belongs to a previous install and is discarded.
const INSTALL_MARKER = 'install.marker.v1';

type AuthStore = {
  state: AuthState;
  hydrated: boolean;
  hydrate(): Promise<void>;
  requestCode(email: string): Promise<void>;
  verify(code: string): Promise<void>;
  signOut(): Promise<void>;
  getToken(): string | null;
};

/** Gen session (identity of record, spec §4) persisted in SecureStore. */
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

export const useAuth = create<AuthStore>((set, get) => ({
  state: { status: 'signedOut' },
  hydrated: false,

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
    await getAuthApi().sendCode(email, currentLocale());
    set({ state: { status: 'codeSent', email } });
  },

  async verify(rawCode) {
    const s = get().state;
    if (s.status !== 'codeSent') throw new Error('no_pending_code');
    const code = normalizeCode(rawCode);
    if (!code) throw new Error('invalid_code_format');
    const { token } = await getAuthApi().verifyCode(s.email, code);
    const session: Session = { token, email: s.email, createdAt: Date.now() };
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    appStorage.set(INSTALL_MARKER, true);
    set({ state: { status: 'signedIn', session } });
  },

  async signOut() {
    // Flip state synchronously first so a burst of 401s only clears storage once.
    if (get().hydrated && get().state.status === 'signedOut') return;
    set({ state: { status: 'signedOut' }, hydrated: true });
    await SecureStore.deleteItemAsync(KEY);
  },

  getToken() {
    const s = get().state;
    return s.status === 'signedIn' ? s.session.token : null;
  },
}));
