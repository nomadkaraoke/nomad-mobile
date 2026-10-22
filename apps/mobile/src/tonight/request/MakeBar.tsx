import { useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable } from 'react-native';

export type TonightMakeBarProps = { onMake: () => void };

/** The slim sticky "Not seeing your song? Make it" bar, shown only when identification isn't confident (A.32). */
export function MakeBar({ onMake }: TonightMakeBarProps) {
  const t = useTranslations('tonight.request');
  return (
    <Pressable
      testID="tonight-make-bar"
      accessibilityRole="button"
      onPress={onMake}
      className="flex-row flex-wrap items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5"
    >
      <Text className="text-center">{t('makeBarPrompt')}</Text>
      <Text testID="tonight-make-bar-make" className="font-bold text-primary">
        {t('makeBarAction')}
      </Text>
    </Pressable>
  );
}
