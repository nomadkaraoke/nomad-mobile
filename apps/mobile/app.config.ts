import type { ConfigContext, ExpoConfig } from 'expo/config';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AndroidConfig, withEntitlementsPlist, withStringsXml, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Native (iOS InfoPlist.strings) strings per app locale, generated from @nomad/i18n messages by
 * scripts/gen-native-locales.mjs (CI runs it with --check), one file per @nomad/i18n locale. Read from disk because
 * expo's config loader can't import the TS workspace package; nativeLocales.test.ts pins the set to LOCALES.
 */
const NATIVE_LOCALES = Object.fromEntries(
  readdirSync(join(__dirname, 'locales'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => [f.slice(0, -'.json'.length), `./locales/${f}`]),
);

/** Home-screen label (like "Photos" for Google Photos); the app's name stays "Nomad Karaoke". iOS: app.json CFBundleDisplayName. */
const LAUNCHER_LABEL = 'Karaoke';

// Build-time additions to app.json that depend on env. Keep the client-id default in step with src/config.ts.
const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com';

/**
 * Night links (spec §4.2, ruling E3-R2): Android App Links for kjbox.cc (http + https, any path; the printed QR is
 * `HTTP://KJBOX.CC/<code>`) and sing.nomadkaraoke.com (`/?t=<code>`). Android matches hosts case-sensitively, so the
 * uppercase QR host gets its own plain (unverified) filter.
 * kjbox.cc and sing.nomadkaraoke.com serve /.well-known/assetlinks.json.
 */
const VERIFIED_VIEW = { action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'] };
const httpAndHttps = (...hosts: string[]) => hosts.flatMap((host) => [{ scheme: 'http', host }, { scheme: 'https', host }]);
const NIGHT_LINK_FILTERS = [
  { ...VERIFIED_VIEW, data: httpAndHttps('kjbox.cc', 'www.kjbox.cc') },
  { ...VERIFIED_VIEW, data: [{ scheme: 'https', host: 'sing.nomadkaraoke.com', path: '/' }] },
  // Ruling E3-R6: unverified (no autoVerify), so an uppercase-host verification can never unverify the hosts above
  // (pre-Android 12 verification is all-or-nothing). The QR's scheme is uppercase too.
  {
    action: 'VIEW',
    category: ['BROWSABLE', 'DEFAULT'],
    data: [...httpAndHttps('KJBOX.CC'), { scheme: 'HTTP', host: 'KJBOX.CC' }],
  },
];

/**
 * EAS project (account `nomadkaraoke`, slug `nomad-karaoke`; docs/RELEASE.md). EAS Build/Update read it from
 * `extra.eas.projectId`; expo-updates fetches from `updates.url`. Debug builds (the dev client on Metro, E2E) never
 * download updates, so local dev and the local stack are unaffected.
 */
const EAS_PROJECT_ID = 'c6092d15-ad6e-4e3d-bfc2-befc2e239af2';

/**
 * The app only saves videos (expo-media-library, write-only) and picks screenshots through the system photo
 * picker, so no read access to the user's media. expo-media-library / expo-image-picker add these by default.
 */
const BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
];

/** iOS universal links for the same hosts (https only; the uppercase HTTP:// QR reaches iOS via the in-app scanner). */
const ASSOCIATED_DOMAINS = ['applinks:kjbox.cc', 'applinks:www.kjbox.cc', 'applinks:sing.nomadkaraoke.com'];

/**
 * Prebuild applies expo-apple-authentication's plugin automatically whenever the package is installed, and
 * it always adds the entitlement. Strip it again when Apple sign-in is off (this mod runs after that one).
 */
const withoutAppleSignIn: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['com.apple.developer.applesignin'];
    return c;
  });

/**
 * expo-notifications' plugin adds `aps-environment` (the push entitlement). Team-signed builds keep it (Expo push
 * needs it, Phase 6). EXPO_PUBLIC_PUSH=0 (the e2e-test profile: unsigned simulator / E2E builds, which can't carry
 * it) strips it again (this mod runs after that one).
 */
const withoutPushEntitlement: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });

/** Android's launcher label is the `app_name` string, which prebuild otherwise sets from `name`. */
const withLauncherLabel: ConfigPlugin = (config) =>
  withStringsXml(config, (c) => {
    c.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: 'app_name', translatable: 'false' }, _: LAUNCHER_LABEL }],
      c.modResults,
    );
    return c;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  // Sign in with Apple is on: App Store review requires it alongside Google, the App ID has the capability
  // (team 55B76HN73D) and gen verifies the tokens. EXPO_PUBLIC_APPLE_SIGNIN=0 drops the entitlement and the
  // button, for a build signed by a team without the capability.
  const apple = process.env.EXPO_PUBLIC_APPLE_SIGNIN !== '0';
  // Associated domains are an entitlement too (it needs the team-signed build), so off until the flag is set.
  const associatedDomains = process.env.EXPO_PUBLIC_ASSOCIATED_DOMAINS === '1';
  const push = process.env.EXPO_PUBLIC_PUSH !== '0';
  const projectId = (config.extra?.eas as { projectId?: string } | undefined)?.projectId ?? EAS_PROJECT_ID;
  const resolved: ExpoConfig = {
    ...config,
    name: config.name ?? 'Nomad Karaoke',
    slug: config.slug ?? 'nomad-karaoke',
    owner: 'nomadkaraoke',
    extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } },
    runtimeVersion: { policy: 'fingerprint' },
    updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` },
    locales: { ...config.locales, ...NATIVE_LOCALES },
    ios: {
      ...config.ios,
      ...(apple ? { usesAppleSignIn: true } : {}),
      ...(associatedDomains ? { associatedDomains: ASSOCIATED_DOMAINS } : {}),
    },
    android: {
      ...config.android,
      // Firebase app `1:718638054799:android:af245e1c3cba60766adffa` (GCP project nomadkaraoke), for FCM: Expo push on
      // Android (docs/RELEASE.md § Push). Committed, not an EAS file variable: it holds only public client identifiers,
      // and the fingerprint hashes its contents, so a file EAS has and the local machine lacks would split the runtime
      // version again.
      googleServicesFile: './google-services.json',
      intentFilters: [...(config.android?.intentFilters ?? []), ...NIGHT_LINK_FILTERS],
      blockedPermissions: [...(config.android?.blockedPermissions ?? []), ...BLOCKED_ANDROID_PERMISSIONS],
    },
    plugins: [
      ...(config.plugins ?? []),
      // iOS: GIDClientID + the reversed-client-id URL scheme the Google Sign-In SDK returns through.
      // Android needs no plugin config: Credential Manager matches the package + signing SHA-1.
      ['react-native-google-auth', { iosClientId: GOOGLE_IOS_CLIENT_ID }],
      ...(apple ? ['expo-apple-authentication'] : []),
      // Android Share -> Nomad Karaoke for privacy-export zips/CSVs (Phase 3b Task 24).
      './plugins/withShareIntake',
      // Source maps + native symbols upload at build time when SENTRY_AUTH_TOKEN is set (EAS secret); without it
      // the build still succeeds and just skips the upload (warning only).
      ['@sentry/react-native/expo', { organization: 'nomadkaraoke', project: 'mobile' }],
    ],
  };
  const labelled = push ? withLauncherLabel(resolved) : withoutPushEntitlement(withLauncherLabel(resolved));
  return apple ? labelled : withoutAppleSignIn(labelled);
};
