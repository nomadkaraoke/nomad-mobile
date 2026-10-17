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
