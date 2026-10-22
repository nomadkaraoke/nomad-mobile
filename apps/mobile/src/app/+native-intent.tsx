// Rewrites links the system hands the app before Expo Router routes them (docs: router/advanced/native-intent).
import { isFreshIntent, useMakeIntent } from '../make/intentStore';

/** nomadkaraoke://checkout (any query): gen's checkout bounce back to the app (see credits/useCheckout.ts). */
const CHECKOUT_RETURN = /^nomadkaraoke:\/\/\/?checkout(?:[?#/]|$)/i;
/** nomadkaraoke://music-connected: decide web's Apple Music connect page handing back (see useAppleMusic). */
const MUSIC_CONNECTED = /^nomadkaraoke:\/\/\/?music-connected(?:[?#/]|$)/i;

/**
 * Android delivers the checkout return to the app as an intent as well as to the in-app browser session that
 * waits for it, so without this Expo Router opens an "Unmatched Route" over the credits screen. Returning null
 * keeps the current screen; useCheckout reads the result from the session. If the return cold-starts the app
 * (Android killed it during card entry, so the session is gone), a song still being made (the intent is in
 * MMKV, read synchronously) resumes the make flow, which re-reads the balance; otherwise Me shows the balance.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (CHECKOUT_RETURN.test(path)) {
    if (!initial) return null;
    return isFreshIntent(useMakeIntent.getState().intent) ? '/make/new' : '/me';
  }
  // Same double delivery as checkout; on a cold start the music profile shows the new connection.
  if (MUSIC_CONNECTED.test(path)) return initial ? '/me/music-profile' : null;
  return path;
}
