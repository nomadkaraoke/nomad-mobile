import { randomUUID } from 'expo-crypto';

import { appStorage } from '../storage';

// Anonymous install id for the search service (X-Device-Id): a random UUID kept in MMKV, so it survives
// restarts and is wiped on uninstall. API clients never touch storage; setup.ts injects this getter.
const KEY = 'device.id.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let id: string | null = null;

export function getDeviceId(): string {
  if (id) return id;
  const stored = appStorage.getString(KEY);
  if (stored && UUID.test(stored)) {
    id = stored;
  } else {
    id = randomUUID();
    appStorage.set(KEY, id);
  }
  return id;
}
