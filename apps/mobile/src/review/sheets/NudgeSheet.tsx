import { useTranslations } from '@nomad/i18n';
import { setWordTiming, shiftLine, type ReviewDoc } from '@nomad/review-core';
import { Sheet, StartText } from '@nomad/ui';
import { useContext, useEffect } from 'react';
import { View } from 'react-native';

import { ReviewStoreContext, useReviewStore } from '../store';
import {
  formatPrecise,
  isTimedWord,
  LINE_STEP_S,
  r3,
  replayLine,
  StepButton,
  StepRow,
  UntimedNotice,
  WORD_STEP_S,
  type SheetPlayer,
} from './TimingControls';

export type NudgeSheetProps = {
  segment: number;
  player: SheetPlayer;
  onClose: () => void;
  /** "Re-sync" for a line with no timing: the screen opens Tap To Sync on it. */
  onResyncRequested: (segment: number) => void;
};

/** Index of the line's first (or last) timed word, or -1. */
function edgeWord(d: ReviewDoc, s: number, edge: 'start' | 'end'): number {
  const ws = d.segments[s]?.words ?? [];
  if (edge === 'start') return ws.findIndex(isTimedWord);
  for (let i = ws.length - 1; i >= 0; i--) if (isTimedWord(ws[i]!)) return i;
  return -1;
}

/**
 * Nudge sheet (spec §4.3): move the whole line by 0.1 s (clamped between its neighbours), or step
 * its start (first timed word) and end (last timed word) by 0.05 s. Every change replays the line.
 */
export function NudgeSheet({ segment: s, player, onClose, onResyncRequested }: NudgeSheetProps) {
  const t = useTranslations('review');
  const store = useContext(ReviewStoreContext)!;
  const seg = useReviewStore((st) => st.doc.segments[s]);

  useEffect(() => {
    if (!seg) onClose();
  }, [seg, onClose]);
  if (!seg) return null;

  const audioDuration = player.duration > 0 ? player.duration : undefined;
  const replay = () => replayLine(player, store.getState().doc.segments[s]);
  const shift = (delta: number) => (d: ReviewDoc) => shiftLine(d, s, delta);
  const edgeOp =
    (edge: 'start' | 'end', delta: number) =>
    (d: ReviewDoc): ReviewDoc => {
      const w = edgeWord(d, s, edge);
      const x = d.segments[s]?.words[w];
      if (!x) return d;
      const v = (edge === 'start' ? x.start_time : x.end_time) as number;
      return setWordTiming(d, s, w, { [edge]: r3(v + delta), audioDuration });
    };

  const timed = seg.start_time !== null && seg.end_time !== null && seg.words.some(isTimedWord);

  return (
    <Sheet visible onClose={onClose} title={t('nudge.title')} testID="review-nudge-sheet" closeLabel={t('close')}>
      {timed ? (
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <StartText className="flex-1 text-base text-text">{t('nudge.line')}</StartText>
            <StepButton
              testID="review-nudge-line-minus"
              label={t('nudge.lineEarlierA11y')}
              text={t('nudge.lineEarlier')}
              op={shift(-LINE_STEP_S)}
              replay={replay}
            />
            <StepButton
              testID="review-nudge-line-plus"
              label={t('nudge.lineLaterA11y')}
              text={t('nudge.lineLater')}
              op={shift(LINE_STEP_S)}
              replay={replay}
            />
          </View>
          <StepRow
            label={t('nudge.start', { time: formatPrecise(seg.start_time as number) })}
            minus={{ testID: 'review-nudge-start-minus', label: t('timing.startEarlier'), op: edgeOp('start', -WORD_STEP_S), replay }}
            plus={{ testID: 'review-nudge-start-plus', label: t('timing.startLater'), op: edgeOp('start', WORD_STEP_S), replay }}
          />
          <StepRow
            label={t('nudge.end', { time: formatPrecise(seg.end_time as number) })}
            minus={{ testID: 'review-nudge-end-minus', label: t('timing.endEarlier'), op: edgeOp('end', -WORD_STEP_S), replay }}
            plus={{ testID: 'review-nudge-end-plus', label: t('timing.endLater'), op: edgeOp('end', WORD_STEP_S), replay }}
          />
        </View>
      ) : (
        <UntimedNotice testID="review-nudge-resync" onResync={() => onResyncRequested(s)} />
      )}
    </Sheet>
  );
}
