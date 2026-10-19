import { client } from './client/client.gen';
import { client as searchClient } from './search-client/client.gen';

export type ClientDeps = {
  baseUrl: string;
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
  ) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

type Interceptors = { request: number | null; error: number | null };
const installed = new Map<typeof client, Interceptors>();

/** Point both generated clients (main decide API + search service) at an environment. Storage-agnostic: the app injects getters. */
export function configureClient(deps: ClientDeps): void {
  for (const c of [client, searchClient]) {
    c.setConfig({ baseUrl: deps.baseUrl, throwOnError: true });
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
        return new ApiError(response?.status ?? 0, detail);
      }),
    });
  }
}
