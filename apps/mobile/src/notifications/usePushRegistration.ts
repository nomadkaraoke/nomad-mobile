import { useTranslations } from '@nomad/i18n';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/store';
import { useNightStore } from '../tonight/nightStore';
import { installNotificationHandler } from './handler';
import { registerNightPush, registerPush, retryPendingUnregister, setPushCopy } from './push';

/**
 * Mounted once (AppProviders): installs the foreground handler, gives push.ts its texts, and keeps this device
 * registered: on launch and on every sign-in (a different account takes the token over on gen), when the token
 * changes, and with the box whenever a Nomad night becomes active. Registers nothing until permission was granted
 * (asked in context only, push.ts). Signed out, on launch and foreground, it retries a pending gen unregister.
 */
export function usePushRegistration(): void {
  const t = useTranslations('push');
  const session = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.token : null));
  const nightId = useNightStore((s) => (s.active?.kind === 'nomad' ? s.active.nightId : null));

  useEffect(() => {
    installNotificationHandler();
    setPushCopy({
      channels: { jobs: t('channels.jobs'), tonight: t('channels.tonight') },
      ask: {
        make: { title: t('ask.make.title'), body: t('ask.make.body') },
        night: { title: t('ask.night.title'), body: t('ask.night.body') },
        allow: t('ask.allow'),
        notNow: t('ask.notNow'),
      },
    });
  }, [t]);

  // gen: once per session (launch, sign-in). Signed out: retry an unregister that didn't happen.
  useEffect(() => {
    if (session) void registerPush();
    else void retryPendingUnregister();
  }, [session]);

  // The box: whenever a Nomad night becomes active (registerPush shares gen's in-flight request when needed).
  useEffect(() => {
    if (session && nightId) void registerNightPush();
  }, [session, nightId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !useAuth.getState().getToken()) void retryPendingUnregister();
    });
    // Some suites mock AppState.addEventListener without a subscription.
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    // The OS rotated the device token: the Expo token may follow, so register again.
    const sub = Notifications.addPushTokenListener(() => {
      if (useAuth.getState().getToken()) void registerPush().then(() => registerNightPush());
    });
    return () => sub.remove();
  }, []);
}
