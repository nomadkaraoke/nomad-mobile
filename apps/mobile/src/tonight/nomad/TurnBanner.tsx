import { isolate, useTranslations } from '@nomad/i18n';
import { Text } from '@nomad/ui';
import { Pressable, View } from 'react-native';

import type { TurnAlert } from './useTurnAlerts';

/** The in-app "You're up next" / "You're on" banner (spec §4.4). */
export function TurnBanner({ alert, onDismiss }: { alert: TurnAlert; onDismiss: () => void }) {
  const t = useTranslations('tonight.night.alert');
  const song = alert.title
    ? alert.artist
      ? t('song', { title: isolate(alert.title), artist: isolate(alert.artist) })
      : isolate(alert.title)
    : null;
  const message =
    alert.state === 'now_singing'
      ? song
        ? t('onStage', { song })
        : t('onStageNoSong')
      : song
        ? t('upNext', { song })
        : t('upNextNoSong');
  return (
    <View
      testID="tonight-turn-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      className="flex-row items-center gap-3 rounded-xl border border-success bg-success/20 p-4"
    >
      <Text testID="tonight-turn-banner-text" className="flex-1 font-bold text-success">
        {message}
      </Text>
      <Pressable
        testID="tonight-turn-banner-dismiss"
        accessibilityRole="button"
        accessibilityLabel={t('dismiss')}
        hitSlop={8}
        onPress={onDismiss}
        className="min-h-11 justify-center px-2"
      >
        <Text className="font-semibold">{t('ok')}</Text>
      </Pressable>
    </View>
  );
}
