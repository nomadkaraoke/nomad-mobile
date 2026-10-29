import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '../auth/store';
import { userKeyFor } from '../auth/userKey';
import { appStorage } from '../storage';
import { getMadeStorageKey, goTosStorageKey, libraryStorageKey, logMirrorStorageKey, OWNER_KEY, setlistsStorageKey } from './account';
import { BOARD_QUERY_KEY, useGetMadeLocal } from './getMadeLocal';
import { useLibrarySettle } from './librarySettle';
import { useLovedOverrides } from './lovedOverrides';
import { useMeOutbox } from './meOutbox';
import { useBindMeQueryClient } from './queryClientRef';
import { useClaimAnswered } from './useClaimSuggestions';

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
  useBindMeQueryClient(queryClient);
  useEffect(() => {
    const now = keyOf(useAuth.getState());
    if (now) adoptOwner(now);
    return useAuth.subscribe((state, prev) => {
      const was = keyOf(prev);
      const is = keyOf(state);
      if (is !== was) {
        // any account change: loves and sent-but-unfetched writes are per person
        useLovedOverrides.getState().clear();
        useLibrarySettle.getState().clear();
        useGetMadeLocal.getState().clear();
        // The board's vote state (voted today, your vote) is the signed-in person's.
        queryClient.removeQueries({ queryKey: BOARD_QUERY_KEY });
        // Past-night suggestions hold other singers' names and are memory-only (R39): never shown to the next person.
        const history = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'kjbox' && q.queryKey[2] === 'history-suggestions';
        void queryClient.cancelQueries({ predicate: history });
        queryClient.removeQueries({ predicate: history });
        useClaimAnswered.getState().clear();
      }
      if (was && !is) {
        for (const kind of ['library', 'setlists', 'karaoke-log', 'song-history', 'get-made', 'recs-gotos', 'crowd']) {
          const predicate = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'decide' && q.queryKey[2] === kind;
          void queryClient.cancelQueries({ predicate });
          queryClient.removeQueries({ predicate });
        }
        appStorage.remove(libraryStorageKey(was));
        appStorage.remove(setlistsStorageKey(was));
        appStorage.remove(logMirrorStorageKey(was));
        appStorage.remove(getMadeStorageKey(was));
        appStorage.remove(goTosStorageKey(was));
      }
      if (is && is !== was) adoptOwner(is);
    });
  }, [queryClient]);
}
