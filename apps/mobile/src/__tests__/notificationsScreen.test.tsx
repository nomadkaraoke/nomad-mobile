// Me → Account and notifications → Notifications (Phase 6 M3): gen's three switches (optimistic, revert on error),
// the Nomad night switch (MMKV; off leaves the box), and the OS-permission banners.
import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import { useAuth } from '../auth/store';
import { NIGHT_ALERTS_KEY } from '../notifications/push';
import { appStorage } from '../storage';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';
import { useNightStore } from '../tonight/nightStore';

jest.mock('@nomad/api-decide', () => ({
  getOfflineIndexManifest: jest.fn(async () => null),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
  updatePushPrefs: jest.fn(),
  registerExpoToken: jest.fn(async () => {}),
  deleteExpoToken: jest.fn(async () => {}),
}));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  registerKjboxPushToken: jest.fn(async () => {}),
  deleteKjboxPushToken: jest.fn(async () => {}),
}));

const N = Notifications as jest.Mocked<typeof Notifications>;
const kj = kjbox as jest.Mocked<typeof kjbox>;
const ALL_ON = { ready: true, review: true, problems: true };
const perm = (granted: boolean, canAskAgain: boolean) =>
  N.getPermissionsAsync.mockResolvedValue({ granted, status: granted ? 'granted' : 'denied', canAskAgain } as never);
const sw = (id: string) => screen.getByTestId(id);

const open = async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/notifications' });
  const row = await screen.findByTestId('notif-ready');
  await waitFor(() => expect(gen.getMe).toHaveBeenCalled());
  await act(async () => {});
  return row;
};

beforeEach(async () => {
  jest.clearAllMocks();
  appStorage.clearAll();
  useNightStore.setState({ active: null });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1, pushPrefs: ALL_ON });
  gen.updatePushPrefs.mockImplementation(async (patch) => ({ ...ALL_ON, ...patch }));
  perm(true, true);
});

it('shows gen\'s prefs and defaults the night switch on', async () => {
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1, pushPrefs: { ...ALL_ON, review: false } });
  await open();
  await waitFor(() => expect(sw('notif-review').props.value).toBe(false));
  expect(sw('notif-ready').props.value).toBe(true);
  expect(sw('notif-problems').props.value).toBe(true);
  expect(sw('notif-night').props.value).toBe(true);
});

it('a toggle PATCHes just that key, optimistically', async () => {
  await open();
  fireEvent(sw('notif-problems'), 'valueChange', false);
  await waitFor(() => expect(sw('notif-problems').props.value).toBe(false));
  await waitFor(() => expect(gen.updatePushPrefs).toHaveBeenCalledWith({ problems: false }));
  expect(sw('notif-ready').props.value).toBe(true);
});

it('a failed PATCH puts the switch back and says so', async () => {
  gen.updatePushPrefs.mockRejectedValue(apiError(500, 'boom'));
  await open();
  fireEvent(sw('notif-ready'), 'valueChange', false);
  expect(await screen.findByTestId('notif-error')).toBeTruthy();
  // gen's real value comes back from a refetch.
  await waitFor(() => expect(sw('notif-ready').props.value).toBe(true));
  expect(gen.getMe).toHaveBeenCalledTimes(2);
});

it('night off is remembered and removes the token from the box; on remembers it again', async () => {
  appStorage.set('push.expoToken.v1', 'ExponentPushToken[test]');
  useNightStore.getState().joinNomad('2121', 'aaaaaaaaaaaaaaaa', 'Sam');
  await open();
  fireEvent(sw('notif-night'), 'valueChange', false);
  await waitFor(() => expect(kj.deleteKjboxPushToken).toHaveBeenCalledWith('2121', 'ExponentPushToken[test]', 'aaaaaaaaaaaaaaaa'));
  expect(appStorage.getBoolean(NIGHT_ALERTS_KEY)).toBe(false);
  expect(gen.updatePushPrefs).not.toHaveBeenCalled();
  fireEvent(sw('notif-night'), 'valueChange', true);
  await waitFor(() => expect(kj.registerKjboxPushToken).toHaveBeenCalled());
  expect(appStorage.getBoolean(NIGHT_ALERTS_KEY)).toBe(true);
});

