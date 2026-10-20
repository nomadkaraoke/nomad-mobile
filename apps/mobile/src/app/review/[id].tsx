import { useTranslations } from '@nomad/i18n';
import { Button, NomadLoader, Screen, Text } from '@nomad/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { openWebHandoff } from '../../jobs/openWebHandoff';
import { ReviewScreen } from '../../review/ReviewScreen';
import { useReviewLoader } from '../../review/useReviewLoader';

/** /review/[id]: opens the review on gen (retrying transient failures), then the native review screen. A load error offers Retry and Continue on web. */
export default function ReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useReviewLoader(id);
  const t = useTranslations('review');
  const queryClient = useQueryClient();
  const web = useMutation({ mutationFn: () => openWebHandoff(id, queryClient) });

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
          {/* The escape hatch (spec §4.7): the web review may still open when the app can't. */}
          <Button testID="review-load-error-web" variant="secondary" label={t('menuWeb')} loading={web.isPending} onPress={() => web.mutate()} />
          {web.isError ? (
            <Text testID="review-load-error-web-failed" className="text-center" variant="error">
              {t('webFailed')}
            </Text>
          ) : null}
        </View>
      ) : (
        <View className="flex-1 items-center justify-center gap-3">
          <NomadLoader testID="review-loading" accessibilityLabel={t('loading')} style={{ width: 240 }} />
          <Text variant="muted">{t('loading')}</Text>
        </View>
      )}
    </Screen>
  );
}
