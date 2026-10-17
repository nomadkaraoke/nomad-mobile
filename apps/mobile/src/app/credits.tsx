import { useTranslations } from '@nomad/i18n';
import { Screen, Text } from '@nomad/ui';

/** Placeholder so `/credits` exists under typed routes; Task 5 replaces it with the credits screen (spec §4.5). */
export default function CreditsScreen() {
  const t = useTranslations('account');
  return (
    <Screen testID="credits-screen">
      <Text variant="title">{t('buyCredits')}</Text>
    </Screen>
  );
}
