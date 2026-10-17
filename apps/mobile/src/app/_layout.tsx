import '../../global.css';

import { colors } from '@nomad/ui';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

import { AppProviders } from '../providers/AppProviders';

// Sign-in is a bottom sheet over whatever asked for it (spec §4.3). Its screens replace one another.
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
        </Stack>
      </ThemeProvider>
    </AppProviders>
  );
}
