import { ApiError, deleteExpoToken, registerExpoToken, type PushPlatform } from '@nomad/api-gen';
import { deleteKjboxPushToken, registerKjboxPushToken } from '@nomad/api-kjbox';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';

import { onBeforeSignOut, useAuth } from '../auth/store';
import { EAS_PROJECT_ID, FAKE_PUSH_TOKEN, PUSH_ENABLED } from '../config';
import { getDeviceId } from '../device/deviceId';
import { appStorage } from '../storage';
import { useNightStore, type NomadNight } from '../tonight/nightStore';

/**
 * Push notifications (Phase 6 spec §5). The device's Expo push token is registered with gen (video ready, needs
 * review, job problems) and, at a Nomad night, with the box (up next, your turn). Every push carries `data.url`,
 * which the one tap router (tapRouting.ts) opens. Permission is asked in context only: after a make starts and
 * after joining a Nomad night, at most once per context per install.
 */

/** Android channels: gen's job pushes and the box's night pushes. */
export const PUSH_CHANNELS = { jobs: 'jobs', tonight: 'tonight' } as const;

/** Me → Notifications' "Nomad night alerts" (default on): off = the token is not registered with the box. */
export const NIGHT_ALERTS_KEY = 'push.nightAlerts.v1';
/** The token last registered with gen for the signed-in account (what sign-out unregisters). */
const TOKEN_KEY = 'push.expoToken.v1';
/** `<nightId>`: the night the token was last registered with (what sign-out unregisters there). */
const NIGHT_KEY = 'push.kjboxNight.v1';
const askedKey = (where: PushContext) => `push.asked.${where}.v1`;
/**
 * SecureStore (it holds a session token): `{token, bearer, attempts}` for a gen unregister that didn't happen (the
 * DELETE failed, or a gen 401 signed out without one). Retried while signed out; moot once this device registers
 * again (gen moves the token on register).
 */
const PENDING_KEY = 'push.pendingUnregister.v1';
/** Retries of a pending unregister before it is dropped (best-effort). */
export const MAX_UNREGISTER_ATTEMPTS = 3;

export type PushContext = 'make' | 'night';

/** The in-app texts, in the user's language (usePushRegistration sets them from the translations). */
export interface PushCopy {
  channels: { jobs: string; tonight: string };
  ask: Record<PushContext, { title: string; body: string }> & { allow: string; notNow: string };
}

let copy: PushCopy | null = null;
export function setPushCopy(c: PushCopy): void {
  copy = c;
}

export const nightAlertsEnabled = (): boolean => appStorage.getBoolean(NIGHT_ALERTS_KEY) !== false;

/**
 * Me → Notifications' Nomad night alerts switch. Off: remembered, and the token leaves the box now (and is not
 * registered with it again). On: remembered, and registers when a Nomad night is active. Never throws.
 */
export function setNightAlertsEnabled(enabled: boolean): Promise<void> {
  appStorage.set(NIGHT_ALERTS_KEY, enabled);
  // One at a time, each applying the latest choice: quick on/off/on can't leave the box out of step.
  nightQueue = nightQueue.then(() => (nightAlertsEnabled() ? registerNightPush() : unregisterNightPush()).then(() => {}));
  return nightQueue;
}
let nightQueue: Promise<void> = Promise.resolve();

const platform = (): PushPlatform => (Platform.OS === 'android' ? 'android' : 'ios');
const signedIn = () => useAuth.getState().getToken() !== null;

/** Android 13+ only shows the permission prompt once a channel exists, so these come first. Resolves off Android. */
async function ensureChannels(): Promise<void> {
  await Promise.all(
    (Object.keys(PUSH_CHANNELS) as (keyof typeof PUSH_CHANNELS)[]).map((k) =>
      Notifications.setNotificationChannelAsync(PUSH_CHANNELS[k], {
        name: copy?.channels[k] ?? PUSH_CHANNELS[k],
        importance: Notifications.AndroidImportance.HIGH,
      }),
    ),
  );
}

