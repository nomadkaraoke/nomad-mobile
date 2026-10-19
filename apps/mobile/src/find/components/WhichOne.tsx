import type { SongRef } from '@nomad/api-decide';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

/** Chips shown before "More…" (kjbox: max 4). */
export const CHIPS_SHOWN = 4;

export type WhichOneProps = {
  /** "Which song do you mean?" (the matcher) or "Did you mean?" (Gemini). */
  heading: 'whichOne' | 'didYouMean';
  candidates: SongRef[];
  onPick: (index: number) => void;
};

/** Candidate chips for a query the matcher (or Gemini) isn't sure about. */
export function WhichOne({ heading, candidates, onPick }: WhichOneProps) {
  const t = useTranslations('discover');
  const [all, setAll] = useState(false);
  const shown = all ? candidates : candidates.slice(0, CHIPS_SHOWN);
  return (
    <View testID="which-one" className="gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3">
      <Text className="text-xs font-bold uppercase text-primary">{t(heading)}</Text>
      <View className="flex-row flex-wrap gap-2">
        {shown.map((c, i) => (
          <Pressable
            key={`${c.song_key}-${i}`}
            testID={`which-one-chip-${i}`}
            accessibilityRole="button"
            onPress={() => onPick(i)}
            className="rounded-full border border-border bg-card px-3 py-1.5"
          >
            <Text className="text-sm">{isolate(t('songValue', { title: c.title, artist: c.artist }))}</Text>
          </Pressable>
        ))}
        {!all && candidates.length > CHIPS_SHOWN ? (
          <Pressable
            testID="which-one-more"
            accessibilityRole="button"
            onPress={() => setAll(true)}
            className="rounded-full border border-border px-3 py-1.5"
          >
            <Text className="text-sm text-muted">{t('more')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
