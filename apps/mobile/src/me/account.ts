import { useAuth } from '../auth/store';
import { userKeyFor } from '../auth/userKey';
import { writeCache } from './cache';

/** The signed-in account's storage key, or null. */
export const useUserKey = (): string | null =>
  useAuth((s) => (s.state.status === 'signedIn' ? userKeyFor(s.state.session.email) : null));

/** The signed-in account's key right now (read at call time, for guarding writes that finish later). */
export const currentUserKey = (): string | null => {
  const s = useAuth.getState().state;
  return s.status === 'signedIn' ? userKeyFor(s.session.email) : null;
};

/** Writes a cache only if the account that started the fetch is still signed in. */
export function writeCacheFor(userKey: string, storageKey: string, value: unknown): void {
  if (currentUserKey() === userKey) writeCache(storageKey, value);
}

export const libraryStorageKey = (userKey: string) => `me.library.v1.${userKey}`;
export const setlistsStorageKey = (userKey: string) => `me.setlists.v1.${userKey}`;
export const logMirrorStorageKey = (userKey: string) => `me.logmirror.v1.${userKey}`;
export const getMadeStorageKey = (userKey: string) => `me.getmade.v1.${userKey}`;
export const OWNER_KEY = 'me.owner.v1';
