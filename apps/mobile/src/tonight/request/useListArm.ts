import { useCallback, useEffect, useMemo, useRef } from 'react';

/** After a results list changes, taps wait this long (A.18: the row under a finger may just have moved). */
export const LIST_ARM_MS = 300;

export type ListArm = {
  /** Call when the list's content changes: opens a new arm window. */
  arm(): void;
  /**
   * Wraps a press handler. Outside the arm window it runs at once. Inside it the tap is queued and replayed when
   * the window ends (ruling E5-R1: the web's silent swallow, A.18, lost real taps). A later tap replaces a queued one.
   */
  guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
};

/**
 * Tonight's tap arming for the search results. Unlike find/useTapGuard (which drops early taps, and whose callers
 * rely on that), a tap during the window is never dropped: it runs once the list has been still for LIST_ARM_MS.
 */
export function useListArm(): ListArm {
  const armedAt = useRef(0);
  const queued = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const wait = Math.max(0, armedAt.current + LIST_ARM_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      const run = queued.current;
      queued.current = null;
      run?.();
    }, wait);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      queued.current = null;
    },
    [],
  );

  const arm = useCallback(() => {
    armedAt.current = Date.now();
    // A tap already waiting replays at the end of the new window, not inside it.
    if (queued.current) schedule();
  }, [schedule]);

  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (Date.now() - armedAt.current >= LIST_ARM_MS) {
          fn(...args);
          return;
        }
        queued.current = () => fn(...args);
        schedule();
      },
    [schedule],
  );

  return useMemo(() => ({ arm, guard }), [arm, guard]);
}
