import { formatClock } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { lineDirection, type LyricsSegment, type SingerId, type Word } from '@nomad/review-core';
import { memo } from 'react';
import { StartText } from '@nomad/ui';
import { I18nManager, Pressable, View } from 'react-native';

import { LineToolbar, type LineTool } from './LineToolbar';
import { WordPill, wordMarks, type WordFill } from './WordPill';

export type LineRowProps = {
  index: number;
  segment: LyricsSegment;
  /** The line playing now. */
  active: boolean;
  selected: boolean;
  /** Playback position, passed to the active line only (so the other rows stay memoised). */
  time?: number;
  isDuet: boolean;
  isLast: boolean;
  /** Words not matched to reference lyrics (shown orange), when the job has no reference lyrics. */
  gapWordIds?: ReadonlySet<string>;
  onPressLine: (index: number) => void;
  onWordPress: (index: number, word: number) => void;
  onSinger: (index: number) => void;
  onTool: (tool: LineTool, index: number) => void;
};

const SINGER_KEY = { 1: 'singer1', 2: 'singer2', 0: 'singerBoth' } as const;

function fillOf(w: Word, time: number | undefined): WordFill {
  if (time === undefined || w.start_time === null || w.end_time === null) return 'idle';
  if (time >= w.end_time) return 'sung';
  return time >= w.start_time ? 'current' : 'idle';
}

/** One lyric line: start time on the leading edge, wrapped word pills, the singer chip in a duet. */
function LineRowInner({
  index,
  segment,
  active,
  selected,
  time,
  isDuet,
  isLast,
  gapWordIds,
  onPressLine,
  onWordPress,
  onSinger,
  onTool,
}: LineRowProps) {
  const t = useTranslations('review.line');
  const rtl = lineDirection(segment.text) === 'rtl';
  // Direction follows the line's text, not the app locale: flip only when they disagree.
  const flexDirection = rtl !== I18nManager.isRTL ? 'row-reverse' : 'row';
  const start = segment.start_time ?? segment.words.find((w) => w.start_time !== null)?.start_time ?? null;
  const singer: SingerId = segment.singer ?? 1;

  return (
    <Pressable
      testID={`review-line-${index}`}
      accessibilityLabel={t('a11y', { n: index + 1, text: segment.text })}
      accessibilityHint={t('hint')}
      accessibilityState={{ selected }}
      onPress={() => onPressLine(index)}
      className={`mx-3 my-1 rounded-xl px-2 py-2 ${selected ? 'border border-primary bg-card' : active ? 'bg-card' : ''}`}
    >
      <View style={{ flexDirection, alignItems: 'flex-start', gap: 8 }}>
        <StartText className={`mt-2 w-10 text-sm ${active ? 'text-primary' : 'text-muted'}`} style={{ fontVariant: ['tabular-nums'] }}>
          {start === null ? t('untimed') : formatClock(start)}
        </StartText>
        <View testID={`review-line-${index}-words`} style={{ flex: 1, flexDirection, flexWrap: 'wrap', gap: 2 }}>
          {segment.words.map((w, j) => (
            <WordPill
              key={w.id}
              testID={`review-word-${index}-${j}`}
              word={w}
              marks={wordMarks(w, gapWordIds?.has(w.id) ?? false)}
              fill={active ? fillOf(w, time) : 'idle'}
              rtl={rtl}
              onPress={() => (selected ? onWordPress(index, j) : onPressLine(index))}
            />
          ))}
        </View>
        {isDuet ? (
          <Pressable
            testID={`review-line-${index}-singer`}
            accessibilityRole="button"
            accessibilityLabel={t('singerA11y', { singer: t(SINGER_KEY[singer]) })}
            onPress={() => onSinger(index)}
            hitSlop={8}
            className={`mt-1 min-w-9 items-center rounded-full px-2 py-1 ${singer === 2 ? 'bg-gold' : singer === 0 ? 'bg-purple' : 'bg-primary'}`}
          >
            <StartText className="text-sm font-bold text-primary-fg">{t(SINGER_KEY[singer])}</StartText>
          </Pressable>
        ) : null}
      </View>
      {selected ? (
        <LineToolbar index={index} canSplit={segment.words.length > 1} canMerge={!isLast} onTool={onTool} />
      ) : null}
    </Pressable>
  );
}

export const LineRow = memo(LineRowInner);
