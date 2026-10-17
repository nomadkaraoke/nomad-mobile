import type { AudioResult } from '@nomad/api-gen';
import { getDisplayName, groupResults, type ConfidenceTier } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import { categoryKey, pickReason, sourceRowText } from './sourceText';

const cardClass = (selected: boolean) =>
  `rounded-xl border bg-card p-3 ${selected ? 'border-primary' : 'border-border'}`;

/** Tier 1/2: gen's pick, with a badge and a plain-language reason (spec §4.4). */
export function PickCard(props: {
  result: AudioResult;
  tier: ConfidenceTier;
  songTitle: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTranslations('make');
  const perfect = props.tier === 1;
  return (
    <Pressable
      testID="make-pick"
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      className={`gap-1 ${cardClass(props.selected)}`}
    >
      <View className="flex-row">
        <Text
          testID="make-pick-badge"
          variant="muted"
          className={`rounded-full px-2 py-0.5 font-bold ${perfect ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'}`}
        >
          {perfect ? t('perfectMatch') : t('recommended')}
        </Text>
      </View>
      <Text className="font-semibold">{[props.songTitle, getDisplayName(props.result)].filter(Boolean).join(' · ')}</Text>
      <Text testID="make-pick-reason" variant="muted">
        {pickReason(props.result, t)}
      </Text>
    </Pressable>
  );
}

/** Every source, in gen's plain-language groups; tap one to choose it. */
export function SourceGroups(props: {
  results: AudioResult[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const t = useTranslations('make');
  return (
    <View className="gap-4">
      {groupResults(props.results).map((group) => (
        <View key={group.category} className="gap-2">
          <Text variant="muted" className="font-semibold uppercase">
            {t(`category.${categoryKey(group.category)}`)}
          </Text>
          {(group.results as AudioResult[]).map((r) => {
            const selected = r.index === props.selectedIndex;
            const text = sourceRowText(r, t);
            return (
              <Pressable
                key={r.index}
                testID={`make-source-${r.index}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => props.onSelect(r.index)}
                className={cardClass(selected)}
              >
                <Text className="font-semibold">{text.title}</Text>
                <Text variant="muted">{text.detail}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