/** This device's Expo push token, or null (push off). Throws when the OS can't give one (no entitlement, no FCM). */
async function expoToken(): Promise<string | null> {
  if (FAKE_PUSH_TOKEN) return `ExponentPushToken[e2e-${getDeviceId()}]`;
  if (!PUSH_ENABLED) return null;
  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId ??
    EAS_PROJECT_ID;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

async function permissionGranted(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

let registering: { session: string; promise: Promise<string | null> } | null = null;

/**
 * Registers this device with the signed-in gen account. Needs permission already granted (never asks). Returns the
 * token, or null when signed out, not allowed, or anything failed (never throws). Concurrent calls for one session
 * share one request.
 */
export function registerPush(): Promise<string | null> {
  const session = useAuth.getState().getToken();
  if (!session) return Promise.resolve(null);
  if (registering?.session === session) return registering.promise;
  const promise = (async () => {
    try {
      await ensureChannels();
      if (!(await permissionGranted())) return null;
      const token = await expoToken();
      if (!token) return null;
      await registerExpoToken(token, platform(), getDeviceId());
      appStorage.set(TOKEN_KEY, token);
      // gen moved the token to this account: any earlier account's unregister is moot.
      await clearPending();
      return token;
    } catch {
      return null;
    }
  })().finally(() => {
    if (registering?.promise === promise) registering = null;
  });
  registering = { session, promise };
  return promise;
}

const activeNomadNight = (): NomadNight | null => {
  const night = useNightStore.getState().current();
  return night?.kind === 'nomad' ? night : null;
};

/**
 * Registers the token with the box for the active Nomad night (its "up next" and "your turn" pushes), when Nomad
 * night alerts are on. True when registered. Never throws.
 */
export async function registerNightPush(): Promise<boolean> {
  const night = activeNomadNight();
  if (!night || !nightAlertsEnabled()) return false;
  try {
    const token = appStorage.getString(TOKEN_KEY) ?? (await registerPush());
    if (!token) return false;
    await registerKjboxPushToken(night.code, token, platform(), night.nightId);
    appStorage.set(NIGHT_KEY, night.nightId);
    return true;
  } catch {
    return false;
  }
}

/** Removes the token from the box (Nomad night alerts turned off, or sign-out). Never throws. */
export async function unregisterNightPush(): Promise<void> {
  const token = appStorage.getString(TOKEN_KEY);
  const registeredNight = appStorage.getString(NIGHT_KEY);
  const night = activeNomadNight();
  if (!token || !night) {
    if (registeredNight !== undefined) appStorage.remove(NIGHT_KEY);
    return;
  }
  try {
    await deleteKjboxPushToken(night.code, token, night.nightId);
  } catch {
    // Best-effort: the box drops tokens Expo reports dead, and a new night starts without it.
  }
  // Only what this call captured: a registration that happened meanwhile keeps its own marker.
  if (appStorage.getString(NIGHT_KEY) === registeredNight) appStorage.remove(NIGHT_KEY);
}

type Pending = { token: string; bearer: string; attempts: number };

async function loadPending(): Promise<Pending | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Pending>) : null;
    if (v && typeof v.token === 'string' && typeof v.bearer === 'string' && typeof v.attempts === 'number') {
      return { token: v.token, bearer: v.bearer, attempts: v.attempts };
    }
  } catch {
    // corrupt: nothing pending
  }
  return null;
}

async function savePending(p: Pending): Promise<void> {
  try {
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(p));
  } catch {
    // Best-effort.
  }
}

async function clearPending(token?: string): Promise<void> {
  try {
    if (token !== undefined && (await loadPending())?.token !== token) return;
    await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    // Best-effort.
  }
}

/**
 * Unregisters this device from gen and (in a Nomad night it registered with) the box. Runs before sign-out clears
 * the session (both DELETEs need it); the auth store calls it through onBeforeSignOut. A failed gen DELETE is kept
 * as a pending unregister (retryPendingUnregister). Never throws.
 */
export async function unregisterPush(): Promise<void> {
  const token = appStorage.getString(TOKEN_KEY);
  const bearer = useAuth.getState().getToken();
  if (!token) return;
  const nightRegistered = appStorage.getString(NIGHT_KEY) !== undefined;
  const [genOk] = await Promise.all([
    deleteExpoToken(token).then(
      () => true,
      () => false,
    ),
    nightRegistered ? unregisterNightPush() : Promise.resolve(),
  ]);
  if (genOk) await clearPending(token);
  else if (bearer) await savePending({ token, bearer, attempts: 0 });
  // Compare-and-delete: a sign-in that registered meanwhile (another account) keeps its token.
  if (appStorage.getString(TOKEN_KEY) === token) appStorage.remove(TOKEN_KEY);
}

