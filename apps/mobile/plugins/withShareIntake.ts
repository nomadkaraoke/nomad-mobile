import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Android Share -> Nomad Karaoke (Phase 3b Task 24): MainActivity accepts a single shared privacy export (a Spotify
 * zip or an Apple Music CSV). The share-intake module (modules/share-intake) copies it into the app's cache and the
 * app opens the import screen. A SEND intent carries no data URI, so it never reaches Expo Router as a path.
 */
export const SHARE_MIME_TYPES = ['application/zip', 'application/x-zip-compressed', 'text/csv', 'text/comma-separated-values'];

const SEND = 'android.intent.action.SEND';

type IntentFilter = NonNullable<AndroidConfig.Manifest.ManifestActivity['intent-filter']>[number];

/** A SEND filter this plugin wrote (only our mime types), so a re-run replaces it; anyone else's filters stay. */
const isOurSendFilter = (f: IntentFilter) =>
  (f.action?.some((a) => a.$['android:name'] === SEND) ?? false) &&
  (f.data ?? []).every((d) => SHARE_MIME_TYPES.includes(d.$['android:mimeType'] ?? ''));

export const withShareIntake: ConfigPlugin = (config) =>
  withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    const filters = (activity['intent-filter'] ?? []).filter((f) => !isOurSendFilter(f));
    filters.push({
      action: [{ $: { 'android:name': SEND } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: SHARE_MIME_TYPES.map((mimeType) => ({ $: { 'android:mimeType': mimeType } })),
    });
    activity['intent-filter'] = filters;
    return c;
  });

export default withShareIntake;
