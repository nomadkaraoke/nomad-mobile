const mockSetUser = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: jest.fn(), setUser: (...a: unknown[]) => mockSetUser(...a), wrap: (c: unknown) => c }));
jest.mock('expo-updates', () => ({ channel: 'preview' }));
const mockCapture = jest.fn();
const mockPostHog = jest.fn().mockImplementation(() => ({ capture: mockCapture }));
jest.mock('posthog-react-native', () => ({ PostHog: mockPostHog }));

const ENV_KEYS = ['EXPO_PUBLIC_SENTRY_DSN', 'EXPO_PUBLIC_POSTHOG_KEY'] as const;

beforeEach(() => {
  jest.resetModules();
  mockCapture.mockReset();
  mockSetUser.mockReset();
  mockPostHog.mockClear();
  for (const k of ENV_KEYS) delete process.env[k];
});

// Fresh module registry per test so env changes take effect.
function load() {
  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    obs: require('../observability') as typeof import('../observability'),
    sentry: require('@sentry/react-native') as { init: jest.Mock },
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}

it('is a no-op without env: nothing initialized, track is safe', () => {
  const { obs, sentry } = load();
  expect(obs.initObservability()).toEqual({ sentry: false, posthog: false });
  expect(() => obs.track('app_opened')).not.toThrow();
  expect(sentry.init).not.toHaveBeenCalled();
  expect(mockPostHog).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
});

it('initializes Sentry privately (no PII, 10% traces, channel as environment) and PostHog without replay or lifecycle capture', () => {
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  const { obs, sentry } = load();
  expect(obs.initObservability()).toEqual({ sentry: true, posthog: true });
  expect(sentry.init).toHaveBeenCalledWith({
    dsn: 'https://k@o.ingest.sentry.io/1',
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    environment: 'preview',
  });
  expect(mockPostHog).toHaveBeenCalledWith(
    'phc_test',
    expect.objectContaining({ enableSessionReplay: false, captureAppLifecycleEvents: false }),
  );
  expect(mockPostHog.mock.calls[0][1]).not.toHaveProperty('autocapture');
});

it('track forwards the ten known events and drops unknown names', () => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  const { obs } = load();
  obs.initObservability();
  for (const e of obs.APP_EVENTS) obs.track(e);
  expect(mockCapture.mock.calls.map((c) => c[0])).toEqual([...obs.APP_EVENTS]);
  expect(obs.APP_EVENTS).toHaveLength(11);
  mockCapture.mockClear();
  obs.track('make_started', { source: 'url' });
  expect(mockCapture).toHaveBeenCalledWith('make_started', { source: 'url' });
  mockCapture.mockClear();
  obs.track('not_an_event' as never);
  expect(mockCapture).not.toHaveBeenCalled();
});

it('Sentry user is the app_user_id only, never an email', () => {
  const { obs } = load();
  obs.setObservabilityUser('0b3c9d52-1a4e-4f6a-9d1c-5e7f8a9b0c1d');
  expect(mockSetUser).toHaveBeenCalledWith({ id: '0b3c9d52-1a4e-4f6a-9d1c-5e7f8a9b0c1d' });
  expect(JSON.stringify(mockSetUser.mock.calls)).not.toMatch(/email|@/);
});

it('clears the Sentry user on sign-out', () => {
  const { obs } = load();
  obs.setObservabilityUser(null);
  expect(mockSetUser).toHaveBeenCalledWith(null);
});
