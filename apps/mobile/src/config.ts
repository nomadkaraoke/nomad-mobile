// Every EXPO_PUBLIC_* read for the API layer and sign-in lives here. Expo inlines these at build
// time only for static `process.env.EXPO_PUBLIC_X` reads, so never index process.env dynamically.

const PROD_GEN_API = /^https?:\/\/api\.nomadkaraoke\.com\/*$/i;

export const GEN_API_URL = process.env.EXPO_PUBLIC_GEN_API_URL || 'https://api.nomadkaraoke.com';
export const GEN_WEB_URL = process.env.EXPO_PUBLIC_GEN_WEB_URL || 'https://gen.nomadkaraoke.com';
export const DECIDE_API_URL = process.env.EXPO_PUBLIC_DECIDE_API_URL || 'https://decide.nomadkaraoke.com';

export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '718638054799-fush0smd1e4icq9pt0immp8n59jjlebh.apps.googleusercontent.com';
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com';

/** Shows the Apple button (iOS only; the UI checks the platform). Off until the Apple developer account is confirmed. */
export const APPLE_SIGNIN_ENABLED = process.env.EXPO_PUBLIC_APPLE_SIGNIN === '1';

/**
 * Google/Apple buttons send `fake:<email>` ID tokens (local stack and E2E only). Hard-off against
 * prod gen whatever the env says, so a misconfigured build can never send fake tokens to prod.
 */
export function fakeSocialEnabled(): boolean {
  return process.env.EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN === '1' && !PROD_GEN_API.test(GEN_API_URL.trim());
}
