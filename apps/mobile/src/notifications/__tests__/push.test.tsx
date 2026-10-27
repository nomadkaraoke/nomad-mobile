// Phase 6 push registration (spec §5): the Expo token goes to gen (video ready / needs review / job problems) and,
// at a Nomad night, to the box (up next / your turn). Permission is asked in context, once per context per install.
import { IntlProvider } from '@nomad/i18n';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Alert, type AlertButton } from 'react-native';

import { setupApiClients } from '../../api/setup';
import { useAuth } from '../../auth/store';
import { getDeviceId } from '../../device/deviceId';
import { appStorage } from '../../storage';
import { session } from '../../test-utils/genAuthMock';
import { useNightStore } from '../../tonight/nightStore';
import {
  askPushPermissionInContext,
  MAX_UNREGISTER_ATTEMPTS,
  NIGHT_ALERTS_KEY,
  registerNightPush,
  registerPush,
  retryPendingUnregister,
  setPushCopy,
  unregisterPush,
} from '../push';
import { usePushRegistration } from '../usePushRegistration';

const wrapper = ({ children }: { children: ReactNode }) => <IntlProvider locale="en">{children}</IntlProvider>;
const N = Notifications as jest.Mocked<typeof Notifications>;
const TOKEN = 'ExponentPushToken[test]';
const EAS_PROJECT_ID = 'c6092d15-ad6e-4e3d-bfc2-befc2e239af2';
const NIGHT = 'aaaaaaaaaaaaaaaa';
const PENDING_KEY = 'push.pendingUnregister.v1';
const pending = async () => JSON.parse((await SecureStore.getItemAsync(PENDING_KEY)) ?? 'null') as unknown;

type Call = { method: string; path: string; auth: string | null; body: unknown; signedIn: boolean };
let calls: Call[] = [];
const fetchMock = jest.fn(async (req: Request) => {
  const text = await req.clone().text();
  calls.push({
    method: req.method,
    path: new URL(req.url).pathname,
    auth: req.headers.get('authorization'),
    body: text ? JSON.parse(text) : null,
    signedIn: useAuth.getState().state.status === 'signedIn',
  });
  if (new URL(req.url).pathname.startsWith('/api/v1/')) {
    return new Response(JSON.stringify({ api_version: '1.0', ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(null, { status: 204 });
});
const genCalls = () => calls.filter((c) => c.path === '/api/push/expo-token');
const kjboxCalls = () => calls.filter((c) => c.path === '/api/v1/push-token');

const granted = () => N.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true } as never);
const COPY = {
  channels: { jobs: 'Your videos', tonight: 'Nomad nights' },
  ask: {
    make: { title: 'Get a notification when your video is ready?', body: 'b' },
    night: { title: "Get a notification when it's your turn?", body: 'b' },
    allow: 'Turn on',
    notNow: 'Not now',
  },
};

/** Alert.alert answered with the button labelled `label`. */
const answerAlert = (label: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });

beforeEach(async () => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  calls = [];
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setupApiClients();
  await useAuth.getState().signOut();
  appStorage.clearAll();
  await SecureStore.deleteItemAsync(PENDING_KEY);
  fetchMock.mockClear();
  N.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'undetermined', canAskAgain: true } as never);
  // The OS prompt answered "Allow": the permission reads granted from then on.
  N.requestPermissionsAsync.mockImplementation(async () => {
    granted();
    return { granted: true, status: 'granted', canAskAgain: true } as never;
  });
  N.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: TOKEN });
  setPushCopy(COPY);
  await useAuth.getState().signInWithSession(session('a@example.com'));
  calls = [];
});

