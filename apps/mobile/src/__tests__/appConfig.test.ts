import type { ExpoConfig } from 'expo/config';

const base = { name: 'Nomad Karaoke', slug: 'nomad-karaoke', ios: { bundleIdentifier: 'com.nomadkaraoke.mobile' }, plugins: ['expo-router'] };

const resolve = (): ExpoConfig => {
  let mod!: typeof import('../../app.config');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../app.config');
  });
  return mod.default({ config: base } as never);
};

// Plugins applied in app.config.ts register their mods on the returned config.
const entitlementsMod = (c: ExpoConfig) => (c as { mods?: { ios?: { entitlements?: unknown } } }).mods?.ios?.entitlements;

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_APPLE_SIGNIN;
  delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
});

it('adds the Google plugin with the iOS client id, and no Apple entitlement by default', () => {
  const c = resolve();
  expect(c.plugins).toEqual([
    'expo-router',
    ['react-native-google-auth', { iosClientId: '718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com' }],
  ]);
  expect(c.ios?.usesAppleSignIn).toBeUndefined();
  // prebuild auto-applies expo-apple-authentication's entitlement; a mod strips it again
  expect(entitlementsMod(c)).toBeDefined();
  expect(c.ios?.bundleIdentifier).toBe('com.nomadkaraoke.mobile');
});

it('enables Sign in with Apple only with EXPO_PUBLIC_APPLE_SIGNIN=1', () => {
  process.env.EXPO_PUBLIC_APPLE_SIGNIN = '1';
  const c = resolve();
  expect(c.ios?.usesAppleSignIn).toBe(true);
  expect(c.plugins).toContain('expo-apple-authentication');
  expect(entitlementsMod(c)).toBeUndefined();
});
