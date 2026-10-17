import { getJob, type JobDetail } from '@nomad/api-gen';
import { useTranslations } from '@nomad/i18n';
import { Button, Screen, Text } from '@nomad/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import type { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, Share, View } from 'react-native';

import { cachedJobSummary } from '../../jobs/cachedJob';
import { discardMp4, downloadMp4, fetchMp4, Mp4ArchivedError, signedMp4Url } from '../../jobs/downloadMp4';
import { copiedToast } from '../../jobs/readyUi';
import { openYouTube, youtubeId, youtubeShortUrl, youtubeThumbnail, youtubeTitle } from '../../jobs/youtube';

type Transfer =
  | { kind: 'idle' | 'saved' | 'denied' | 'archived' | 'failed' }
  | { kind: 'busy'; progress: number | null };

/**
 * Ready screen (spec §4.7): the YouTube video is the hero (thumbnail, gen's title, the youtu.be link)
 * with Copy link and Share. Without a YouTube link the MP4 plays in the app. Download MP4 saves the
 * 720p render to Photos either way. No QR code: KJs are unlikely to scan one.
 */
export default function ReadyScreen() {
  const t = useTranslations('ready');
  const tc = useTranslations('common');
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: (): Promise<JobDetail> => getJob(id),
    // The Make tab's copy shows the YouTube block at once while the full job loads.
    placeholderData: (): JobDetail | undefined => {
      const summary = cachedJobSummary(queryClient, id);
      return summary && { ...summary, download_urls: undefined };
    },
  });

  const [transfer, setTransfer] = useState<Transfer>({ kind: 'idle' });
  // The MP4 fetched for in-app playback; Download saves it without fetching again.
  const [local, setLocal] = useState<File | null>(null);
  const busy = transfer.kind === 'busy';
  // A late progress event (after the save, or after a failure) must not bring the progress line back.
  const onProgress = (progress: number | null) =>
    setTransfer((prev) => (prev.kind === 'busy' ? { kind: 'busy', progress } : prev));

  // The player's cached MP4 goes when it's replaced or the screen closes (Photos keeps its own copy).
  useEffect(() => {
    if (!local) return;
    return () => discardMp4(local);
  }, [local]);

  const fail = (e: unknown) => setTransfer({ kind: e instanceof Mp4ArchivedError ? 'archived' : 'failed' });

  const onDownload = async () => {
    setTransfer({ kind: 'busy', progress: null });
    try {
      setTransfer({ kind: await downloadMp4(id, { onProgress, cached: local ?? undefined }) });
    } catch (e) {
      fail(e);
    }
  };

  const onPlay = async () => {
    setTransfer({ kind: 'busy', progress: null });
    try {
      setLocal(await fetchMp4(id, onProgress));
      setTransfer({ kind: 'idle' });
    } catch (e) {
      fail(e);
    }
  };

  if (!job.data) {
    return (
      <Screen testID="ready-screen">
        {job.isError ? (
          <>
            <Text variant="error">{tc('error')}</Text>
            <Button testID="ready-reload" variant="secondary" label={tc('retry')} onPress={() => void job.refetch()} />
          </>
        ) : (
          <ActivityIndicator testID="ready-loading" />
        )}
      </Screen>
    );
  }

  const data: JobDetail = job.data;
  if (data.status !== 'complete') {
    return (
      <Screen testID="ready-screen">
        <Text variant="title">{data.title}</Text>
        <Text variant="muted" testID="ready-not-ready">
          {t('notReady')}
        </Text>
      </Screen>
    );
  }

  const ytId = data.state_data?.youtube_url ? youtubeId(data.state_data.youtube_url) : null;
  const signed = signedMp4Url(data);
  const playUri = signed ?? local?.uri ?? null;

  return (
    <Screen testID="ready-screen" scroll>
      {ytId ? (
        <YouTubeBlock id={ytId} title={youtubeTitle(data)} />
      ) : job.isPlaceholderData ? (
        <ActivityIndicator testID="ready-loading" />
      ) : playUri ? (
        <Player uri={playUri} />
      ) : (
        <Pressable
          testID="ready-play"
          accessibilityRole="button"
          accessibilityLabel={t('play')}
          disabled={busy}
          onPress={() => void onPlay()}
          className="aspect-video items-center justify-center rounded-lg border border-border bg-card"
        >
          {busy ? <ActivityIndicator /> : <Text className="font-semibold">{t('play')}</Text>}
        </Pressable>
      )}

      {!ytId ? (
        <Text variant="title" numberOfLines={2}>
          {data.title}
        </Text>
      ) : null}

      <Button testID="ready-download" variant="secondary" label={t('downloadMp4')} disabled={busy} onPress={() => void onDownload()} />
      <TransferStatus transfer={transfer} />
    </Screen>
  );
}

