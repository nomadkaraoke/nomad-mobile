// Local Spotify-export reminders: +5 d (Account data) and +25 d (Extended history), and reminder-tap routing (Task 21).
import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import {
  cancelExportReminder,
  REMINDER_DAYS,
  scheduleExportReminders,
  useReminderTapRouting,
} from '../../discover/connect/reminders';
import { appStorage } from '../../storage';

jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn() } }));

const N = Notifications as jest.Mocked<typeof Notifications>;
const COPY = { title: 'Your Spotify data may be ready', body: 'Open the email from Spotify.', channelName: 'Reminders' };
const NOW = Date.UTC(2026, 9, 22, 12);
const DAY = 24 * 60 * 60 * 1000;
const stored = () => JSON.parse(appStorage.getString('connect.spotifyReminders') ?? 'null');

let next = 0;
beforeEach(() => {
  jest.clearAllMocks();
  appStorage.clearAll();
  next = 0;
  N.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true } as never);
  N.scheduleNotificationAsync.mockImplementation(async () => `id-${++next}`);
});

it('days are +5 and +25', () => {
  expect(REMINDER_DAYS).toEqual({ account: 5, extended: 25 });
});

it('schedules +5d and +25d and replaces earlier ids', async () => {
  appStorage.set('connect.spotifyReminders', JSON.stringify({ account: 'old-a', extended: 'old-e' }));

  await expect(scheduleExportReminders(COPY, NOW)).resolves.toBe('scheduled');

  expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('reminders', { name: 'Reminders', importance: 5 });
  expect(N.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id).sort()).toEqual(['old-a', 'old-e']);
  const calls = N.scheduleNotificationAsync.mock.calls.map(([req]) => req);
  expect(calls).toEqual([
    {
      content: { title: COPY.title, body: COPY.body, data: { url: '/discover/connect/spotify-export' } },
      trigger: { type: 'date', date: new Date(NOW + 5 * DAY), channelId: 'reminders' },
    },
    {
      content: { title: COPY.title, body: COPY.body, data: { url: '/discover/connect/spotify-export' } },
      trigger: { type: 'date', date: new Date(NOW + 25 * DAY), channelId: 'reminders' },
    },
  ]);
  expect(stored()).toEqual({ account: 'id-1', extended: 'id-2' });
});

it('denied permission schedules nothing', async () => {
  appStorage.set('connect.spotifyReminders', JSON.stringify({ account: 'old-a' }));
  N.requestPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false } as never);

  await expect(scheduleExportReminders(COPY, NOW)).resolves.toBe('denied');

  expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(N.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(stored()).toEqual({ account: 'old-a' });
});

it('cancelExportReminder cancels only that kind', async () => {
  await scheduleExportReminders(COPY, NOW);
  N.cancelScheduledNotificationAsync.mockClear();

  await cancelExportReminder('account');
  expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('id-1');
  expect(stored()).toEqual({ extended: 'id-2' });

  await cancelExportReminder('account'); // nothing left to cancel
  expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
});

describe('tap routing', () => {
  const response = (url: unknown) => ({ notification: { request: { content: { data: { url } } } } }) as never;

  it('tap routing pushes data.url (a tap while running)', () => {
    let listener!: (r: Notifications.NotificationResponse) => void;
    const remove = jest.fn();
    N.addNotificationResponseReceivedListener.mockImplementation((l) => ((listener = l), { remove }));
    const { unmount } = renderHook(() => useReminderTapRouting());

    listener(response('/discover/connect/spotify-export'));
    expect(router.push).toHaveBeenCalledWith('/discover/connect/spotify-export');
    unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('a tap that launched the app routes once and is cleared', () => {
    N.getLastNotificationResponse.mockReturnValueOnce(response('/discover/connect/spotify-export'));
    renderHook(() => useReminderTapRouting());
    expect(router.push).toHaveBeenCalledWith('/discover/connect/spotify-export');
    expect(N.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('ignores notifications without an in-app url', () => {
    let listener!: (r: Notifications.NotificationResponse) => void;
    N.addNotificationResponseReceivedListener.mockImplementation((l) => ((listener = l), { remove: jest.fn() }));
    renderHook(() => useReminderTapRouting());
    listener(response('https://example.com'));
    listener(response(undefined));
    expect(router.push).not.toHaveBeenCalled();
  });
});
