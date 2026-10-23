import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';

/** What an import added, shown when it finishes ("Added 3 artists and 120 songs you know"). */
export function ImportResult({ artists, songs }: { artists: number; songs: number }) {
  const t = useTranslations('connect');
  return (
    <Text testID="connect-import-result" accessibilityLiveRegion="polite" className="font-semibold">
      {t('result', { artists, songs })}
    </Text>
  );
}
