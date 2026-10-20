import { useTranslations } from '@nomad/i18n';
import { applyLineText, insertGapText, insertLineEstimated } from '@nomad/review-core';
import { Button, colors, Sheet, StartText } from '@nomad/ui';
import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import type { TextRequest } from '../lyrics/LyricsStep';
import { useReviewStore } from '../store';

/** Edit an existing line's text, or type a new line (insert after a line / fill a vocal gap). */
export type EditLineTarget = { kind: 'edit'; segment: number } | TextRequest;

export type EditLineSheetProps = {
  target: EditLineTarget;
  onClose: () => void;
  /**
   * "Re-sync now?": the screen opens Tap To Sync on that line, with "keep going into the next
   * lines" on when several lines were typed at once.
   */
  onResyncRequested: (segment: number, opts?: { keepGoing: boolean }) => void;
  /** The audio's length when known: a line typed after the last one never runs past it. */
  audioDuration?: number;
};

/** After a save that guessed timing: which line, how many words, and whether they got any timing at all. */
type Guessed = { segment: number; count: number; timed: boolean; keepGoing?: boolean };

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * The field takes focus once the sheet has slid up. autoFocus inside an RN Modal put the cursor in the field
 * on Android without raising the keyboard (iOS raised it).
 */
export const FOCUS_DELAY_MS = 350;

/**
 * Edit text sheet (spec §4.3). Saving an edit keeps matched words' timings (`applyLineText`); new
 * words get estimated timing and the sheet offers "Re-sync now?". The same sheet types new lines
 * (Ruling K: no wordless lines, so Save stays disabled until there is a word).
 */
export function EditLineSheet({ target, onClose, onResyncRequested, audioDuration }: EditLineSheetProps) {
  const t = useTranslations('review');
  const apply = useReviewStore((s) => s.apply);
  const editSeg = useReviewStore((s) => (target.kind === 'edit' ? s.doc.segments[target.segment] : undefined));
  const [text, setText] = useState(() => editSeg?.text ?? '');
  const [guessed, setGuessed] = useState<Guessed | null>(null);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  const gone = target.kind === 'edit' && !editSeg && !guessed;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (gone) return null;

  const typed = words(text);
  const canSave = typed.length > 0;

  const save = () => {
    if (!canSave) return;
    // Filled in by the op (apply runs it synchronously).
    const out: { result: Guessed | null } = { result: null };
    if (target.kind === 'edit') {
      const s = target.segment;
      // Unchanged text is not an edit (no undo entry).
      if (editSeg && typed.join(' ') === words(editSeg.text).join(' ')) return onClose();
      apply((d) => {
        const r = applyLineText(d, s, text);
        out.result = r.estimated > 0 ? { segment: s, count: r.estimated, timed: true } : null;
        return r.doc;
      });
    } else if (target.kind === 'insertAfter') {
      apply((d) => {
        const r = insertLineEstimated(d, target.segment, text, audioDuration);
        out.result = r.insertedAt >= 0 ? { segment: r.insertedAt, count: typed.length, timed: r.timed } : null;
        return r.doc;
      });
    } else {
      apply((d) => {
        const r = insertGapText(d, target.gap, text);
        const lines = text.split(/\r?\n/).filter((l) => words(l).length > 0).length;
        out.result =
          r.insertedAt >= 0 ? { segment: r.insertedAt, count: typed.length, timed: true, keepGoing: lines > 1 } : null;
        return r.doc;
      });
    }
    if (out.result) setGuessed(out.result);
    else onClose();
  };

  const title = target.kind === 'edit' ? t('lineSheet.editTitle') : t('lineSheet.newTitle');

  return (
    <Sheet visible onClose={onClose} title={title} testID="review-line-sheet" closeLabel={t('close')}>
      {guessed ? (
        <View className="gap-3">
          <StartText className="text-base text-text">
            {guessed.timed
              ? t('lineSheet.guessed', { count: guessed.count })
              : t('lineSheet.needsTiming', { count: guessed.count })}
          </StartText>
          <Button
            testID="review-line-resync-now"
            label={t('lineSheet.resyncNow')}
            onPress={() =>
              guessed.keepGoing ? onResyncRequested(guessed.segment, { keepGoing: true }) : onResyncRequested(guessed.segment)
            }
          />
          <Button testID="review-line-done" variant="secondary" label={t('lineSheet.done')} onPress={onClose} />
        </View>
      ) : (
        <View className="gap-3">
          <TextInput
            ref={input}
            testID="review-line-input"
            accessibilityLabel={t('lineSheet.input')}
            placeholder={t('lineSheet.placeholder')}
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            multiline
            autoCorrect={false}
            className="min-h-24 rounded-lg border border-border bg-bg px-3 py-3 text-base text-text"
            style={{ textAlignVertical: 'top' }}
          />
          <Button testID="review-line-save" label={t('lineSheet.save')} disabled={!canSave} onPress={save} />
        </View>
      )}
    </Sheet>
  );
}
