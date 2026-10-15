jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));
const mockCapture = jest.fn();
jest.mock('posthog-react-native', () => ({ PostHog: jest.fn().mockImplementation(() => ({ capture: mockCapture })) }));

const ENV_KEYS = ['EXPO_PUBLIC_SENTRY_DSN', 'EXPO_PUBLIC_POSTHOG_KEY'] as const;

beforeEach(() => {
  jest.resetModules();
  mockCapture.mockReset();
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
  expect(() => obs.track('x')).not.toThrow();
  expect(sentry.init).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
});

it('initializes both when configured and forwards track to PostHog', () => {
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  const { obs, sentry } = load();
  expect(obs.initObservability()).toEqual({ sentry: true, posthog: true });
  expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://k@o.ingest.sentry.io/1', sendDefaultPii: false }));
  obs.track('make_tap', { where: 'song' });
  expect(mockCapture).toHaveBeenCalledWith('make_tap', { where: 'song' });
});
