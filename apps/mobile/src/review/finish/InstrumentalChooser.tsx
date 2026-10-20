import { Ionicons } from '@expo/vector-icons';
import { formatClock } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { recommendInstrumental, type InstrumentalChoice, type InstrumentalOption } from '@nomad/review-core';
import { colors } from '@nomad/ui';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useAbPlayers, type AbPlayers } from '../audio/useAbPlayers';
import { useReviewStore } from '../store';
import type { StemsState } from '../useStemsPoll';
import { BackingStrip } from './BackingStrip';
import type { SubmitSelection } from './useSubmitReview';

const CHOICES: readonly InstrumentalChoice[] = ['clean', 'with_backing'];
const NO_OPTIONS: InstrumentalOption[] = [];
const LABEL = { clean: 'clean', with_backing: 'withBacking' } as const;
const ERROR_KEY = { load_failed: 'loadFailed', play_failed: 'playFailed' } as const;

export type Stems = StemsState & { ready: boolean };

/**
 * The instrumental the singer ends up with: their pick, else the recommendation. `submit` is what gen
 * gets: `auto` only when the backing verdict is confident and the singer didn't change it.
 */
export function useInstrumentalChoice(stems: Stems): {
  chosen: InstrumentalChoice;
  recommended: InstrumentalChoice;
  confident: boolean;
  touched: boolean;
  submit: SubmitSelection;
} {
  const selection = useReviewStore((s) => s.selection);
  const touched = useReviewStore((s) => s.selectionTouched);
  const rec = recommendInstrumental({ auto_approval: stems.autoApproval, backing_vocals_analysis: stems.analysis });
  const chosen = selection ?? rec.choice;
  return {
    chosen,
    recommended: rec.choice,
    confident: rec.confident,
    touched,
    submit: rec.confident && !touched ? 'auto' : chosen,
  };
}

type Props = { jobId: string; stems: Stems };

/**
 * Instrumental chooser (spec §4.4): Clean / With backing vocals cards with the recommendation
 * preselected (badged only when confident), A/B listening on one shared playhead (switching keeps the
 * position), the backing-vocals strip, and the help line. A confident, untouched verdict collapses to
 * one line with Change. While the stems separate, a spinner stands in for the cards.
 */
export function InstrumentalChooser({ jobId, stems }: Props) {
  const t = useTranslations('review.instrumental');
  const tp = useTranslations('review.player');
  const setSelection = useReviewStore((s) => s.setSelection);
  const choice = useInstrumentalChoice(stems);
  const [expanded, setExpanded] = useState(false);
  const ab = useAbPlayers(jobId, stems.ready ? stems.options : NO_OPTIONS);

  if (!stems.ready) {
    return (
      <View testID="review-stems-pending" className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4">
        <ActivityIndicator color={colors.primary} />
        <Text className="flex-1 text-sm text-text">{t('separating')}</Text>
      </View>
    );
  }

  const showCards = expanded || !choice.confident || choice.touched;
  if (!showCards) {
    return (
      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card ps-4">
        <Text testID="review-choice-summary" className="flex-1 text-base text-text">
          {t('summaryConfident', { choice: t(LABEL[choice.chosen]) })}
        </Text>
        <Pressable
          testID="review-choice-change"
          accessibilityRole="button"
          accessibilityLabel={t('changeA11y')}
          onPress={() => setExpanded(true)}
          className="min-h-12 justify-center px-4"
        >
          <Text className="text-base font-semibold text-primary">{t('change')}</Text>
        </Pressable>
      </View>
    );
  }

  const select = (c: InstrumentalChoice) => {
    setSelection(c);
    // While listening, picking a card also switches what you hear (same position).
    if (ab.playing) ab.setActive(c);
  };
  const playChoice = (c: InstrumentalChoice) => {
    if (ab.playing && ab.active === c) return ab.pause();
    ab.setActive(c);
    if (!ab.playing) ab.play();
  };
  const audition = (at: number) => {
    setSelection('with_backing');
    ab.setActive('with_backing');
    void ab.seekTo(at).then(() => ab.play());
  };

  return (
    <View className="gap-3">
      <Text className="text-sm text-muted">{choice.confident ? t('title') : t('listen')}</Text>
      {CHOICES.map((c) => (
        <ChoiceCard
          key={c}
          choice={c}
          selected={choice.chosen === c}
          recommended={choice.confident && choice.recommended === c}
          playing={ab.playing && ab.active === c}
          loading={ab.loading}
          onSelect={() => select(c)}
          onPlay={() => playChoice(c)}
        />
      ))}
      <AbScrub ab={ab} label={t('scrub')} />
      <BackingStrip jobId={jobId} analysis={stems.analysis} position={ab.position} onAudition={audition} />
      {ab.error ? (
        <Text testID="review-ab-error" className="text-sm text-danger" accessibilityLiveRegion="polite">
          {tp(ERROR_KEY[ab.error])}
        </Text>
      ) : null}
      <Text className="text-sm text-muted">{t('help')}</Text>
    </View>
  );
}

