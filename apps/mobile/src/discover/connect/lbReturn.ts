// The ListenBrainz OAuth return (decide's callback → nomadkaraoke://services/listenbrainz?status=…&reason=…).
// Kept free of React so +native-intent can use it.

export const LB_RETURN_URL = 'nomadkaraoke://services/listenbrainz';
/** The return in any form the system hands over (`nomadkaraoke:///services/listenbrainz`, any case). */
export const LB_RETURN = /^nomadkaraoke:\/\/\/?services\/listenbrainz(?:[?#/]|$)/i;
export const LB_SCREEN = '/discover/connect/listenbrainz';

export type LbReturn = { status: 'connected' | 'error'; reason?: string };

/**
 * Only well-formed values survive: these arrive from outside the app (a deep link anyone can craft), so a status
 * is `connected` or `error` and a reason is a short snake_case code. Anything else is no result at all.
 */
export function sanitizeLbReturn(status: unknown, reason: unknown): LbReturn | null {
  if (status !== 'connected' && status !== 'error') return null;
  if (status === 'connected') return { status };
  return typeof reason === 'string' && /^[a-z_]{1,40}$/.test(reason) ? { status, reason } : { status };
}

const param = (url: string, name: string) => url.match(new RegExp(`[?&]${name}=([^&#]*)`))?.[1];

/** The result carried by a return URL. */
export const lbReturnFromUrl = (url: string): LbReturn | null =>
  sanitizeLbReturn(param(url, 'status'), param(url, 'reason'));

/** The LB screen's path, with the (sanitised) result as route params. */
export function lbScreenPath(result: LbReturn | null): string {
  if (!result) return LB_SCREEN;
  return `${LB_SCREEN}?status=${result.status}${result.reason ? `&reason=${result.reason}` : ''}`;
}
