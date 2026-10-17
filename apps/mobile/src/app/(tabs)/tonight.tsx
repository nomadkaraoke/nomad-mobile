import { useTranslations } from '@nomad/i18n';
import { Screen, Text } from '@nomad/ui';

/** Phase 1 placeholder: kjbox nights land here in a later phase (docs/VISION.md). */
export default function TonightScreen() {
  const t = useTranslations('tonight');
  return (
    <Screen testID="tonight-screen">
      <Text variant="title">{t('title')}</Text>
      <Text variant="muted">{t('comingSoon')}</Text>
    </Screen>
  );
}
