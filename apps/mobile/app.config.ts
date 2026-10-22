import type { ConfigContext, ExpoConfig } from 'expo/config';
import { AndroidConfig, withEntitlementsPlist, withStringsXml, type ConfigPlugin } from 'expo/config-plugins';

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
  // Sign in with Apple adds an entitlement that only a provisioning profile with the capability can sign,
  // so it is off (no entitlement, no button) until EXPO_PUBLIC_APPLE_SIGNIN=1 and the Apple account is set up.
  const apple = process.env.EXPO_PUBLIC_APPLE_SIGNIN === '1';
  // Associated domains are an entitlement too (same reason: the team-signed build), so off until the flag is set.
  const associatedDomains = process.env.EXPO_PUBLIC_ASSOCIATED_DOMAINS === '1';
  const resolved: ExpoConfig = {
    ...config,
    name: config.name ?? 'Nomad Karaoke',
    slug: config.slug ?? 'nomad-karaoke',
    ios: {
      ...config.ios,
      ...(apple ? { usesAppleSignIn: true } : {}),
      ...(associatedDomains ? { associatedDomains: ASSOCIATED_DOMAINS } : {}),
    },
    android: { ...config.android, intentFilters: [...(config.android?.intentFilters ?? []), ...NIGHT_LINK_FILTERS] },
    plugins: [
      ...(config.plugins ?? []),
      // iOS: GIDClientID + the reversed-client-id URL scheme the Google Sign-In SDK returns through.
      // Android needs no plugin config: Credential Manager matches the package + signing SHA-1.
      ['react-native-google-auth', { iosClientId: GOOGLE_IOS_CLIENT_ID }],
      ...(apple ? ['expo-apple-authentication'] : []),
    ],
  };
  const labelled = withLauncherLabel(resolved);
  return apple ? labelled : withoutAppleSignIn(labelled);
};
