import { File } from 'expo-file-system';

/** Deletes a local take if it is there; a missing file or a failed delete is ignored. */
export function deleteFileQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

/** The WAV takes' folder under the app's documents (useSongRecorder). */
export const WAV_DIR_NAME = 'voice-recordings';
/**
 * Where expo-audio writes AAC takes under the documents folder (`directory: 'document'`): `ExpoAudio/` on iOS,
 * `Audio/` on Android, each file named `recording-<uuid>.m4a` (expo-audio's AudioUtils / AudioRecorder).
 */
export const AAC_DIR_NAMES = ['ExpoAudio', 'Audio'] as const;
export const AAC_FILE_PREFIX = 'recording-';
