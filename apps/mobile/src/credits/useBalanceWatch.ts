import { getMe } from '@nomad/api-gen';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Spec: poll every 1s for up to 10s after a paid return. A dismissed browser (closed after paying, before the
 * redirect) checks 3 times (~2s) before "No payment made". Mutable so tests can shrink the wait instead of
 * faking timers.
 */
export const pollConfig = { intervalMs: 1000, tries: 10, dismissTries: 3 };

/**
 * Watches the gen balance after a payment: the credit (Stripe or store webhook) can land a moment after the payment
 * itself. `alive` is false once the screen unmounted; nothing outlives it.
 */
export function useBalanceWatch(email: string) {
  const queryClient = useQueryClient();
  const alive = useRef(true);
  const baseline = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  /**
   * Resolves after `ms`. On unmount the timer is cleared and the promise never settles, so a poll waiting on it
   * just stops (nothing outlives the screen); pending awaits are garbage-collected with it.
   */
  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(() => {
          timers.current.delete(id);
          resolve();
        }, ms);
        timers.current.add(id);
      }),
    [],
  );

  /** Reads a fresh balance as the baseline (a stale low cache would read as "credits rose") and returns /me. */
  const markBaseline = useCallback(async () => {
    const me = await getMe();
    baseline.current = me.credits;
    return me;
  }, []);

  /** Polls until credits exceed the baseline; true when they did. */
  const waitForCredits = useCallback(
    async (tries: number) => {
      for (let i = 0; i < tries; i++) {
        if (!alive.current) return false;
        try {
          const me = await getMe();
          if (me.credits > baseline.current) {
            queryClient.setQueryData(['me', email], me);
            return true;
          }
        } catch {
          // a blip while polling: keep trying until the window closes
        }
        if (i < tries - 1) await sleep(pollConfig.intervalMs);
      }
      return false;
    },
    [email, queryClient, sleep],
  );

  const refreshBalance = useCallback(() => void queryClient.invalidateQueries({ queryKey: ['me'] }), [queryClient]);

  return { alive, markBaseline, waitForCredits, refreshBalance };
}
