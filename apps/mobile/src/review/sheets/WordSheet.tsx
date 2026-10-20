import { useTranslations } from '@nomad/i18n';
import {
  deleteWord,
  editWordText,
  mergeWords,
  revertAiSpan,
  setWordTiming,
  type LyricsSegment,
  type ReviewDoc,
  type Word,
} from '@nomad/review-core';
import { Button, Sheet, TextField } from '@nomad/ui';
import { useContext, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ReviewStoreContext, useReviewStore } from '../store';
import {
  formatPrecise,
  isTimedWord,
  r3,
  replaySpan,
  StepRow,
  UntimedNotice,
  WORD_STEP_S,
  type SheetPlayer,
} from './TimingControls';

export type WordSheetProps = {
  segment: number;
  word: number;
  player: SheetPlayer;
  onClose: () => void;
  /** "Re-sync" for an untimed word: the screen opens Tap To Sync on the line. */
  onResyncRequested: (segment: number) => void;
};

/** The AI span's original transcription: `original_text` sits on the span's first word only. */
function aiOriginal(seg: LyricsSegment, w: Word): string | undefined {
  if (!w.correction_span_id) return w.original_text;
  return seg.words.find((x) => x.correction_span_id === w.correction_span_id && x.original_text !== undefined)?.original_text;
}

/** Word sheet (spec §4.3): fix the text, delete or merge, step its start/end, revert an AI change. */
export function WordSheet({ segment: s, word: wi, player, onClose, onResyncRequested }: WordSheetProps) {
  const t = useTranslations('review');
  const seg = useReviewStore((st) => st.doc.segments[s]);
  const word = seg?.words[wi];

  // The word went away (deleted, merged into its neighbour's line…): nothing left to edit.
  useEffect(() => {
    if (!word) onClose();
  }, [word, onClose]);
  if (!seg || !word) return null;

  return (
    <Sheet visible onClose={onClose} title={t('wordSheet.title')} testID="review-word-sheet" closeLabel={t('close')}>
      {/* Keyed on the word's text so a merge (which changes it) refreshes the field. */}
      <WordBody
        key={`${word.id}|${word.text}`}
        s={s}
        wi={wi}
        seg={seg}
        word={word}
        player={player}
        onClose={onClose}
        onResyncRequested={onResyncRequested}
      />
    </Sheet>
  );
}

type BodyProps = { s: number; wi: number; seg: LyricsSegment; word: Word } & Pick<
  WordSheetProps,
  'player' | 'onClose' | 'onResyncRequested'
>;

function WordBody({ s, wi, seg, word, player, onClose, onResyncRequested }: BodyProps) {
  const t = useTranslations('review');
  const store = useContext(ReviewStoreContext)!;
  const apply = useReviewStore((st) => st.apply);
  const doc = useReviewStore((st) => st.doc);
  const [text, setText] = useState(word.text);

  const audioDuration = player.duration > 0 ? player.duration : undefined;
  const timingOp =
    (edge: 'start' | 'end', delta: number) =>
    (d: ReviewDoc): ReviewDoc => {
      const x = d.segments[s]?.words[wi];
      const v = edge === 'start' ? x?.start_time : x?.end_time;
      if (!x || v === null || v === undefined || !isTimedWord(x)) return d;
      return setWordTiming(d, s, wi, { [edge]: r3(v + delta), audioDuration });
    };
  const replay = () => {
    const x = store.getState().doc.segments[s]?.words[wi];
    if (x) replaySpan(player, x.start_time, x.end_time);
  };

  const save = () => {
    // Unchanged text is not an edit (no undo entry).
    if (text.trim() !== word.text) apply((d) => editWordText(d, s, wi, text));
    onClose();
  };
  const remove = () => {
    apply((d) => deleteWord(d, s, wi));
    onClose();
  };
  const hasNext = wi + 1 < seg.words.length;
  const merge = () => apply((d) => mergeWords(d, s, wi));

  const spanId = word.ai_corrected ? word.correction_span_id : undefined;
  const original = word.ai_corrected ? aiOriginal(seg, word) : undefined;
  const canRevert = spanId !== undefined && revertAiSpan(doc, spanId) !== doc;
  const revert = () => {
    if (spanId === undefined) return;
    apply((d) => revertAiSpan(d, spanId));
    onClose();
  };

  return (
    <View className="gap-4">
      <View className="gap-2">
        <TextField
          testID="review-word-input"
          label={t('wordSheet.input')}
          value={text}
          onChangeText={setText}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={save}
        />
        <Text className="text-xs text-muted">{t('wordSheet.inputHint')}</Text>
        <Button testID="review-word-save" label={t('wordSheet.save')} onPress={save} />
      </View>

      {word.ai_corrected ? (
        <View className="flex-row items-center gap-2 rounded-xl bg-purple/25 ps-3">
          <Text className="flex-1 text-sm text-text">
            {original !== undefined ? t('wordSheet.aiFrom', { original }) : t('wordSheet.aiChanged')}
          </Text>
          <View className="w-28">
            <Button
              testID="review-word-revert-ai"
              variant="secondary"
              label={t('wordSheet.revert')}
              disabled={!canRevert}
              onPress={revert}
            />
          </View>
        </View>
      ) : null}

      {isTimedWord(word) ? (
        <View className="gap-2">
          <StepRow
            label={t('timing.start', { time: formatPrecise(word.start_time as number) })}
            minus={{ testID: 'review-word-start-minus', label: t('timing.startEarlier'), op: timingOp('start', -WORD_STEP_S), replay }}
            plus={{ testID: 'review-word-start-plus', label: t('timing.startLater'), op: timingOp('start', WORD_STEP_S), replay }}
          />
          <StepRow
            label={t('timing.end', { time: formatPrecise(word.end_time as number) })}
            minus={{ testID: 'review-word-end-minus', label: t('timing.endEarlier'), op: timingOp('end', -WORD_STEP_S), replay }}
            plus={{ testID: 'review-word-end-plus', label: t('timing.endLater'), op: timingOp('end', WORD_STEP_S), replay }}
          />
        </View>
      ) : (
        <UntimedNotice testID="review-word-resync" onResync={() => onResyncRequested(s)} />
      )}

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button testID="review-word-delete" variant="secondary" label={t('wordSheet.delete')} onPress={remove} />
        </View>
        <View className="flex-1">
          <Button
            testID="review-word-merge"
            variant="secondary"
            label={t('wordSheet.merge')}
            disabled={!hasNext}
            onPress={merge}
          />
        </View>
      </View>
    </View>
  );
}
