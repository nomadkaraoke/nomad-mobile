import { client } from './client/client.gen';
import { client as searchClient } from './search-client/client.gen';

export type ClientDeps = {
  baseUrl: string;
  /** Search service origin (Phase 3a splits it from the main API). Defaults to `baseUrl`. */
  searchBaseUrl?: string;
  getToken: () => string | null;
  getLocale: () => string;
  /** Stable anonymous install id, sent as X-Device-Id. The app owns persistence (API clients never touch storage). */
  getDeviceId: () => string;
  onUnauthorized: () => void;
};

/** Error thrown by every SDK call; `detail` is FastAPI's error detail when present. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
    /** Seconds from a `Retry-After` header (429/503), when the server sent a numeric one. */
    public readonly retryAfter: number | null = null,
  ) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/** A numeric `Retry-After` (delta-seconds); an HTTP-date or garbage → null. */
function retryAfterSeconds(header: string | null | undefined): number | null {
  if (!header || !/^\s*\d+\s*$/.test(header)) return null;
  return Number(header);
}

type Interceptors = { request: number | null; error: number | null };
const installed = new Map<typeof client, Interceptors>();

/** Point both generated clients (main decide API + search service) at an environment; search uses `searchBaseUrl ?? baseUrl`. Storage-agnostic: the app injects getters. */
export function configureClient(deps: ClientDeps): void {
  for (const [c, baseUrl] of [
    [client, deps.baseUrl],
    [searchClient, deps.searchBaseUrl ?? deps.baseUrl],
  ] as const) {
    c.setConfig({ baseUrl, throwOnError: true });
    const prev = installed.get(c) ?? { request: null, error: null };
    if (prev.request !== null) c.interceptors.request.eject(prev.request);
    if (prev.error !== null) c.interceptors.error.eject(prev.error);
    installed.set(c, {
      request: c.interceptors.request.use((request) => {
        request.headers.set('Accept-Language', deps.getLocale());
        request.headers.set('X-Device-Id', deps.getDeviceId());
        const token = deps.getToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      }),
      error: c.interceptors.error.use((error, response) => {
        if (response?.status === 401) deps.onUnauthorized();
        const detail =
          error && typeof error === 'object' && 'detail' in error ? (error as { detail: unknown }).detail : error;
        return new ApiError(response?.status ?? 0, detail, retryAfterSeconds(response?.headers.get('Retry-After')));
      }),
    });
  }
}
