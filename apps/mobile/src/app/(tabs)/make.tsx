import { useTranslations } from '@nomad/i18n';
import { Button, List, NomadLoader, Screen, Text } from '@nomad/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { openSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';
import { JobCard } from '../../jobs/JobCard';
import { useMyJobs } from '../../jobs/useMyJobs';

/** The Make tab (spec §4.6): the person's jobs, needs-you first, polled while any is unfinished. */
export default function MakeTabScreen() {
  const t = useTranslations('makeTab');
  const tc = useTranslations('common');
  const ta = useTranslations('account');
  const [pulling, setPulling] = useState(false);
  const auth = useAuth((s) => s.state);
  const email = auth.status === 'signedIn' ? auth.session.email : null;
  const jobs = useMyJobs(email);

  const title = <Text variant="title">{t('title')}</Text>;

  if (!email) {
    return (
      <Screen testID="make-tab-screen">
        {title}
        <Text variant="muted">{t('signInPrompt')}</Text>
        <Button
          testID="make-tab-signin"
          label={ta('signIn')}
          onPress={() => openSignIn('/(tabs)/make')}
        />
      </Screen>
    );
  }

  if (jobs.isPending) {
    return (
      <Screen testID="make-tab-screen">
        {title}
        <NomadLoader testID="make-loading" accessibilityLabel={tc('loading')} />
      </Screen>
    );
  }

  // Only a failed first load replaces the list; a failed poll keeps the cards (see refreshFailed below).
  if (jobs.isError && !jobs.data) {
    return (
      <Screen testID="make-tab-screen">
        {title}
        <Text variant="error">{t('loadFailed')}</Text>
        <Button testID="make-retry" variant="secondary" label={tc('retry')} onPress={() => void jobs.refetch()} />
      </Screen>
    );
  }

  if (!jobs.data || jobs.data.length === 0) {
    return (
      <Screen testID="make-tab-screen">
        {title}
        <View testID="make-empty" className="gap-2">
          <Text>{t('emptyTitle')}</Text>
          <Text variant="muted">{t('emptyBody')}</Text>
        </View>
        <Button testID="make-find" label={t('findSong')} onPress={() => router.navigate('/discover')} />
      </Screen>
    );
  }

  return (
    <Screen testID="make-tab-screen">
      <List
        testID="make-list"
        data={jobs.data}
        // A job that starts needing the singer sorts to the top: it must show, not land above the viewport.
        showNewRowsAtTop
        keyExtractor={(j) => j.job_id}
        ListHeaderComponent={
          <View className="w-full gap-1 pb-2">
            {title}
            {jobs.isRefetchError ? (
              <Text variant="muted" testID="make-refresh-failed">
                {t('refreshFailed')}
              </Text>
            ) : null}
          </View>
        }
        renderItem={(job) => (
          <View className="pb-3">
            <JobCard job={job} />
          </View>
        )}
        // Only a pull shows the spinner; background polls refresh quietly.
        refreshing={pulling}
        onRefresh={() => {
          setPulling(true);
          void jobs.refetch().finally(() => setPulling(false));
        }}
      />
    </Screen>
  );
}
