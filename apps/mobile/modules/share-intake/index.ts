// Android Share -> Nomad Karaoke (see android/…/ShareIntakeModule.kt and plugins/withShareIntake.ts). iOS has no
// share target for exports yet: the module is absent there, so these return null and no-op.
import { requireOptionalNativeModule } from 'expo';

/** A shared export, copied into the app's cache (`file://…/cache/shared/<name>`). */
export type SharedFile = { uri: string; name: string; mimeType: string };

type Subscription = { remove(): void };

type Native = {
  getInitialSharedFile(): Promise<SharedFile | null>;
  addListener(event: 'onSharedFile', listener: (file: SharedFile) => void): Subscription;
};

const native = requireOptionalNativeModule<Native>('ShareIntake');

/** The file shared into the app when the share launched it (read once: the native side then forgets it). */
export async function getInitialSharedFile(): Promise<SharedFile | null> {
  if (!native) return null;
  try {
    return await native.getInitialSharedFile();
  } catch {
    // Unreadable stream (revoked permission, provider gone): nothing to import.
    return null;
  }
}

/** Calls `listener` for each file shared while the app is running. */
export function addSharedFileListener(listener: (file: SharedFile) => void): Subscription {
  if (!native) return { remove() {} };
  return native.addListener('onSharedFile', listener);
}
