import { KjboxError, type KjboxErrorCode } from '@nomad/api-kjbox';

// One translated message per v1 error code (A.27: the web's single "Couldn't send" hid the real reason).
// Record<KjboxErrorCode, …> keeps it exhaustive: a new contract code fails typecheck until it has copy.
const KEYS: Record<KjboxErrorCode, string> = {
  unauthenticated: 'tonight.errors.unauthenticated',
  gen_unavailable: 'tonight.errors.genUnavailable',
  not_open: 'tonight.errors.notOpen',
  night_changed: 'tonight.errors.nightChanged',
  needs_name: 'tonight.errors.needsName',
  not_found: 'tonight.errors.notFound',
  not_owner: 'tonight.errors.notOwner',
  already_sung: 'tonight.errors.alreadySung',
  on_stage: 'tonight.errors.onStage',
  rate_limited: 'tonight.errors.rateLimited',
  invalid: 'tonight.errors.invalid',
  kj_pick_too_large: 'tonight.errors.kjPickTooLarge',
  make_disabled: 'tonight.errors.makeDisabled',
  youtube_blocked: 'tonight.errors.youtubeBlocked',
  gen_rejected: 'tonight.errors.genRejected',
  already_generating: 'tonight.errors.alreadyGenerating',
  busy_retry: 'tonight.errors.busyRetry',
  conflict: 'tonight.errors.conflict',
  internal: 'tonight.errors.internal',
};

/** The full i18n key (under `tonight.errors.*`) for a v1 error code. */
export const errorCopyKey = (code: KjboxErrorCode): string => KEYS[code];

/** Every code with copy (tests check it against the contract's enum). */
export const ERROR_CODES_WITH_COPY = Object.keys(KEYS) as KjboxErrorCode[];

/** Key + ICU values for any thrown error: the box unreachable, rate_limited with its wait, or the code's copy. */
export function errorCopy(e: unknown): { key: string; values?: Record<string, number> } {
  if (!(e instanceof KjboxError)) return { key: 'tonight.errors.unreachable' };
  if (e.unreachable) return { key: 'tonight.errors.unreachable' };
  if (e.code === 'rate_limited' && typeof e.retryAfter === 'number' && e.retryAfter > 0) {
    return { key: 'tonight.errors.rateLimitedWait', values: { minutes: Math.max(1, Math.ceil(e.retryAfter / 60)) } };
  }
  return { key: errorCopyKey(e.code) };
}
