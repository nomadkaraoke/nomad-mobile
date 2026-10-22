import fs from 'fs';
import path from 'path';
import type { ExpoConfig } from 'expo/config';
import { withPlugins } from 'expo/config-plugins';
import path from 'path';

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
type EntitlementsMod = (c: object) => Promise<{ modResults: Record<string, unknown> }>;
const entitlementsMod = (c: ExpoConfig) =>
  (c as { mods?: { ios?: { entitlements?: EntitlementsMod } } }).mods?.ios?.entitlements;
/** Runs the iOS entitlements mods registered on `c` over `start`, as prebuild does. */
const entitlementsAfterPrebuild = async (c: ExpoConfig, start: Record<string, unknown>) => {
  const mod = entitlementsMod(c);
  return mod ? (await mod({ ...c, modResults: { ...start }, modRequest: {} })).modResults : start;
};

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
    './plugins/withShareIntake',
  ]);
  expect(c.ios?.usesAppleSignIn).toBeUndefined();
  // prebuild auto-applies expo-apple-authentication's entitlement; a mod strips it again
  expect(entitlementsMod(c)).toBeDefined();
  expect(c.ios?.bundleIdentifier).toBe('com.nomadkaraoke.mobile');
});

describe('microphone (vocal range test)', () => {
  it('configures expo-audio with the iOS permission string and Android RECORD_AUDIO', () => {
    const app = require('../../app.json').expo;
    const entry = (app.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === 'expo-audio') as [string, Record<string, unknown>];
    expect(entry[1]).toMatchObject({ recordAudioAndroid: true });
    expect(entry[1].microphonePermission).toMatch(/vocal range/);
    expect(app.ios.infoPlist.CFBundleAllowMixedLocalizations).toBe(true);
  });

  it('declares one native locale file per app locale, and every file exists', () => {
    const { LOCALES } = require('@nomad/i18n');
    const locales = resolve().locales as Record<string, string>;
    expect(Object.keys(locales).sort()).toEqual([...LOCALES].sort());
    expect(LOCALES).toHaveLength(33);
    for (const [code, file] of Object.entries(locales)) {
      expect(file).toBe(`./locales/${code}.json`);
      expect(fs.existsSync(path.resolve(__dirname, '../..', file))).toBe(true);
    }
  });
});

it('enables Sign in with Apple by default', () => {
  const c = resolve();
  expect(c.ios?.usesAppleSignIn).toBe(true);
  expect(c.plugins).toContain('expo-apple-authentication');
  // the Apple entitlement survives (only aps-environment is stripped)
  return expect(entitlementsAfterPrebuild(c, { 'com.apple.developer.applesignin': ['Default'] })).resolves.toEqual({
    'com.apple.developer.applesignin': ['Default'],
  });
});

