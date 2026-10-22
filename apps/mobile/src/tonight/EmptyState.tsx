import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CodeEntry } from './CodeEntry';
import { StartOtherNight } from './other/StartOtherNight';

/** Opens the join route for a night code (sign-in, name confirm and the switch question happen there). */
export const openJoin = (code: string) => router.push({ pathname: '/tonight/join', params: { t: code } });

/**
 * Tonight with no active night (spec §4.2, ruling E3-R5): scan the host's QR code, enter the night code, or start
 * logging another karaoke night (E9's StartOtherNight).
 */
export function EmptyState() {
  const t = useTranslations('tonight');
  const [entering, setEntering] = useState(false);
  return (
    <Screen testID="tonight-screen" scroll>
      <Text variant="title">{t('title')}</Text>
      <Text variant="muted">{t('empty.intro')}</Text>
      <Button testID="tonight-scan" label={t('empty.scan')} onPress={() => router.push('/tonight/scan')} />
      <Button testID="tonight-enter-code" variant="secondary" label={t('empty.enterCode')} onPress={() => setEntering((v) => !v)} />
      {entering ? <CodeEntry autoFocus onCode={openJoin} /> : null}
      <View className="mt-4">
        <StartOtherNight />
      </View>
    </Screen>
  );
}
