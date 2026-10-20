import { configureClient as configureDecide } from '@nomad/api-decide';
import { configureClient as configureGen } from '@nomad/api-gen';

import { useAuth } from '../auth/store';
import { DECIDE_API_URL, GEN_API_URL } from '../config';
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
  // Decide is public for the MVP catalog: no gen token is sent and a 401 never signs the user out
  // (spec §4.2 adds a decide token via exchange-gen-session later).
  configureDecide({ baseUrl: DECIDE_API_URL, getToken: () => null, getLocale: currentLocale, getDeviceId, onUnauthorized: () => {} });
}