onBeforeSignOut(unregisterPush);

/**
 * Account deletion: forgets this device's registration on the phone only. gen erased the account's push tokens
 * itself, so nothing is sent (and no pending unregister is kept for a session that no longer exists). Run it BEFORE
 * signing out, so the sign-out listener below finds no token to keep. Never throws.
 */
export async function forgetPushLocally(): Promise<void> {
  appStorage.remove(TOKEN_KEY);
  appStorage.remove(NIGHT_KEY);
  await clearPending();
}

// A gen 401 signs out without the hooks (the session is dead): note the unregister that didn't happen, so a later
// retry tries it (gen will most likely refuse the dead session, and the marker is then dropped) and the next
// registration clears it. Also catches a sign-out whose unregister timed out with the DELETE still in flight.
useAuth.subscribe((s, prev) => {
  if (s.state.status !== 'signedOut' || prev.state.status !== 'signedIn') return;
  const token = appStorage.getString(TOKEN_KEY);
  if (!token) return;
  appStorage.remove(TOKEN_KEY);
  appStorage.remove(NIGHT_KEY);
  void savePending({ token, bearer: prev.state.session.token, attempts: 0 });
});

/**
 * Retries a pending gen unregister with the session that registered it, while signed out (signed in, the next
 * registration makes it moot). Dropped after MAX_UNREGISTER_ATTEMPTS or when gen refuses it (4xx). Never throws.
 */
export async function retryPendingUnregister(): Promise<void> {
  if (signedIn()) return;
  const p = await loadPending();
  if (!p) return;
  if (p.attempts >= MAX_UNREGISTER_ATTEMPTS) return clearPending(p.token);
  try {
    await deleteExpoToken(p.token, p.bearer);
    await clearPending(p.token);
  } catch (e) {
    const refused = e instanceof ApiError && e.status >= 400 && e.status < 500;
    if (refused) await clearPending(p.token);
    else await savePending({ ...p, attempts: p.attempts + 1 });
  }
}

/**
 * Our own question first ("Get a notification when …?"), so a "not now" never spends the OS prompt. Resolves on an
 * answer only: an Alert iOS dropped (presented while a Modal dismissed) never resolves, and the ask then stays open.
 */
function preAsk(where: PushContext): Promise<boolean> {
  if (!copy) return Promise.resolve(true);
  const c = copy;
  const { title, body } = c.ask[where];
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: c.ask.notNow, style: 'cancel', onPress: () => resolve(false) },
        { text: c.ask.allow, onPress: () => resolve(true) },
      ],
      // Android: a tap outside is an answer too.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Contexts whose question is on screen now (one at a time; a dropped one waits for the next launch). */
const asking = new Set<PushContext>();

/**
 * Asks for notification permission in context (`make`: after a make starts; `night`: after joining a Nomad night), at
 * most once per context per install: the context counts as asked once our question was answered. Granted → registers
 * with gen (and the box for `night`). Resolves whether notifications are on. Never throws. Call it from a settled
 * screen (usePendingPushAsk), never while a sheet or Modal is closing: iOS drops that Alert.
 */
export async function askPushPermissionInContext(where: PushContext): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain && !appStorage.getBoolean(askedKey(where)) && !asking.has(where)) {
      asking.add(where);
      let allow: boolean;
      try {
        allow = await preAsk(where);
      } finally {
        asking.delete(where);
      }
      appStorage.set(askedKey(where), true);
      if (allow) {
        await ensureChannels();
        granted = (await Notifications.requestPermissionsAsync()).granted;
      }
    }
    if (granted) {
      await registerPush();
      if (where === 'night') await registerNightPush();
    }
    return granted;
  } catch {
    return false;
  }
}

/** Asks waiting for their screen (requestPushAsk → usePendingPushAsk on the screen the flow lands on). */
const pendingAsks = new Set<PushContext>();

/** Queues the in-context ask for the screen the flow lands on (the Make tab after a make, Tonight after a join). */
export function requestPushAsk(where: PushContext): void {
  pendingAsks.add(where);
}

/** True (and dequeued) when an ask for `where` is waiting. */
export function takePendingPushAsk(where: PushContext): boolean {
  return pendingAsks.delete(where);
}
