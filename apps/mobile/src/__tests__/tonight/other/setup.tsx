// Shared setup for the Other-night tests (not a test file: no `.test.` in the name).
import { useAuth } from '../../../auth/store';
import { appStorage } from '../../../storage';
import { useLogStore } from '../../../tonight/log/logStore';
import { useOutbox } from '../../../tonight/log/outbox';
import { setNightClock, useNightStore, type OtherNight } from '../../../tonight/nightStore';
import { useEditingStore } from '../../../tonight/nomad/editingStore';

export const EMAIL = 'sam@example.com';

/** Signed in as Sam with clean per-user stores (no night). */
export function signedInClean(): void {
  appStorage.clearAll();
  setNightClock();
  useEditingStore.setState({ editing: false, sheets: 0 });
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: EMAIL, createdAt: 0 } } });
  useNightStore.getState().rehydrate(EMAIL);
  useLogStore.getState().rehydrate(EMAIL);
  useOutbox.getState().rehydrate(EMAIL);
}

/** Starts an Other night at "The Crown" and returns it. */
export function otherNight(venue = 'The Crown'): OtherNight {
  useNightStore.getState().startOther(venue);
  return useNightStore.getState().current() as OtherNight;
}