it('permission denied: a banner opens the system settings', async () => {
  perm(false, false);
  const open$ = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await open();
  fireEvent.press(await screen.findByTestId('notif-open-settings'));
  expect(open$).toHaveBeenCalled();
  expect(screen.queryByTestId('notif-ask')).toBeNull();
});

it('permission not asked yet: the button asks, then registers with gen and the box', async () => {
  perm(false, true);
  useNightStore.getState().joinNomad('2121', 'aaaaaaaaaaaaaaaa', 'Sam');
  await open();
  fireEvent.press(await screen.findByTestId('notif-ask'));
  await waitFor(() => expect(N.requestPermissionsAsync).toHaveBeenCalled());
  perm(true, true);
  N.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true } as never);
  fireEvent.press(await screen.findByTestId('notif-ask'));
  await waitFor(() => expect(gen.registerExpoToken).toHaveBeenCalled());
  await waitFor(() => expect(kj.registerKjboxPushToken).toHaveBeenCalled());
});

it('a failing permission request does not crash or leave an unhandled rejection', async () => {
  perm(false, true);
  N.requestPermissionsAsync.mockRejectedValueOnce(new Error('os'));
  await open();
  fireEvent.press(await screen.findByTestId('notif-ask'));
  await waitFor(() => expect(N.requestPermissionsAsync).toHaveBeenCalled());
  expect(screen.getByTestId('notif-ask')).toBeTruthy();
});

it('no banner flashes before the permission is known', async () => {
  let resolve!: (v: never) => void;
  N.getPermissionsAsync.mockReturnValue(new Promise((r) => (resolve = r as never)));
  await open();
  expect(screen.queryByTestId('notif-open-settings')).toBeNull();
  expect(screen.queryByTestId('notif-ask')).toBeNull();
  await act(async () => resolve({ granted: false, status: 'denied', canAskAgain: false } as never));
  expect(await screen.findByTestId('notif-open-settings')).toBeTruthy();
});

it('rapid on/off/on on one key, answers arriving late, ends on in the UI and in the last PATCH', async () => {
  const gates: ((v: void) => void)[] = [];
  gen.updatePushPrefs.mockImplementation(
    (patch) => new Promise((res) => gates.push(() => res({ ...ALL_ON, ...patch }))),
  );
  await open();
  fireEvent(sw('notif-ready'), 'valueChange', false);
  fireEvent(sw('notif-ready'), 'valueChange', true);
  fireEvent(sw('notif-ready'), 'valueChange', false);
  fireEvent(sw('notif-ready'), 'valueChange', true);
  await waitFor(() => expect(gates).toHaveLength(1)); // PATCHes are sent one at a time
  while (gates.length) {
    gates.shift()!();
    await act(async () => {});
    await waitFor(() => expect(gen.updatePushPrefs.mock.calls.length).toBeGreaterThan(0));
  }
  await waitFor(() => expect(gen.updatePushPrefs).toHaveBeenCalled());
  const last = gen.updatePushPrefs.mock.calls.at(-1)![0];
  expect(last).toEqual({ ready: true });
  expect(sw('notif-ready').props.value).toBe(true);
});

it('toggling A then B quickly keeps both', async () => {
  const gates: (() => void)[] = [];
  gen.updatePushPrefs.mockImplementation(
    (patch) => new Promise((res) => gates.push(() => res({ ...ALL_ON, ...patch }))),
  );
  await open();
  fireEvent(sw('notif-ready'), 'valueChange', false);
  fireEvent(sw('notif-review'), 'valueChange', false);
  while (gates.length || gen.updatePushPrefs.mock.calls.length < 2) {
    gates.shift()?.();
    await act(async () => {});
  }
  await waitFor(() => expect(sw('notif-ready').props.value).toBe(false));
  expect(sw('notif-review').props.value).toBe(false);
});

