import '../../global.css';

import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

import { AppProviders } from '../providers/AppProviders';

// Sign-in is a bottom sheet over whatever asked for it (spec §4.3). Its screens replace one another.
// The duration-confirm sheet reuses the same look.
const SIGN_IN_SHEET = {
  presentation: 'formSheet',
  headerShown: false,
  sheetGrabberVisible: true,
  sheetCornerRadius: 24,
  contentStyle: { backgroundColor: colors.bg },
} as const;

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg, card: colors.card } };

export default function RootLayout() {
  return (
    <AppProviders>
      <RootStack />
    </AppProviders>
  );
}

/** Inside AppProviders, so screen titles can be translated. */
function RootStack() {
  const tReview = useTranslations('review');
  return (
    <ThemeProvider value={theme}>
      <Stack
        screenOptions={{
          // Pushed screens get a minimal native header (back chevron only, no title text).
          headerShown: true,
          title: '',
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: colors.primary,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in/index" options={{ ...SIGN_IN_SHEET, sheetAllowedDetents: [0.6, 1] }} />
        {/* Email and code raise the keyboard, so they open full height. */}
        <Stack.Screen name="sign-in/email" options={{ ...SIGN_IN_SHEET, sheetAllowedDetents: [1] }} />
        <Stack.Screen name="sign-in/code" options={{ ...SIGN_IN_SHEET, sheetAllowedDetents: [1] }} />
        {/* Duration confirm: a short native sheet over the Make tab (spec §4.6). */}
        <Stack.Screen name="job/duration/[id]" options={{ ...SIGN_IN_SHEET, sheetAllowedDetents: [0.5, 1] }} />
        {/* Native review (Phase 2 spec §4): "Review" while loading; ReviewScreen then sets the song title, undo and menu. */}
        <Stack.Screen name="review/[id]" options={{ title: tReview('title') }} />
      </Stack>
    </ThemeProvider>
  );
}
