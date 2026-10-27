// Foreground pushes (spec §5): a push that arrives with the app open shows as a banner, except a Tonight push while
// the Tonight tab is focused (the screen already shows the status tile).
import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';

import { installNotificationHandler, presentationFor, setTonightFocused, useTonightFocusTracking } from '../handler';

jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), useFocusEffect: jest.fn() }));

const N = Notifications as jest.Mocked<typeof Notifications>;
const note = (url: string, trigger: Record<string, unknown> | null = { type: 'push' }) =>
  ({ request: { identifier: 'n', content: { title: 't', body: 'b', data: { url } }, trigger }, date: 0 }) as unknown as Notifications.Notification;
const SHOWN = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
const HIDDEN = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };

afterEach(() => setTonightFocused(false));

it('shows gen pushes as banners', () => {
  expect(presentationFor(note('/job/abc'))).toEqual(SHOWN);
  expect(presentationFor(note('/review/abc'))).toEqual(SHOWN);
  setTonightFocused(true);
  expect(presentationFor(note('/job/duration/abc'))).toEqual(SHOWN);
});

it('handler suppresses tonight push while Tonight focused', () => {
  expect(presentationFor(note('/tonight'))).toEqual(SHOWN);
  setTonightFocused(true);
  expect(presentationFor(note('/tonight'))).toEqual(HIDDEN);
  setTonightFocused(false);
  expect(presentationFor(note('/tonight'))).toEqual(SHOWN);
});

it('local notifications (reminders) keep their old foreground behaviour: not shown', () => {
  expect(presentationFor(note('/discover/connect/spotify-export', { type: 'date', value: 0 }))).toEqual(HIDDEN);
});

it('installs the handler once', async () => {
  installNotificationHandler();
  installNotificationHandler();
  expect(N.setNotificationHandler).toHaveBeenCalledTimes(1);
  const handler = N.setNotificationHandler.mock.calls[0]![0]!;
  await expect(handler.handleNotification(note('/job/abc'))).resolves.toEqual(SHOWN);
});

it('useTonightFocusTracking marks Tonight focused until it blurs', () => {
  let effect: (() => (() => void) | void) | undefined;
  (useFocusEffect as jest.Mock).mockImplementation((cb: () => (() => void) | void) => (effect = cb));
  renderHook(() => useTonightFocusTracking());
  const blur = effect!();
  expect(presentationFor(note('/tonight'))).toEqual(HIDDEN);
  blur?.();
  expect(presentationFor(note('/tonight'))).toEqual(SHOWN);
});
