import type { ArtistTitle } from '@nomad/api-kjbox';
import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

export type NoKaraokeCardProps = {
  song: ArtistTitle;
  /** Make-it is on offer tonight (on, not Simple Mode, not changing a song); otherwise "Ask the host" (A.78). */
  offerMake: boolean;
  onMake: () => void;
};

/** "🎵 No karaoke version yet · Title — Artist · Make it now" on a confident identification (A.31). */
export function NoKaraokeCard({ song, offerMake, onMake }: NoKaraokeCardProps) {
  const t = useTranslations('tonight.request');
  return (
    <View testID="tonight-no-karaoke" className="gap-1 rounded-xl border border-gold/40 bg-gold/10 p-3">
      <Text className="text-xs font-bold uppercase text-gold">{t('noKaraokeYet')}</Text>
      <Text testID="tonight-no-karaoke-title" className="text-lg font-semibold">
        {song.title}
      </Text>
      <Text variant="muted">{song.artist}</Text>
      <View className="pt-2">
        {offerMake ? (
          <>
            <Button testID="tonight-no-karaoke-make" label={t('makeNow')} onPress={onMake} />
            <Text variant="muted" className="pt-1 text-xs">
              {t('makeHint')}
            </Text>
          </>
        ) : (
          <Text testID="tonight-ask-host" variant="muted">
            {t('askHost')}
          </Text>
        )}
      </View>
    </View>
  );
}
