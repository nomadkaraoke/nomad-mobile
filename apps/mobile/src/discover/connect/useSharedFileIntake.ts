import { router } from 'expo-router';
import { useEffect } from 'react';

import { addSharedFileListener, getInitialSharedFile, type SharedFile } from '../../../modules/share-intake';
import { openSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';

const IMPORT_FILE = '/discover/connect/import-file';

/** The import screen's path for a shared file (the same form the screen itself uses for its sign-in return). */
export const importFilePath = (f: SharedFile) =>
  `${IMPORT_FILE}?file=${encodeURIComponent(f.uri)}&name=${encodeURIComponent(f.name)}`;

function open(f: SharedFile | null): void {
  if (!f?.uri) return;
  if (useAuth.getState().state.status === 'signedIn') {
    router.push({ pathname: IMPORT_FILE, params: { file: f.uri, name: f.name } });
  } else {
    // The import belongs to an account: sign in first, then land on the import screen with the same file.
    openSignIn(importFilePath(f));
  }
}

/**
 * Android Share -> Nomad Karaoke (Phase 3b Task 24): a privacy export shared into the app opens the import screen,
 * whether the share launched the app or arrived while it was on any other screen. A SEND intent has no data URI, so
 * Expo Router never sees it as a path; the share-intake module hands over a cached file:// copy instead.
 * No-op on iOS (no native module).
 */
export function useSharedFileIntake(): void {
  useEffect(() => {
    // The native side forgets the launch file once read, so a second effect run (dev StrictMode) gets null.
    void getInitialSharedFile().then(open);
    const sub = addSharedFileListener(open);
    return () => sub.remove();
  }, []);
}
