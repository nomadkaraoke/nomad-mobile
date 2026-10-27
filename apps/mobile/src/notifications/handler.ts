import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

/**
 * Foreground presentation (Phase 6 spec §5): a push that arrives while the app is open shows as a banner, except a
 * Tonight push (kjbox's "up next" / "your turn", `data.url` `/tonight`) while the Tonight tab is focused, where the
 * status tile already says it. Local notifications keep the behaviour they had before a handler existed (not shown
 * in the foreground): 3d's "Done singing?" is for when the singer is in another app.
 */

let tonightFocused = false;

/** Set by the Tonight tab (useTonightFocusTracking). */
export function setTonightFocused(focused: boolean): void {
  tonightFocused = focused;
}

const isTonightUrl = (url: unknown) => typeof url === 'string' && (url === '/tonight' || url.startsWith('/tonight/') || url.startsWith('/tonight?'));

export function presentationFor(notification: Notifications.Notification): Notifications.NotificationBehavior {
  const { trigger, content } = notification.request;
  const isPush = (trigger as { type?: unknown } | null)?.type === 'push';
  const show = isPush && !(tonightFocused && isTonightUrl(content.data?.url));
  return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
}

let installed = false;

/** Installs the app's one notification handler (idempotent). */
export function installNotificationHandler(): void {
  if (installed) return;
  installed = true;
  Notifications.setNotificationHandler({ handleNotification: async (n) => presentationFor(n) });
}

/** The Tonight tab calls this: Tonight pushes stay quiet while it is the screen in front. */
export function useTonightFocusTracking(): void {
  useFocusEffect(
    useCallback(() => {
      setTonightFocused(true);
      return () => setTonightFocused(false);
    }, []),
  );
}
