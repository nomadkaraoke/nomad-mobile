import { installIntlPolyfills, IntlProvider } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { setupApiClients } from '../api/setup';
import { useAuth } from '../auth/store';
import { useSessionCheck } from '../auth/useSessionCheck';
import { fakeSocialEnabled } from '../config';
import { useClearDiscoverOnSignOut } from '../discover/useClearDiscoverOnSignOut';
import { useClearMeOnAccountChange } from '../me/useClearMeOnAccountChange';
import { useSearchWarmup } from '../find/useSearchWarmup';
import { currentLocale, syncLayoutDirection } from '../locale';
import { usePushRegistration } from '../notifications/usePushRegistration';
import { initObservability, track } from '../observability';
import { useKaraokeLogFreshness } from '../tonight/log/IdeasPanel';
import { useLogSync } from '../tonight/log/useLogSync';
import { useVoiceSync } from '../voice/useVoiceProfile';
import { useFlushRecordingQueue } from '../voiceSession/recording/recordingQueue';
import { installDevWarningTrace } from './devWarnings';

// Before anything formats: Hermes has no Intl.PluralRules (ICU plurals would throw).
installIntlPolyfills();
initObservability();
track('app_opened');
setupApiClients();
// Dev only (Ruling T): trace "state update on a component that hasn't mounted yet" to its caller; E2E
// builds also keep that warning's LogBox toast from covering what Maestro taps.
installDevWarningTrace({ dev: __DEV__, e2e: fakeSocialEnabled() });

/** Spec §5: re-checks the gen session on launch and on foreground (a 401 signs out). */
function SessionCheck() {
  useSessionCheck();
  return null;
}

/** Spec §5.1: wakes the scale-to-zero search service (and checks the offline song list) on launch and foreground. */
function SearchWarmup() {
  useSearchWarmup();
  return null;
}

/** Ruling E8-R2: sends the karaoke-log outbox on launch, on reconnect and on foreground; keeps Ideas' log fresh. */
function LogSync() {
  useLogSync();
  useKaraokeLogFreshness();
  return null;
}

/**
 * Phase 3c: sends a voice profile decide hasn't got yet (offline / 5xx / signed-out saves) on sign-in and foreground,
 * and adopts a newer one decide has (saved on another phone).
 */
function VoiceSync() {
  useVoiceSync();
  useFlushRecordingQueue(); // Phase 3d: queued voice-session recordings, on launch and foreground
  return null;
}

/** Discover's picks, music profile and quiz draft belong to the signed-in person: dropped on sign-out. */
function ClearDiscoverOnSignOut() {
  useClearDiscoverOnSignOut();
  return null;
}

/** Me's cached library, setlists and unsent writes belong to one account: dropped on sign-out / account change. */
function ClearMeOnAccountChange() {
  useClearMeOnAccountChange();
  return null;
}

/** Phase 6: keeps this device's push token registered with gen (and the box at a Nomad night); foreground handler. */
function PushRegistration() {
  usePushRegistration();
  return null;
}

/** i18n + server-state providers; renders nothing until the stored session has been read. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const hydrated = useAuth((s) => s.hydrated);
  const [locale] = useState(currentLocale);

  useEffect(() => {
    if (!useAuth.getState().hydrated) void useAuth.getState().hydrate();
  }, []);

  useEffect(() => {
    syncLayoutDirection(locale);
  }, [locale]);

  if (!hydrated) return null;
  // Gesture handler root: the review's waveform scrubber (@nomad/ui WaveformCanvas) uses RNGH gestures.
  // Sheets are RN Modals outside this root, where RNGH got no touches on iOS: Tap To Sync's pad uses the
  // responder system instead.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <IntlProvider locale={locale}>
        <QueryClientProvider client={queryClient}>
          <SessionCheck />
          <SearchWarmup />
          <LogSync />
          <ClearDiscoverOnSignOut />
          <ClearMeOnAccountChange />
          <VoiceSync />
          <PushRegistration />
          {children}
        </QueryClientProvider>
      </IntlProvider>
    </GestureHandlerRootView>
  );
}
