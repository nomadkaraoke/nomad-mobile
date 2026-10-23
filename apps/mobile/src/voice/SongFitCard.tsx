import type { VocalTier } from '@nomad/core';
import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { router, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { FitBadge, fitCopy } from './FitBadge';
import { useSongFit } from './useSongFit';

const TIER_KEY: Record<VocalTier, string> = {
  measured: 'tierMeasured',
  notes: 'tierNotes',
  estimated: 'tierEstimated',
  rough: 'tierRough',
};

/**
 * The song page's fit (Phase 3c): the badge plus where the range came from ("Range measured from the recording" …
 * "Rough guess from the artist"), online or from the offline list. With a range but no voice profile on the phone,
 * a link to the voice test. Nothing when there's no range, or the song is outside the singer's range.
 */
export function SongFitCard({ songKey }: { songKey: string }) {
  const t = useTranslations('fit');
  const { range, fit } = useSongFit(songKey);
  if (!range) return null;
  if (!fit) {
    return (
      <Pressable
        testID="fit-song-cta"
        accessibilityRole="button"
        onPress={() => router.push('/discover/voice' as Href)}
        className="min-h-11 justify-center"
      >
        <Text className="text-primary">{t('songCta')}</Text>
      </Pressable>
    );
  }
  if (!fitCopy(fit)) return null;
  return (
    <View testID="fit-card" className="items-start gap-1">
      <FitBadge fit={fit} testID="fit-badge-song" />
      <Text testID="fit-tier" variant="muted" className="text-xs">
        {t(TIER_KEY[range.tier])}
      </Text>
    </View>
  );
}
