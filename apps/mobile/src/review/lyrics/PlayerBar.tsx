import { formatClock } from '@nomad/core';
import { isolateLtr, useTranslations } from '@nomad/i18n';
import { colors, StartText, WaveformCanvas, type WaveformMarker } from '@nomad/ui';
import { ActivityIndicator, Pressable, View } from 'react-native';

import type { ReviewPlayer } from '../audio/useReviewPlayer';
import { IconButton } from '../IconButton';
import type { VocalsPeaks } from './useVocalsPeaks';

const BACK_SECONDS = 5;
const WAVE_HEIGHT = 40;
const ERROR_KEY = { load_failed: 'loadFailed', play_failed: 'playFailed' } as const;

type Props = {
  player: ReviewPlayer;
  peaks: VocalsPeaks;
  /** The vocals stem exists; until then the player plays the song. */
  vocalsReady: boolean;
  /** Vocal gaps and untimed words, as fractions of the song. */
  markers: readonly WaveformMarker[];
};

/** Sticky player: play/pause, back 5 s, the vocals waveform scrubber, Vocals/Song and 1×/0.75×. */
export function PlayerBar({ player, peaks, vocalsReady, markers }: Props) {
  const t = useTranslations('review.player');
  const duration = player.duration > 0 ? player.duration : peaks.duration;
  const progress = duration > 0 ? player.position / duration : 0;
  const vocals = player.source === 'vocals';
  const sourceLabel = !vocalsReady ? t('vocalsSoon') : vocals ? t('vocals') : t('song');

  return (
    <View className="border-t border-border bg-card px-3 pb-1 pt-2">
      {/* Media transport, timeline and time read left to right in every language (not mirrored in RTL). */}
      <View testID="review-player-transport" className="flex-row items-center gap-1" style={{ direction: 'ltr' }}>
        <IconButton
          testID="review-player-play"
          icon={player.playing ? 'pause' : 'play'}
          label={player.playing ? t('pause') : t('play')}
          color={colors.primary}
          size={28}
          onPress={player.toggle}
        />
        <IconButton
          testID="review-player-back5"
          icon="play-back"
          label={t('back5')}
          onPress={() => void player.seekTo(Math.max(0, player.position - BACK_SECONDS))}
        />
        <View className="flex-1">
          <WaveformCanvas
            testID="review-player-scrub"
            peaks={peaks.peaks}
            progress={progress}
            height={WAVE_HEIGHT}
            markers={markers}
            accessibilityLabel={t('scrub')}
            onSeek={(f) => {
              if (duration > 0) void player.seekTo(f * duration);
            }}
          />
          {peaks.status === 'pending' ? (
            <View className="absolute inset-0 flex-row items-center justify-center gap-2" pointerEvents="none">
              <ActivityIndicator size="small" color={colors.muted} />
              <StartText className="text-xs text-muted">{t('waveformLoading')}</StartText>
            </View>
          ) : null}
        </View>
      </View>

      <View testID="review-player-controls" className="flex-row items-center gap-2" style={{ direction: 'ltr' }}>
        <StartText testID="review-player-time" className="flex-1 text-xs text-muted" style={{ fontVariant: ['tabular-nums'] }}>
          {isolateLtr(t('time', { position: formatClock(player.position), duration: formatClock(duration) }))}
        </StartText>
        <Pressable
          testID="review-player-source"
          accessibilityRole="button"
          accessibilityLabel={t('sourceA11y', { source: sourceLabel })}
          accessibilityState={{ disabled: !vocalsReady }}
          disabled={!vocalsReady}
          onPress={() => player.setSource(vocals ? 'song' : 'vocals')}
          className={`min-h-11 justify-center rounded-full border px-3 ${vocals ? 'border-primary' : 'border-border'} ${vocalsReady ? '' : 'opacity-50'}`}
        >
          <StartText className={`text-sm font-semibold ${vocals ? 'text-primary' : 'text-text'}`}>{sourceLabel}</StartText>
        </Pressable>
        <Pressable
          testID="review-player-rate"
          accessibilityRole="button"
          accessibilityLabel={t('rateA11y', { rate: player.rate })}
          onPress={() => player.setRate(player.rate === 1 ? 0.75 : 1)}
          className={`min-h-11 min-w-14 items-center justify-center rounded-full border px-3 ${player.rate === 1 ? 'border-border' : 'border-primary'}`}
        >
          <StartText testID="review-player-rate-label" className={`text-sm font-semibold ${player.rate === 1 ? 'text-text' : 'text-primary'}`}>
            {isolateLtr(t('rate', { rate: player.rate }))}
          </StartText>
        </Pressable>
      </View>

      {player.error ? (
        <StartText testID="review-player-error" className="pb-1 text-sm text-danger" accessibilityLiveRegion="polite">
          {t(ERROR_KEY[player.error])}
        </StartText>
      ) : null}
    </View>
  );
}
