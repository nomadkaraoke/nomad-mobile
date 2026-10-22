import { client } from './client/client.gen';
import { toKjboxError } from './errors';

export type ClientDeps = {
  /** kjbox origin, e.g. https://sing.nomadkaraoke.com (the `/api/v1` prefix is added here). */
  baseUrl: string;
  /** The gen session token: kjbox verifies it against gen. */
  getToken: () => string | null;
  getLocale: () => string;
  // No onUnauthorized: a kjbox 401 means "kjbox could not verify the session right now", not "the gen session is dead",
  // so it must never sign the user out. Gen owns identity. API clients never touch storage.
};

let installed: { request: number; error: number } | null = null;

/** Point the generated kjbox client at an environment. Storage-agnostic: the app injects getters. */
export function configureClient(deps: ClientDeps): void {
  client.setConfig({ baseUrl: `${deps.baseUrl.replace(/\/+$/, '')}/api/v1`, throwOnError: true });
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
