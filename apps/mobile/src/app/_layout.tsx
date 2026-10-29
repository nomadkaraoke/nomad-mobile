import '../../global.css';

import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

import { useImportQueueRunner } from '../discover/connect/importQueue';
import { useReminderTapRouting } from '../discover/connect/reminders';
import { useSharedFileIntake } from '../discover/connect/useSharedFileIntake';
import { AppProviders } from '../providers/AppProviders';
import { headerBackWhenFirst } from '../ui/HeaderBack';
import { voiceSessionScreenProps } from '../voiceSession/screenProps';

/** Your music profile opened cold (e.g. the Apple Music hand-back) goes back to Me. */
const profileBack = headerBackWhenFirst('/me', 'profile-back');

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
  const tQuiz = useTranslations('quiz');
  const tAccount = useTranslations('account');
  // Sends privacy-export uploads parsed on the phone once online and signed in (Phase 3b).
  useImportQueueRunner();
  // A tapped Spotify-export reminder opens its screen (Phase 3b).
  useReminderTapRouting();
  // Android Share -> Nomad Karaoke: a shared export zip/CSV opens the import screen (Phase 3b).
  useSharedFileIntake();
  const tMe = useTranslations('me');
  const tSong = useTranslations('song');
  const tVoice = useTranslations('voice');
  const tVoiceDebug = useTranslations('voiceSession.debug');
  const tVoiceSession = useTranslations('voiceSession');
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
        {/* The Discover quiz (Phase 3a spec §8.2): a modal over Discover; finishing dismisses back to it. */}
        <Stack.Screen name="discover/quiz" options={{ presentation: 'modal', title: tQuiz('title') }} />
        {/* The voice range test (Phase 3c spec §4.2): a modal over Discover, like the quiz. */}
        <Stack.Screen name="discover/voice" options={{ presentation: 'modal', title: tVoice('title') }} />
        {/* The voice session (Phase 3d spec §4): a modal over Discover or Me. */}
        <Stack.Screen name="discover/voice-session" {...voiceSessionScreenProps(tVoiceSession('title'))} />
        {/* Me -> Your music profile (Phase 3a spec §8.3). */}
        <Stack.Screen name="me/music-profile" options={(p) => ({ title: tAccount('musicProfile'), ...profileBack(p) })} />
        <Stack.Screen name="me/songs" options={{ title: tMe('allSongs') }} />
        <Stack.Screen name="me/sung-before" options={{ title: tMe('sungBefore.title') }} />
        <Stack.Screen name="me/setlists/index" options={{ title: tMe('setlists.title') }} />
        <Stack.Screen name="me/setlists/[id]" options={{ title: tMe('setlists.detailTitle') }} />
        <Stack.Screen name="me/get-made" options={{ title: tMe('getMade.title') }} />
        <Stack.Screen name="me/history/[key]" options={{ title: tSong('history.pageTitle') }} />
        <Stack.Screen name="me/artists" options={(p) => ({ title: tAccount('artistsAll'), ...profileBack(p) })} />
        {/* Connect your music (Phase 3b): its own stack with its own headers. */}
        <Stack.Screen name="discover/connect" options={{ headerShown: false }} />
        <Stack.Screen name="me/voice-debug" options={{ title: tVoiceDebug('title') }} />
      </Stack>
    </ThemeProvider>
  );
}
