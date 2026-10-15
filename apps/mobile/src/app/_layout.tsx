import '../../global.css';

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

import { AppProviders } from '../providers/AppProviders';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: '#0f0f0f', card: '#1a1a1a' } };

export default function RootLayout() {
  return (
    <AppProviders>
      <ThemeProvider value={theme}>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </AppProviders>
  );
}