it('the gen switches are disabled until Me has loaded', async () => {
  let resolve!: (v: unknown) => void;
  gen.getMe.mockReturnValue(new Promise((r) => (resolve = r)) as never);
  renderRouter(appRoutes(), { initialUrl: '/me/notifications' });
  expect(await screen.findByTestId('notif-loading')).toBeTruthy();
  expect(sw('notif-ready').props.disabled).toBe(true);
  await act(async () => resolve({ email: 'me@example.com', credits: 1, pushPrefs: ALL_ON }));
  await waitFor(() => expect(sw('notif-ready').props.disabled).toBeFalsy());
});

it('quick night off/on ends registered with the box', async () => {
  appStorage.set('push.expoToken.v1', 'ExponentPushToken[test]');
  useNightStore.getState().joinNomad('2121', 'aaaaaaaaaaaaaaaa', 'Sam');
  await open();
  fireEvent(sw('notif-night'), 'valueChange', false);
  fireEvent(sw('notif-night'), 'valueChange', true);
  await waitFor(() => expect(kj.registerKjboxPushToken).toHaveBeenCalled());
  expect(appStorage.getBoolean(NIGHT_ALERTS_KEY)).toBe(true);
  expect(kj.deleteKjboxPushToken).not.toHaveBeenCalled();
});

it('permission granted: no banner', async () => {
  await open();
  await waitFor(() => expect(gen.getMe).toHaveBeenCalled());
  expect(screen.queryByTestId('notif-open-settings')).toBeNull();
  expect(screen.queryByTestId('notif-ask')).toBeNull();
});

it('Me hides the account row when signed out', async () => {
  await useAuth.getState().signOut();
  renderRouter(appRoutes(), { initialUrl: '/me' });
  await screen.findByTestId('me-signin');
  expect(screen.queryByTestId('me-account')).toBeNull();
});

it('Me links to Account, which links to Notifications', async () => {
  renderRouter(appRoutes(), { initialUrl: '/me' });
  fireEvent.press(await screen.findByTestId('me-account'));
  fireEvent.press(await screen.findByTestId('account-notifications'));
  expect(await screen.findByTestId('notifications-screen')).toBeTruthy();
});

it('Me fails to load: an error with Retry instead of an endless spinner; Retry loads the switches', async () => {
  gen.getMe.mockRejectedValue(apiError(503, 'unavailable'));
  renderRouter(appRoutes(), { initialUrl: '/me/notifications' });
  expect(await screen.findByTestId('notif-load-failed', {}, { timeout: 4000 })).toBeTruthy();
  expect(screen.queryByTestId('notif-loading')).toBeNull();
  expect(sw('notif-ready').props.disabled).toBe(true);
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1, pushPrefs: { ...ALL_ON, review: false } });
  await act(async () => fireEvent.press(sw('notif-retry')));
  await waitFor(() => expect(sw('notif-ready').props.disabled).toBeFalsy());
  expect(sw('notif-review').props.value).toBe(false);
  expect(screen.queryByTestId('notif-load-failed')).toBeNull();
});

it('coming back to the screen re-reads gen\'s switches', async () => {
  renderRouter(appRoutes(), { initialUrl: '/me/notifications' });
  await screen.findByTestId('notif-ready');
  await waitFor(() => expect(sw('notif-ready').props.disabled).toBeFalsy());
  await act(async () => router.push('/me/account'));
  await act(async () => {});
  // Whatever the screen on top fetched, the change lands only after the notifications screen is back in focus.
  const beforeBack = gen.getMe.mock.calls.length;
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1, pushPrefs: { ...ALL_ON, problems: false } });
  await act(async () => router.back());
  await waitFor(() => expect(gen.getMe.mock.calls.length).toBeGreaterThan(beforeBack));
  await waitFor(() => expect(sw('notif-problems').props.value).toBe(false));
});
