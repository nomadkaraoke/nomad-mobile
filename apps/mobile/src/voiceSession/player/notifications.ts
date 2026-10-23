import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

/**
 * The link-out player's "Done singing?" local notification (Phase 3d D3): while the singer is in the YouTube app, one
 * local notification fires a little after the song should have ended and brings them back to the quiz. Local only:
 * no push token.
 *
 * `expo-notifications` (and its config plugin) arrive with Phase 3b, which isn't on this branch yet, so the module is
 * loaded optionally: without it every helper is a no-op (null / false). The calls follow 3b's reminders
 * (discover/connect/reminders.ts): the Android channel is created BEFORE asking for permission (Android 13+ only
 * shows the prompt once a channel exists), permission is asked only from the user's tap on "Open in YouTube", and the
 * notification carries `data.url`, which 3b's `useReminderTapRouting` also routes.
 */

export const VOICE_SESSION_CHANNEL = 'voice-session';
/** Where a tap lands: the voice session screen, which restores to the quiz. */
export const VOICE_SESSION_URL = '/discover/voice-session';
/** Seconds after the song's length that the reminder fires. */
export const BACK_PAD_S = 10;
/** The delay when the song's length is unknown. */
export const DEFAULT_BACK_DELAY_S = 240;

/** The notification's text and the Android channel's name, in the user's language (the caller translates). */
export interface BackNotificationCopy {
  title: string;
  body: string;
  channelName: string;
}

// The subset of expo-notifications used here (typed locally: the package isn't installed on this branch).
type NotificationResponse = { notification: { request: { content: { data?: Record<string, unknown> | null } } } };
interface NotificationsModule {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  setNotificationChannelAsync(id: string, channel: { name: string; importance: number }): Promise<unknown>;
  scheduleNotificationAsync(request: {
    content: { title: string; body: string; data: Record<string, unknown> };
    trigger: { type: string; seconds: number; channelId: string };
  }): Promise<string>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
  getLastNotificationResponse(): NotificationResponse | null;
  clearLastNotificationResponse(): void;
  addNotificationResponseReceivedListener(listener: (r: NotificationResponse) => void): { remove(): void };
  AndroidImportance: { DEFAULT: number };
  SchedulableTriggerInputTypes: { TIME_INTERVAL: string };
}

/** expo-notifications, or null when it isn't installed (Metro treats a require inside try/catch as optional). */
function notificationsModule(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional dependency, see above
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

/** When the reminder fires: the song's length + 10 s, else 240 s. */
export function backDelaySeconds(durationS: number | null): number {
  return durationS !== null && Number.isFinite(durationS) && durationS > 0 ? Math.ceil(durationS) + BACK_PAD_S : DEFAULT_BACK_DELAY_S;
}

async function ensureChannel(N: NotificationsModule, channelName: string): Promise<void> {
  // Resolves null off Android.
  await N.setNotificationChannelAsync(VOICE_SESSION_CHANNEL, { name: channelName, importance: N.AndroidImportance.DEFAULT });
}

/** Creates the channel, then asks for notification permission. Call only from the user's tap. False when declined. */
export async function ensureLocalPermission(channelName: string): Promise<boolean> {
  const N = notificationsModule();
  if (!N) return false;
  try {
    await ensureChannel(N, channelName);
    return (await N.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Schedules the "Done singing?" reminder; its id, or null when it couldn't be scheduled. Never throws. */
export async function scheduleBackNotification(durationS: number | null, copy: BackNotificationCopy): Promise<string | null> {
  const N = notificationsModule();
  if (!N) return null;
  try {
    await ensureChannel(N, copy.channelName);
    return await N.scheduleNotificationAsync({
      content: { title: copy.title, body: copy.body, data: { url: VOICE_SESSION_URL } },
      trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: backDelaySeconds(durationS), channelId: VOICE_SESSION_CHANNEL },
    });
  } catch {
    return null;
  }
}

/** Cancels a scheduled reminder (the singer came back first). Already fired or gone is fine. */
export async function cancelBackNotification(id: string | null): Promise<void> {
  const N = notificationsModule();
  if (!N || !id) return;
  try {
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or gone: nothing to cancel.
  }
}

/**
 * Opens the screen a tapped notification points to (`data.url`, an in-app path), whether the tap launched the app or
 * arrived while it was running. Register once, near the root. 3b's `useReminderTapRouting` does the same for every
 * local notification: once 3b is on this branch, register only one of the two, or a tap pushes the screen twice.
 */
export function useNotificationOpens(): void {
  useEffect(() => {
    const N = notificationsModule();
    if (!N) return;
    const open = (r: NotificationResponse | null) => {
      const url = r?.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) router.push(url as Href);
    };
    try {
      const last = N.getLastNotificationResponse();
      if (last) {
        N.clearLastNotificationResponse();
        open(last);
      }
    } catch {
      // No native module: nothing to route.
    }
    const sub = N.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
