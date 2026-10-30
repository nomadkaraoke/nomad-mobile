import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ActivityIndicator, Switch, View } from 'react-native';

import { useAuth } from '../../auth/store';
import { usePushPrefs, type GenPushType } from '../../notifications/usePushPrefs';

const GEN_TYPES: readonly GenPushType[] = ['ready', 'review', 'problems'];

function Row({
  testID,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  testID: string;
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <View className="flex-1 gap-1">
        <Text className="font-semibold">{label}</Text>
        <Text variant="muted">{hint}</Text>
      </View>
      <Switch testID={testID} accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

/** Me → Account and notifications → Notifications: which pushes this account gets, and the Nomad night alerts. */
export default function NotificationsScreen() {
  const t = useTranslations('settings.notifications');
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const tc = useTranslations('common');
  const p = usePushPrefs();
  const { reload } = p;

  // Back on this screen (e.g. from the system settings or another tab): re-read gen's switches. The first focus is
  // the mount, which the query already fetches for.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      if (signedIn) reload();
    }, [signedIn, reload]),
  );

  return (
    <Screen testID="notifications-screen" scroll>
      <Text variant="title">{t('title')}</Text>
      {p.permission === 'denied' ? (
        <View testID="notif-denied" className="gap-2 rounded-xl border border-border bg-card p-3">
          <Text>{t('deniedBody')}</Text>
          <Button testID="notif-open-settings" label={t('openSettings')} variant="secondary" onPress={p.openSettings} />
        </View>
      ) : null}
      {p.permission === 'undetermined' ? (
        <View testID="notif-ask-banner" className="gap-2 rounded-xl border border-border bg-card p-3">
          <Text>{t('askBody')}</Text>
          <Button testID="notif-ask" label={t('askButton')} onPress={() => void p.askPermission()} />
        </View>
      ) : null}
      {signedIn && p.loadFailed ? (
        <View testID="notif-load-failed" className="items-start gap-2">
          <Text variant="error">{t('loadFailed')}</Text>
          <Button testID="notif-retry" variant="secondary" label={tc('retry')} onPress={reload} />
        </View>
      ) : null}
      {signedIn && !p.loaded && !p.loadFailed ? <ActivityIndicator testID="notif-loading" /> : null}
      {signedIn
        ? GEN_TYPES.map((type) => (
            <Row
              key={type}
              testID={`notif-${type}`}
              label={t(`${type}.label`)}
              hint={t(`${type}.hint`)}
              value={p.prefs[type]}
              disabled={!p.loaded}
              onChange={(v) => p.setPref(type, v)}
            />
          ))
        : null}
      <Row
        testID="notif-night"
        label={t('night.label')}
        hint={t('night.hint')}
        value={p.night}
        onChange={p.setNightAlerts}
      />
      {p.error ? (
        <Text testID="notif-error" variant="error">
          {t('error')}
        </Text>
      ) : null}
    </Screen>
  );
}
