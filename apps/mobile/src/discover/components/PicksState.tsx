import { useTranslations } from '@nomad/i18n';
import { Button, NomadLoader, Text } from '@nomad/ui';
import { View } from 'react-native';

export type PicksStateKind = 'loading' | 'warming' | 'error' | 'empty' | 'none' | 'offline';

/**
 * Everything the picks area shows instead of sections: loading, warming up, an error, no match for the filters,
 * or (none) no picks at all yet with no filters on.
 */
export function PicksState({
  kind,
  onRetry,
  onClear,
}: {
  kind: PicksStateKind;
  onRetry?: () => void;
  onClear?: () => void;
}) {
  const t = useTranslations('discover');
  switch (kind) {
    case 'loading':
      return (
        <View className="items-center py-2">
          <NomadLoader testID="discover-picks-loading" accessibilityLabel={t('picksLoading')} />
        </View>
      );
    case 'warming':
      return (
        <Text variant="muted" testID="discover-picks-warming">
          {t('picksWarming')}
        </Text>
      );
    case 'error':
      return (
        <View testID="discover-picks-error" className="items-start gap-2">
          <Text variant="error">{t('picksError')}</Text>
          {onRetry ? (
            <Button testID="discover-picks-retry" label={t('picksRetry')} variant="secondary" onPress={onRetry} />
          ) : null}
        </View>
      );
    case 'offline':
      return (
        <Text variant="muted" testID="discover-picks-offline" className="py-4">
          {t('picksOffline')}
        </Text>
      );
    case 'none':
      return (
        <Text variant="muted" testID="discover-picks-none" className="py-4">
          {t('picksNone')}
        </Text>
      );
    case 'empty':
      return (
        <View testID="discover-picks-empty" className="items-start gap-2 py-4">
          <Text variant="muted">{t('picksEmpty')}</Text>
          {onClear ? (
            <Button testID="discover-picks-clear" label={t('picksClear')} variant="secondary" onPress={onClear} />
          ) : null}
        </View>
      );
  }
}
