const ENV_KEYS = [
  'EXPO_PUBLIC_GEN_API_URL',
  'EXPO_PUBLIC_GEN_WEB_URL',
  'EXPO_PUBLIC_DECIDE_API_URL',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
  'EXPO_PUBLIC_APPLE_SIGNIN',
  'EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN',
  'EXPO_PUBLIC_SEARCH_FORCE_OFFLINE',
  'EXPO_PUBLIC_FAKE_MIC',
  'EXPO_PUBLIC_FAKE_YT',
  'EXPO_PUBLIC_FAKE_YT_SECONDS',
  'EXPO_PUBLIC_VS_PLAYER_MODE',
] as const;

beforeEach(() => {
  jest.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
});

// config.ts reads env at import time; load a fresh copy after setting env (every call, so one test can load twice).
const load = () => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../config') as typeof import('../config');
};

it('defaults to prod gen, the gen web app and the Nomad Google client ids', () => {
  const c = load();
  expect(c.GEN_API_URL).toBe('https://api.nomadkaraoke.com');
  expect(c.GEN_WEB_URL).toBe('https://gen.nomadkaraoke.com');
  expect(c.DECIDE_API_URL).toBe('https://decide.nomadkaraoke.com');
  expect(c.GOOGLE_WEB_CLIENT_ID).toBe('718638054799-fush0smd1e4icq9pt0immp8n59jjlebh.apps.googleusercontent.com');
  expect(c.GOOGLE_IOS_CLIENT_ID).toBe('718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com');
  expect(c.APPLE_SIGNIN_ENABLED).toBe(true);
  expect(c.fakeSocialEnabled()).toBe(false);
  expect(c.searchForceOffline()).toBe(false);
});

it('reads overrides from env', () => {
  process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
  process.env.EXPO_PUBLIC_GEN_WEB_URL = 'http://127.0.0.1:3000';
  process.env.EXPO_PUBLIC_APPLE_SIGNIN = '0';
  const c = load();
  expect(c.GEN_API_URL).toBe('http://127.0.0.1:8010');
  expect(c.GEN_WEB_URL).toBe('http://127.0.0.1:3000');
  expect(c.APPLE_SIGNIN_ENABLED).toBe(false);
});

it.each([
  'http://127.0.0.1:8010',
  'http://localhost:8010',
  'http://LOCALHOST',
  'http://10.0.2.2:8010/',
  'http://192.168.1.20:8010',
  'http://10.1.2.3:8010',
  'http://172.16.0.5:8010',
  'http://172.31.255.1',
  'https://my-mac.local:8010/api',
])('enables fake social sign-in against a local gen (%s)', (genUrl) => {
  process.env.EXPO_PUBLIC_GEN_API_URL = genUrl;
  process.env.EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN = '1';
  expect(load().fakeSocialEnabled()).toBe(true);
});

it.each([
  undefined,
  'https://api.nomadkaraoke.com',
  'https://api.nomadkaraoke.com/',
  'HTTPS://API.NomadKaraoke.com',
  'http://api.nomadkaraoke.com',
  // Any other non-local host (staging, a tunnel, a look-alike) is off too: the guard is an allowlist.
  'https://staging-api.nomadkaraoke.com',
  'https://gen-pr-12.example.run.app',
  'http://127.0.0.1.evil.example',
  'http://localhost.evil.example',
  'http://172.32.0.1',
  'http://192.169.0.1',
  'http://evil.example/127.0.0.1',
  'http://user@evil.example',
  'not a url',
])(
  'never enables fake social sign-in against a non-local gen (%s), even with the env set',
  (genUrl) => {
    if (genUrl !== undefined) process.env.EXPO_PUBLIC_GEN_API_URL = genUrl;
    process.env.EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN = '1';
    expect(load().fakeSocialEnabled()).toBe(false);
  },
);

it('keeps fake social sign-in off unless the env is exactly 1', () => {
  process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
  process.env.EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN = 'true';
  expect(load().fakeSocialEnabled()).toBe(false);
});

