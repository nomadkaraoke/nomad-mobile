import { Paths } from 'expo-file-system';

/**
 * The only places the import screen reads (and later deletes) a file from, inside the app's cache:
 * - `DocumentPicker/`: expo-document-picker's `copyToCacheDirectory` copy (`<cache>/DocumentPicker/<uuid>.<ext>` on
 *   both platforms: DocumentPickerModule.kt `copyDocumentToCacheDirectory`, DocumentPickerModule.swift
 *   `readDocumentDetails`);
 * - `shared/`: the share-intake module's copy (`<cache>/shared/<per-share dir>/<safeName>`).
 */
const IMPORT_DIRS = ['DocumentPicker/', 'shared/'];

/**
 * One path segment as the picker and share intake write them: letters, digits, `.`, `_`, `-`, not starting with a
 * dot. That rules out `.` / `..`, percent-encoding (so no encoded traversal or separators), `?`, `#` and backslashes.
 */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function cacheRoot(): string {
  const cache = (Paths.cache as unknown as { uri?: string }).uri ?? String(Paths.cache);
  return cache.replace(/\/*$/, '/');
}

/**
 * Whether `uri` is a file the import screen may read and delete: a `file://` uri inside the picker's or share
 * intake's cache folder. Anything else (another app-private file, a path with `..`) came from a crafted link
 * (final review I2) and is refused.
 */
export function isImportableFileUri(uri: string | undefined | null): uri is string {
  if (!uri || !uri.startsWith('file://')) return false;
  let root: string;
  try {
    root = cacheRoot();
  } catch {
    return false;
  }
  const dir = IMPORT_DIRS.find((d) => uri.startsWith(root + d));
  if (!dir) return false;
  const rest = uri.slice(root.length + dir.length).split('/');
  return rest.length > 0 && rest.every((s) => SEGMENT.test(s));
}
