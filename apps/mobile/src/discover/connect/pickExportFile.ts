import * as DocumentPicker from 'expo-document-picker';
import { router, type Href } from 'expo-router';

/**
 * What the picker offers. Zips are labelled differently by different file providers (Windows-made zips,
 * generic "binary" downloads), so those are allowed too: the reader rejects anything that isn't an export.
 */
export const PICK_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'text/csv',
  'text/comma-separated-values',
];

/**
 * Opens the system file picker for a privacy export and, when a file is picked, the import screen for it. The
 * picker copies the file into the app's cache, so the reader gets a `file://` uri with a known size (the import
 * screen deletes that copy once it is done with it).
 */
export async function pickExportFile(replace = false): Promise<void> {
  const res = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES, copyToCacheDirectory: true });
  const asset = res.canceled ? undefined : res.assets?.[0];
  if (!asset) return;
  const to = { pathname: '/discover/connect/import-file', params: { file: asset.uri, name: asset.name } } as unknown as Href;
  if (replace) router.replace(to);
  else router.push(to);
}
