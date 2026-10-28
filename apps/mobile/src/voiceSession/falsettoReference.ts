// Which chest comfort top the live falsetto chip measures against (Phase 3d batch 1, M7).
import type { ComfortEstimateOut } from '@nomad/api-decide';

/** A model estimate counts only once its top is this sure (semitones of spread). */
export const MAX_MODEL_SD_HIGH = 3;

/**
 * The chest comfort top for the falsetto detector, or null (no chip until there is a reference):
 * 1. decide's estimate for this song: a `measured` or `profile` one always (its `sd_high` is the model's spread, not
 *    its own), a `model` one only with `sd_high` ≤ 3;
 * 2. otherwise this phone's saved profile's comfort top;
 * 3. otherwise null.
 */
export function chestTopFor(estimate: ComfortEstimateOut | null | undefined, localComfortHigh: number | null): number | null {
  if (estimate && (estimate.source !== 'model' || estimate.sd_high <= MAX_MODEL_SD_HIGH)) return estimate.high;
  return localComfortHigh;
}
