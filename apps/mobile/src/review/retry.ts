import { ApiError } from '@nomad/api-gen';

/** Seconds to wait before retry 1, 2, 3, 4 for a transient error. After these the load gives up. */
export const RETRY_SCHEDULE_S = [5, 15, 30, 60] as const;

export type LoadError = 'network' | 'not_found' | 'server';

/**
 * Transient (5xx, 429, network) errors are retried; a 404 is final, and so is a 401 (the gen client
 * has already signed the person out) and any other 4xx (retrying cannot fix them). A body gen sent
 * that doesn't parse (`ApiError(0, 'invalid_response')`) reached gen: it is a final server error, not
 * a network one, since asking again returns the same body.
 */
export function classifyLoadError(e: unknown): { error: LoadError; transient: boolean; status: number } {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 404) return { error: 'not_found', transient: false, status };
  if (e instanceof ApiError && status === 0 && e.detail === 'invalid_response') return { error: 'server', transient: false, status };
  if (status === 0) return { error: 'network', transient: true, status };
  return { error: 'server', transient: status >= 500 || status === 429, status };
}

/** Delay in ms before retry number `attempt` (0-based), or null when the schedule is exhausted. */
export function retryDelayMs(e: unknown, attempt: number): number | null {
  const base = RETRY_SCHEDULE_S[attempt];
  if (base === undefined) return null;
  const header = e instanceof ApiError ? e.retryAfter : null;
  return (header !== null && header > 0 ? header : base) * 1000;
}
