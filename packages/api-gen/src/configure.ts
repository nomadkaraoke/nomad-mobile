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
  ) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

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
  errorInterceptor = client.interceptors.error.use((error, response) => {
    if (response?.status === 401) deps.onUnauthorized();
    const detail =
      error && typeof error === 'object' && 'detail' in error ? (error as { detail: unknown }).detail : error;
    return new ApiError(response?.status ?? 0, detail);
  });
}
