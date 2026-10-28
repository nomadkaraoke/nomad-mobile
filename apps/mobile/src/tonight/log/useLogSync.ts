import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useOffline } from '../../net/useOffline';
import { useMeOutbox } from '../../me/meOutbox';
import { useOutbox } from './outbox';

const flushAll = () => {
  void useOutbox.getState().flush();
  void useMeOutbox.getState().flush();
};

/**
 * Drives the karaoke-log and Me outboxes (ruling E8-R2): flushes on mount, when the connection comes back and when the app
 * returns to the foreground. (Each enqueue flushes too, and a transient failure schedules its own backoff retry.)
 * Mounted once, in AppProviders.
 */
export function useLogSync(): void {
  const offline = useOffline();
  const wasOffline = useRef(offline);

  useEffect(() => {
    flushAll();
  }, []);

  useEffect(() => {
    if (wasOffline.current && !offline) flushAll();
    wasOffline.current = offline;
  }, [offline]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') flushAll();
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, []);
}
