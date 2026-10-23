import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { PickExportError, usePickExportFile } from './usePickExportFile';
import { scheduleExportReminders } from './reminders';

const SPOTIFY_PRIVACY = 'https://www.spotify.com/account/privacy/';

type Remind = 'idle' | 'busy' | 'scheduled' | 'denied' | 'failed';

function Step({ n, text, children }: { n: number; text: string; children: ReactNode }) {
  const t = useTranslations('connect');
  return (
    <View className="flex-row gap-3 rounded-xl border border-border bg-card p-4">
      <View className="size-7 items-center justify-center rounded-full bg-primary">
        <Text className="font-semibold">{t('stepNumber', { n })}</Text>
      </View>
      <View className="flex-1 gap-3">
        <Text>{text}</Text>
        {children}
      </View>
    </View>
  );
}

/**
 * "Your Spotify history" (Phase 3b spec §5.4): request the privacy export, get a local reminder when it should be
 * ready (permission asked only on "Remind me"), then pick the zip (or share it to the app on Android).
 */
export function SpotifyExportGuide() {
  const t = useTranslations('connect');
  const { pick, failed: pickFailed } = usePickExportFile();
  const [remind, setRemind] = useState<Remind>('idle');

  const remindMe = async () => {
    if (remind === 'busy') return;
    setRemind('busy');
    try {
      setRemind(
        await scheduleExportReminders({
          title: t('reminders.title'),
          body: t('reminders.body'),
          channelName: t('reminders.channel'),
        }),
      );
    } catch (e) {
      console.warn('[connect] scheduling the Spotify reminders failed', e);
      setRemind('failed');
    }
  };

  return (
    <Screen testID="connect-spotify-export" scroll underHeader>
      <Text variant="muted">{t('spotifyExport.intro')}</Text>
      <Step n={1} text={t('spotifyExport.step1')}>
        <Button
          testID="connect-spotify-open"
          variant="secondary"
          label={t('spotifyExport.open')}
          onPress={() => void WebBrowser.openBrowserAsync(SPOTIFY_PRIVACY)}
        />
      </Step>
      <Step n={2} text={t('spotifyExport.step2')}>
        {remind === 'scheduled' ? (
          <Text testID="connect-spotify-reminded" accessibilityLiveRegion="polite">
            {t('spotifyExport.reminded')}
          </Text>
        ) : (
          <Button
            testID="connect-spotify-remind"
            variant="secondary"
            label={t('spotifyExport.remind')}
            loading={remind === 'busy'}
            onPress={() => void remindMe()}
          />
        )}
        {remind === 'denied' ? (
          <>
            <Text testID="connect-spotify-denied" variant="error" accessibilityLiveRegion="polite">
              {t('spotifyExport.denied')}
            </Text>
            <Button
              testID="connect-spotify-settings"
              variant="secondary"
              label={t('spotifyExport.openSettings')}
              onPress={() => void Linking.openSettings()}
            />
          </>
        ) : null}
        {remind === 'failed' ? (
          <Text testID="connect-spotify-remind-error" variant="error" accessibilityLiveRegion="polite">
            {t('errors.generic')}
          </Text>
        ) : null}
      </Step>
      <Step n={3} text={t('spotifyExport.step3')}>
        <Button testID="connect-spotify-pick" label={t('spotifyExport.pick')} onPress={pick} />
        <PickExportError visible={pickFailed} />
      </Step>
    </Screen>
  );
}
