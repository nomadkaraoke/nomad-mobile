import * as Notifications from 'expo-notifications';

/**
 * The link-out player's "Done singing?" local notification (Phase 3d D3): while the singer is in the YouTube app, one
 * local notification fires a little after the song should have ended and brings them back to the quiz. Local only:
 * no push token (3b's expo-notifications config plugin strips `aps-environment`).
 *
 * The calls follow 3b's reminders (discover/connect/reminders.ts): the Android channel is created BEFORE asking for
 * permission (Android 13+ only shows the prompt once a channel exists), permission is asked only from the user's tap
 * on "Open in YouTube", and the notification carries `data.url`, which 3b's `useReminderTapRouting` (mounted once in
 * the root layout) routes for every local notification, cold or warm. This file registers no tap listener of its own.
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

/** When the reminder fires: the song's length + 10 s, else 240 s. */
export function backDelaySeconds(durationS: number | null): number {
  return durationS !== null && Number.isFinite(durationS) && durationS > 0 ? Math.ceil(durationS) + BACK_PAD_S : DEFAULT_BACK_DELAY_S;
}

async function ensureChannel(channelName: string): Promise<void> {
  // Resolves null off Android.
  await Notifications.setNotificationChannelAsync(VOICE_SESSION_CHANNEL, {
    name: channelName,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Creates the channel, then asks for notification permission. Call only from the user's tap. False when declined. */
export async function ensureLocalPermission(channelName: string): Promise<boolean> {
  try {
    await ensureChannel(channelName);
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Schedules the "Done singing?" reminder; its id, or null when it couldn't be scheduled. Never throws. */
export async function scheduleBackNotification(durationS: number | null, copy: BackNotificationCopy): Promise<string | null> {
  try {
    await ensureChannel(copy.channelName);
    return await Notifications.scheduleNotificationAsync({
      content: { title: copy.title, body: copy.body, data: { url: VOICE_SESSION_URL } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: backDelaySeconds(durationS), channelId: VOICE_SESSION_CHANNEL },
    });
  } catch {
    return null;
  }
}

/** Cancels a scheduled reminder (the singer came back first). Already fired or gone is fine. */
export async function cancelBackNotification(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or gone: nothing to cancel.
  }
}
