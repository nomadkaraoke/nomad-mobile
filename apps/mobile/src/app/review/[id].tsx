import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { ReviewScreen } from '../../review/ReviewScreen';
import { useReviewLoader } from '../../review/useReviewLoader';

/** /review/[id]: opens the review on gen (retrying transient failures), then the native review screen. */
export default function ReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useReviewLoader(id);
  const t = useTranslations('review');

  if (load.status === 'ready') return <ReviewScreen key={id} jobId={id} data={load.data} />;

  return (
    <Screen testID="review-loading-screen">
      {load.status === 'error' ? (
        <View className="flex-1 justify-center gap-4">
          {/* Never "access denied": a 404 says not found, everything else is a connection problem. */}
          <Text testID="review-load-error" className="text-center" variant="body">
            {load.error === 'not_found' ? t('notFound') : t('loadError')}
          </Text>
          <Button testID="review-retry" variant="secondary" label={t('retry')} onPress={load.retry} />
        </View>
      ) : (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator testID="review-loading" />
          <Text variant="muted">{t('loading')}</Text>
        </View>
      )}
    </Screen>
  );
}
