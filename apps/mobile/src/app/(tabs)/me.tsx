import { getOfflineIndexManifest } from '@nomad/api-decide';
import { getMe } from '@nomad/api-gen';
import { formatMegabytes } from '@nomad/core';
import { isolate, LOCALE_NAMES, useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, View } from 'react-native';

import { openSignIn } from '../../auth/signInUi';
import { useAuth } from '../../auth/store';
import { displayCredits } from '../../credits/balance';
import { currentLocale } from '../../locale';
import { MeHome } from '../../me/MeHome';
import { useOfflineIndex } from '../../offline/offlineIndex';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (at: number) => Math.max(0, Math.floor((Date.now() - at) / DAY_MS));

/**
 * The opt-in offline song list (spec §7.1): "Download song list for offline use (N MB)", progress, "Song list
 * updated N days ago", "Remove offline song list". The download size comes from decide's manifest, fetched
 * only while this section is on screen with no list yet.
 */
function OfflineSongList() {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const locale = currentLocale();
  const { status, bytes, downloadedAt, progress, download, remove } = useOfflineIndex();
  // A refresh download keeps the list already on the phone (and its size/date) until the new one is swapped in.
  const hasList = downloadedAt !== null && status !== 'none';
  // Only for the size on the Download button: not while downloading, and not in the error state (its button is
  // Try again, without a size).
  const manifest = useQuery({
    queryKey: ['decide', 'offline-index-manifest'],
    queryFn: getOfflineIndexManifest,
    enabled: !hasList && status === 'none',
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const confirmRemove = () =>
    Alert.alert(t('offlineRemoveTitle'), t('offlineRemoveBody'), [
      { text: tCommon('cancel'), style: 'cancel' },
      { text: t('offlineRemoveConfirm'), style: 'destructive', onPress: () => void remove() },
    ]);

  return (
    <View testID="me-offline" className="gap-2 rounded-xl border border-border bg-card p-3">
      <Text className="font-semibold">{t('offlineHeading')}</Text>
      {hasList ? (
        <>
          {bytes !== null ? (
            <Text testID="me-offline-size">{t('offlineSaved', { size: formatMegabytes(bytes, locale) })}</Text>
          ) : null}
          <Text testID="me-offline-updated" variant="muted">
            {t('offlineUpdated', { days: daysSince(downloadedAt) })}
          </Text>
        </>
      ) : (
        <Text variant="muted">{t('offlineHint')}</Text>
      )}
      {status === 'downloading' ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator />
          <Text testID="me-offline-progress">{t('offlineDownloading', { percent: Math.round((progress ?? 0) * 100) })}</Text>
        </View>
      ) : status === 'error' ? (
        <>
          <Text testID="me-offline-error" variant="error">
            {t('offlineError')}
          </Text>
          <Button testID="me-offline-retry" label={t('offlineRetry')} variant="secondary" onPress={() => void download()} />
        </>
      ) : !hasList ? (
        <Button
          testID="me-offline-download"
          label={
            manifest.data
              ? t('offlineDownloadSize', { size: formatMegabytes(manifest.data.bytes, locale) })
              : t('offlineDownload')
          }
          variant="secondary"
          onPress={() => void download()}
        />
      ) : null}
      {hasList && status !== 'downloading' ? (
        <Button testID="me-offline-remove" label={t('offlineRemove')} variant="secondary" onPress={confirmRemove} />
      ) : null}
    </View>
  );
}

/** Me (spec §4.1): credit balance, buy credits, the offline song list, language, signed-in email, sign out. */
export default function MeScreen() {
  const t = useTranslations('account');
  const tSettings = useTranslations('settings');
  const state = useAuth((s) => s.state);
  const signOut = useAuth((s) => s.signOut);
  const signedIn = state.status === 'signedIn';
  const me = useQuery({ queryKey: ['me', signedIn ? state.session.email : null], queryFn: getMe, enabled: signedIn });
  const locale = currentLocale();

  return (
    <Screen testID="me-screen" scroll>
      <Text variant="title">{t('title')}</Text>
      {signedIn ? (
        <>
          <MeHome />
          {me.data ? (
            <Text testID="me-credits" className="text-lg font-semibold">
              {t('credits', { credits: displayCredits(me.data.credits) })}
            </Text>
          ) : (
            <ActivityIndicator testID="me-credits-loading" />
          )}
          <Button testID="me-buy" label={t('buyCredits')} onPress={() => router.push('/credits')} />
          <Text>{t('signedInAs', { email: isolate(state.session.email) })}</Text>
          <Button
            testID="me-music-profile"
            label={t('musicProfile')}
            variant="secondary"
            onPress={() => router.push('/me/music-profile')}
          />
        </>
      ) : (
        <Button
          testID="me-signin"
          label={t('signIn')}
          onPress={() => openSignIn('/me')}
        />
      )}
      <OfflineSongList />
      <Text variant="muted">{t('language')}</Text>
      <Text testID="me-language">{LOCALE_NAMES[locale]}</Text>
      {signedIn ? (
        <Button
          testID="me-account"
          label={tSettings('account.row')}
          variant="secondary"
          onPress={() => router.push('/me/account')}
        />
      ) : null}
      {signedIn ? (
        <Button testID="me-signout" label={t('signOut')} variant="secondary" onPress={() => void signOut()} />
      ) : null}
    </Screen>
  );
}
