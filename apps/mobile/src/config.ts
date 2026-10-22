// Every EXPO_PUBLIC_* read for the API layer and sign-in lives here. Expo inlines these at build
// time only for static `process.env.EXPO_PUBLIC_X` reads, so never index process.env dynamically.

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
