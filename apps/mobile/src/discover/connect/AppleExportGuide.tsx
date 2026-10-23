import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { PickExportError, usePickExportFile } from './usePickExportFile';

const APPLE_PRIVACY = 'https://privacy.apple.com/';

function Step({ n, text, children }: { n: number; text: string; children?: ReactNode }) {
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
 * "Apple Music history": the fallback for people without an Apple Music subscription (MusicKit needs one). Request
 * the privacy export, then pick the zip or the Play Activity CSV. No reminder: Apple's timing isn't fixed.
 */
export function AppleExportGuide() {
  const t = useTranslations('connect');
  const { pick, failed: pickFailed } = usePickExportFile();
  return (
    <Screen testID="connect-apple-export-guide" scroll underHeader>
      <Text variant="muted">{t('appleGuide.intro')}</Text>
      <Step n={1} text={t('appleGuide.step1')}>
        <Button
          testID="connect-apple-open"
          variant="secondary"
          label={t('appleGuide.open')}
          onPress={() => void WebBrowser.openBrowserAsync(APPLE_PRIVACY)}
        />
      </Step>
      <Step n={2} text={t('appleGuide.step2')} />
      <Step n={3} text={t('appleGuide.step3')}>
        <Button testID="connect-apple-pick" label={t('appleGuide.pick')} onPress={pick} />
        <PickExportError visible={pickFailed} />
      </Step>
    </Screen>
  );
}