describe('registerPush', () => {
  it('register posts token with device id', async () => {
    granted();
    await expect(registerPush()).resolves.toBe(TOKEN);
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: EAS_PROJECT_ID });
    expect(genCalls()).toEqual([
      expect.objectContaining({
        method: 'POST',
        auth: 'Bearer tok-a@example.com',
        body: { token: TOKEN, platform: 'ios', device_id: getDeviceId() },
      }),
    ]);
    // The Android channels exist before any push arrives (named in the user's language).
    expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('jobs', expect.objectContaining({ name: 'Your videos' }));
    expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('tonight', expect.objectContaining({ name: 'Nomad nights' }));
  });

  it('no permission → no request', async () => {
    await expect(registerPush()).resolves.toBeNull();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('signed out → no request', async () => {
    granted();
    await useAuth.getState().signOut();
    calls = [];
    await expect(registerPush()).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('never throws: a failed token or POST resolves null', async () => {
    granted();
    N.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no aps-environment'));
    await expect(registerPush()).resolves.toBeNull();
    fetchMock.mockImplementationOnce(async () => new Response('{"detail":"x"}', { status: 500 }));
    await expect(registerPush()).resolves.toBeNull();
  });
});

describe('sign-out', () => {
  it('unregister runs before session cleared on sign-out', async () => {
    granted();
    await registerPush();
    useNightStore.getState().joinNomad('2121', NIGHT, 'Sam');
    await registerNightPush();
    calls = [];

    await useAuth.getState().signOut();

    expect(useAuth.getState().state.status).toBe('signedOut');
    const del = genCalls().find((c) => c.method === 'DELETE');
    expect(del).toEqual(expect.objectContaining({ auth: 'Bearer tok-a@example.com', body: { token: TOKEN }, signedIn: true }));
    // The box forgets it too (the night is the signed-in person's).
    expect(kjboxCalls()).toEqual([
      expect.objectContaining({ method: 'DELETE', signedIn: true, body: { t: '2121', night_id: NIGHT, expo_push_token: TOKEN } }),
    ]);
  });

  it('sign-out still completes when the DELETE fails or hangs', async () => {
    jest.useFakeTimers();
    try {
      granted();
      await registerPush();
      fetchMock.mockImplementationOnce(() => new Promise(() => {}));
      const out = useAuth.getState().signOut();
      await jest.advanceTimersByTimeAsync(5_000);
      await out;
      expect(useAuth.getState().state.status).toBe('signedOut');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a dead session (gen 401) signs out without a DELETE', async () => {
    granted();
    await registerPush();
    calls = [];
    fetchMock.mockImplementationOnce(async () => new Response('{"detail":"Invalid session"}', { status: 401 }));
    await registerPush(); // any gen call that comes back 401
    await waitFor(() => expect(useAuth.getState().state.status).toBe('signedOut'));
    expect(genCalls().filter((c) => c.method === 'DELETE')).toEqual([]);
    // The unregister that didn't happen is kept for a retry, with the session that registered it.
    await waitFor(async () => expect(await pending()).toEqual({ token: TOKEN, bearer: 'tok-a@example.com', attempts: 0 }));
    expect(appStorage.getString('push.expoToken.v1')).toBeUndefined();
    // gen refuses the dead session: the marker is dropped (nothing more to do).
    fetchMock.mockImplementationOnce(async () => new Response('{"detail":"Invalid session"}', { status: 401 }));
    await retryPendingUnregister();
    expect(await pending()).toBeNull();
  });

  it('a failed DELETE on sign-out is retried while signed out, bounded', async () => {
    granted();
    await registerPush();
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Network request failed');
    });
    await useAuth.getState().signOut();
    expect(await pending()).toEqual({ token: TOKEN, bearer: 'tok-a@example.com', attempts: 0 });

    // Still offline at the next launch / foreground: counted, kept.
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Network request failed');
    });
    await retryPendingUnregister();
    expect(await pending()).toMatchObject({ attempts: 1 });

    // Back online: the old session's DELETE goes through and the marker is gone.
    calls = [];
    await retryPendingUnregister();
    expect(genCalls()).toEqual([expect.objectContaining({ method: 'DELETE', auth: 'Bearer tok-a@example.com', body: { token: TOKEN } })]);
    expect(await pending()).toBeNull();
  });

  it('a pending unregister is dropped after MAX_UNREGISTER_ATTEMPTS', async () => {
    await useAuth.getState().signOut();
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify({ token: TOKEN, bearer: 'old', attempts: MAX_UNREGISTER_ATTEMPTS }));
    calls = [];
    await retryPendingUnregister();
    expect(calls).toEqual([]);
    expect(await pending()).toBeNull();
  });

  it('signed in, the pending unregister is not retried, and the next registration clears it', async () => {
    granted();
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify({ token: TOKEN, bearer: 'old', attempts: 0 }));
    await retryPendingUnregister();
    expect(calls).toEqual([]);
    await registerPush();
    expect(await pending()).toBeNull();
  });

  it("compare-and-delete: a late DELETE from account A leaves B's stored token alone", async () => {
    granted();
    await registerPush();
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      (req: Request) =>
        new Promise((resolve) => {
          release = () => {
            calls.push({ method: req.method, path: new URL(req.url).pathname, auth: null, body: null, signedIn: false });
            resolve(new Response(null, { status: 204 }));
          };
        }),
    );
    const out = unregisterPush();
    await waitFor(() => expect(release).toBeDefined());
    // Meanwhile B's registration stores another token.
    appStorage.set('push.expoToken.v1', 'ExponentPushToken[b]');
    release();
    await out;
    expect(appStorage.getString('push.expoToken.v1')).toBe('ExponentPushToken[b]');
  });

  it('unregisterPush with nothing registered sends nothing', async () => {
    await unregisterPush();
    expect(calls).toEqual([]);
  });
});

