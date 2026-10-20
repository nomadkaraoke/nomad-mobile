import { getWaveformData } from '@nomad/api-gen';
import { useTranslations } from '@nomad/i18n';
import { normalizePeaks, type BackingVocalsAnalysis } from '@nomad/review-core';
import { colors, StartText, WaveformCanvas, type WaveformMarker } from '@nomad/ui';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

/** Bars in the strip (gen downsamples server-side). */
export const STRIP_POINTS = 200;
/** A tap this close (s) to a highlighted region still counts as on it (a fingertip is wide). */
const TAP_TOLERANCE_S = 0.75;
const HEIGHT = 48;

type Props = {
  jobId: string;
  analysis: BackingVocalsAnalysis | null | undefined;
  /** Position (s) of the shared A/B playhead, for the played colour. */
  position: number;
  /** A tap on a highlighted (audible) region: select With backing and audition it from `at` seconds. */
  onAudition: (at: number) => void;
};

/**
 * The backing-vocals stem's waveform (`/waveform-data`) with its audible stretches highlighted.
 * Mount it only once the stems are complete: before that gen falls back to the full mix. Hidden when
 * the analysis found no audible backing vocals (nothing to audition) or the waveform can't be loaded.
 */
export function BackingStrip({ jobId, analysis, position, onAudition }: Props) {
  const t = useTranslations('review.instrumental');
  const [wave, setWave] = useState<{ peaks: number[]; duration: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWaveformData(jobId, STRIP_POINTS)
      .then((r) => {
        // Backing vocals are quiet next to the mix: scale them (as the vocals scrubber does) or they draw flat.
        if (!cancelled) setWave({ peaks: normalizePeaks(r.amplitudes), duration: r.duration });
      })
      .catch(() => undefined); // decoration: the chooser works without it
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const segments = useMemo(() => analysis?.audible_segments ?? [], [analysis]);
  const duration = wave?.duration || analysis?.total_duration_seconds || 0;
  const markers = useMemo<WaveformMarker[]>(
    () =>
      duration > 0
        ? segments.map((s) => ({ from: s.start_seconds / duration, to: s.end_seconds / duration, color: colors.gold }))
        : [],
    [segments, duration],
  );

  if (!wave || segments.length === 0 || duration <= 0) return null;

  return (
    <View className="w-full gap-1 self-stretch">
      <StartText className="text-xs text-muted">{t('stripTitle')}</StartText>
      <WaveformCanvas
        testID="review-backing-strip"
        peaks={wave.peaks}
        progress={position / duration}
        height={HEIGHT}
        markers={markers}
        color={colors.muted}
        playedColor={colors.gold}
        accessibilityLabel={t('stripA11y')}
        onSeek={(f) => {
          const at = f * duration;
          const hit = segments.find((s) => at >= s.start_seconds - TAP_TOLERANCE_S && at <= s.end_seconds + TAP_TOLERANCE_S);
          if (hit) onAudition(Math.max(hit.start_seconds, Math.min(at, hit.end_seconds)));
        }}
      />
    </View>
  );
}
