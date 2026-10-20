import { LOCALE_NAMES, useTranslations, type Locale } from '@nomad/i18n';
import { Button, NomadLoader, StartText } from '@nomad/ui';
import { createAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { LOCKSTEP_INTERVAL_MS, lockstepCheck } from '../audio/lockstep';
import { safePlay } from '../audio/playback';
import { useAudioFocus } from './audioFocus';
import { usePreview } from './usePreview';

/** The player takes at most this share of the screen height, so the choice and "Make my video" stay in view. */
export const PREVIEW_MAX_HEIGHT = 0.4;

type Props = {
  jobId: string;
  /** Playable URL of the chosen instrumental stem; without one there is no Instrumental toggle. */
  stemUri: string | null;
  /** The job's `translation_language` (translations are added after review). */
  translationLanguage?: string | null;
  onBackToLyrics: () => void;
  /** The video just became ready (the step scrolls it into view). */
  onReady?: () => void;
};

/**
 * Optional preview video (spec §4.5). Starts on request; a cached or synchronous render is ready at
 * once, otherwise it shows progress (and the cold-server copy after 30 s). A 422 sends the singer back
 * to Lyrics. The video is a black-background sync check; its audio is the full song, and the
 * Instrumental toggle mutes it and plays the chosen stem alongside instead.
 */
export function PreviewPanel({ jobId, stemUri, translationLanguage, onBackToLyrics, onReady }: Props) {
  const t = useTranslations('review.preview');
  const preview = usePreview(jobId);
  const isReady = preview.state === 'ready';
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    if (isReady) onReadyRef.current?.();
  }, [isReady]);
  const language = translationLanguage ? (LOCALE_NAMES[translationLanguage as Locale] ?? translationLanguage) : null;

  return (
    <View className="gap-2">
      {preview.state === 'idle' ? (
        <Button testID="review-preview-start" variant="secondary" label={t('start')} onPress={preview.start} />
      ) : null}
      {preview.state === 'generating' || preview.state === 'slow' ? (
        <View testID="review-preview-generating" className="gap-3 rounded-xl border border-border bg-card p-4">
          <NomadLoader
            testID="review-preview-generating-loader"
            height={28}
            accessibilityLabel={preview.state === 'slow' ? t('slow') : t('generating')}
          />
          <StartText className="text-sm text-text" accessibilityLiveRegion="polite">
            {preview.state === 'slow' ? t('slow') : t('generating')}
          </StartText>
        </View>
      ) : null}
      {preview.state === 'error' ? (
        <View className="gap-2">
          <StartText testID="review-preview-error" className="text-sm text-danger">
            {t('error')}
          </StartText>
          <Button testID="review-preview-retry" variant="secondary" label={t('retry')} onPress={preview.start} />
        </View>
      ) : null}
      {preview.state === 'untimed' ? (
        <View className="gap-2">
          <StartText testID="review-preview-untimed" className="text-sm text-text">
            {t('untimed')}
          </StartText>
          <Button testID="review-preview-back" variant="secondary" label={t('backToLyrics')} onPress={onBackToLyrics} />
        </View>
      ) : null}
      {preview.state === 'ready' && preview.uri ? <PreviewPlayer uri={preview.uri} stemUri={stemUri} /> : null}
      {preview.state !== 'idle' ? (
        <StartText className="text-xs text-muted">
          {language ? `${t('note')} ${t('translationNote', { language })}` : t('note')}
        </StartText>
      ) : null}
    </View>
  );
}

// Native player properties are written outside the component body (the compiler lint treats hook values as immutable).
const setVideoMuted = (player: VideoPlayer, muted: boolean): void => {
  player.muted = muted;
};

type Audio = 'song' | 'instrumental';

function PreviewPlayer({ uri, stemUri }: { uri: string; stemUri: string | null }) {
  const t = useTranslations('review.preview');
  const { height } = useWindowDimensions();
  const [audio, setAudio] = useState<Audio>('song');
  const video = useVideoPlayer(uri, (p) => {
    // The instrumental stem plays alongside the muted video: don't let the video take the audio session.
    p.audioMixingMode = 'mixWithOthers';
  });
  const instrumental = audio === 'instrumental' && !!stemUri;
  const [videoPlaying, setVideoPlaying] = useState(false);
  useEffect(() => {
    const sub = video.addListener('playingChange', (e) => setVideoPlaying(!!e?.isPlaying));
    return () => sub.remove();
  }, [video]);
  // The preview and the A/B stems never play over each other.
  useAudioFocus('preview', videoPlaying, () => video.pause());

  // Instrumental: the video goes muted and the stem follows it (play/pause, and a lockstep watchdog).
  useEffect(() => {
    if (!instrumental || !stemUri) return;
    const stem = createAudioPlayer({ uri: stemUri });
    const follow = () => {
      try {
        void Promise.resolve(stem.seekTo(video.currentTime)).catch(() => undefined);
        if (video.playing) safePlay(stem, () => undefined);
        else stem.pause();
      } catch {
        /* a player already released */
      }
    };
    setVideoMuted(video, true);
    follow();
    const sub = video.addListener('playingChange', follow);
    const watchdog = setInterval(() => {
      try {
        const target = lockstepCheck(video.currentTime, stem.currentTime);
        if (target !== null) void Promise.resolve(stem.seekTo(target)).catch(() => undefined);
      } catch {
        /* a player already released */
      }
    }, LOCKSTEP_INTERVAL_MS);
    return () => {
      clearInterval(watchdog);
      sub.remove();
      stem.remove();
      try {
        setVideoMuted(video, false);
      } catch {
        /* the video player is gone too */
      }
    };
  }, [instrumental, stemUri, video]);

  return (
    <View className="gap-2">
      <VideoView
        testID="review-preview-player"
        player={video}
        nativeControls
        contentFit="contain"
        style={{ width: '100%', aspectRatio: 16 / 9, maxHeight: height * PREVIEW_MAX_HEIGHT, backgroundColor: '#000' }}
      />
      {stemUri ? (
        <View className="flex-row items-center gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('audio')}>
          <StartText className="text-sm text-muted">{t('audio')}</StartText>
          {(['song', 'instrumental'] as const).map((a) => (
            <Pressable
              key={a}
              testID={`review-preview-audio-${a}`}
              accessibilityRole="radio"
              accessibilityLabel={t(a)}
              accessibilityState={{ selected: audio === a, checked: audio === a }}
              onPress={() => setAudio(a)}
              className={`min-h-11 justify-center rounded-full border px-4 ${audio === a ? 'border-primary' : 'border-border'}`}
            >
              <StartText className={`text-sm font-semibold ${audio === a ? 'text-primary' : 'text-text'}`}>{t(a)}</StartText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
