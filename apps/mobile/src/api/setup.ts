import { configureClient as configureDecide } from '@nomad/api-decide';
import { configureClient as configureGen } from '@nomad/api-gen';

import { useAuth } from '../auth/store';
import { currentLocale } from '../locale';

export const GEN_BASE_URL = process.env.EXPO_PUBLIC_GEN_API_URL ?? 'https://api.nomadkaraoke.com';
export const DECIDE_BASE_URL = process.env.EXPO_PUBLIC_DECIDE_API_URL ?? 'https://decide.nomadkaraoke.com';

export function setupApiClients() {
  // Gen owns identity: a gen 401 means the session is dead.
  configureGen({
    baseUrl: GEN_BASE_URL,
    getToken: () => useAuth.getState().getToken(),
    getLocale: currentLocale,
    onUnauthorized: () => void useAuth.getState().signOut(),
  });
  // Decide is public for the MVP catalog: no gen token is sent and a 401 never signs the user out
  // (spec §4.2 adds a decide token via exchange-gen-session later).
  configureDecide({ baseUrl: DECIDE_BASE_URL, getToken: () => null, getLocale: currentLocale, onUnauthorized: () => {} });
}
