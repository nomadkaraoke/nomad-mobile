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

it('adds the Google plugin with the iOS client id, and no Apple entitlement with EXPO_PUBLIC_APPLE_SIGNIN=0', () => {
  process.env.EXPO_PUBLIC_APPLE_SIGNIN = '0';
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

it('enables Sign in with Apple by default', () => {
  const c = resolve();
  expect(c.ios?.usesAppleSignIn).toBe(true);
  expect(c.plugins).toContain('expo-apple-authentication');
  expect(entitlementsMod(c)).toBeUndefined();
});

// Ruling E3-R2: night links (spec §4.2). Android App Links for kjbox.cc (the printed QR is HTTP://KJBOX.CC/<code>, and
// Android matches hosts case-sensitively, so the uppercase host gets its own filter) and sing.nomadkaraoke.com path /.
describe('night links', () => {
  const VIEW = { action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'] };
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_ASSOCIATED_DOMAINS;
  });

  it('adds verified Android intent filters for kjbox.cc, www.kjbox.cc and sing.nomadkaraoke.com, and a plain one for KJBOX.CC', () => {
    expect(resolve().android?.intentFilters).toEqual([
      {
        ...VIEW,
        data: [
          { scheme: 'http', host: 'kjbox.cc' },
          { scheme: 'https', host: 'kjbox.cc' },
          { scheme: 'http', host: 'www.kjbox.cc' },
          { scheme: 'https', host: 'www.kjbox.cc' },
        ],
      },
      { ...VIEW, data: [{ scheme: 'https', host: 'sing.nomadkaraoke.com', path: '/' }] },
      // Ruling E3-R6: unverified (no autoVerify), so it can never affect the verified hosts; uppercase scheme too.
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [
          { scheme: 'http', host: 'KJBOX.CC' },
          { scheme: 'https', host: 'KJBOX.CC' },
          { scheme: 'HTTP', host: 'KJBOX.CC' },
        ],
      },
    ]);
  });

  it('has no iOS associated domains by default (they need the team-signed build)', () => {
    expect(resolve().ios?.associatedDomains).toBeUndefined();
  });

  it('adds iOS associated domains only with EXPO_PUBLIC_ASSOCIATED_DOMAINS=1', () => {
    process.env.EXPO_PUBLIC_ASSOCIATED_DOMAINS = '1';
    const c = resolve();
    expect(c.ios?.associatedDomains).toEqual(['applinks:kjbox.cc', 'applinks:www.kjbox.cc', 'applinks:sing.nomadkaraoke.com']);
    expect(c.ios?.bundleIdentifier).toBe('com.nomadkaraoke.mobile');
  });
});
