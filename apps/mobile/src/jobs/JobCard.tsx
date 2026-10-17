import { retryJob, type JobSummary } from '@nomad/api-gen';
import { jobPhase, jobStep } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { openReview } from './openReview';

type Kind = 'working' | 'review' | 'duration' | 'web' | 'done' | 'failed' | 'cancelled';

const STEP_KEYS = ['audio', 'separated', 'lyrics', 'video', 'youtube'] as const;

/** jobPhase lumps cancelled into failed and every needs-you status together; the card needs them apart. */
export function cardKind(status: string): Kind {
  if (status === 'cancelled') return 'cancelled';
  const phase = jobPhase(status);
  if (phase !== 'needsUser') return phase;
  if (status === 'awaiting_review' || status === 'in_review') return 'review';
  if (status === 'awaiting_duration_confirm') return 'duration';
  return 'web';
}

/** One job on the Make tab (spec §4.6, mockup phone 5). */
export function JobCard({ job }: { job: JobSummary }) {
  const t = useTranslations('jobs');
  const id = job.job_id;
  const kind = cardKind(job.status);

  const heading = (
    <View className="gap-0.5">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="shrink font-bold">{job.title || t('untitled')}</Text>
        {kind === 'review' || kind === 'duration' || kind === 'web' ? (
          <Badge testID={`job-needs-you-${id}`} tone="gold" label={t('needsYou')} />
        ) : null}
        {kind === 'done' ? <Badge testID={`job-ready-${id}`} tone="green" label={t('ready')} /> : null}
      </View>
      {job.artist ? <Text variant="muted">{job.artist}</Text> : null}
    </View>
  );

  if (kind === 'done') {
    return (
      <Pressable
        testID={`job-card-${id}`}
        accessibilityRole="button"
        // The ready screen (/job/[id]) lands with Task 7; until then typed routes don't know it.
        onPress={() => router.push(`/job/${id}` as Href)}
        className="rounded-lg border border-border bg-card p-3"
      >
        {heading}
      </Pressable>
    );
  }

  const gold = kind === 'review' || kind === 'duration' || kind === 'web';
  return (
    <View
      testID={`job-card-${id}`}
      className={`gap-2 rounded-lg border bg-card p-3 ${gold ? 'border-gold/40' : 'border-border'} ${kind === 'cancelled' ? 'opacity-60' : ''}`}
    >
      {heading}
      {kind === 'working' ? <Progress job={job} /> : null}
      {kind === 'review' ? <ReviewAction id={id} body={t('reviewBody')} label={t('reviewLyrics')} testID={`job-review-${id}`} /> : null}
      {kind === 'web' ? <ReviewAction id={id} label={t('finishOnWeb')} testID={`job-web-${id}`} /> : null}
      {kind === 'duration' ? (
        <>
          <Text variant="muted">{t('durationBody')}</Text>
          <Button
            testID={`job-confirm-${id}`}
            label={t('confirmCost')}
            onPress={() => router.push({ pathname: '/job/duration/[id]', params: { id } })}
          />
        </>
      ) : null}
      {kind === 'failed' ? <Failed job={job} /> : null}
      {kind === 'cancelled' ? (
        <Text variant="muted" testID={`job-cancelled-${id}`}>
          {t('cancelled')}
        </Text>
      ) : null}
    </View>
  );
}

function Badge({ label, tone, testID }: { label: string; tone: 'gold' | 'green'; testID: string }) {
  const cls = tone === 'gold' ? 'bg-gold/15 text-gold' : 'bg-success/15 text-success';
  return (
    <Text testID={testID} className={`overflow-hidden rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>
      {label}
    </Text>
  );
}

function Progress({ job }: { job: JobSummary }) {
  const t = useTranslations('jobs');
  const id = job.job_id;
  const { step, slow } = jobStep(job.status);
  const pct = Math.min(100, Math.max(0, job.progress));
  return (
    <View className="gap-1">
      <View
        testID={`job-progress-${id}`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct }}
        className="my-1 h-1.5 overflow-hidden rounded-full bg-border"
      >
        <View className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </View>
      {STEP_KEYS.map((key, i) => {
        const n = i + 1;
        // `step` is the stage the job is in now: earlier stages are done, later ones still to come.
        const done = n < step;
        const current = n === step;
        return (
          <View
            key={key}
            testID={`job-step-${id}-${n}`}
            accessibilityState={{ checked: done, selected: current }}
            className="flex-row items-center gap-2 py-0.5"
          >
            <View
              className={`size-3.5 rounded-full ${done ? 'bg-success' : current ? 'bg-primary' : 'border-2 border-border'}`}
            />
            <Text className={`text-sm ${done || current ? 'text-text' : 'text-muted'}`}>{t(`steps.${key}`)}</Text>
          </View>
        );
      })}
      {slow ? (
        <Text variant="muted" testID={`job-slow-${id}`}>
          {t('slow')}
        </Text>
      ) : null}
    </View>
  );
}

function ReviewAction({ id, label, testID, body }: { id: string; label: string; testID: string; body?: ReactNode }) {
  const t = useTranslations('jobs');
  const queryClient = useQueryClient();
  const open = useMutation({ mutationFn: () => openReview(id, queryClient) });
  return (
    <>
      {body ? <Text variant="muted">{body}</Text> : null}
      <Button testID={testID} label={label} loading={open.isPending} onPress={() => open.mutate()} />
      {open.isError ? (
        <Text variant="error" testID={`${testID}-error`}>
          {t('openFailed')}
        </Text>
      ) : null}
    </>
  );
}

function Failed({ job }: { job: JobSummary }) {
  const t = useTranslations('jobs');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const id = job.job_id;
  const [open, setOpen] = useState(false);
  const retry = useMutation({
    mutationFn: () => retryJob(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });
  return (
    <>
      <Text>{t('failed')}</Text>
      {job.credit_refunded ? (
        <Text variant="muted" testID={`job-refunded-${id}`}>
          {t('refunded')}
        </Text>
      ) : null}
      {job.error_message ? (
        <Pressable
          testID={`job-error-${id}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          className="gap-1"
        >
          <Text variant="muted">{`${open ? '▾' : '▸'} ${t('details')}`}</Text>
          {open ? (
            <Text variant="muted" testID={`job-error-text-${id}`} selectable>
              {job.error_message}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      <Button
        testID={`job-retry-${id}`}
        variant="secondary"
        label={tc('retry')}
        loading={retry.isPending}
        onPress={() => retry.mutate()}
      />
      {retry.isError ? (
        <Text variant="error" testID={`job-retry-error-${id}`}>
          {t('retryFailed')}
        </Text>
      ) : null}
    </>
  );
}
