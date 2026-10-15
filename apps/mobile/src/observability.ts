import * as Sentry from '@sentry/react-native';
import { PostHog } from 'posthog-react-native';

let posthog: PostHog | null = null;

/**
 * Crash reporting (Sentry) + product analytics (PostHog), each enabled only when its key is set.
 * No accounts exist yet (spec §3.5), so by default this is a no-op.
 */
export function initObservability() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (dsn) Sentry.init({ dsn, tracesSampleRate: 0.2, sendDefaultPii: false });
  if (posthogKey) {
    posthog = new PostHog(posthogKey, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com' });
  }
  return { sentry: Boolean(dsn), posthog: Boolean(posthogKey) };
}

export function track(event: string, props?: Record<string, string | number | boolean | null>) {
  posthog?.capture(event, props);
}
