import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

export type MakeBarProps = {
  /** No connection: "Making a song needs a connection" instead of the offer. */
  offline: boolean;
  onMake: () => void;
};

/** The slim sticky "Not seeing your song? Make it" (only when the song isn't confidently identified). */
export function MakeBar({ offline, onMake }: MakeBarProps) {
  const t = useTranslations('discover');
  if (offline) {
    return (
      <View testID="make-bar" className="items-center rounded-xl border border-border bg-card px-3 py-2.5">
        <Text variant="muted" className="text-center">
          {t('needsConnection')}
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      testID="make-bar"
      accessibilityRole="button"
      onPress={onMake}
      className="flex-row flex-wrap items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5"
    >
      <Text className="text-center">{t('makeBarPrompt')}</Text>
      <Text testID="make-bar-make" className="font-bold text-primary">
        {t('makeBarAction')}
      </Text>
    </Pressable>
  );
}
