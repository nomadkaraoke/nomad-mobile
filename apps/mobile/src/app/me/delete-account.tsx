import { getDeletionPreview, isApiError, type DeletionPreview } from '@nomad/api-gen';
import { isolate, useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';

import { appleCodeIfNeeded, deleteAccount, SUPPORT_EMAIL } from '../../account/deleteAccount';
import { useAuth } from '../../auth/store';

const KNOWN_BLOCKS = ['admin', 'referral_balance', 'connect_account', 'order_in_progress', 'unavailable'] as const;
type KnownBlock = (typeof KNOWN_BLOCKS)[number];
const isKnownBlock = (code: string): code is KnownBlock => (KNOWN_BLOCKS as readonly string[]).includes(code);

type Failure = { kind: 'blocked'; code: string } | { kind: 'retry'; partWay: boolean } | { kind: 'apple' };

/** Why the account can't be deleted here, and the support email (gen's 409 / a blocked preview / deletion off). */
function Blocked({ code }: { code: string }) {
  const t = useTranslations('deleteAccount');
  return (
    <View testID="delete-account-blocked" className="gap-2">
      <Text>{isKnownBlock(code) ? t(`blocked.${code}`) : t('blocked.generic')}</Text>
      <Text variant="muted">{t('support', { email: isolate(SUPPORT_EMAIL) })}</Text>
      <Button
        testID="delete-account-support"
        label={t('contactSupport')}
        variant="secondary"
        onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {})}
      />
    </View>
  );
}

function WhatHappens({ preview }: { preview: DeletionPreview }) {
  const t = useTranslations('deleteAccount');
  return (
    <View className="gap-2">
      <Text>{t('intro')}</Text>
      {preview.credits > 0 ? (
        <Text testID="delete-account-credits" className="font-semibold">
          {t('creditsLost', { count: preview.credits })}
        </Text>
      ) : null}
      {preview.jobsInProgress > 0 ? (
        <Text testID="delete-account-jobs" className="font-semibold">
          {t('jobsCancelled', { count: preview.jobsInProgress })}
        </Text>
      ) : null}
      <Text className="font-semibold">{t('deletedHeading')}</Text>
      {(['deletedDetails', 'deletedUploads', 'deletedDiscover', 'deletedNights', 'deletedRecordings'] as const).map((k) => (
        <Text key={k}>{`• ${t(k)}`}</Text>
      ))}
      <Text className="font-semibold">{t('keptHeading')}</Text>
      {(['keptRecords', 'keptVideos'] as const).map((k) => (
        <Text key={k}>{`• ${t(k)}`}</Text>
      ))}
    </View>
  );
}

/**
 * Me → Account and notifications → Delete account (Phase 6 spec §6, App Store 5.1.1(v)): gen's preview (credits
 * lost, videos cancelled, what is kept), then the confirm. Apple accounts on iOS re-confirm with Apple first. The
 * phone is wiped only after gen's 200 (or a 401: the session is gone, ruling R30); offline, timeouts and 503s keep
 * everything and offer a retry.
 */
export default function DeleteAccountScreen() {
  const t = useTranslations('deleteAccount');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const preview = useQuery({
    queryKey: ['account', 'deletion-preview', email],
    queryFn: getDeletionPreview,
    enabled: email !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  // Set synchronously: two taps in one frame both see `busy` false, but only one DELETE may go out.
  const inFlight = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const leave = (title: string, body: string) => {
    router.replace('/');
    Alert.alert(title, body, [{ text: t('ok') }]);
  };

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      let appleCode: string | null | 'cancelled';
      try {
        appleCode = await appleCodeIfNeeded();
      } catch {
        setFailure({ kind: 'apple' });
        return;
      }
      if (appleCode === 'cancelled') return;
      const result = await deleteAccount({ appleAuthorizationCode: appleCode ?? undefined, queryClient });
      if (result.ok) return leave(t('doneTitle'), t('doneBody'));
      if (result.reason === 'signedOut') return leave(t('signedOutTitle'), t('signedOutBody'));
      if (result.reason === 'blocked') setFailure({ kind: 'blocked', code: result.code });
      else setFailure({ kind: 'retry', partWay: result.partWay });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const previewBlocked = preview.data?.blocked ?? null;
  const previewOff = isApiError(preview.error, 404);

  const keepButton = (
    <Button testID="delete-account-keep" label={t('keep')} variant="secondary" disabled={busy} onPress={() => router.back()} />
  );

  return (
    <Screen testID="delete-account-screen" scroll>
      <Text variant="title">{t('title')}</Text>
      {preview.isPending ? (
        <ActivityIndicator testID="delete-account-loading" />
      ) : previewOff ? (
        <>
          <Blocked code="unavailable" />
          {keepButton}
        </>
      ) : preview.error ? (
        <View className="gap-2">
          <Text testID="delete-account-load-error" variant="error">
            {t('loadError')}
          </Text>
          <Button
            testID="delete-account-load-retry"
            label={tCommon('retry')}
            variant="secondary"
            onPress={() => void preview.refetch()}
          />
        </View>
      ) : previewBlocked ? (
        <>
          <Blocked code={previewBlocked} />
          {keepButton}
        </>
      ) : (
        <>
          <WhatHappens preview={preview.data} />
          {failure?.kind === 'blocked' ? <Blocked code={failure.code} /> : null}
          {failure?.kind === 'retry' ? (
            <Text testID="delete-account-retry-message" variant="error">
              {failure.partWay ? t('retryPartWay') : t('retryNetwork')}
            </Text>
          ) : null}
          {failure?.kind === 'apple' ? (
            <Text testID="delete-account-apple-error" variant="error">
              {t('appleFailed')}
            </Text>
          ) : null}
          {failure?.kind !== 'blocked' ? (
            <Button
              testID="delete-account-confirm"
              label={failure?.kind === 'retry' ? tCommon('retry') : t('confirm')}
              loading={busy}
              onPress={() => void confirm()}
            />
          ) : null}
          {keepButton}
        </>
      )}
    </Screen>
  );
}
