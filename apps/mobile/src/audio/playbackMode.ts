import { setAudioModeAsync } from 'expo-audio';

/**
 * The app's one audio session for explicit playback (ruling E10-R7): the native review and Tonight's previews play
 * with the ringer switch off. expo-audio applies no mode until `setAudioModeAsync` is called, and the iOS native
 * default (soloAmbient, `playsInSilentMode: false`) is silent with the ringer off, so this is set explicitly rather
 * than left to whichever screen plays first. `mixWithOthers`: the review's A/B stems and its preview video play
 * together, and on Android `doNotMix` would have each player request audio focus from the other.
 */
export const PLAYBACK_AUDIO_MODE = { playsInSilentMode: true, interruptionMode: 'mixWithOthers' } as const;

let pending: Promise<void> | null = null;

/** Sets the playback mode once per launch; a failed attempt is retried on the next call. Never rejects. */
export function ensurePlaybackAudioMode(): Promise<void> {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => setAudioModeAsync(PLAYBACK_AUDIO_MODE))
      .catch(() => {
        pending = null;
      });
  }
  return pending;
}

/** Tests: forget that the mode was set. */
export function resetPlaybackAudioModeForTests(): void {
  pending = null;
}
