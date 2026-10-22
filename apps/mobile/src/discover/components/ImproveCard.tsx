import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

/** Last on the picks list. 3b and 3c add their own rows here (connect services, vocal range). */
export function ImproveCard({ onAddArtists }: { onAddArtists: () => void }) {
  const t = useTranslations('discover');
  return (
    <View testID="discover-improve-card" className="my-4 gap-2 rounded-xl border border-border bg-card p-3">
      <Text className="font-semibold">{t('improveTitle')}</Text>
      <Pressable
        testID="discover-improve-artists"
        accessibilityRole="button"
        onPress={onAddArtists}
        className="min-h-11 justify-center"
      >
        <Text className="text-primary">{t('improveArtists')}</Text>
      </Pressable>
    </View>
  );
}
