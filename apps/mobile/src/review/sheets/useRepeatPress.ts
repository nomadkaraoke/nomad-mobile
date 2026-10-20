import { useCallback, useEffect, useRef } from 'react';

/** Holding a step button starts repeating after this long… */
export const REPEAT_DELAY_MS = 400;
/** …and then steps this often. */
export const REPEAT_INTERVAL_MS = 120;

type Phase = 'idle' | 'waiting' | 'repeating' | 'ended';

/**
 * Press handlers for a step button (Pressable `onPressIn` / `onPressOut` / `onPress`).
 *
 * A tap calls `fire` once, then `done`. A hold calls `fire` after 400 ms and every 120 ms after
 * that, and `done` once on release (so a replay plays once, not per step). `fire` returning
 * `false` means nothing changed (the step hit a clamp): the repeat stops there and `done` runs.
 * `gesture.begin` / `gesture.end` bracket a hold's steps (the store coalesces them into one undo).
 */
export function useRepeatPress(
  fire: () => boolean | void,
  done?: () => void,
  gesture?: { begin: () => void; end: () => void },
) {
  const fireRef = useRef(fire);
  const doneRef = useRef(done);
  const gestureRef = useRef(gesture);
  useEffect(() => {
    fireRef.current = fire;
    doneRef.current = done;
    gestureRef.current = gesture;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phase = useRef<Phase>('idle');

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  const end = useCallback(() => {
    clear();
    if (phase.current === 'repeating') {
      phase.current = 'ended';
      gestureRef.current?.end();
      doneRef.current?.();
    }
  }, [clear]);
  // Unmounting mid-hold stops the repeat and closes its gesture.
  useEffect(
    () => () => {
      clear();
      if (phase.current === 'repeating') gestureRef.current?.end();
      phase.current = 'idle';
    },
    [clear],
  );

  const onPressIn = useCallback(() => {
    clear();
    phase.current = 'waiting';
    timer.current = setTimeout(() => {
      phase.current = 'repeating';
      gestureRef.current?.begin();
      const tick = () => {
        if (fireRef.current() === false) end();
      };
      timer.current = setInterval(tick, REPEAT_INTERVAL_MS);
      tick();
    }, REPEAT_DELAY_MS);
  }, [clear, end]);

  const onPressOut = useCallback(() => {
    if (phase.current === 'waiting') {
      clear();
      return;
    }
    end();
  }, [clear, end]);

  const onPress = useCallback(() => {
    // A hold already stepped (and replayed on release): the release's own press is not another step.
    if (phase.current === 'repeating' || phase.current === 'ended') {
      end(); // the release's press may arrive before its press-out
      phase.current = 'idle';
      return;
    }
    clear();
    phase.current = 'idle';
    if (fireRef.current() !== false) doneRef.current?.();
  }, [clear, end]);

  return { onPressIn, onPressOut, onPress };
}
