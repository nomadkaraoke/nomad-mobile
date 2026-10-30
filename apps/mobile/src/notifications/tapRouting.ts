import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

/**
 * The only screens a notification may open (exact path, or a prefix ending in `/`): gen's job pushes, kjbox's
 * Tonight, 3b's Spotify-export reminder (reminders.ts REMINDER_URL), 3d's "Done singing?" (voiceSession/player/
 * notifications.ts VOICE_SESSION_URL) and Me → Notifications. Anything else in `data.url` is ignored.
 */
const EXACT = ['/tonight', '/discover/connect/spotify-export', '/discover/voice-session', '/me/notifications'];
const PREFIXES = ['/job/', '/review/', '/tonight/'];

/** An allowlisted in-app path (query allowed), never a full URL, `//host` or a `..` segment. */
export function isNotificationPath(url: unknown): url is string {
  if (typeof url !== 'string' || url.includes('..') || url.includes('//') || url.includes('\\')) return false;
  const path = url.split(/[?#]/)[0]!;
  return EXACT.includes(path) || PREFIXES.some((p) => path.startsWith(p) && path.length > p.length);
}

/**
 * The one notification tap router, mounted once in the root layout: every notification carries `data.url` and a tap
 * opens it, whether the tap launched the app or arrived while it was running. Local reminders (3b's Spotify export,
 * 3d's "Done singing?") and pushes (gen: `/job/<id>`, `/review/<id>`, `/job/duration/<id>`; kjbox: `/tonight`) alike.
 */
export function useNotificationTapRouting(): void {
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      const url = r?.notification.request.content.data?.url;
      if (isNotificationPath(url)) router.push(url as Href);
    };
    try {
      const last = Notifications.getLastNotificationResponse();
      if (last) {
        Notifications.clearLastNotificationResponse();
        open(last);
      }
    } catch {
      // No native module (e.g. web): nothing to route.
    }
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}

/** 3b's name for the same hook (discover/connect/reminders.ts re-exports it). */
export const useReminderTapRouting = useNotificationTapRouting;
