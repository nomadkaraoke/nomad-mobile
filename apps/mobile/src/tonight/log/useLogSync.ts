import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { useOutbox } from './outbox';

/**
 * Drives the karaoke-log outbox (ruling E8-R2): flushes on mount, when the connection comes back and when the app
 * returns to the foreground. (Each enqueue flushes too, and a transient failure schedules its own backoff retry.)
 * Mounted once, in AppProviders.
 */
export function useLogSync(): void {
  const offline = useOffline();
  const wasOffline = useRef(offline);

  useEffect(() => {
    void useOutbox.getState().flush();
  }, []);

  useEffect(() => {
    if (wasOffline.current && !offline) void useOutbox.getState().flush();
    wasOffline.current = offline;
  }, [offline]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void useOutbox.getState().flush();
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, []);
}
