import '../../global.css';

import { colors } from '@nomad/ui';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

import { AppProviders } from '../providers/AppProviders';

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
        </Stack>
      </ThemeProvider>
    </AppProviders>
  );
}
