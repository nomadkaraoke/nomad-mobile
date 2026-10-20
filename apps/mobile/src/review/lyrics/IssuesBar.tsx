import { useTranslations } from '@nomad/i18n';
import type { Issue } from '@nomad/review-core';
import { colors, StartText } from '@nomad/ui';
import { View } from 'react-native';

import { directionalIcon } from '../directionalIcon';
import { IconButton } from '../IconButton';

type Props = {
  /** In song order (`collectIssues`). */
  issues: readonly Issue[];
  /** Index of the issue last stepped to, or -1 before the first step. */
  cursor: number;
  onStep: (index: number) => void;
};

/** "3 things to check ‹ ›": steps through the issues in song order, wrapping at both ends. Hidden when empty. */
export function IssuesBar({ issues, cursor, onStep }: Props) {
  const t = useTranslations('review.issues');
  const count = issues.length;
  if (count === 0) return null;
  const current = cursor >= 0 && cursor < count ? issues[cursor]! : null;
  const label = current
    ? t('position', { n: cursor + 1, count, kind: t(`kind.${current.kind}`) })
    : t('count', { count });
  const step = (dir: 1 | -1) => {
    if (!current) onStep(dir === 1 ? 0 : count - 1);
    else onStep((cursor + dir + count) % count);
  };

  return (
    <View className="mx-3 mb-1 flex-row items-center rounded-xl border border-gold/40 bg-card ps-3">
      <StartText testID="review-issues-label" className="flex-1 text-sm font-semibold text-gold" numberOfLines={1} accessibilityLiveRegion="polite">
        {label}
      </StartText>
      <IconButton testID="review-issues-prev" icon={directionalIcon('chevron-back')} label={t('prev')} color={colors.gold} onPress={() => step(-1)} />
      <IconButton testID="review-issues-next" icon={directionalIcon('chevron-forward')} label={t('next')} color={colors.gold} onPress={() => step(1)} />
    </View>
  );
}
