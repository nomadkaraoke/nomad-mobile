import { useTranslations } from '@nomad/i18n';
import { Stack } from 'expo-router';

import { ScanScreen } from '../../tonight/ScanScreen';

/** Scan the host's QR code to join tonight's Nomad night (spec §4.2). */
export default function TonightScanRoute() {
  const t = useTranslations('tonight.scan');
  return (
    <>
      <Stack.Screen options={{ title: t('title') }} />
      <ScanScreen />
    </>
  );
}
