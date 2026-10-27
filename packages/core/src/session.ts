/** How the person signed in on this phone (Apple accounts re-confirm with Apple before account deletion). */
export type SignInMethod = 'apple' | 'google' | 'email';

/** `method` is absent on sessions stored before Phase 6 recorded it. */
export type Session = { token: string; email: string; createdAt: number; method?: SignInMethod };

export type AuthState =
  | { status: 'signedOut' }
  | { status: 'codeSent'; email: string }
  | { status: 'signedIn'; session: Session };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed + lowercased email, or null if it doesn't look like an address. */
export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** 6-digit sign-in code with pasted spaces/dashes removed, or null. */
export function normalizeCode(raw: string): string | null {
  const c = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(c) ? c : null;
}
