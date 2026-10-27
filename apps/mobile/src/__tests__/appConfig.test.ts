import fs from 'fs';
import path from 'path';
import type { ExpoConfig } from 'expo/config';
import { AndroidConfig, withPlugins } from 'expo/config-plugins';

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
    ['@sentry/react-native/expo', { organization: 'nomadkaraoke', project: 'mobile' }],
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
    expect(entry[1]).toMatchObject({ recordAudioAndroid: true, enableBackgroundPlayback: false, enableBackgroundRecording: false });
    expect(entry[1].microphonePermission).toMatch(/vocal range/);
    expect(entry[1].microphonePermission).toMatch(/recording is uploaded and kept privately/);
    expect(entry[1].microphonePermission).not.toMatch(/stays on your phone/);
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
  // the Apple entitlement survives
  return expect(entitlementsAfterPrebuild(c, { 'com.apple.developer.applesignin': ['Default'] })).resolves.toEqual({
    'com.apple.developer.applesignin': ['Default'],
  });
});

// Push (Phase 6 spec §5): expo-notifications' plugin adds aps-environment. Team-signed builds keep it (Expo push needs
// it); EXPO_PUBLIC_PUSH=0 (the e2e-test profile: unsigned simulator / E2E builds) strips it again.
describe('push entitlement', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_PUSH;
  });
  // Plugins listed in app.json are applied after app.config.ts, so their mods wrap (and run before) ours.
  const prebuiltEntitlements = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const withNotifications = (require('expo-notifications/app.plugin') as { default: (c: ExpoConfig, p?: object) => ExpoConfig }).default;
    return entitlementsAfterPrebuild(withNotifications(resolve(), {}), {});
  };

  it('keeps aps-environment by default (team-signed builds)', async () => {
    expect(await prebuiltEntitlements()).toHaveProperty('aps-environment');
  });

  it('keeps it with EXPO_PUBLIC_PUSH=1 (the release profiles)', async () => {
    process.env.EXPO_PUBLIC_PUSH = '1';
    expect(await prebuiltEntitlements()).toHaveProperty('aps-environment');
  });

  it('strips aps-environment with EXPO_PUBLIC_PUSH=0', async () => {
    process.env.EXPO_PUBLIC_PUSH = '0';
    expect(await prebuiltEntitlements()).not.toHaveProperty('aps-environment');
  });

  it('keeps the EAS project id in extra.eas.projectId (getExpoPushTokenAsync uses it)', () => {
    expect(resolve().extra?.eas?.projectId).toBe('c6092d15-ad6e-4e3d-bfc2-befc2e239af2');
  });
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
    // app.config.ts's android.blockedPermissions, applied by prebuild's default Android plugins.
    const c = AndroidConfig.Permissions.withInternalBlockedPermissions(
      withPlugins(
        { name: 'Nomad Karaoke', slug: 'nomad-karaoke', android: resolve().android, _internal: { projectRoot } } as ExpoConfig,
        appJson.expo.plugins ?? [],
      ),
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

  it('RECORD_AUDIO and CAMERA still present (vocal range mic, Tonight QR scanner)', async () => {
    const names = (await permissionsAfterPrebuild()).map((p) => p.$['android:name']);
    expect(names).toContain('android.permission.CAMERA');
    expect(names).toContain('android.permission.RECORD_AUDIO');
  });

  // The app only saves videos (write-only) and picks screenshots through the system photo picker: no media reads.
  const MEDIA_READS = [
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  ];

  it('blocks READ_MEDIA_* and READ_EXTERNAL_STORAGE', async () => {
    expect(resolve().android?.blockedPermissions).toEqual(MEDIA_READS);
    const perms = await permissionsAfterPrebuild();
    for (const name of MEDIA_READS) {
      const entries = perms.filter((p) => p.$['android:name'] === name);
      expect(entries).toEqual([{ $: { 'android:name': name, 'tools:node': 'remove' } }]);
    }
  });
});

// FCM (docs/RELEASE.md § Push): Expo push on Android needs the Firebase app's google-services.json in the build.
describe('Android Google services file', () => {
  it('points at the committed google-services.json for com.nomadkaraoke.mobile', () => {
    const c = resolve();
    expect(c.android?.googleServicesFile).toBe('./google-services.json');
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../..', c.android!.googleServicesFile!), 'utf8'));
    expect(file.project_info.project_id).toBe('nomadkaraoke');
    const packages = file.client.map((cl: { client_info: { android_client_info: { package_name: string } } }) => cl.client_info.android_client_info.package_name);
    expect(packages).toEqual(['com.nomadkaraoke.mobile']);
  });
});

