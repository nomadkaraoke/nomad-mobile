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
  const player = () => ({
    play: jest.fn(),
    pause: jest.fn(),
    muted: false,
    currentTime: 0,
    playing: false,
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  });
  return { useVideoPlayer: jest.fn(() => player()), VideoView: (props) => createElement(View, props) };
});
// The review's native audio (expo-audio has no JS fallback under jest) and haptics. Suites that test the
// audio hooks mock expo-audio themselves; this stub only lets screens that create players render.
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  // The voice session's song recorder (useSongRecorder): enough for screens that use it to render.
  useAudioRecorder: jest.fn(() => ({
    uri: null,
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(),
    stop: jest.fn(async () => {}),
    getStatus: jest.fn(() => ({ durationMillis: 0 })),
  })),
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  AudioQuality: { MEDIUM: 64 },
  createAudioPlayer: jest.fn(() => ({
    muted: false,
    currentTime: 0,
    playing: false,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => {}),
    replace: jest.fn(),
    remove: jest.fn(),
    setPlaybackRate: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
}));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
// Local reminders (Connect → Spotify export): the root layout listens for reminder taps. Suites drive the jest.fns.
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'reminder-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 5 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })) }));
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

// react-query's gc timers (5 min) would keep a jest worker alive after a suite that renders AppProviders
// ("worker failed to exit gracefully"): unref them. Wrapped lazily so fake timers installed later still apply.
{
  const { timeoutManager } = require('@tanstack/query-core');
  const unref = (t) => {
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  };
  timeoutManager.setTimeoutProvider({
    setTimeout: (cb, ms) => unref(setTimeout(cb, ms)),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (cb, ms) => unref(setInterval(cb, ms)),
    clearInterval: (id) => clearInterval(id),
  });
}

// Vector icons load their font asynchronously, which re-renders every icon outside act() (noisy warnings).
// Icons are decoration under test: every icon set (Ionicons, MaterialIcons, ...) is a plain View.
jest.mock('@expo/vector-icons', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const Icon = ({ testID }) => createElement(View, { testID });
  return new Proxy({ __esModule: true }, { get: (target, key) => (key in target ? target[key] : Icon) });
});

// The voice session's embedded player (any suite that loads the route table imports it): a plain View.
// player.test.tsx mocks it itself to drive the page's messages.
jest.mock('react-native-webview', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { WebView: ({ testID }) => createElement(View, { testID }) };
});
