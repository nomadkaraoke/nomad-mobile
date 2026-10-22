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
    /**
     * True when kjbox could not be reached at all: fetch threw (offline, DNS, 10 s timeout; status 0) or a gateway
     * answered 502/503/504/520-530 with a non-JSON body (tunnel or box down). `code` stays `internal` then. A JSON error
     * body, even a 503 `gen_unavailable`, means kjbox itself answered, so it is false.
     */
    public readonly unreachable: boolean = false,
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

// Record<ErrorCode, true> makes this list exhaustive at compile time: a contract enum change fails typecheck here.
const CODES: Record<ErrorCode, true> = {
  unauthenticated: true, gen_unavailable: true, not_open: true, night_changed: true, needs_name: true, not_found: true,
  not_owner: true, already_sung: true, on_stage: true, rate_limited: true, invalid: true, kj_pick_too_large: true,
  make_disabled: true, youtube_blocked: true, gen_rejected: true, already_generating: true, busy_retry: true,
  conflict: true, internal: true,
};

/** Map an HTTP failure to a KjboxError. Unknown or missing codes become `internal` (the contract's catch-all). */
export function toKjboxError(body: unknown, status: number, retryAfterHeader?: string | null): KjboxError {
  if (body instanceof KjboxError) return body; // already mapped (thrown by the timed fetch)
  const b = (body && typeof body === 'object' ? body : {}) as Partial<ErrorBody>;
  const code = (typeof b.error === 'string' && Object.hasOwn(CODES, b.error) ? b.error : 'internal') as KjboxErrorCode;
  const header = retryAfterHeader && /^\s*\d+\s*$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
  const retryAfter = typeof b.retry_after === 'number' ? b.retry_after : header;
  const isJson = body !== null && typeof body === 'object';
  const gateway = status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530);
  return new KjboxError(code, status, retryAfter, b, gateway && !isJson);
}

/** fetch threw: no HTTP response at all. */
export const unreachableError = (cause?: unknown) => {
  const e = new KjboxError('internal', 0, undefined, { message: cause instanceof Error ? cause.message : 'unreachable' }, true);
  return e;
};
