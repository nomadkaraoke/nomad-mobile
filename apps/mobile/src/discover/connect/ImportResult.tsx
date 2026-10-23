import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';

/**
 * What an import added, shown when it finishes ("Added 3 artists and 120 songs you know"), or, for an export decide
 * had already imported in full, that there was nothing new.
 */
export function ImportResult({ artists, songs, alreadyImported = false }: { artists: number; songs: number; alreadyImported?: boolean }) {
  const t = useTranslations('connect');
  return (
    <Text testID="connect-import-result" accessibilityLiveRegion="polite" className="font-semibold">
      {alreadyImported ? t('alreadyImported') : t('result', { artists, songs })}
    </Text>
  );
}
