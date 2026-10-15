import { normalizeCode, normalizeEmail, type AuthState, type Session } from '@nomad/core';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { currentLocale } from '../locale';
import { getAuthApi } from './authApi';

const KEY = 'nomad.session.v1';

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
export const useAuth = create<AuthStore>((set, get) => ({
  state: { status: 'signedOut' },
  hydrated: false,

  async hydrate() {
    const raw = await SecureStore.getItemAsync(KEY);
    let state: AuthState = { status: 'signedOut' };
    if (raw) {
      try {
        state = { status: 'signedIn', session: JSON.parse(raw) as Session };
      } catch {
        await SecureStore.deleteItemAsync(KEY);
      }
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
