import { pingSearch } from '@nomad/api-decide';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { maybeRefreshOfflineIndex } from '../offline/offlineIndex';

/** The search service scales to zero: a ping wakes it at most this often. */
export const WARMUP_INTERVAL_MS = 60 * 1000;

let lastPingAt: number | null = null;

/** Test hook: forget the last ping (simulates an app restart). */
export function resetSearchWarmupForTests(): void {
  lastPingAt = null;
}

function onForeground(now = Date.now()): void {
  if (lastPingAt === null || now - lastPingAt >= WARMUP_INTERVAL_MS) {
    lastPingAt = now;
    void pingSearch(); // Starts a cold instance before the first keystroke; the answer doesn't matter.
  }
  // Self-gating (weekly, unmetered, opt-in only): cheap to ask on every foreground.
  void maybeRefreshOfflineIndex(now).catch(() => {});
}

/**
 * Spec §5.1: wakes the scale-to-zero search service on launch and on each return to the foreground (at most
 * once a minute), and gives the offline song list its background refresh check at the same moments.
 */
export function useSearchWarmup(): void {
  useEffect(() => {
    onForeground();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') onForeground();
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, []);
}
