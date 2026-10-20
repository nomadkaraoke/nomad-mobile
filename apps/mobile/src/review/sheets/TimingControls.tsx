import { Ionicons } from '@expo/vector-icons';
import { formatClock } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import type { LyricsSegment, ReviewDoc, Word } from '@nomad/review-core';
import { Button, colors } from '@nomad/ui';
import { useContext } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ReviewPlayer } from '../audio/useReviewPlayer';
import { ReviewStoreContext, useReviewStore } from '../store';
import { useRepeatPress } from './useRepeatPress';

/** What the editing sheets need from the review player. */
export type SheetPlayer = Pick<ReviewPlayer, 'playRange' | 'duration'>;

/** Each timing change replays the word (or line) with this much audio either side. */
export const REPLAY_PAD_S = 0.3;
/** Spec: words step 0.05 s, whole lines 0.1 s. */
export const WORD_STEP_S = 0.05;
export const LINE_STEP_S = 0.1;

/** Millisecond rounding, so repeated steps don't drift (0.1 + 0.2 …). */
export const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** "0:42.30": minutes, seconds and hundredths. */
export function formatPrecise(seconds: number): string {
  const s = Math.max(0, seconds);
  const hundredths = Math.floor(Math.round(s * 1000) / 10) % 100;
  return `${formatClock(s)}.${String(hundredths).padStart(2, '0')}`;
}

export const isTimedWord = (w: Word): boolean => w.start_time !== null && w.end_time !== null;

export function replaySpan(player: SheetPlayer, start: number | null, end: number | null) {
  if (start === null || end === null) return;
  player.playRange(Math.max(0, start - REPLAY_PAD_S), end + REPLAY_PAD_S);
}

export function replayLine(player: SheetPlayer, seg: LyricsSegment | undefined) {
  if (seg) replaySpan(player, seg.start_time, seg.end_time);
}

/**
 * A timing step: `op` is applied through the store (one undo entry per step). `enabled` is whether
 * it would change anything now; a no-op step (a clamp) is disabled.
 */
export function useTimingStep(op: (d: ReviewDoc) => ReviewDoc, replay: () => void) {
  const store = useContext(ReviewStoreContext)!;
  const doc = useReviewStore((s) => s.doc);
  const handlers = useRepeatPress(() => {
    const before = store.getState().doc;
    store.getState().apply(op);
    return store.getState().doc !== before;
  }, replay);
  return { handlers, enabled: op(doc) !== doc };
}

type StepButtonProps = {
  testID: string;
  label: string;
  /** Visible text; an icon (−/+) when omitted. */
  text?: string;
  icon?: 'remove' | 'add';
  op: (d: ReviewDoc) => ReviewDoc;
  replay: () => void;
};

/** A step button: tap = one step and a replay; hold = repeat, replay on release. Disabled at a clamp. */
export function StepButton({ testID, label, text, icon, op, replay }: StepButtonProps) {
  const { handlers, enabled } = useTimingStep(op, replay);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      {...handlers}
      className={`min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-bg px-3 ${enabled ? '' : 'opacity-40'}`}
    >
      {text !== undefined ? (
        <Text className="text-base font-semibold text-text">{text}</Text>
      ) : (
        <Ionicons name={icon ?? 'add'} size={20} color={colors.text} />
      )}
    </Pressable>
  );
}

/** "Start 0:42.30 [−] [+]". */
export function StepRow({ label, minus, plus }: { label: string; minus: StepButtonProps; plus: StepButtonProps }) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="flex-1 text-base text-text">{label}</Text>
      <StepButton icon="remove" {...minus} />
      <StepButton icon="add" {...plus} />
    </View>
  );
}

/** Shown instead of the timing steps when there is nothing timed to step. */
export function UntimedNotice({ testID, onResync }: { testID: string; onResync: () => void }) {
  const t = useTranslations('review.timing');
  return (
    <View className="gap-2">
      <Text className="text-base text-danger">{t('untimed')}</Text>
      <Button testID={testID} variant="secondary" label={t('resync')} onPress={onResync} />
    </View>
  );
}
