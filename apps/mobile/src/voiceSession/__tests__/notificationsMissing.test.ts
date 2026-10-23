// Without expo-notifications (not installed on this branch until 3b lands), every helper is a no-op. Its own file, with
// the module mocked as missing (a throwing factory), so this holds before and after 3b's global mock arrives.
import { renderHook } from '@testing-library/react-native';

import { cancelBackNotification, ensureLocalPermission, scheduleBackNotification, useNotificationOpens } from '../player/notifications';

jest.mock(
  'expo-notifications',
  () => {
    throw new Error("Cannot find module 'expo-notifications'");
  },
  { virtual: true },
);
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: mockPush } }));

it('without expo-notifications installed every helper is a no-op', async () => {
  expect(await ensureLocalPermission('Voice session')).toBe(false);
  expect(await scheduleBackNotification(100, { title: 't', body: 'b', channelName: 'c' })).toBeNull();
  await expect(cancelBackNotification('x')).resolves.toBeUndefined();
  expect(() => renderHook(() => useNotificationOpens())).not.toThrow();
  expect(mockPush).not.toHaveBeenCalled();
});
