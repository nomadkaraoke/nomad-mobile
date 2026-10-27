import { getMe, updatePushPrefs, type Me, type PushPrefs } from '@nomad/api-gen';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { useAuth } from '../auth/store';
import { nightAlertsEnabled, registerNightPush, registerPush, setNightAlertsEnabled } from './push';

export type GenPushType = keyof PushPrefs;
/** `undetermined`: the OS can still ask. `denied`: only the system settings can turn notifications on. */
export type PushPermission = 'unknown' | 'granted' | 'undetermined' | 'denied';

/** gen's defaults while its answer is loading or the backend predates push_prefs: everything on. */
const DEFAULTS: PushPrefs = { ready: true, review: true, problems: true };

async function readPermission(): Promise<PushPermission> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'granted';
  }
}

/**
 * State and actions of Me → Notifications. gen's three switches share the Me query's cache (`['me', email]`) and
 * are optimistic: a failed PATCH puts that one switch back. The night switch lives on the phone (MMKV).
 */
export function usePushPrefs() {
  const qc = useQueryClient();
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const key = ['me', email];
  const me = useQuery({ queryKey: key, queryFn: getMe, enabled: email !== null });
  const prefs = me.data?.pushPrefs ?? DEFAULTS;
  const [night, setNight] = useState(nightAlertsEnabled);
  const [permission, setPermission] = useState<PushPermission>('unknown');
  const [error, setError] = useState(false);

  const refreshPermission = useCallback(() => void readPermission().then(setPermission), []);
  useEffect(() => {
    refreshPermission();
    // Back from the system settings: re-read.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshPermission());
    return () => sub?.remove();
  }, [refreshPermission]);

  // The value each switch should end at, and the one queue that sends them (PATCHes never overlap or reorder).
  const intended = useRef<Partial<PushPrefs>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setPref = useCallback(
    (type: GenPushType, value: boolean) => {
      setError(false);
      intended.current[type] = value;
      qc.setQueryData<Me>(key, (old) =>
        old ? { ...old, pushPrefs: { ...(old.pushPrefs ?? DEFAULTS), [type]: value } } : old,
      );
      queue.current = queue.current.then(async () => {
        const sending = intended.current[type];
        if (sending === undefined) return;
        try {
          const full = await updatePushPrefs({ [type]: sending });
          // Only this key from the answer, and only while no newer choice is waiting behind it.
          if (intended.current[type] === sending) {
            delete intended.current[type];
            qc.setQueryData<Me>(key, (old) =>
              old ? { ...old, pushPrefs: { ...(old.pushPrefs ?? DEFAULTS), [type]: full[type] } } : old,
            );
          }
        } catch {
          delete intended.current[type];
          setError(true);
          // Show what gen really holds rather than a guess.
          await qc.invalidateQueries({ queryKey: key });
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is derived from email
    [qc, email],
  );

  const setNightAlerts = useCallback((value: boolean) => {
    setNight(value);
    void setNightAlertsEnabled(value);
  }, []);

  /** Asks the OS (when it still can), then registers this device. */
  const askPermission = useCallback(async () => {
    try {
      await Notifications.requestPermissionsAsync();
      await registerPush();
      await registerNightPush();
    } catch {
      // Best-effort: the banner reflects what the OS says below.
    }
    refreshPermission();
  }, [refreshPermission]);

  const openSettings = useCallback(() => void Linking.openSettings(), []);

  /** Re-reads gen's switches (Retry, and each time the screen comes back into focus). */
  const { refetch } = me;
  const reload = useCallback(() => void refetch(), [refetch]);

  return {
    prefs,
    loaded: me.data !== undefined,
    loading: me.isLoading,
    /** gen's answer failed and there is nothing cached to show (offline, a 5xx). */
    loadFailed: me.isError && me.data === undefined,
    reload,
    night,
    permission,
    error,
    setPref,
    setNightAlerts,
    askPermission,
    openSettings,
  };
}
