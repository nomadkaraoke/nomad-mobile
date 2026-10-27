import type { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';

import { signOutAndWipe } from '../auth/store';
import { clearImportQueue } from '../discover/connect/importQueue';
import { clearDiscoverLocalData } from '../discover/useClearDiscoverOnSignOut';
import { deleteDownloadedMp4s } from '../jobs/downloadMp4';
import { useMakeIntent } from '../make/intentStore';
import { clearMeLocalData } from '../me/useClearMeOnAccountChange';
import { forgetPushLocally } from '../notifications/push';
import { resetObservability } from '../observability';
import { removeOfflineIndex } from '../offline/offlineIndex';
import { ALL_STORAGES } from '../storage';
import { useRecordingQueue } from '../voiceSession/recording/recordingQueue';

/** One cleanup step; a failure is logged and never stops the steps after it. */
async function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`[wipeLocal] ${name} failed`, e);
  }
}

/**
 * Account deletion (Phase 6 spec §6): leaves the phone as if the app had just been installed. Only call it once gen
 * has deleted the account (200), or the session is gone mid-delete (ruling R30): it never talks to a server, since
 * gen already erased the push tokens, recordings and everything else on its side.
 *
 * 1. Push: forget the token on the phone only (before sign-out, so no pending unregister is kept for a dead session).
 * 2. Sign out with `sessionDead` semantics (signOutAndWipe): no before-sign-out hooks; RevenueCat logOut; the
 *    session leaves SecureStore. Every `useAuth.subscribe` listener reacts: Tonight's night, karaoke log and outbox
 *    rehydrate as nobody, the import queue hides its error, Discover clears (AppProviders' listener).
 * 3. What sign-out deliberately keeps for the same person signing back in: the import queue and its payload files,
 *    Discover (again, in case its listener isn't mounted), Me's caches and unsent Me writes (`clearMeLocalData`),
 *    the voice recording queue (local part only: decide has
 *    erased the recordings), the make intent, the offline song list, downloaded videos, scheduled reminders, the
 *    query cache.
 * 4. Sentry user and PostHog's anonymous id reset.
 * 5. Every MMKV instance cleared, so nothing above writes a key back afterwards.
 * 6. Push forgotten once more, last (see the note there).
 */
export async function wipeLocal(opts: { queryClient?: QueryClient } = {}): Promise<void> {
  const { queryClient } = opts;
  await step('push', forgetPushLocally);
  await step('sign-out', signOutAndWipe);
  await step('imports', clearImportQueue);
  await step('discover', () => clearDiscoverLocalData(queryClient));
  await step('recordings', () => useRecordingQueue.getState().clearAll());
  await step('make intent', () => useMakeIntent.getState().clear());
  await step('me', clearMeLocalData);
  await step('offline song list', removeOfflineIndex);
  await step('downloaded videos', deleteDownloadedMp4s);
  await step('reminders', () => Notifications.cancelAllScheduledNotificationsAsync());
  await step('query cache', () => queryClient?.clear());
  await step('observability', resetObservability);
  for (const storage of ALL_STORAGES) await step('storage', () => storage.clearAll());
  // Again, last: a gen 401 during the delete signs out through the client's onUnauthorized before step 1, and the push
  // sign-out listener then writes a pending unregister (SecureStore) for the dead session; never leave it behind.
  await step('push pending', forgetPushLocally);
}
