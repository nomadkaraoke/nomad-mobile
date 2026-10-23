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

/** How a pick ended: the import screen opened, the user cancelled, a picker was already up, or the picker failed. */
export type PickOutcome = 'opened' | 'cancelled' | 'busy' | 'failed';

/** Set while a picker is up: a second tap (or another screen's button) must not open another (iOS rejects it). */
let picking = false;

/**
 * Opens the system file picker for a privacy export and, when a file is picked, the import screen for it. The
 * picker copies the file into the app's cache, so the reader gets a `file://` uri with a known size (the import
 * screen deletes that copy once it is done with it). Never rejects: a picker failure is the `failed` outcome.
 */
export async function pickExportFile(replace = false): Promise<PickOutcome> {
  if (picking) return 'busy';
  picking = true;
  try {
    let res: DocumentPicker.DocumentPickerResult;
    try {
      res = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES, copyToCacheDirectory: true });
    } catch (e) {
      console.warn(`[connect] file picker failed: ${String(e)}`);
      return 'failed';
    }
    const asset = res.canceled ? undefined : res.assets?.[0];
    if (!asset) return 'cancelled';
    const to = { pathname: '/discover/connect/import-file', params: { file: asset.uri, name: asset.name } } as unknown as Href;
    if (replace) router.replace(to);
    else router.push(to);
    return 'opened';
  } finally {
    picking = false;
  }
}
