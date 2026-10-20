import type { ConfigContext, ExpoConfig } from 'expo/config';
import { AndroidConfig, withEntitlementsPlist, withStringsXml, type ConfigPlugin } from 'expo/config-plugins';

/** Home-screen label (like "Photos" for Google Photos); the app's name stays "Nomad Karaoke". iOS: app.json CFBundleDisplayName. */
const LAUNCHER_LABEL = 'Karaoke';

// Build-time additions to app.json that depend on env. Keep the client-id default in step with src/config.ts.
const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com';

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
  const resolved: ExpoConfig = {
    ...config,
    name: config.name ?? 'Nomad Karaoke',
    slug: config.slug ?? 'nomad-karaoke',
    ios: { ...config.ios, ...(apple ? { usesAppleSignIn: true } : {}) },
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
