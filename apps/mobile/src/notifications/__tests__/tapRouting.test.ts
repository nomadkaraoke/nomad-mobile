// One tap router app-wide (agreed with 3d): local reminders and pushes both carry data.url.
import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { useReminderTapRouting as fromOldPath } from '../../discover/connect/reminders';
import { useNotificationTapRouting, useReminderTapRouting } from '../tapRouting';

jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn() } }));

const N = Notifications as jest.Mocked<typeof Notifications>;
type Listener = (r: Notifications.NotificationResponse) => void;
const response = (url: unknown) =>
  ({ notification: { request: { content: { data: { url } } } }, actionIdentifier: 'default' }) as unknown as Notifications.NotificationResponse;

beforeEach(() => jest.clearAllMocks());

it("the old path re-exports the same hook (3b's and 3d's code untouched)", () => {
  expect(fromOldPath).toBe(useReminderTapRouting);
  expect(useNotificationTapRouting).toBe(useReminderTapRouting);
});

it('tap routing still handles reminder data.url', () => {
  let listener: Listener = () => {};
  N.addNotificationResponseReceivedListener.mockImplementationOnce((l) => ((listener = l), { remove: jest.fn() }));
  renderHook(() => fromOldPath());
  listener(response('/discover/connect/spotify-export'));
  expect(router.push).toHaveBeenCalledWith('/discover/connect/spotify-export');
});

it('routes only allowlisted screens (gen, kjbox, 3b, 3d, Me → Notifications)', () => {
  let listener: Listener = () => {};
  N.addNotificationResponseReceivedListener.mockImplementationOnce((l) => ((listener = l), { remove: jest.fn() }));
  renderHook(() => useNotificationTapRouting());
  for (const url of [
    '/review/job1',
    '/job/job1',
    '/job/duration/job1',
    '/tonight',
    '/discover/connect/spotify-export',
    '/discover/voice-session', // 3d's "Done singing?" (VOICE_SESSION_URL)
    '/me/notifications',
    // Not allowlisted, or not an app path:
    '/me',
    '/discover/connect/import-file?file=file:///data/x',
    '/job/',
    '/job/../me',
    '//evil.example/x',
    'https://evil.example/x',
    '/tonightx',
    42,
  ])
    listener(response(url));
  expect((router.push as jest.Mock).mock.calls).toEqual([
    ['/review/job1'],
    ['/job/job1'],
    ['/job/duration/job1'],
    ['/tonight'],
    ['/discover/connect/spotify-export'],
    ['/discover/voice-session'],
    ['/me/notifications'],
  ]);
});

it('a tap that launched the app is routed once', () => {
  N.getLastNotificationResponse.mockReturnValueOnce(response('/job/job1'));
  renderHook(() => useNotificationTapRouting());
  expect(N.clearLastNotificationResponse).toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith('/job/job1');
});
