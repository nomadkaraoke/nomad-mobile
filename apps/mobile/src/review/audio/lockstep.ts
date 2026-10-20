import { useEffect } from 'react';

/** Drift (seconds) beyond which the muted player is pulled back to the audible one. */
export const LOCKSTEP_MAX_DRIFT = 0.25;
export const LOCKSTEP_INTERVAL_MS = 1000;

/** The seek target for the muted player (the active position) when it has drifted too far, else null. */
export function lockstepCheck(activePos: number, otherPos: number): number | null {
  return Math.abs(activePos - otherPos) > LOCKSTEP_MAX_DRIFT ? activePos : null;
}

export interface LockstepPlayer {
  currentTime: number;
  seekTo(seconds: number): Promise<void> | void;
}

/** Every second, seeks `other` to `active`'s position if they drifted. Pass null players to stay idle. */
export function useLockstep(active: LockstepPlayer | null, other: LockstepPlayer | null): void {
  useEffect(() => {
    if (!active || !other) return;
    const id = setInterval(() => {
      // A removed native player throws on access: the tick is simply skipped.
      try {
        const target = lockstepCheck(active.currentTime, other.currentTime);
        if (target !== null) void Promise.resolve(other.seekTo(target)).catch(() => undefined);
      } catch {
        /* player already removed */
      }
    }, LOCKSTEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, other]);
}
