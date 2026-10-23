// The voice profile and decide (Phase 3c 18b). The phone's copy (useVoiceStore) is the source of truth for badges;
// decide's copy follows it. A save never loses the measurement: it is stored `pending` first and stays pending
// through offline, 5xx/503 and signed-out states until a PUT succeeds. A decide 401 only marks Discover stale.
import { ApiError, getVoiceProfile, putVoiceProfile, type VoiceProfileOut } from '@nomad/api-decide';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/store';
import { useOffline } from '../net/useOffline';
import { toVoiceProfileIn, useVoiceStore, type LocalVoiceProfile } from './voiceStore';

export const VOICE_KEY = ['voice'] as const;

const isSignedIn = () => useAuth.getState().state.status === 'signedIn';
const time = (iso: string) => Date.parse(iso);

/** decide's `VoiceProfileOut` as the phone's camelCase profile. */
export function fromServer(o: VoiceProfileOut): LocalVoiceProfile {
  return {
    lowMidi: o.low_midi,
    highMidi: o.high_midi,
    comfortLow: o.comfort_low,
    comfortHigh: o.comfort_high,
    voiceType: o.voice_type,
    voiceTypeBetween: o.voice_type_between ?? null,
    register: o.register,
    confidence: o.confidence,
    method: o.method,
    measuredAt: o.measured_at,
  };
}

let inFlight: Promise<void> | null = null;

/**
 * PUTs the pending profile, once at a time (a save and a flush never double-send). Resolves true when nothing is
 * left pending. Failures leave it pending; they never throw.
 */
export function sendPendingVoice(): Promise<boolean> {
  const run = async () => {
    // A newer save while a PUT is in flight stays pending after markSynced: send that one too.
    for (let guard = 0; guard < 3; guard++) {
      const { profile, pending } = useVoiceStore.getState();
      if (!pending || !profile || !isSignedIn()) return;
      try {
        await putVoiceProfile(toVoiceProfileIn(profile));
      } catch (e) {
        // 400/422: decide will never take this measurement; keep it for badges and stop retrying (not an error).
        // Everything else (401 — api/setup.ts marks Discover stale and never signs out —, 403, 404, 408, 429, 5xx,
        // status 0) stays pending for the next trigger.
        if (e instanceof ApiError && (e.status === 400 || e.status === 422)) {
          console.warn(`voice profile rejected by decide (${e.status})`);
          useVoiceStore.getState().markRejected(profile.measuredAt);
          continue;
        }
        return;
      }
      useVoiceStore.getState().markSynced(profile.measuredAt);
    }
  };
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight.then(() => !useVoiceStore.getState().pending);
}

/**
 * The profile for badges (this phone's copy), reconciled with decide's: a server profile measured later than the
 * local one replaces it, an older one is ignored, the same one marks the local copy synced.
 */
export function useVoiceProfile() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const offline = useOffline();
  const profile = useVoiceStore((s) => s.profile);
  const pending = useVoiceStore((s) => s.pending);

  const query = useQuery({
    queryKey: [...VOICE_KEY, email],
    enabled: signedIn && !offline,
    queryFn: getVoiceProfile,
    retry: false,
  });

  const server = query.data;
  useEffect(() => {
    if (!server) return;
    const { profile: mine, adopt, markSynced } = useVoiceStore.getState();
    if (!mine || time(server.measured_at) > time(mine.measuredAt)) adopt(fromServer(server));
    else if (time(server.measured_at) === time(mine.measuredAt)) markSynced(mine.measuredAt);
  }, [server]);

  return { profile, pending, isLoading: query.isLoading };
}

/** Settles once no voice PUT is in flight (a remove waits for it, so a PUT can never land after its DELETE). */
export function waitForVoiceSend(): Promise<void> {
  return inFlight ? inFlight.then(
      () => undefined,
      () => undefined,
    ) : Promise.resolve();
}

/**
 * Returns `save(profile)`: stores it pending, then PUTs it when signed in. Resolves true once decide has it,
 * false when it is still pending (offline, 5xx/503, 401, signed out).
 */
export function useSaveVoiceProfile() {
  return useCallback(async (profile: LocalVoiceProfile): Promise<boolean> => {
    useVoiceStore.getState().save(profile);
    if (!isSignedIn()) return false;
    return sendPendingVoice();
  }, []);
}

/**
 * Sends a pending profile when signed in: on mount, when the connection comes back and when the app returns to the
 * foreground (the pattern of the karaoke-log outbox, `useLogSync`). Mounted once in AppProviders.
 */
export function useFlushPendingVoice() {
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  const offline = useOffline();
  const wasOffline = useRef(offline);

  useEffect(() => {
    if (!email) return;
    void sendPendingVoice();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sendPendingVoice();
    });
    return () => sub?.remove();
  }, [email]);

  useEffect(() => {
    if (wasOffline.current && !offline && email) void sendPendingVoice();
    wasOffline.current = offline;
  }, [offline, email]);
}

/** Discover's own trigger: tries a pending profile whenever the tab mounts while signed in. */
export function useFlushVoiceOnDiscoverMount() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  useEffect(() => {
    if (signedIn) void sendPendingVoice();
  }, [signedIn]);
}
