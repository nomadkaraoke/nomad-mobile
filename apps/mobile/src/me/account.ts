import { useAuth } from '../auth/store';
import { userKeyFor } from '../auth/userKey';

/** The signed-in account's storage key, or null. */
export const useUserKey = (): string | null =>
  useAuth((s) => (s.state.status === 'signedIn' ? userKeyFor(s.state.session.email) : null));

export const libraryStorageKey = (userKey: string) => `me.library.v1.${userKey}`;
export const setlistsStorageKey = (userKey: string) => `me.setlists.v1.${userKey}`;
export const logMirrorStorageKey = (userKey: string) => `me.logmirror.v1.${userKey}`;
export const OWNER_KEY = 'me.owner.v1';
