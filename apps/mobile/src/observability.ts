import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import { PostHog } from 'posthog-react-native';

let posthog: PostHog | null = null;

/** The fixed product-event list. No free text, titles or emails in props: ids, counts and enums only. */
export const APP_EVENTS = [
  'app_opened',
  'signed_in',
  'make_started',
  'purchase_started',
  'purchase_store_confirmed', // the store sheet confirmed an in-app purchase (gen's credit follows)
  'purchase_completed',
  'review_submitted',
  'night_joined',
  'song_requested',
  'recs_viewed',
  'voice_test_completed',
] as const;
export type AppEvent = (typeof APP_EVENTS)[number];

const KNOWN_EVENTS: ReadonlySet<string> = new Set(APP_EVENTS);

/**
 * Crash reporting (Sentry) + anonymous product analytics (PostHog), each enabled only when its key is set.
 * No PII: Sentry's user is the opaque app_user_id only, and PostHog is never identified.
 */
export function initObservability() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (dsn) {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      environment: Updates.channel ?? 'development',
    });
  }
  if (posthogKey) {
    posthog = new PostHog(posthogKey, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      // Autocapture is a PostHogProvider feature; we use the bare client, so it stays off.
      enableSessionReplay: false,
      captureAppLifecycleEvents: false,
    });
  }
  return { sentry: Boolean(dsn), posthog: Boolean(posthogKey) };
}

/** Sentry's user on crashes: gen's opaque app_user_id (never the email); null on sign-out. */
export function setObservabilityUser(appUserId: string | null) {
  Sentry.setUser(appUserId ? { id: appUserId } : null);
}

/** Account deletion: forgets the Sentry user and starts PostHog over with a new anonymous id. */
export function resetObservability() {
  Sentry.setUser(null);
  posthog?.reset();
}

/** Sends a product event to PostHog. Unknown names are dropped (the type is the contract, this guards casts). */
export function track(event: AppEvent, props?: Record<string, string | number | boolean>) {
  if (!KNOWN_EVENTS.has(event)) return;
  posthog?.capture(event, props);
}

/** Root component wrapper: touch/navigation breadcrumbs and a crash boundary when Sentry is on. */
export const wrapRoot: typeof Sentry.wrap = Sentry.wrap;
