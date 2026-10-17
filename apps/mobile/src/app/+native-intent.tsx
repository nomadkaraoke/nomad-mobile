// Rewrites links the system hands the app before Expo Router routes them (docs: router/advanced/native-intent).

/** nomadkaraoke://checkout (any query): gen's checkout bounce back to the app (see credits/useCheckout.ts). */
const CHECKOUT_RETURN = /^nomadkaraoke:\/\/\/?checkout(?:[?#/]|$)/i;

/**
 * Android delivers the checkout return to the app as an intent as well as to the in-app browser session that
 * waits for it, so without this Expo Router opens an "Unmatched Route" over the credits screen. Returning null
 * keeps the current screen; useCheckout reads the result from the session. If the return cold-starts the app
 * (the session is gone), Me shows the balance.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (CHECKOUT_RETURN.test(path)) return initial ? '/me' : null;
  return path;
}
