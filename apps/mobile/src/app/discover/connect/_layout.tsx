import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { Stack } from 'expo-router';

/**
 * The Connect screens (Phase 3b): the hub, then one screen per way in. Pushed over the tabs; the root stack hides
 * its own header for this group, and the hub's back chevron comes from the root stack.
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
      <Stack.Screen name="index" options={{ title: t('title') }} />
      <Stack.Screen name="screenshot" options={{ title: t('cards.screenshot.title') }} />
      <Stack.Screen name="playlist" options={{ title: t('cards.playlist.title') }} />
      <Stack.Screen name="spotify-export" options={{ title: t('cards.spotifyExport.title') }} />
      <Stack.Screen name="apple" options={{ title: t('source.appleExport') }} />
      <Stack.Screen name="import-file" options={{ title: t('importFile.title') }} />
    </Stack>
  );
}