describe('searchForceOffline (E2E: search as if the device had no connection)', () => {
  it.each(['http://127.0.0.1:8020', 'http://10.0.2.2:8020', 'http://192.168.1.20:8020'])(
    'is on against a local decide (%s) with the env set to 1',
    (decideUrl) => {
      process.env.EXPO_PUBLIC_DECIDE_API_URL = decideUrl;
      process.env.EXPO_PUBLIC_SEARCH_FORCE_OFFLINE = '1';
      expect(load().searchForceOffline()).toBe(true);
    },
  );

  it.each([undefined, 'https://decide.nomadkaraoke.com', 'http://127.0.0.1.evil.example'])(
    'is never on against a non-local decide (%s), even with the env set',
    (decideUrl) => {
      if (decideUrl !== undefined) process.env.EXPO_PUBLIC_DECIDE_API_URL = decideUrl;
      process.env.EXPO_PUBLIC_SEARCH_FORCE_OFFLINE = '1';
      expect(load().searchForceOffline()).toBe(false);
    },
  );

  it('is off unless the env is exactly 1', () => {
    process.env.EXPO_PUBLIC_DECIDE_API_URL = 'http://127.0.0.1:8020';
    process.env.EXPO_PUBLIC_SEARCH_FORCE_OFFLINE = 'true';
    expect(load().searchForceOffline()).toBe(false);
  });
});

describe('FAKE_MIC', () => {
  it('is null by default', () => {
    expect(load().FAKE_MIC).toBeNull();
  });

  it('is honoured against a local gen', () => {
    process.env.EXPO_PUBLIC_GEN_API_URL = 'http://10.0.2.2:8010';
    process.env.EXPO_PUBLIC_FAKE_MIC = 'baritone-scale';
    expect(load().FAKE_MIC).toBe('baritone-scale');
  });

  it('is null for a non-local gen URL, so release builds never use the fake source', () => {
    process.env.EXPO_PUBLIC_FAKE_MIC = 'baritone-scale';
    expect(load().FAKE_MIC).toBeNull();
    process.env.EXPO_PUBLIC_GEN_API_URL = 'https://api.nomadkaraoke.com';
    expect(load().FAKE_MIC).toBeNull();
    process.env.EXPO_PUBLIC_GEN_API_URL = 'https://staging.example.com';
    expect(load().FAKE_MIC).toBeNull();
  });
});

describe('FAKE_YT (E2E: the voice session plays a fake video)', () => {
  it('is off by default', () => {
    expect(load().FAKE_YT).toBe(false);
  });

  it.each(['http://127.0.0.1:8010', 'http://10.0.2.2:8010'])('is on against a local gen (%s) with the env set to 1', (genUrl) => {
    process.env.EXPO_PUBLIC_GEN_API_URL = genUrl;
    process.env.EXPO_PUBLIC_FAKE_YT = '1';
    expect(load().FAKE_YT).toBe(true);
  });

  it.each([undefined, 'https://api.nomadkaraoke.com', 'https://staging.example.com', 'http://127.0.0.1.evil.example'])(
    'FAKE_YT ignored for non-local URLs (%s), even with the env set',
    (genUrl) => {
      if (genUrl !== undefined) process.env.EXPO_PUBLIC_GEN_API_URL = genUrl;
      process.env.EXPO_PUBLIC_FAKE_YT = '1';
      expect(load().FAKE_YT).toBe(false);
    },
  );

  it('is off unless the env is exactly 1', () => {
    process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
    process.env.EXPO_PUBLIC_FAKE_YT = 'true';
    expect(load().FAKE_YT).toBe(false);
  });

  it('FAKE_YT_SECONDS defaults to 5 and reads a positive number', () => {
    expect(load().FAKE_YT_SECONDS).toBe(5);
    process.env.EXPO_PUBLIC_FAKE_YT_SECONDS = '2';
    expect(load().FAKE_YT_SECONDS).toBe(2);
    process.env.EXPO_PUBLIC_FAKE_YT_SECONDS = 'soon';
    expect(load().FAKE_YT_SECONDS).toBe(5);
    process.env.EXPO_PUBLIC_FAKE_YT_SECONDS = '0';
    expect(load().FAKE_YT_SECONDS).toBe(5);
  });
});

describe('PLAYER_MODE (voice session player)', () => {
  it('defaults to embed-hosted (spike D1 verdict)', () => {
    expect(load().PLAYER_MODE).toBe('embed-hosted');
  });

  it('is overridable by EXPO_PUBLIC_VS_PLAYER_MODE in a local build', () => {
    process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
    process.env.EXPO_PUBLIC_VS_PLAYER_MODE = 'linkout';
    expect(load().PLAYER_MODE).toBe('linkout');
  });

  it('ignores the override for a non-local gen, and ignores unknown modes', () => {
    process.env.EXPO_PUBLIC_VS_PLAYER_MODE = 'linkout';
    expect(load().PLAYER_MODE).toBe('embed-hosted');
    process.env.EXPO_PUBLIC_GEN_API_URL = 'http://127.0.0.1:8010';
    process.env.EXPO_PUBLIC_VS_PLAYER_MODE = 'embed-iframe-lib';
    expect(load().PLAYER_MODE).toBe('embed-hosted');
  });
});
