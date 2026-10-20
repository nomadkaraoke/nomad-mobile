import { useTranslations } from '@nomad/i18n';
import type { Word } from '@nomad/review-core';
import { colors } from '@nomad/ui';
import { Pressable, Text } from 'react-native';

/** Why a word deserves a look; the first one present drives the pill's look and testID suffix. */
export type WordMark = 'untimed' | 'ai' | 'est' | 'gap';

export function wordMarks(word: Word, inGap: boolean): WordMark[] {
  const marks: WordMark[] = [];
  if (word.start_time === null || word.end_time === null) marks.push('untimed');
  if (word.ai_corrected) marks.push('ai');
  if (word.timing_estimated) marks.push('est');
  if (inGap) marks.push('gap');
  return marks;
}

/** Karaoke fill on the playing line: already sung, being sung now, or not yet. */
export type WordFill = 'sung' | 'current' | 'idle';

const MARK_HINT = { untimed: 'untimed', ai: 'ai', est: 'estimated', gap: 'gap' } as const;

type Props = {
  testID: string;
  word: Word;
  marks: readonly WordMark[];
  fill: WordFill;
  rtl: boolean;
  onPress: () => void;
};

/**
 * One word of a line. Purple = changed by AI, amber dashed underline = guessed timing,
 * red outline = no timing, orange = not matched to the reference lyrics.
 */
export function WordPill({ testID, word, marks, fill, rtl, onPress }: Props) {
  const t = useTranslations('review.word');
  const first = marks[0];
  const box =
    fill === 'current'
      ? 'bg-primary'
      : first === 'untimed'
        ? 'border border-danger'
        : first === 'ai'
          ? 'bg-purple/25'
          : 'border border-transparent';
  const color =
    fill === 'current'
      ? 'text-primary-fg'
      : fill === 'sung'
        ? 'text-primary'
        : marks.includes('ai')
          ? 'text-purple'
          : marks.includes('gap')
            ? 'text-orange'
            : 'text-text';
  const estimated = marks.includes('est');
  const hint = [...marks.map((m) => t(MARK_HINT[m])), t('hint')].join('. ');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={word.text}
      accessibilityHint={hint}
      accessibilityState={{ selected: fill === 'current' }}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      className={`rounded-md px-1.5 py-1 ${box}`}
    >
      <Text
        testID={first ? `${testID}-${first}` : undefined}
        className={`text-lg ${color} ${estimated ? 'underline' : ''}`}
        style={[
          { writingDirection: rtl ? 'rtl' : 'ltr' },
          estimated ? { textDecorationStyle: 'dashed', textDecorationColor: colors.gold } : null,
        ]}
      >
        {word.text}
      </Text>
    </Pressable>
  );
}