type CardProps = {
  choice: InstrumentalChoice;
  selected: boolean;
  recommended: boolean;
  playing: boolean;
  loading: boolean;
  onSelect: () => void;
  onPlay: () => void;
};

function ChoiceCard({ choice, selected, recommended, playing, loading, onSelect, onPlay }: CardProps) {
  const t = useTranslations('review.instrumental');
  const name = t(LABEL[choice]);
  return (
    <View className={`flex-row items-center rounded-xl border-2 bg-card ${selected ? 'border-primary' : 'border-border'}`}>
      <Pressable
        testID={`review-choice-${choice}`}
        accessibilityRole="radio"
        accessibilityLabel={name}
        accessibilityState={{ selected, checked: selected }}
        onPress={onSelect}
        className="min-h-16 flex-1 justify-center gap-1 py-3 ps-4"
      >
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-base font-bold text-text">{name}</Text>
          {recommended ? (
            <Text testID={`review-choice-${choice}-recommended`} className="overflow-hidden rounded-full bg-success/15 px-2 py-0.5 text-xs font-bold text-success">
              {t('recommended')}
            </Text>
          ) : null}
        </View>
        <Text className="text-sm text-muted">{t(`${LABEL[choice]}Body`)}</Text>
      </Pressable>
      <Pressable
        testID={`review-choice-play-${choice}`}
        accessibilityRole="button"
        accessibilityLabel={playing ? t('pauseA11y', { choice: name }) : t('playA11y', { choice: name })}
        accessibilityState={{ disabled: loading, busy: loading }}
        disabled={loading}
        onPress={onPlay}
        className="min-h-16 min-w-16 items-center justify-center"
      >
        {loading ? <ActivityIndicator color={colors.muted} /> : <Ionicons name={playing ? 'pause-circle' : 'play-circle'} size={40} color={colors.primary} />}
      </Pressable>
    </View>
  );
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const A11Y_STEP = 0.05;

/** The shared A/B playhead: tap to seek both stems (they stay in lockstep). Plain responder, no gesture handler. */
function AbScrub({ ab, label }: { ab: AbPlayers; label: string }) {
  const tp = useTranslations('review.player');
  const [width, setWidth] = useState(0);
  const progress = ab.duration > 0 ? clamp01(ab.position / ab.duration) : 0;
  const seekFraction = (f: number) => {
    if (ab.duration > 0) void ab.seekTo(clamp01(f) * ab.duration);
  };
  return (
    <View className="gap-1">
      <Pressable
        testID="review-ab-scrub"
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => seekFraction(progress + (e.nativeEvent.actionName === 'increment' ? A11Y_STEP : -A11Y_STEP))}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (width > 0) seekFraction(e.nativeEvent.locationX / width);
        }}
        className="h-11 justify-center"
      >
        <View className="h-1.5 overflow-hidden rounded-full bg-border" pointerEvents="none">
          <View className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </View>
      </Pressable>
      <Text className="text-xs text-muted" style={{ fontVariant: ['tabular-nums'] }}>
        {tp('time', { position: formatClock(ab.position), duration: formatClock(ab.duration) })}
      </Text>
    </View>
  );
}
