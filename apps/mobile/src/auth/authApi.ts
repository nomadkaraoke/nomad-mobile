import { ApiError } from '@nomad/api-gen';

// Gen sign-in endpoints (spec §5). The store and social.ts call the facades directly; this module owns
// how their failures are shown to a person.
export { exchangeAppleToken, exchangeGoogleToken, sendCode, verifyCode, type GenSession } from '@nomad/api-gen';

/** Gen allows 5 wrong codes; the 6th attempt is locked out (429 too_many_attempts) whatever it is. */
export const MAX_CODE_ATTEMPTS = 5;

export type SignInErrorKind =
  | 'invalid' // wrong code, attemptsLeft says how many remain
  | 'locked' // too many wrong codes: only a new code helps
  | 'expired' // code timed out (or was destroyed by a lockout)
  | 'tooManyCodes' // send-code throttled
  | 'disposable' // throwaway email rejected
  | 'notAllowed' // gen refused this account (tenant rules)
  | 'signupLimited' // too many new accounts from here
  | 'failed' // anything else from gen
  | 'network'; // never reached gen

export class SignInError extends Error {
  constructor(
    public readonly kind: SignInErrorKind,
    public readonly attemptsLeft?: number,
  ) {
    super(kind);
    this.name = 'SignInError';
  }
}

export const isSignInError = (e: unknown): e is SignInError => e instanceof SignInError;

/** Maps a gen sign-in failure (send-code, verify-code, google, apple) to what the person needs to know. */
export function toSignInError(e: unknown): SignInError {
  if (e instanceof SignInError) return e;
  if (!(e instanceof ApiError) || e.status === 0) return new SignInError('network');
  const { status, detail } = e;
  if (status === 429 && detail === 'too_many_attempts') return new SignInError('locked', 0);
  if (status === 429 && detail === 'too_many_codes') return new SignInError('tooManyCodes');
  if (status === 429 && detail === 'signup_rate_limited') return new SignInError('signupLimited');
  if (status === 401 && detail === 'expired') return new SignInError('expired');
  if (status === 422 && detail === 'sign_in_not_allowed') return new SignInError('notAllowed');
  // send-code's disposable-email 422 carries a sentence (a validation 422 carries a list).
  if (status === 422 && typeof detail === 'string') return new SignInError('disposable');
  if (status >= 500 && detail !== 'google_not_configured') return new SignInError('network');
  return new SignInError('failed');
}
