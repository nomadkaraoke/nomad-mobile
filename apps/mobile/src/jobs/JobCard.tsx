import { retryJob, type JobSummary } from '@nomad/api-gen';
import { jobPhase, jobStep } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';

import { openReview } from './openReview';
import { youtubeId, youtubeThumbnail } from './youtube';

type Kind = 'working' | 'review' | 'duration' | 'web' | 'done' | 'failed' | 'cancelled';

const STEP_KEYS = ['audio', 'separated', 'lyrics', 'video', 'youtube'] as const;

/** error_details.code gen's audio-download worker sets when a torrent never started (web: StalledDownloadNotice). */
export const STALLED_DOWNLOAD_CODE = 'audio_download_stalled';

const isStalledDownload = (job: JobSummary) =>
  job.status === 'failed' && job.error_details?.code === STALLED_DOWNLOAD_CODE;

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
    const videoId = job.state_data?.youtube_url ? youtubeId(job.state_data.youtube_url) : null;
    return (
      <Pressable
        testID={`job-card-${id}`}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/job/[id]', params: { id } })}
        className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-3"
      >
        {videoId ? (
          // 16:9 thumbnail so a finished song is recognisable at a glance; decorative (the title follows).
          <Image
            testID={`job-thumb-${id}`}
            source={{ uri: youtubeThumbnail(videoId) }}
            accessibilityElementsHidden
            importantForAccessibility="no"
            className="h-14 w-24 rounded-md bg-border"
            resizeMode="cover"
          />
        ) : null}
        <View className="flex-1">{heading}</View>
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
      {kind === 'failed' ? isStalledDownload(job) ? <StalledDownload job={job} /> : <Failed job={job} /> : null}
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

type ReviewActionProps = { id: string; label: string; testID: string; body?: ReactNode; variant?: 'primary' | 'secondary' };

function ReviewAction({ id, label, testID, body, variant }: ReviewActionProps) {
  const t = useTranslations('jobs');
  const queryClient = useQueryClient();
  const open = useMutation({ mutationFn: () => openReview(id, queryClient) });
  return (
    <>
      {body ? <Text variant="muted">{body}</Text> : null}
      <Button testID={testID} variant={variant} label={label} loading={open.isPending} onPress={() => open.mutate()} />
      {open.isError ? (
        <Text variant="error" testID={`${testID}-error`}>
          {t('openFailed')}
        </Text>
      ) : null}
    </>
  );
}

/**
 * A failed job whose torrent never started (its only source was offline): no raw error, just
 * Keep trying (gen waits up to an hour) or choose different audio on the website.
 */
function StalledDownload({ job }: { job: JobSummary }) {
  const t = useTranslations('jobs');
  const queryClient = useQueryClient();
  const id = job.job_id;
  const keepTrying = useMutation({
    mutationFn: () => retryJob(id, { keepTrying: true }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });
  return (
    <>
      <View testID={`job-stalled-${id}`} className="gap-1">
        <Text className="font-semibold text-gold">{t('stalledTitle')}</Text>
        <Text variant="muted">{job.error_details?.keep_trying ? t('stalledBodyExtended') : t('stalledBody')}</Text>
      </View>
      {job.credit_refunded ? (
        <Text variant="muted" testID={`job-refunded-${id}`}>
          {t('refunded')}
        </Text>
      ) : null}
      <Button
        testID={`job-keep-trying-${id}`}
        label={t('keepTrying')}
        loading={keepTrying.isPending}
        onPress={() => keepTrying.mutate()}
      />
      {keepTrying.isError ? (
        <Text variant="error" testID={`job-keep-trying-error-${id}`}>
          {t('retryFailed')}
        </Text>
      ) : null}
      <ReviewAction id={id} label={t('chooseAudioOnWeb')} testID={`job-web-${id}`} variant="secondary" />
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
          className="min-h-11 justify-center gap-1"
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
