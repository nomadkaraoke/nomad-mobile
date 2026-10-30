import * as Notifications from 'expo-notifications';

import { appStorage } from '../../storage';

/**
 * Local reminders for the Spotify privacy export (Phase 3b spec §5.4): Spotify takes about 5 days for Account data
 * and up to 30 for Extended streaming history, so "Remind me" schedules one local notification for each. Local
 * notifications only (no push token needed). Notification permission is asked only when the user taps "Remind me".
 */
export type ReminderKind = 'account' | 'extended';

export const REMINDER_DAYS = { account: 5, extended: 25 } as const;
export const REMINDER_CHANNEL = 'reminders';
/** Where a reminder tap lands. */
export const REMINDER_URL = '/discover/connect/spotify-export';

const KEY = 'connect.spotifyReminders';
const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS: readonly ReminderKind[] = ['account', 'extended'];

/** The notification's text and the Android channel's name, in the user's language (the caller translates). */
export interface ReminderCopy {
  title: string;
  body: string;
  channelName: string;
}

type Stored = Partial<Record<ReminderKind, string>>;

function load(): Stored {
  try {
    const raw = appStorage.getString(KEY);
    const v = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const out: Stored = {};
    for (const k of KINDS) if (typeof v[k] === 'string') out[k] = v[k];
    return out;
  } catch {
    return {};
  }
}

const store = (ids: Stored) => appStorage.set(KEY, JSON.stringify(ids));

async function cancelId(id: string | undefined): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or gone: nothing to cancel.
  }
}

/**
 * Creates the Android channel, asks for notification permission, then schedules the +5 d (Account data) and +25 d (Extended history) reminders,
 * replacing any scheduled earlier. Returns 'denied' (nothing scheduled) when permission is refused.
 */
export async function scheduleExportReminders(copy: ReminderCopy, now = Date.now()): Promise<'scheduled' | 'denied'> {
  // The channel first: Android 13+ only shows the permission prompt once the app has a channel (SDK docs).
  // Elsewhere this resolves null.
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: copy.channelName,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return 'denied';
  const earlier = load();
  await Promise.all(KINDS.map((k) => cancelId(earlier[k])));
  store({});
  const ids: Stored = {};
  for (const kind of KINDS) {
    ids[kind] = await Notifications.scheduleNotificationAsync({
      content: { title: copy.title, body: copy.body, data: { url: REMINDER_URL } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(now + REMINDER_DAYS[kind] * DAY_MS),
        channelId: REMINDER_CHANNEL,
      },
    });
    store(ids);
  }
  return 'scheduled';
}

/** Cancels one reminder (its export has been imported). */
export async function cancelExportReminder(kind: ReminderKind): Promise<void> {
  const ids = load();
  const id = ids[kind];
  if (!id) return;
  delete ids[kind];
  store(ids);
  await cancelId(id);
}

// The tap router moved to notifications/tapRouting.ts (Phase 6: pushes use it too); this path keeps working.
export { useReminderTapRouting } from '../../notifications/tapRouting';
