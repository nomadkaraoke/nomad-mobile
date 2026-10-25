import { ApiError } from '@nomad/api-decide';

export const OUTBOX_BACKOFF_BASE_MS = 5_000;
export const OUTBOX_BACKOFF_MAX_MS = 5 * 60_000;

/** Backoff after `attempts` consecutive transient failures (1 → 5 s, doubling, capped at 5 min). */
export const outboxBackoffMs = (attempts: number): number =>
  Math.min(OUTBOX_BACKOFF_MAX_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

/** decide answers that will never succeed on retry: drop the item (400 invalid, 403 not_owner, 404 not_found, 422). */
export const isPermanent = (e: unknown): boolean => e instanceof ApiError && [400, 403, 404, 422].includes(e.status);
