import { reportClientEvent } from '@nomad/api-gen';

const THROTTLE_MS = 60_000;
const lastSent = new Map<string, number>();

/** reportClientEvent, at most once per 60 s per event type (a retrying loader would otherwise flood gen). */
export function reportThrottled(
  type: Parameters<typeof reportClientEvent>[0],
  detail: Record<string, unknown>,
): void {
  const now = Date.now();
  const last = lastSent.get(type);
  if (last !== undefined && now - last < THROTTLE_MS) return;
  lastSent.set(type, now);
  void reportClientEvent(type, detail);
}
