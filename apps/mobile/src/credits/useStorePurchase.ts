import { useCallback, useRef, useState } from 'react';

import { track } from '../observability';
import { createPurchaseLock, type PurchaseLock } from './purchaseLock';
import type { PurchasesAdapter } from './purchases';
import { pollConfig, useBalanceWatch } from './useBalanceWatch';

/**
 * Like the web checkout's phases, minus "no payment": a cancelled store sheet just goes back to idle.
 * `awaitingApproval`: Ask to Buy / a deferred payment; gen credits it once the store approves.
 */
export type StorePurchasePhase = 'idle' | 'opening' | 'confirming' | 'added' | 'pending' | 'awaitingApproval' | 'failed';

export type StorePackage = { id: string; storeProductId: string };

/**
 * An in-app purchase of one credit pack. The store sheet confirms the payment, but gen credits it from RevenueCat's
 * webhook, so a purchase polls `/me` like the web checkout; a balance that never rises is "on its way".
 */
export function useStorePurchase(adapter: PurchasesAdapter, email: string, sharedLock?: PurchaseLock) {
  const [phase, setPhase] = useState<StorePurchasePhase>('idle');
  const { alive, markBaseline, waitForCredits, refreshBalance } = useBalanceWatch(email);
  const lastPackage = useRef<string | null>(null);
  const [ownLock] = useState(createPurchaseLock);
  const lock = sharedLock ?? ownLock;

  const set = useCallback(
    (p: StorePurchasePhase) => {
      if (alive.current) setPhase(p);
    },
    [alive],
  );

  const finish = useCallback(
    async (tries: number) => {
      set('confirming');
      const ok = await waitForCredits(tries);
      refreshBalance();
      if (ok && lastPackage.current) track('purchase_completed', { channel: 'iap', package_id: lastPackage.current });
      set(ok ? 'added' : 'pending');
    },
    [refreshBalance, set, waitForCredits],
  );

  const start = useCallback(
    async (pkg: StorePackage) => {
      if (!lock.tryAcquire()) return;
      set('opening');
      try {
        const me = await markBaseline();
        // Never buy as an anonymous store customer: gen could not tell whose credits they are.
        if (!me.appUserId) return set('failed');
        await adapter.configure(me.appUserId);
        lastPackage.current = pkg.id;
        track('purchase_started', { channel: 'iap', package_id: pkg.id });
        const outcome = await adapter.purchase(pkg.storeProductId);
        if (outcome.kind === 'purchased') {
          track('purchase_store_confirmed', { channel: 'iap', package_id: pkg.id });
          await finish(pollConfig.tries);
        } else if (outcome.kind === 'pending') set('awaitingApproval');
        else set(outcome.kind === 'cancelled' ? 'idle' : 'failed');
      } catch {
        set('failed');
      } finally {
        lock.release();
      }
    },
    [adapter, finish, lock, markBaseline, set],
  );

  /** The "on its way" refresh button: one more short wait for the webhook. */
  const refresh = useCallback(() => finish(3), [finish]);

  return { phase, start, refresh, busy: phase === 'opening' || phase === 'confirming' };
}
