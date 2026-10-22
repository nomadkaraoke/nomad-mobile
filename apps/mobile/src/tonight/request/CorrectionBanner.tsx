import type { ArtistTitle } from '@nomad/api-kjbox';
import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { ActivityIndicator, Pressable, View } from 'react-native';

import type { Correction } from './useKjboxSearch';

export type CorrectionBannerProps = {
  resolving: boolean;
  correction: Correction | null;
  undone: boolean;
  onUndo: () => void;
  onRedo: () => void;
  alternatives: ArtistTitle[];
  onAlternative: (alt: ArtistTitle) => void;
};

/**
 * Auto-correct (A.29, only after an empty search): "Checking the spelling…", then "✓ Corrected to X — you typed …"
 * with Undo (and back), or "Did you mean…?" chips when it's ambiguous.
 */
export function CorrectionBanner({ resolving, correction, undone, onUndo, onRedo, alternatives, onAlternative }: CorrectionBannerProps) {
  const t = useTranslations('tonight.request');
  if (resolving) {
    return (
      <View testID="tonight-checking-spelling" className="flex-row items-center gap-2 py-1">
        <ActivityIndicator size="small" />
        <Text variant="muted">{t('checkingSpelling')}</Text>
      </View>
    );
  }
  if (correction) {
    const song = t('songByArtist', { title: isolate(correction.corrected.title), artist: isolate(correction.corrected.artist) });
    return (
      <View testID="tonight-correction" className="gap-1 rounded-xl border border-success/40 bg-success/10 p-3">
        <Text testID="tonight-correction-text">
          {undone ? t('usingTyped', { typed: isolate(correction.typed) }) : t('correctedTo', { song, typed: isolate(correction.typed) })}
        </Text>
        <Pressable
          testID={undone ? 'tonight-correction-redo' : 'tonight-correction-undo'}
          accessibilityRole="button"
          hitSlop={8}
          onPress={undone ? onRedo : onUndo}
        >
          <Text className="text-sm font-semibold text-primary">{undone ? t('useCorrection') : t('undo')}</Text>
        </Pressable>
      </View>
    );
  }
  if (alternatives.length === 0) return null;
  return (
    <View testID="tonight-did-you-mean" className="gap-2">
      <Text className="font-semibold">{t('didYouMean')}</Text>
      <View className="flex-row flex-wrap gap-2">
        {alternatives.map((a, i) => (
          <Pressable
            key={`${a.artist}-${a.title}-${i}`}
            testID={`tonight-alternative-${i}`}
            accessibilityRole="button"
            onPress={() => onAlternative(a)}
            className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5"
          >
            <Text className="text-sm">{t('songByArtist', { title: isolate(a.title), artist: isolate(a.artist) })}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
