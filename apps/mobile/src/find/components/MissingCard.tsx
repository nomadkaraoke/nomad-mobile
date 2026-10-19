import type { SongRef } from '@nomad/api-decide';
import { useTranslations } from '@nomad/i18n';
import { Button, Text } from '@nomad/ui';
import { View } from 'react-native';

export type MissingCardProps = {
  song: SongRef;
  /** No connection: making a song needs one, so the button gives way to a note. */
  offline: boolean;
  onMake: () => void;
};

/** "🎵 No karaoke version yet · Title — Artist · Make it →" (spec §4.1 outcome 2, kjbox D13). */
export function MissingCard({ song, offline, onMake }: MissingCardProps) {
  const t = useTranslations('discover');
  return (
    <View testID="missing-card" className="gap-1 rounded-xl border border-gold/40 bg-gold/10 p-3">
      <Text className="text-xs font-bold uppercase text-gold">{t('noKaraokeYet')}</Text>
      <Text className="text-lg font-semibold">{song.title}</Text>
      <Text variant="muted">{song.artist}</Text>
      <View className="pt-2">
        {offline ? (
          <Text variant="muted" testID="missing-card-offline">
            {t('needsConnection')}
          </Text>
        ) : (
          <>
            <Button testID="missing-card-make" label={t('makeIt')} onPress={onMake} />
            <Text variant="muted" className="pt-1 text-xs">
              {t('makeHint')}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
