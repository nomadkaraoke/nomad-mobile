import { useCallback, useEffect, useRef } from 'react';

/** A results list that just changed ignores taps this long (kjbox A98: the row under a finger moved). */
export const TAP_GUARD_MS = 300;

/**
 * `guard(fn)` wraps a press handler so it does nothing within TAP_GUARD_MS of `key` changing (pass a string
 * that changes whenever the rendered results do).
 */
export function useTapGuard(key: string): <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void {
  const changedAt = useRef(0);
  useEffect(() => {
    changedAt.current = Date.now();
  }, [key]);
  return useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (Date.now() - changedAt.current < TAP_GUARD_MS) return;
        fn(...args);
      },
    [],
  );
}
