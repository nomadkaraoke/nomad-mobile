import { useTranslations } from '@nomad/i18n';
import { Screen, Text } from '@nomad/ui';
import { router, useIsFocused } from 'expo-router';

import { installPendingMakePurge } from '../../tonight/make/pendingMake';
import { useNightStore } from '../../tonight/nightStore';
import { NightScreen } from '../../tonight/nomad/NightScreen';

// App open and every night change: forget other nights' pending makes (their ids are no use to a new night).
// (Module scope: runs once, when the tab's module first loads.)
installPendingMakePurge();

/** Tonight: the Nomad night home while a Nomad night is active; otherwise a placeholder until E3's empty state. */
export default function TonightScreen() {
  const t = useTranslations('tonight');
  const night = useNightStore((s) => s.active);
  const userKey = useNightStore((s) => s.userKey);
  const focused = useIsFocused();
  // Keyed by night: a new night (or account) starts from a clean screen, never the previous one's state.
  if (night?.kind === 'nomad') {
    return (
      <NightScreen
        key={`${userKey}:${night.nightId}`}
        night={night}
        focused={focused}
        onRequest={() => router.push('/tonight/search')}
        onChange={(song) => {
          if (song.request.id == null) return;
          router.push({
            pathname: '/tonight/search',
            params: { change: String(song.request.id), replacing: song.request.song_title },
          });
        }}
      />
    );
  }
  return (
    <Screen testID="tonight-screen">
      <Text variant="title">{t('title')}</Text>
      <Text variant="muted">{t('comingSoon')}</Text>
    </Screen>
  );
}
