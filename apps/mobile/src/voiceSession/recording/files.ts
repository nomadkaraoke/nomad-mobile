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
