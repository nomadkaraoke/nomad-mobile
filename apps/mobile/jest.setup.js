/* global jest */
// In-memory SecureStore so auth persistence is testable without native modules.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
  };
});

// In-memory MMKV (cleared on "reinstall" by tests via __resetMMKV).
jest.mock('react-native-mmkv', () => {
  const stores = new Map();
  return {
    createMMKV: ({ id = 'default' } = {}) => {
      if (!stores.has(id)) stores.set(id, new Map());
      const s = stores.get(id);
      return {
        set: (k, v) => void s.set(k, v),
        getString: (k) => (typeof s.get(k) === 'string' ? s.get(k) : undefined),
        getBoolean: (k) => (typeof s.get(k) === 'boolean' ? s.get(k) : undefined),
        remove: (k) => s.delete(k),
        clearAll: () => s.clear(),
      };
    },
    __resetMMKV: () => stores.forEach((s) => s.clear()),
  };
});

// Native sign-in SDKs: tests drive these per case (signIn / signInAsync resolve or reject).
jest.mock('react-native-google-auth', () => {
  class GoogleAuthError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  return {
    GoogleAuth: { configure: jest.fn(async () => {}), signIn: jest.fn(async () => ({ type: 'cancelled' })) },
    GoogleAuthErrorCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
    GoogleAuthError,
    isGoogleAuthError: (e) => e instanceof GoogleAuthError,
  };
});

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

// The real Sentry SDK starts timers at import, which keeps jest workers alive after the run.
// observability.test.ts overrides this with its own mock to assert init().
jest.mock('@sentry/react-native', () => ({ init: jest.fn(), wrap: (c) => c, captureException: jest.fn() }));

// Ready screen native modules (any suite that loads the route table imports them). Tests drive the jest.fns.
jest.mock('expo-video', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { useVideoPlayer: jest.fn(() => ({ play: jest.fn() })), VideoView: (props) => createElement(View, props) };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), Asset: { create: jest.fn() } }));
jest.mock('expo-file-system', () => {
  class File {
    constructor(dir, name) {
      this.uri = `${dir}/${name}`;
      this.delete = jest.fn();
    }
  }
  File.downloadFileAsync = jest.fn();
  return { File, Paths: { cache: 'file:///cache' } };
});

// NetInfo's native module is absent under jest: use the library's mock (connected) unless a suite mocks it itself.
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