// Local reminders only (Phase 3b Task 21): expo-notifications' plugin adds aps-environment (a push entitlement the
// App ID doesn't have); app.config.ts strips it again.
it('appConfig has no aps-environment', async () => {
  const c = resolve();
  // Plugins listed in app.json are applied after app.config.ts, so their mods wrap (and run before) ours.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const withNotifications = (require('expo-notifications/app.plugin') as { default: (c: ExpoConfig, p?: object) => ExpoConfig }).default;
  const prebuilt = withNotifications(c, {});
  const out = await entitlementsAfterPrebuild(prebuilt, {});
  expect(out).not.toHaveProperty('aps-environment');
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

// Phase 3b Task 24: Android Share -> Nomad Karaoke for privacy-export zips and CSVs.
describe('share intake', () => {
  type ManifestMod = (c: object) => Promise<{ modResults: AndroidManifestFixture }>;
  type IntentFilter = { action?: { $: Record<string, string> }[]; category?: { $: Record<string, string> }[]; data?: { $: Record<string, string> }[] };
  type AndroidManifestFixture = {
    manifest: { $: Record<string, string>; application: { $: Record<string, string>; activity: { $: Record<string, string>; 'intent-filter'?: IntentFilter[] }[] }[] };
  };
  // Filters the plugin must leave alone: a deep link, and someone else's SEND (images).
  const VIEW_FILTER: IntentFilter = {
    action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }, { $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
    data: [{ $: { 'android:scheme': 'nomadkaraoke' } }],
  };
  const OTHER_SEND: IntentFilter = {
    action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:mimeType': 'image/*' } }],
  };
  const fixture = (extra: IntentFilter[] = []): AndroidManifestFixture => ({
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity' },
              'intent-filter': [
                { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] },
                VIEW_FILTER,
                OTHER_SEND,
                ...extra,
              ],
            },
          ],
        },
      ],
    },
  });
  const manifestAfterPrebuild = async (c: ExpoConfig, extra: IntentFilter[] = []) => {
    const mod = (c as { mods?: { android?: { manifest?: ManifestMod } } }).mods?.android?.manifest;
    expect(mod).toBeDefined();
    return (await mod!({ ...c, modResults: fixture(extra), modRequest: {} })).modResults;
  };
  const sendFilters = (m: AndroidManifestFixture) =>
    (m.manifest.application[0]!.activity[0]!['intent-filter'] ?? []).filter((f) =>
      f.action?.some((a) => a.$['android:name'] === 'android.intent.action.SEND'),
    );

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const plugin = () => (require('../../plugins/withShareIntake') as typeof import('../../plugins/withShareIntake')).withShareIntake;

  it('appConfig adds SEND intent filter with four mime types', async () => {
    // Prebuild resolves the plugin entry against the project root (a TS import from app.config.ts doesn't load there).
    const c = resolve();
    expect(c.plugins).toContain('./plugins/withShareIntake');
    const m = await manifestAfterPrebuild(plugin()(c));
    expect(sendFilters(m)).toEqual([
      OTHER_SEND,
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [
          { $: { 'android:mimeType': 'application/zip' } },
          { $: { 'android:mimeType': 'application/x-zip-compressed' } },
          { $: { 'android:mimeType': 'text/csv' } },
          { $: { 'android:mimeType': 'text/comma-separated-values' } },
        ],
      },
    ]);
    // The launcher, the deep link and the other SEND filter are kept.
    const filters = m.manifest.application[0]!.activity[0]!['intent-filter']!;
    expect(filters).toHaveLength(4);
    expect(filters).toContainEqual(VIEW_FILTER);
  });

  it('does not treat a SEND filter with no <data> as ours', async () => {
    const dataless: IntentFilter = {
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    };
    const filters = sendFilters(await manifestAfterPrebuild(plugin()({ name: 'x', slug: 'x' }), [dataless]));
    expect(filters).toHaveLength(3); // OTHER_SEND + the data-less one (kept) + ours
    expect(filters).toContainEqual(dataless);
  });

  it('adds the SEND filter once, however often prebuild runs', async () => {
    const twice = plugin()(plugin()({ name: 'x', slug: 'x' }));
    expect(sendFilters(await manifestAfterPrebuild(twice))).toHaveLength(2); // ours once + OTHER_SEND
  });
});

// Final review C1: a plugin option set to `false` (expo-image-picker's cameraPermission / microphonePermission) adds
// `<uses-permission tools:node="remove"/>`, which strips the permission app-wide (Tonight's QR scanner, 3c's mic).
// Applies every app.json plugin, as prebuild does, and runs the Android manifest mods over an empty manifest.
describe('android permissions', () => {
  type UsesPermission = { $: Record<string, string> };
  type ManifestMod = (c: object) => Promise<{ modResults: { manifest: { 'uses-permission'?: UsesPermission[] } } }>;

  const permissionsAfterPrebuild = async () => {
    const appJson = require('../../app.json') as { expo: { plugins?: Parameters<typeof withPlugins>[1] } };
    const projectRoot = path.resolve(__dirname, '../..');
    const c = withPlugins(
      { name: 'Nomad Karaoke', slug: 'nomad-karaoke', _internal: { projectRoot } } as ExpoConfig,
      appJson.expo.plugins ?? [],
    );
    const mod = (c as { mods?: { android?: { manifest?: ManifestMod } } }).mods?.android?.manifest;
    expect(mod).toBeDefined();
    const application = { $: { 'android:name': '.MainApplication' }, activity: [{ $: { 'android:name': '.MainActivity' } }] };
    const start = { manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, application: [application] } };
    const out = await mod!({ ...c, modResults: start, modRequest: { projectRoot, platform: 'android', introspect: true } });
    return out.modResults.manifest['uses-permission'] ?? [];
  };

  it.each(['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'])('does not block %s', async (name) => {
    const perms = await permissionsAfterPrebuild();
    const entries = perms.filter((p) => p.$['android:name'] === name);
    expect(entries.some((p) => p.$['tools:node'] === 'remove')).toBe(false);
  });

  it('declares CAMERA for the Tonight QR scanner', async () => {
    const perms = await permissionsAfterPrebuild();
    expect(perms.map((p) => p.$['android:name'])).toContain('android.permission.CAMERA');
  });
});
