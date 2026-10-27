// Every EXPO_PUBLIC_* read for the API layer and sign-in lives here. Expo inlines these at build
// time only for static `process.env.EXPO_PUBLIC_X` reads, so never index process.env dynamically.

import { DEFAULT_PLAYER_MODE, parsePlayerMode, type PlayerMode } from './voiceSession/player/playerMode';

/** scheme://host[:port], then a path, query, fragment or the end. No userinfo (`user@host`) is accepted. */
const URL_HOST = /^https?:\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i;
/**
 * Hosts the local stack can be on: loopback, the Android emulator's host alias (10.0.2.2), private LAN ranges
 * and mDNS names.
 */
const LOCAL_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local)$/i;

const isLocalUrl = (url: string) => {
  const host = url.trim().match(URL_HOST)?.[1];
  return host !== undefined && LOCAL_HOST.test(host);
};

export const GEN_API_URL = process.env.EXPO_PUBLIC_GEN_API_URL || 'https://api.nomadkaraoke.com';
export const GEN_WEB_URL = process.env.EXPO_PUBLIC_GEN_WEB_URL || 'https://gen.nomadkaraoke.com';
export const DECIDE_API_URL = process.env.EXPO_PUBLIC_DECIDE_API_URL || 'https://decide.nomadkaraoke.com';
/** The search service's origin. Same as the main decide API unless split (locally: search :8020, main API :8030). */
export const DECIDE_SEARCH_URL = process.env.EXPO_PUBLIC_DECIDE_SEARCH_URL || DECIDE_API_URL;
export const KJBOX_API_URL = process.env.EXPO_PUBLIC_KJBOX_API_URL || 'https://sing.nomadkaraoke.com';

export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '718638054799-fush0smd1e4icq9pt0immp8n59jjlebh.apps.googleusercontent.com';
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com';

/** Shows the Apple button (iOS only; the UI checks the platform). Off until the Apple developer account is confirmed. */
export const APPLE_SIGNIN_ENABLED = process.env.EXPO_PUBLIC_APPLE_SIGNIN !== '0';

/**
 * Google/Apple buttons send `fake:<email>` ID tokens (local stack and E2E only). Only against a local gen
 * (an allowlist of local hosts, not "anything but prod"), so a misconfigured build can never send fake
 * tokens to prod, staging or any other deployed gen.
 */
export function fakeSocialEnabled(): boolean {
  return process.env.EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN === '1' && isLocalUrl(GEN_API_URL);
}

/**
 * Debug/E2E only: search, the song page and the make offers behave as if the device had no connection (the
 * offline song list answers; no cloud search). Only against a local decide, so a misconfigured build can never
 * ship it. The Me screen's offline-list download still uses decide, so a flow can download the list first.
 */
export function searchForceOffline(): boolean {
  return process.env.EXPO_PUBLIC_SEARCH_FORCE_OFFLINE === '1' && isLocalUrl(DECIDE_API_URL);
}

/**
 * E2E only: name of a bundled synthetic recording the voice test plays instead of the microphone (e.g.
 * `baritone-scale`). Null unless gen is a local host, so a release build can never use the fake source.
 */
export const FAKE_MIC: string | null =
  (process.env.EXPO_PUBLIC_FAKE_MIC || '') !== '' && isLocalUrl(GEN_API_URL) ? (process.env.EXPO_PUBLIC_FAKE_MIC as string) : null;

/**
 * E2E only: the voice session plays a fake video (`FakePlayer`: ready, then playing on play(), then ended after
 * `FAKE_YT_SECONDS`) instead of YouTube. Off unless gen is a local host, so a release build never fakes it.
 */
export const FAKE_YT: boolean = process.env.EXPO_PUBLIC_FAKE_YT === '1' && isLocalUrl(GEN_API_URL);

const fakeYtSeconds = Number(process.env.EXPO_PUBLIC_FAKE_YT_SECONDS);
/** How long the fake video "plays" (default 5 s). */
export const FAKE_YT_SECONDS: number = Number.isFinite(fakeYtSeconds) && fakeYtSeconds > 0 ? fakeYtSeconds : 5;

/**
 * The voice session's player (`embed-hosted` by default, spike D1). `EXPO_PUBLIC_VS_PLAYER_MODE` overrides it only in
 * a local build (gen on a local host), for trying `linkout`.
 */
export const PLAYER_MODE: PlayerMode = isLocalUrl(GEN_API_URL)
  ? parsePlayerMode(process.env.EXPO_PUBLIC_VS_PLAYER_MODE)
  : DEFAULT_PLAYER_MODE;

/**
 * RevenueCat public SDK keys (EAS `release` profiles set them). Unset = in-app purchases off, and the credits screen
 * keeps the web checkout (dev builds, the local stack).
 */
export const REVENUECAT_IOS_KEY: string | null = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || null;
export const REVENUECAT_ANDROID_KEY: string | null = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || null;

/**
 * E2E only: in-app purchases go through the fake adapter (gen's `/api/test/fake-iap/purchase`) instead of the store.
 * Off unless gen is a local host, so a release build can never fake a purchase.
 */
export const FAKE_IAP: boolean = process.env.EXPO_PUBLIC_FAKE_IAP === '1' && isLocalUrl(GEN_API_URL);

/** The fake adapter's store country (App Store storefront code), `USA` by default. */
export const FAKE_STOREFRONT: string = process.env.EXPO_PUBLIC_FAKE_STOREFRONT || 'USA';

/**
 * EAS project (keep in step with app.config.ts EAS_PROJECT_ID; appConfig.test.ts and push.test.ts pin both). The push
 * token is attributed to it; the built config's `extra.eas.projectId` wins when present.
 */
export const EAS_PROJECT_ID = 'c6092d15-ad6e-4e3d-bfc2-befc2e239af2';

/**
 * Push notifications (Phase 6). Off only with EXPO_PUBLIC_PUSH=0 (the e2e-test profile and the E2E Metro): those builds
 * have no push entitlement (app.config.ts strips `aps-environment`), so no real Expo token.
 */
export const PUSH_ENABLED: boolean = process.env.EXPO_PUBLIC_PUSH !== '0';

/**
 * E2E only: with push off against a local gen, the app registers a made-up Expo token (`ExponentPushToken[e2e-<device
 * id>]`) so gen's and the box's fake push outboxes record what they would send. Never against a deployed gen.
 */
export const FAKE_PUSH_TOKEN: boolean = !PUSH_ENABLED && isLocalUrl(GEN_API_URL);
