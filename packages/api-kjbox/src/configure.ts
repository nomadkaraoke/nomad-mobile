import { client } from './client/client.gen';
import { toKjboxError, unreachableError } from './errors';

export type ClientDeps = {
  /** kjbox origin, e.g. https://sing.nomadkaraoke.com (the `/api/v1` prefix is added here). */
  baseUrl: string;
  /** The gen session token: kjbox verifies it against gen. */
  getToken: () => string | null;
  getLocale: () => string;
  // No onUnauthorized: a kjbox 401 means "kjbox could not verify the session right now", not "the gen session is dead",
  // so it must never sign the user out. Gen owns identity. API clients never touch storage.
};

/** Per-request cap. Hermes may lack AbortSignal.timeout, so use a plain AbortController. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** fetch with a timeout; any thrown failure (network, abort, timeout) becomes an `unreachable` KjboxError. */
async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  if (request.signal?.aborted) ctrl.abort();
  else request.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await globalThis.fetch(request, { signal: ctrl.signal });
  } catch (e) {
    throw unreachableError(e);
  } finally {
    clearTimeout(timer);
  }
}

let installed: { request: number; error: number } | null = null;

/** Point the generated kjbox client at an environment. Storage-agnostic: the app injects getters. */
export function configureClient(deps: ClientDeps): void {
  client.setConfig({ baseUrl: `${deps.baseUrl.replace(/\/+$/, '')}/api/v1`, throwOnError: true, fetch: timedFetch });
  if (installed) {
    client.interceptors.request.eject(installed.request);
    client.interceptors.error.eject(installed.error);
  }
  installed = {
    request: client.interceptors.request.use((request) => {
      request.headers.set('Accept-Language', deps.getLocale());
      const token = deps.getToken();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    }),
    error: client.interceptors.error.use((error, response) =>
      toKjboxError(error, response?.status ?? 0, response?.headers.get('Retry-After')),
    ),
  };
}
