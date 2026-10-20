import { formatClock } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import type { OpenVocalGap } from '@nomad/review-core';
import { StartText } from '@nomad/ui';
import { Pressable, View } from 'react-native';

type Props = {
  /** Position among the open gaps (testIDs). */
  k: number;
  open: OpenVocalGap;
  onPlay: (k: number) => void;
  onInsert: (k: number) => void;
  /** Words already sit in the gap untimed: sync them instead of inserting again. */
  onSync: (k: number) => void;
};

const button = 'min-h-11 justify-center rounded-lg border border-orange/60 px-3';

/** "Possible missing lyrics · 0:42–0:51" between lines, with Play and Insert line(s) (or Sync timing). */
export function GapCallout({ k, open, onPlay, onInsert, onSync }: Props) {
  const t = useTranslations('review.gap');
  // One left-to-right isolate around "from–to" (every locale keeps the two adjacent): times read left to right
  // in every language, as in the player, and Android RTL otherwise showed the range as "0:29–0:28".
  const title = t('title', { from: `\u2066${formatClock(open.gap.start)}`, to: `${formatClock(open.gap.end)}\u2069` });
  return (
    <View className="mx-3 my-1 gap-2 rounded-xl border border-dashed border-orange bg-orange/10 p-3">
      <StartText className="text-sm font-semibold text-orange">{title}</StartText>
      <View className="flex-row gap-2">
        <Pressable testID={`review-gap-${k}-play`} accessibilityRole="button" accessibilityLabel={t('play')} onPress={() => onPlay(k)} className={button}>
          <StartText className="text-sm text-text">{t('play')}</StartText>
        </Pressable>
        {open.pending ? (
          <Pressable testID={`review-gap-${k}-sync`} accessibilityRole="button" accessibilityLabel={t('sync')} onPress={() => onSync(k)} className={button}>
            <StartText className="text-sm text-text">{t('sync')}</StartText>
          </Pressable>
        ) : (
          <Pressable testID={`review-gap-${k}-insert`} accessibilityRole="button" accessibilityLabel={t('insert')} onPress={() => onInsert(k)} className={button}>
            <StartText className="text-sm text-text">{t('insert')}</StartText>
          </Pressable>
        )}
      </View>
    </View>
  );
}
