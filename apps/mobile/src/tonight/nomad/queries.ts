import {
  getMe,
  getNight,
  getNow,
  getRotation,
  KjboxError,
  type MeResult,
  type Night,
  type NowResult,
  type RotationResult,
} from '@nomad/api-kjbox';
import { CancelledError, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { NomadNight } from '../nightStore';
import { useEditingStore } from './editingStore';

/**
 * Poll intervals (spec §4.1 Freshness): Your songs every 15 s, the rotation every 30 s (ETag/304), venue info rarely.
 * While the box is unreachable, retries back off 15 s → 30 s → 60 s (capped, ruling E4-R2). Mutable so tests can shrink them.
 */
export const nightPoll = {
  meMs: 15_000,
  nowMs: 15_000,
  rotationMs: 30_000,
  nightMs: 120_000,
  backoffMs: [15_000, 30_000, 60_000],
};

/**
 * The box can't be reached (no response, a gateway with no JSON, or 503 gen_unavailable: spec §4.2). A cancelled
 * fetch is never "unreachable": the api-kjbox client reports a caller abort as unreachable, so cancellations are
 * filtered here (our query functions don't pass an abort signal, so TanStack's own cancels never reach fetch).
 */
export function isUnreachable(e: unknown): boolean {
  if (e instanceof CancelledError) return false;
  if (e instanceof Error && e.name === 'AbortError') return false;
  return e instanceof KjboxError && (e.unreachable || e.code === 'gen_unavailable');
}

/**
 * The night this app holds is over (ruling E4-R1): 409 night_changed (the host started a new night, A.89) or 403
 * not_open (the event code no longer works). The app ends the night and stops polling: the box rate-limits failed
 * event codes per IP, and a phone polling a stale code would lock out everyone on the venue wifi.
 */
export function isNightOver(e: unknown): boolean {
  return e instanceof KjboxError && (e.code === 'night_changed' || e.code === 'not_open');
}

/** GET /night answered "not open" because the code or night is gone (not merely closed for requests). */
export const nightGone = (n: Night | undefined, nightId: string): boolean =>
  n !== undefined && (n.open ? n.night_id !== nightId : n.reason !== 'closed');

/** Next poll delay after a fetch: off once the night is over, backoff while unreachable, honour retry_after. */
export function nextPollDelay(baseMs: number, failures: number, error: unknown): number | false {
  if (isNightOver(error)) return false;
  if (failures > 0 && isUnreachable(error)) {
    const steps = nightPoll.backoffMs;
    return steps[Math.min(failures, steps.length) - 1]!;
  }
  if (error instanceof KjboxError && error.retryAfter) return Math.max(baseMs, error.retryAfter * 1000);
  return baseMs;
}

/** The app is in the foreground (AppState active or inactive, not background). */
export function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s !== 'background'));
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, []);
  return foreground;
}

/** Ruling E4-R3: poll only while the screen is focused, the app is foregrounded and the singer isn't editing. */
export function usePollingActive(focused: boolean): boolean {
  const foreground = useAppForeground();
  const editing = useEditingStore((s) => s.editing);
  return focused && foreground && !editing;
}

export const nightKey = (night: NomadNight, userKey: string | null): QueryKey => ['kjbox', userKey, night.nightId];

/**
 * One polled kjbox read. No automatic retries (the poll is the retry); consecutive failures drive the unreachable
 * backoff. The last good data stays in the cache through errors, so an unreachable box keeps the last-known state.
 * The key carries the user and the night id, so another account or a new night never sees this one's data.
 */
function usePolled<T>(key: QueryKey, fetcher: (prev: T | undefined) => Promise<T>, baseMs: number, active: boolean) {
  const failures = useRef(0);
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        const value = await fetcher(queryClient.getQueryData<T>(key));
        failures.current = 0;
        return value;
      } catch (e) {
        failures.current += 1;
        throw e;
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (active ? nextPollDelay(baseMs, failures.current, query.state.error) : false),
  });
}

/** GET /me: Your songs, the next turn and what's been sung tonight. 15 s while visible. */
export function useMe(night: NomadNight, userKey: string | null, active: boolean) {
  return usePolled<MeResult>([...nightKey(night, userKey), 'me'], () => getMe(night.code, night.nightId), nightPoll.meMs, active);
}

/** GET /now: who's on stage and up next. */
export function useNow(night: NomadNight, userKey: string | null, active: boolean) {
  return usePolled<NowResult>([...nightKey(night, userKey), 'now'], () => getNow(night.code, night.nightId), nightPoll.nowMs, active);
}

/** GET /night: venue info and feature flags (rarely changes), and whether the night is still this one. */
export function useNightInfo(night: NomadNight, userKey: string | null, active: boolean) {
  return usePolled<Night>([...nightKey(night, userKey), 'night'], () => getNight(night.code, night.nightId), nightPoll.nightMs, active);
}

/** The rotation as last received. Its wait estimates are relative to `receivedAt` (a 304 keeps the earlier ones). */
export type RotationData = { result: RotationResult; etag?: string; receivedAt: number };

/**
 * GET /rotation every 30 s with If-None-Match: a 304 keeps the data (and `receivedAt`) already held, so the app
 * counts the estimates down locally (A.62: a full rotation read costs the box 0.5 s mid-show).
 */
export function useRotation(night: NomadNight, userKey: string | null, active: boolean) {
  return usePolled<RotationData>(
    [...nightKey(night, userKey), 'rotation'],
    async (prev) => {
      const res = await getRotation(night.code, prev?.etag, night.nightId);
      if (!res.notModified) return { result: res.data, etag: res.etag, receivedAt: Date.now() };
      if (prev) return prev;
      // A 304 with nothing cached (cache cleared under us): ask again unconditionally.
      const full = await getRotation(night.code, undefined, night.nightId);
      if (full.notModified) throw new KjboxError('internal', 304);
      return { result: full.data, etag: full.etag, receivedAt: Date.now() };
    },
    nightPoll.rotationMs,
    active,
  );
}
