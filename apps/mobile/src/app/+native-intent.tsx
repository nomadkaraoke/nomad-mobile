// Rewrites links the system hands the app before Expo Router routes them (docs: router/advanced/native-intent).
import { isFreshIntent, useMakeIntent } from '../make/intentStore';
import { parseNightLink } from '../tonight/links';

/** nomadkaraoke://checkout (any query): gen's checkout bounce back to the app (see credits/useCheckout.ts). */
const CHECKOUT_RETURN = /^nomadkaraoke:\/\/\/?checkout(?:[?#/]|$)/i;
/** nomadkaraoke://music-connected: decide web's Apple Music connect page handing back (see useAppleMusic). */
const MUSIC_CONNECTED = /^nomadkaraoke:\/\/\/?music-connected(?:[?#/]|$)/i;

/** http(s) links on the hosts the app claims: kjbox.cc, www.kjbox.cc, sing.nomadkaraoke.com (any case). */
const CLAIMED_HOST = /^https?:\/\/(?:(?:www\.)?kjbox\.cc|sing\.nomadkaraoke\.com)(?:[:/?#]|$)/i;

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
  // Night links (spec §4.2, ruling E3-R1): kjbox.cc/<code> (any case: the printed QR is HTTP://KJBOX.CC/<code>),
  // sing.nomadkaraoke.com/?t=<code> and nomadkaraoke://tonight?t=<code> open the join route. Only full links: a bare
  // code is never a system path.
  if (path.includes('://')) {
    const link = parseNightLink(path);
    if (link) return `/tonight/join?t=${link.code}`;
    // Any other link on a host the app claims (intent filters / associated domains) would be an Unmatched Route.
    if (CLAIMED_HOST.test(path)) return '/tonight';
  }
  return path;
}