function YouTubeBlock({ id, title }: { id: string; title: string }) {
  const t = useTranslations('ready');
  const url = youtubeShortUrl(id);
  // Counts taps, so copying again restarts the toast's timer.
  const [copied, setCopied] = useState(0);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(0), copiedToast.ms);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = async () => {
    await Clipboard.setStringAsync(url);
    setCopied((n) => n + 1);
  };

  // Android shares only `message`; iOS shares `url` alongside it, so the link goes in once.
  const onShare = () =>
    void Share.share({ url, message: Platform.OS === 'ios' ? title : `${title}\n${url}` }).catch(() => {});

  return (
    <View testID="ready-youtube" className="gap-3">
      <Pressable
        testID="ready-youtube-open"
        accessibilityRole="link"
        accessibilityLabel={t('openInYouTube')}
        onPress={() => void openYouTube(id)}
        className="gap-2"
      >
        <Image
          testID="ready-youtube-thumbnail"
          source={{ uri: youtubeThumbnail(id) }}
          accessibilityIgnoresInvertColors
          style={{ width: '100%', aspectRatio: 16 / 9 }}
          className="rounded-lg bg-card"
        />
        <Text testID="ready-youtube-title" numberOfLines={2} className="text-lg font-bold">
          {title}
        </Text>
      </Pressable>
      <View className="flex-row">
        <Text testID="ready-youtube-link" selectable style={{ flexShrink: 1 }} className="text-2xl font-semibold text-primary">
          {`youtu.be/${id}`}
        </Text>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button testID="ready-copy" label={t('copyLink')} onPress={() => void onCopy()} />
        </View>
        <View className="flex-1">
          <Button testID="ready-share" variant="secondary" label={t('share')} onPress={onShare} />
        </View>
      </View>
      {copied > 0 ? (
        <Text testID="ready-copied" accessibilityLiveRegion="polite" className="self-center rounded-full bg-card px-4 py-1">
          {t('copied')}
        </Text>
      ) : null}
    </View>
  );
}

function Player({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      testID="ready-player"
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: '100%', aspectRatio: 16 / 9 }}
    />
  );
}

function TransferStatus({ transfer }: { transfer: Transfer }) {
  const t = useTranslations('ready');
  switch (transfer.kind) {
    case 'busy':
      return (
        <Text testID="ready-progress" variant="muted" accessibilityLiveRegion="polite">
          {transfer.progress === null
            ? t('downloadingNoSize')
            : t('downloading', { percent: Math.round(transfer.progress * 100) })}
        </Text>
      );
    case 'saved':
      return (
        <Text testID="ready-saved" accessibilityLiveRegion="polite" className="font-semibold text-success">
          {Platform.OS === 'android' ? t('savedGallery') : t('saved')}
        </Text>
      );
    case 'denied':
      return (
        <View testID="ready-denied" className="gap-2">
          <Text variant="muted">{t('permissionDenied')}</Text>
          <Button testID="ready-open-settings" variant="secondary" label={t('openSettings')} onPress={() => void Linking.openSettings()} />
        </View>
      );
    case 'archived':
      return (
        <Text testID="ready-archived" variant="muted">
          {t('archived')}
        </Text>
      );
    case 'failed':
      return (
        <Text testID="ready-download-failed" variant="error">
          {t('downloadFailed')}
        </Text>
      );
    default:
      return null;
  }
}
