import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { Stack } from 'expo-router';

import { headerBackWhenFirst } from '../../../ui/HeaderBack';

/** The hub is always first here: back to where it was opened from, else Discover. */
const hubBack = headerBackWhenFirst('/discover', 'connect-hub-back');
/** Any other Connect screen opened cold (deep link, reminder tap, ListenBrainz OAuth return, Android share): the hub. */
const toHub = headerBackWhenFirst('/discover/connect', 'connect-back');

/**
 * The Connect screens (Phase 3b): the hub, then one screen per way in. Pushed over the tabs; the root stack hides
 * its own header for this group, so the hub (first in this stack, no native chevron) gets its own back button, and
 * so does any other screen when it is first (opened cold).
 */
export default function ConnectLayout() {
  const t = useTranslations('connect');
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        title: '',
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={(p) => ({ title: t('title'), ...hubBack(p) })} />
      <Stack.Screen name="screenshot" options={(p) => ({ title: t('cards.screenshot.title'), ...toHub(p) })} />
      <Stack.Screen name="playlist" options={(p) => ({ title: t('cards.playlist.title'), ...toHub(p) })} />
      <Stack.Screen name="spotify-export" options={(p) => ({ title: t('cards.spotifyExport.title'), ...toHub(p) })} />
      <Stack.Screen name="apple" options={(p) => ({ title: t('source.appleExport'), ...toHub(p) })} />
      <Stack.Screen name="import-file" options={(p) => ({ title: t('importFile.title'), ...toHub(p) })} />
      <Stack.Screen name="listenbrainz" options={(p) => ({ title: t('cards.listenbrainz.title'), ...toHub(p) })} />
      <Stack.Screen name="lastfm" options={(p) => ({ title: t('cards.lastfm.title'), ...toHub(p) })} />
    </Stack>
  );
}
