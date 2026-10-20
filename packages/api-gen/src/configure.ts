import { client } from './client/client.gen';

export type ClientDeps = {
  baseUrl: string;
  getToken: () => string | null;
  getLocale: () => string;
  onUnauthorized: () => void;
};

/** Error thrown by every SDK call; `detail` is FastAPI's error detail when present. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
    /**
     * Seconds from a `Retry-After` header (429/503), capped at `MAX_RETRY_AFTER_S`; null when absent or not a
     * positive finite number (an HTTP-date is not parsed).
     */
    public readonly retryAfter: number | null = null,
  ) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/** The longest `Retry-After` honoured: a broken or hostile header must not park a screen for hours. */
export const MAX_RETRY_AFTER_S = 300;

/** Seconds from a `Retry-After` header value, or null (absent, garbage, ≤ 0, infinite). Capped at 300 s. */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_RETRY_AFTER_S);
}

// Sign-in attempts made while signed out. Not handoff-token: that one carries the session, so its 401 is real.
const SIGN_IN_PATH = /\/api\/users\/auth\/(send-code|verify-code|google|apple)$/;
const isSignInRequest = (request: Request | undefined) =>
  request !== undefined && SIGN_IN_PATH.test(request.url.split('?')[0] ?? '');

let requestInterceptor: number | null = null;
let errorInterceptor: number | null = null;

/** Point the generated client at an environment. Storage-agnostic: the app injects token/locale getters. */
export function configureClient(deps: ClientDeps): void {
  client.setConfig({ baseUrl: deps.baseUrl, throwOnError: true });

  if (requestInterceptor !== null) client.interceptors.request.eject(requestInterceptor);
  requestInterceptor = client.interceptors.request.use((request) => {
    request.headers.set('Accept-Language', deps.getLocale());
    const token = deps.getToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  });

  if (errorInterceptor !== null) client.interceptors.error.eject(errorInterceptor);
  errorInterceptor = client.interceptors.error.use((error, response, request) => {
    // A 401 from a sign-in endpoint (wrong code, bad ID token) is not a dead session.
    if (response?.status === 401 && !isSignInRequest(request)) deps.onUnauthorized();
    const detail =
      error && typeof error === 'object' && 'detail' in error ? (error as { detail: unknown }).detail : error;
    return new ApiError(response?.status ?? 0, detail, parseRetryAfter(response?.headers?.get('Retry-After')));
  });
}

/** True when `e` is an ApiError with this status (and, if given, this string detail). */
export function isApiError(e: unknown, status: number, detail?: string): e is ApiError {
  return e instanceof ApiError && e.status === status && (detail === undefined || e.detail === detail);
}
