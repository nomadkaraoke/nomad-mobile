import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { CodeEntry } from './CodeEntry';
import { parseNightLink } from './links';

const QR_ONLY = { barcodeTypes: ['qr' as const] };

/** Replaces the scanner with the join route, so Back from there returns to Tonight, not the camera. */
const join = (code: string) => router.replace({ pathname: '/tonight/join', params: { t: code } });

/**
 * The in-app QR scanner (spec §4.2, ruling E3-R3). Asks for the camera with a reason first; denied → Settings and the
 * night code. Accepts only night links (`parseNightLink`): one haptic on the first hit, everything else ignored
 * silently (a venue has menus and wifi QRs on every table).
 */
export function ScanScreen() {
  const t = useTranslations('tonight.scan');
  const [permission, requestPermission] = useCameraPermissions();
  const [codeOpen, setCodeOpen] = useState(false);
  const hit = useRef(false);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (hit.current) return;
    const link = parseNightLink(data);
    // A bare number on some other QR is not a night link: only full links count from the camera.
    if (!link || !data.includes('://')) return;
    hit.current = true;
    try {
      void Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => undefined);
    } catch {
      // no haptics engine: the join still happens
    }
    join(link.code);
  };

  if (!permission) return <Screen testID="tonight-scan-screen">{null}</Screen>;

  if (!permission.granted) {
    const denied = permission.status === 'denied';
    return (
      <Screen testID="tonight-scan-screen" scroll>
        <Text variant="title">{t('whyTitle')}</Text>
        {denied ? (
          <Text testID="tonight-scan-denied" variant="muted">
            {t('denied')}
          </Text>
        ) : (
          <Text testID="tonight-scan-why" variant="muted">
            {t('why')}
          </Text>
        )}
        {permission.canAskAgain ? (
          <Button testID="tonight-scan-allow" label={t('allow')} onPress={() => void requestPermission()} />
        ) : (
          <Button testID="tonight-scan-settings" label={t('openSettings')} onPress={() => void Linking.openSettings()} />
        )}
        {denied ? <CodeEntry onCode={join} /> : null}
      </Screen>
    );
  }

  return (
    <Screen testID="tonight-scan-screen" scroll>
      <Text variant="muted">{t('hint')}</Text>
      <View className="aspect-square w-full overflow-hidden rounded-2xl border border-border">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={QR_ONLY}
          onBarcodeScanned={onScanned}
        />
      </View>
      {codeOpen ? (
        <CodeEntry autoFocus onCode={join} />
      ) : (
        <Button testID="tonight-scan-enter-code" variant="secondary" label={t('enterCodeInstead')} onPress={() => setCodeOpen(true)} />
      )}
    </Screen>
  );
}