describe('askPushPermissionInContext', () => {
  it('asks once per context', async () => {
    const alert = answerAlert('Turn on');
    await expect(askPushPermissionInContext('make')).resolves.toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toBe('Get a notification when your video is ready?');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    // Android 13+ only prompts once a channel exists.
    expect(N.setNotificationChannelAsync.mock.invocationCallOrder[0]!).toBeLessThan(N.requestPermissionsAsync.mock.invocationCallOrder[0]!);
    // Granted → registered with gen straight away.
    expect(genCalls()).toHaveLength(1);

    N.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: true } as never);
    await askPushPermissionInContext('make');
    expect(alert).toHaveBeenCalledTimes(1);

    await askPushPermissionInContext('night');
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1]![0]).toBe("Get a notification when it's your turn?");
  });

  it('an Alert iOS dropped (never answered) does not use up the ask', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    void askPushPermissionInContext('night');
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(appStorage.getBoolean('push.asked.night.v1')).toBeUndefined();
    // While that one is (invisibly) open, no second Alert on top.
    await askPushPermissionInContext('night');
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('the ask counts as asked only once answered', async () => {
    let answer!: (label: string) => void;
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
      answer = (label) => buttons?.find((b) => b.text === label)?.onPress?.();
    });
    const out = askPushPermissionInContext('make');
    await waitFor(() => expect(answer).toBeDefined());
    expect(appStorage.getBoolean('push.asked.make.v1')).toBeUndefined();
    answer('Not now');
    await expect(out).resolves.toBe(false);
    expect(appStorage.getBoolean('push.asked.make.v1')).toBe(true);
  });

  it('"Not now" asks nothing of the OS and still counts as asked', async () => {
    const alert = answerAlert('Not now');
    await expect(askPushPermissionInContext('make')).resolves.toBe(false);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    await askPushPermissionInContext('make');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('already granted: no question, true', async () => {
    granted();
    const alert = answerAlert('Turn on');
    await expect(askPushPermissionInContext('night')).resolves.toBe(true);
    expect(alert).not.toHaveBeenCalled();
  });

  it('the OS will not ask again (denied for good): no question, false', async () => {
    N.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false } as never);
    const alert = answerAlert('Turn on');
    await expect(askPushPermissionInContext('make')).resolves.toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('the box (Nomad nights)', () => {
  it('registers with the box for the active Nomad night', async () => {
    granted();
    useNightStore.getState().joinNomad('2121', NIGHT, 'Sam');
    await expect(registerNightPush()).resolves.toBe(true);
    expect(kjboxCalls()).toEqual([
      expect.objectContaining({ method: 'POST', body: { t: '2121', night_id: NIGHT, expo_push_token: TOKEN, platform: 'ios' } }),
    ]);
  });

  it('Nomad night alerts off: nothing goes to the box', async () => {
    granted();
    appStorage.set(NIGHT_ALERTS_KEY, false);
    useNightStore.getState().joinNomad('2121', NIGHT, 'Sam');
    await expect(registerNightPush()).resolves.toBe(false);
    expect(kjboxCalls()).toEqual([]);
  });

  it('no Nomad night: nothing goes to the box', async () => {
    granted();
    await expect(registerNightPush()).resolves.toBe(false);
    expect(kjboxCalls()).toEqual([]);
  });
});

describe('usePushRegistration (mounted once in AppProviders)', () => {
  it('registers on launch when allowed, and a sign-in as another account re-registers to the new user', async () => {
    granted();
    renderHook(() => usePushRegistration(), { wrapper });
    await waitFor(() => expect(genCalls().filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(genCalls()[0]!.auth).toBe('Bearer tok-a@example.com');
    expect(N.setNotificationHandler).toHaveBeenCalledTimes(1);

    await act(async () => {
      await useAuth.getState().signOut();
      await useAuth.getState().signInWithSession(session('b@example.com'));
    });
    await waitFor(() =>
      expect(genCalls().filter((c) => c.method === 'POST').map((c) => c.auth)).toEqual(['Bearer tok-a@example.com', 'Bearer tok-b@example.com']),
    );
  });

  it('a Nomad night starting registers with the box without POSTing gen again', async () => {
    granted();
    renderHook(() => usePushRegistration(), { wrapper });
    await waitFor(() => expect(genCalls()).toHaveLength(1));
    await act(async () => {
      useNightStore.getState().joinNomad('2121', NIGHT, 'Sam');
    });
    await waitFor(() => expect(kjboxCalls()).toHaveLength(1));
    expect(genCalls()).toHaveLength(1);
  });

  it('registers nothing without permission', async () => {
    renderHook(() => usePushRegistration(), { wrapper });
    await act(async () => {});
    expect(calls).toEqual([]);
  });
});
