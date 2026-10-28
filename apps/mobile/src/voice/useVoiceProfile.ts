// The voice profile and decide (Phase 3c 18b). The phone's copy (useVoiceStore) is the source of truth for badges;
// decide's copy follows it. A save never loses the measurement: it is stored `pending` first and stays pending
// through offline, 5xx/503 and signed-out states until a PUT succeeds. A decide 401 only marks Discover stale.
import { ApiError, getVoiceProfiles, putVoiceProfile, type VoiceProfileOut, type VoiceProfiles } from '@nomad/api-decide';
import { VOICE_TYPES, type VoiceType } from '@nomad/core';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/store';
import { useRecFilters } from '../discover/filtersStore';
import { useOffline } from '../net/useOffline';
import { toVoiceProfileIn, useVoiceStore, type LocalVoiceProfile, type VoiceProfileInBody } from './voiceStore';

export const VOICE_KEY = ['voice'] as const;

const isSignedIn = () => useAuth.getState().state.status === 'signedIn';
const time = (iso: string) => Date.parse(iso);

const KNOWN_TYPES: ReadonlySet<string> = new Set(VOICE_TYPES.map((v) => v.type));
/** A voice type this app knows, else null: a newer decide may add types, and the labels must never look up an unknown key. */
const knownType = (v: string | null | undefined): VoiceType | null => (v != null && KNOWN_TYPES.has(v) ? (v as VoiceType) : null);

/** decide's `VoiceProfileOut` as the phone's camelCase profile. */
export function fromServer(o: VoiceProfileOut): LocalVoiceProfile {
  return {
    lowMidi: o.low_midi,
    highMidi: o.high_midi,
    comfortLow: o.comfort_low,
    comfortHigh: o.comfort_high,
    voiceType: knownType(o.voice_type),
    voiceTypeBetween: knownType(o.voice_type_between),
    register: o.register,
    confidence: o.confidence,
    method: o.method,
    measuredAt: o.measured_at,
    evidenceCount: o.evidence_count ?? null,
    sessionId: o.session_id ?? null,
    ...(o.falsetto_high != null && { falsettoHigh: o.falsetto_high }),
  };
}

/** decide before v0.33 refuses `falsetto_high` (422, pydantic `extra_forbidden` on that field). */
function refusedFalsettoHigh(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 422 || !Array.isArray(e.detail)) return false;
  return e.detail.some(
    (d: unknown) =>
      typeof d === 'object' &&
      d !== null &&
      (d as { type?: unknown }).type === 'extra_forbidden' &&
      Array.isArray((d as { loc?: unknown }).loc) &&
      ((d as { loc: unknown[] }).loc).includes('falsetto_high'),
  );
}

/** PUTs the profile; an older decide that refuses `falsetto_high` gets it again without that field. */
async function putProfile(body: VoiceProfileInBody): Promise<void> {
  try {
    await putVoiceProfile(body);
  } catch (e) {
    if (body.falsetto_high === undefined || !refusedFalsettoHigh(e)) throw e;
    console.warn('decide refused falsetto_high (older decide): sending the profile without it');
    const { falsetto_high: _dropped, ...rest } = body;
    await putVoiceProfile(rest);
  }
}

let inFlight: Promise<void> | null = null;
/**
 * Set when decide reverted or removed the saved profile itself (a "Don't count" recompute) and the app couldn't read
 * the result: the next server read made after this time is followed as-is (`followServerVoice`), even though decide's
 * restored mic result is older than the phone's copy, which the reconcile below would otherwise keep forever.
 */
let followReadAfter: number | null = null;

/** Follow the next server read of the voice profile, whatever its age (see `followReadAfter`). */
export function followNextServerRead(): void {
  followReadAfter = Date.now();
}
/** Date.now() when the last voice PUT started, and when the last voice GET started (the clear-on-null race guard). */
let lastPutStartedAt = 0;
let lastGetStartedAt = 0;
const fetchVoice = (): Promise<VoiceProfiles> => {
  lastGetStartedAt = Date.now();
  return getVoiceProfiles();
};

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
      // decide writes session profiles itself (the public PUT rejects them): nothing to send.
      if (profile.method === 'session') {
        useVoiceStore.getState().markSynced(profile.measuredAt);
        return;
      }
      try {
        lastPutStartedAt = Date.now();
        await putProfile(toVoiceProfileIn(profile));
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
 * local one replaces it, an older one is ignored, the same one marks the local copy synced. decide having none while
 * the local copy is synced means it was removed on another phone: the local copy is cleared too. Not when it is
 * pending (not uploaded yet), was rejected by decide (400/422, never there), or a PUT started after this GET did
 * (the GET read decide before the upload landed: the launch-time flush and fetch run together).
 * Also returns decide's mic-test result and latest session result (Me shows both), null until read.
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
    queryFn: fetchVoice,
    retry: false,
  });

  const server = query.data === undefined ? undefined : query.data.profile;
  const readAt = query.dataUpdatedAt;
  useEffect(() => {
    if (server === undefined) return;
    if (followReadAfter !== null && readAt >= followReadAfter) {
      followReadAfter = null;
      if (!useVoiceStore.getState().pending) {
        followServerVoice(server);
        return;
      }
    }
    const { profile: mine, pending: minePending, rejected, adopt, markSynced, clear } = useVoiceStore.getState();
    if (server === null) {
      if (mine && !minePending && !rejected && lastPutStartedAt < lastGetStartedAt) clear();
      return;
    }
    if (!mine || time(server.measured_at) > time(mine.measuredAt)) adopt(fromServer(server));
    else if (time(server.measured_at) === time(mine.measuredAt)) markSynced(mine.measuredAt);
  }, [server, readAt]);

  return {
    profile,
    pending,
    isLoading: query.isLoading,
    mic: query.data?.mic ?? null,
    latestSession: query.data?.latestSession ?? null,
  };
}

/** Turns off the filters that need a voice profile (Singable, sort by fit). */
export function clearVoiceFilters(): void {
  const { filters, set } = useRecFilters.getState();
  if (filters.singable || filters.sort === 'fit') set({ singable: false, ...(filters.sort === 'fit' ? { sort: 'best' } : {}) });
}

/**
 * decide changed the saved profile itself (a "Don't count" recompute, adopting a session result): the phone's copy
 * follows it at once, even when decide's is older (a revert to the mic result), unless the phone holds a newer
 * measurement that isn't sent yet (that one wins when it lands).
 */
export function followServerVoice(server: VoiceProfileOut | null): void {
  const { pending, adopt, clear } = useVoiceStore.getState();
  if (pending) return;
  if (server) {
    adopt(fromServer(server));
    return;
  }
  clear();
  clearVoiceFilters();
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

/**
 * Mounted once in AppProviders: flushes a pending profile (useFlushPendingVoice) and keeps the phone's copy reconciled
 * with decide's on every screen, not only on Me. Without it, a profile decide got from another phone (or a seeded one)
 * never reached this phone's badges: the song page fitted against no or an older profile while the picks' badges
 * (decide's) used the newer one, and Singable offered the voice test.
 */
export function useVoiceSync() {
  useFlushPendingVoice();
  useVoiceProfile();
}

/** Discover's own trigger: tries a pending profile whenever the tab mounts while signed in. */
export function useFlushVoiceOnDiscoverMount() {
  const signedIn = useAuth((s) => s.state.status === 'signedIn');
  useEffect(() => {
    if (signedIn) void sendPendingVoice();
  }, [signedIn]);
}
