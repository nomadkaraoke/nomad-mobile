import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '../auth/store';
import { userKeyFor } from '../auth/userKey';
import { appStorage } from '../storage';
import { libraryStorageKey, logMirrorStorageKey, OWNER_KEY, setlistsStorageKey } from './account';
import { useLovedOverrides } from './lovedOverrides';
import { useMeOutbox } from './meOutbox';

const keyOf = (s: ReturnType<typeof useAuth.getState>): string | null =>
  s.state.status === 'signedIn' ? userKeyFor(s.state.session.email) : null;

/** Deletes every `me.*.<userKey>` key (caches, outbox) and the in-memory outbox if it is that user's. */
function purgeOwner(userKey: string): void {
  for (const k of appStorage.getAllKeys()) if (k.startsWith('me.') && k.endsWith(`.${userKey}`)) appStorage.remove(k);
  useMeOutbox.getState().purge(userKey);
}

/** On sign-in: a different account than the last owner purges the owner's Me data and unsent Me writes. */
function adoptOwner(userKey: string): void {
  const owner = appStorage.getString(OWNER_KEY);
  if (owner && owner !== userKey) purgeOwner(owner);
  if (owner !== userKey) appStorage.set(OWNER_KEY, userKey);
}

/**
 * Me's data is the signed-in person's. Sign-out drops the cached library, setlists and log mirror (the unsent Me
 * writes stay, so the same person signing back in still gets them sent); a DIFFERENT account signing in purges the
 * previous owner's Me data including those unsent writes. Mounted once in AppProviders.
 */
export function useClearMeOnAccountChange(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const now = keyOf(useAuth.getState());
    if (now) adoptOwner(now);
    return useAuth.subscribe((state, prev) => {
      const was = keyOf(prev);
      const is = keyOf(state);
      if (was && !is) {
        for (const kind of ['library', 'setlists', 'karaoke-log']) {
          queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'decide' && q.queryKey[2] === kind });
        }
        appStorage.remove(libraryStorageKey(was));
        appStorage.remove(setlistsStorageKey(was));
        appStorage.remove(logMirrorStorageKey(was));
        useLovedOverrides.getState().clear();
      }
      if (is && is !== was) adoptOwner(is);
    });
  }, [queryClient]);
}
