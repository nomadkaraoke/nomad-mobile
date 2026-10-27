import { createAppCheckout } from '@nomad/api-gen';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';

import { track } from '../observability';
import { createPurchaseLock, type PurchaseLock } from './purchaseLock';
import { pollConfig, useBalanceWatch } from './useBalanceWatch';

export { pollConfig } from './useBalanceWatch';

export const RETURN_URL = 'nomadkaraoke://checkout';

export type CheckoutPhase = 'idle' | 'opening' | 'confirming' | 'added' | 'noPayment' | 'pending' | 'failed';

/** `nomadkaraoke://checkout?status=success|cancelled` -> the status, or null for anything else. */
const returnStatus = (url: string | undefined): string | null => url?.match(/[?&]status=([^&#]*)/)?.[1] ?? null;

/**
 * Stripe checkout in an in-app browser (spec §4.5). Gen's web-hook credit can land a moment after the redirect,
 * so a paid return polls the balance for up to ~10s; a balance that never rises is "on its way", not an error.
 */
export function useCheckout(email: string, sharedLock?: PurchaseLock) {
  const [phase, setPhase] = useState<CheckoutPhase>('idle');
  const [ownLock] = useState(createPurchaseLock);
  const lock = sharedLock ?? ownLock;
  const { alive, markBaseline, waitForCredits, refreshBalance } = useBalanceWatch(email);

  const set = useCallback(
    (p: CheckoutPhase) => {
      if (alive.current) setPhase(p);
    },
    [alive],
  );

  const finish = useCallback(
    async (tries: number) => {
      set('confirming');
      const ok = await waitForCredits(tries);
      refreshBalance();
      if (ok) track('purchase_completed', { channel: 'web' });
      set(ok ? 'added' : 'pending');
    },
    [refreshBalance, set, waitForCredits],
  );

  const start = useCallback(
    async (packageId: string) => {
      if (!lock.tryAcquire()) return;
      set('opening');
      try {
        await markBaseline();
        const url = await createAppCheckout(packageId, email);
        track('purchase_started', { channel: 'web', package_id: packageId });
        const result = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
        if (result.type === 'success' && returnStatus(result.url) === 'success') await finish(pollConfig.tries);
        else if (result.type === 'dismiss' && (await waitForCredits(pollConfig.dismissTries))) {
          // Closed the browser after paying, before the redirect: the credit is already there.
          refreshBalance();
          track('purchase_completed', { channel: 'web' });
          set('added');
        } else set('noPayment');
      } catch {
        set('failed');
      } finally {
        lock.release();
      }
    },
    [email, finish, lock, markBaseline, refreshBalance, set, waitForCredits],
  );

  /** The "on its way" refresh button: one more short wait for the webhook. */
  const refresh = useCallback(() => finish(3), [finish]);

  return { phase, start, refresh, busy: phase === 'opening' || phase === 'confirming' };
}
