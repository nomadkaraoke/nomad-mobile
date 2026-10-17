import { cancelJob, confirmDuration, getJob, isApiError, type JobSummary } from '@nomad/api-gen';
import { durationConfirm, formatClock } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { cachedJobSummary } from '../../../jobs/cachedJob';

/**
 * Duration confirm (spec §4.6): a long track costs more than the credit already charged. Confirm
 * acknowledges the full total; without enough credits it goes to the credits screen, which
 * comes back here. Cancel stops the job, and gen refunds what was charged. A job that has moved on
 * (confirmed elsewhere, cancelled) shows "Nothing to confirm" with just Close.
 */
export default function DurationSheet() {
  const t = useTranslations('duration');
  const tc = useTranslations('common');
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  // gen answered 409: the total (or the job) changed under the sheet. Show the fresh figure, not an error.
  const [priceChanged, setPriceChanged] = useState(false);

  const job = useQuery({
    queryKey: ['job', id],
    // Only the summary fields are needed, so the Make tab's copy can stand in.
    queryFn: (): Promise<JobSummary> => getJob(id),
    // The Make tab already has the job: show it at once while the fresh copy loads.
    placeholderData: () => cachedJobSummary(queryClient, id),
  });

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/make');
  };

  const confirm = useMutation({
    mutationFn: (total: number) => confirmDuration(id, total),
    onMutate: () => setPriceChanged(false),
    onSuccess: done,
    onError: (e) => {
      if (isApiError(e, 402)) {
        router.push({ pathname: '/credits', params: { returnTo: `/job/duration/${id}` } });
      } else if (isApiError(e, 409)) {
        setPriceChanged(true);
        void job.refetch();
      }
    },
  });
  const cancel = useMutation({ mutationFn: () => cancelJob(id), onSuccess: done });

  const busy = confirm.isPending || cancel.isPending;
  const failed =
    (confirm.isError && !isApiError(confirm.error, 402) && !isApiError(confirm.error, 409)) || cancel.isError;

  return (
    <View testID="duration-sheet" className="flex-1 gap-4 bg-bg p-6">
      <Text variant="title">{t('title')}</Text>
      {!job.data ? (
        job.isError ? (
          <>
            <Text variant="error">{t('failed')}</Text>
            <Button testID="duration-reload" variant="secondary" label={tc('retry')} onPress={() => void job.refetch()} />
          </>
        ) : (
          <ActivityIndicator testID="duration-loading" />
        )
      ) : job.data.status !== 'awaiting_duration_confirm' ? (
        <View testID="duration-nothing" className="gap-4">
          <Text>{t('nothingTitle')}</Text>
          <Text variant="muted">{t('nothingBody')}</Text>
          <Button testID="duration-close" variant="secondary" label={t('close')} onPress={done} />
        </View>
      ) : (
        <DurationBody
          job={job.data}
          busy={busy}
          confirming={confirm.isPending}
          cancelling={cancel.isPending}
          failed={failed}
          priceChanged={priceChanged}
          onConfirm={(total) => confirm.mutate(total)}
          onCancel={() => cancel.mutate()}
        />
      )}
    </View>
  );
}

type BodyProps = {
  job: JobSummary;
  busy: boolean;
  confirming: boolean;
  cancelling: boolean;
  failed: boolean;
  priceChanged: boolean;
  onConfirm: (total: number) => void;
  onCancel: () => void;
};

function DurationBody({ job, busy, confirming, cancelling, failed, priceChanged, onConfirm, onCancel }: BodyProps) {
  const t = useTranslations('duration');
  const { totalCredits, extraCredits, seconds } = durationConfirm(job);
  const charged = totalCredits - extraCredits;
  return (
    <>
      {priceChanged ? (
        <Text testID="duration-price-changed" className="font-semibold text-gold">
          {t('priceChanged')}
        </Text>
      ) : null}
      <Text testID="duration-body">
        {t('body', { duration: formatClock(seconds), total: totalCredits, extra: extraCredits })}
      </Text>
      {/* gen refunds credits_charged on cancel (job_manager._refund_credit_for_job) and skips a 0-credit job. */}
      {charged > 0 ? (
        <Text variant="muted" testID="duration-refund-note">
          {t('refundNote')}
        </Text>
      ) : null}
      {failed ? (
        <Text variant="error" testID="duration-error">
          {t('failed')}
        </Text>
      ) : null}
      <Button
        testID="duration-confirm"
        label={t('confirm')}
        loading={confirming}
        disabled={busy}
        onPress={() => onConfirm(totalCredits)}
      />
      <Button
        testID="duration-cancel"
        variant="secondary"
        label={t('cancelVideo')}
        loading={cancelling}
        disabled={busy}
        onPress={onCancel}
      />
    </>
  );
}