// EAS project (docs/RELEASE.md): EAS Build/Update need the project id; expo-updates fetches from u.expo.dev.
describe('EAS project and updates', () => {
  const PROJECT_ID = 'c6092d15-ad6e-4e3d-bfc2-befc2e239af2';

  it('runtimeVersion fingerprint and updates url set when project id present', () => {
    const c = resolve();
    expect(c.owner).toBe('nomadkaraoke');
    expect(c.slug).toBe('nomad-karaoke');
    expect(c.extra?.eas?.projectId).toBe(PROJECT_ID);
    expect(c.runtimeVersion).toEqual({ policy: 'fingerprint' });
    expect(c.updates?.url).toBe(`https://u.expo.dev/${PROJECT_ID}`);
  });

  it('builds the updates url from a project id already in the config', () => {
    let mod!: typeof import('../../app.config');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../../app.config');
    });
    const c = mod.default({ config: { ...base, extra: { eas: { projectId: 'other-id' }, keep: 1 } } } as never);
    expect(c.extra).toEqual({ eas: { projectId: 'other-id' }, keep: 1 });
    expect(c.updates?.url).toBe('https://u.expo.dev/other-id');
  });

  it('lists expo-secure-store and expo-localization once each in app.json', () => {
    const plugins = (require('../../app.json').expo.plugins as unknown[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins.filter((p) => p === 'expo-secure-store')).toHaveLength(1);
    expect(plugins.filter((p) => p === 'expo-localization')).toHaveLength(1);
  });
});

// eas.json: release profiles talk to prod with the public SDK keys; dev and E2E builds never carry them.
describe('eas.json profiles', () => {
  type Profile = { extends?: string; env?: Record<string, string> };
  const eas = require('../../eas.json') as { build: Record<string, Profile> };
  /** A profile's env with its `extends` chain merged, as EAS does. */
  const envOf = (name: string): Record<string, string> => {
    const p = eas.build[name]!;
    return { ...(p.extends ? envOf(p.extends) : {}), ...p.env };
  };
  const PUBLIC_KEYS = [
    'EXPO_PUBLIC_REVENUECAT_IOS_KEY',
    'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY',
    'EXPO_PUBLIC_SENTRY_DSN',
    'EXPO_PUBLIC_POSTHOG_KEY',
    'EXPO_PUBLIC_POSTHOG_HOST',
  ];

  it.each(['preview', 'production'])('%s: prod URLs, associated domains, push and the public keys', (name) => {
    const env = envOf(name);
    expect(env).toMatchObject({
      EXPO_PUBLIC_GEN_API_URL: 'https://api.nomadkaraoke.com',
      EXPO_PUBLIC_GEN_WEB_URL: 'https://gen.nomadkaraoke.com',
      EXPO_PUBLIC_DECIDE_API_URL: 'https://decide.nomadkaraoke.com',
      EXPO_PUBLIC_KJBOX_API_URL: 'https://sing.nomadkaraoke.com',
      EXPO_PUBLIC_ASSOCIATED_DOMAINS: '1',
      EXPO_PUBLIC_PUSH: '1',
      EXPO_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
    });
    for (const key of PUBLIC_KEYS) expect(env[key]).toMatch(/\S/);
    expect(env.EXPO_PUBLIC_REVENUECAT_IOS_KEY).toMatch(/^appl_/);
    expect(env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY).toMatch(/^goog_/);
    expect(Object.keys(env).filter((k) => k.includes('FAKE'))).toEqual([]);
  });

  it.each(['development', 'e2e-test'])('%s: no public keys and no associated domains', (name) => {
    const env = envOf(name);
    for (const key of [...PUBLIC_KEYS, 'EXPO_PUBLIC_ASSOCIATED_DOMAINS']) expect(env).not.toHaveProperty(key);
  });

  it('e2e-test: push off and the fakes on', () => {
    expect(envOf('e2e-test')).toMatchObject({ EXPO_PUBLIC_PUSH: '0', EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN: '1', EXPO_PUBLIC_FAKE_IAP: '1' });
  });
});
