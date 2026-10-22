import { useTranslations } from '@nomad/i18n';
import { Screen, Text } from '@nomad/ui';
import { useIsFocused } from 'expo-router';

import { useNightStore } from '../../tonight/nightStore';
import { NightScreen } from '../../tonight/nomad/NightScreen';

/** Tonight: the Nomad night home while a Nomad night is active; otherwise a placeholder until E3's empty state. */
export default function TonightScreen() {
  const t = useTranslations('tonight');
  const night = useNightStore((s) => s.active);
  const userKey = useNightStore((s) => s.userKey);
  const focused = useIsFocused();
  // Keyed by night: a new night (or account) starts from a clean screen, never the previous one's state.
  if (night?.kind === 'nomad') return <NightScreen key={`${userKey}:${night.nightId}`} night={night} focused={focused} />;
  return (
    <Screen testID="tonight-screen">
      <Text variant="title">{t('title')}</Text>
      <Text variant="muted">{t('comingSoon')}</Text>
    </Screen>
  );
}
