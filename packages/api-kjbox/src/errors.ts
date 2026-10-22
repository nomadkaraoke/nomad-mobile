import type { Error as ErrorBody, ErrorCode } from './client';

/** The closed v1 error-code enum, derived from the contract (never hand-copied). */
export type KjboxErrorCode = ErrorCode;

/** Every non-2xx kjbox v1 call rejects with this. `code` is the contract's `error` field; the app shows its own copy per code. */
export class KjboxError extends Error {
  readonly name = 'KjboxError';
  /** The full parsed error body (`{}` when the response was not JSON, e.g. a proxy 502). */
  readonly body: Partial<ErrorBody>;
  constructor(
    public readonly code: KjboxErrorCode,
    public readonly status: number,
    public readonly retryAfter?: number,
    body: Partial<ErrorBody> = {},
  ) {
    super(body.message ?? `${code} (HTTP ${status})`);
    this.body = body;
  }
  /** `night_changed` only: the host's current night id. */
  get nightId(): string | undefined {
    return this.body.night_id;
  }
  /** PUT /me conflict only: why the rename was refused. */
  get reason(): ErrorBody['reason'] {
    return this.body.reason;
  }
  get from(): string | undefined {
    return this.body.from;
  }
  get to(): string | undefined {
    return this.body.to;
  }
}

const CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'unauthenticated', 'gen_unavailable', 'not_open', 'night_changed', 'needs_name', 'not_found', 'not_owner',
  'already_sung', 'on_stage', 'rate_limited', 'invalid', 'kj_pick_too_large', 'make_disabled', 'youtube_blocked',
  'gen_rejected', 'already_generating', 'busy_retry', 'conflict', 'internal',
]);

/** Map an HTTP failure to a KjboxError. Unknown or missing codes become `internal` (the contract's catch-all). */
export function toKjboxError(body: unknown, status: number, retryAfterHeader?: string | null): KjboxError {
  const b = (body && typeof body === 'object' ? body : {}) as Partial<ErrorBody>;
  const code = (typeof b.error === 'string' && CODES.has(b.error) ? b.error : 'internal') as KjboxErrorCode;
  const header = retryAfterHeader && /^\s*\d+\s*$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
  const retryAfter = typeof b.retry_after === 'number' ? b.retry_after : header;
  return new KjboxError(code, status, retryAfter, b);
}
