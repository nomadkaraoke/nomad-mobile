import { router, useIsFocused } from 'expo-router';

import { EmptyState } from './EmptyState';
import { useNightStore } from './nightStore';
import { NightScreen } from './nomad/NightScreen';
import { OtherNightScreen } from './other/OtherNightScreen';

/**
 * The Tonight tab: the Nomad night home while a Nomad night is active, the Other-night log while one is (E9),
 * otherwise the empty state with the ways in (E3).
 */
export function TonightHome() {
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
  if (night?.kind === 'other') {
    return <OtherNightScreen key={`${userKey}:${night.nightId}`} night={night} />;
  }
  return <EmptyState />;
}
