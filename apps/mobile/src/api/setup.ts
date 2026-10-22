import { configureClient as configureDecide } from '@nomad/api-decide';
import { configureClient as configureGen } from '@nomad/api-gen';
import { configureKjbox } from '@nomad/api-kjbox';

import { useAuth } from '../auth/store';
import { DECIDE_API_URL, GEN_API_URL, KJBOX_API_URL } from '../config';
import { currentLocale } from '../locale';
import { getDeviceId } from '../device/deviceId';

export { DECIDE_API_URL, GEN_API_URL, GEN_WEB_URL } from '../config';

export function setupApiClients() {
  // Gen owns identity: a gen 401 means the session is dead.
  configureGen({
    baseUrl: GEN_API_URL,
    getToken: () => useAuth.getState().getToken(),
    getLocale: currentLocale,
    onUnauthorized: () => void useAuth.getState().signOut(),
  });
  // Decide accepts the gen session token (the karaoke log, /api/my/*). Gen still owns identity: a decide 401 never
  // signs the user out (the karaoke-log outbox just waits for the next sign-in or trigger).
  configureDecide({
    baseUrl: DECIDE_API_URL,
    getToken: () => useAuth.getState().getToken(),
    getLocale: currentLocale,
    getDeviceId,
    onUnauthorized: () => {},
  });
  // kjbox verifies the gen session token itself. Its 401 only means "could not verify right now": never sign out.
  configureKjbox({ baseUrl: KJBOX_API_URL, getToken: () => useAuth.getState().getToken(), getLocale: currentLocale });
}
