// Offline recommendations snapshot freshness (spec §8.4).
export const RECS_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function isFresh(savedAt: number, now: number): boolean {
  const age = now - savedAt;
  return Number.isFinite(age) && age >= 0 && age <= RECS_SNAPSHOT_MAX_AGE_MS;
}
