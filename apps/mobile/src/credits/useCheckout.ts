import { createAppCheckout, getMe } from '@nomad/api-gen';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';

export const RETURN_URL = 'nomadkaraoke://checkout';
/** Spec: poll every 1s for up to 10s. Mutable so tests can shrink the wait instead of faking timers. */
export const pollConfig = { intervalMs: 1000, tries: 10 };

export type CheckoutPhase = 'idle' | 'opening' | 'confirming' | 'added' | 'noPayment' | 'pending' | 'failed';

/** `nomadkaraoke://checkout?status=success|cancelled` -> the status, or null for anything else. */
const returnStatus = (url: string | undefined): string | null => url?.match(/[?&]status=([^&#]*)/)?.[1] ?? null;

/**
 * Stripe checkout in an in-app browser (spec §4.5). Gen's web-hook credit can land a moment after the redirect,
 * so a paid return polls the balance for up to ~10s; a balance that never rises is "on its way", not an error.
 */
export function useCheckout(email: string) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<CheckoutPhase>('idle');
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

  /** Resolves after `ms`, or at once on unmount (the timer is cleared so nothing outlives the screen). */
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

  const set = (p: CheckoutPhase) => {
    if (alive.current) setPhase(p);
  };

  /** Polls until credits exceed `baseline`; true when they did. */
  const waitForCredits = useCallback(async (tries: number) => {
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
  }, [email, queryClient, sleep]);

  const finish = useCallback(
    async (tries: number) => {
      set('confirming');
      const ok = await waitForCredits(tries);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      set(ok ? 'added' : 'pending');
    },
    [queryClient, waitForCredits],
  );

  const start = useCallback(
    async (packageId: string) => {
      set('opening');
      try {
        // Always fresh: a stale cached balance below the real one would read as "credits rose".
        baseline.current = (await getMe()).credits;
        const url = await createAppCheckout(packageId, email);
        const result = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
        if (result.type === 'success' && returnStatus(result.url) === 'success') await finish(pollConfig.tries);
        else if (result.type === 'dismiss' && (await waitForCredits(1))) {
          // Closed the browser after paying, before the redirect: the credit is already there.
          void queryClient.invalidateQueries({ queryKey: ['me'] });
          set('added');
        } else set('noPayment');
      } catch {
        set('failed');
      }
    },
    [email, finish, queryClient, waitForCredits],
  );

  /** The "on its way" refresh button: one more short wait for the webhook. */
  const refresh = useCallback(() => finish(3), [finish]);

  return { phase, start, refresh, busy: phase === 'opening' || phase === 'confirming' };
}
