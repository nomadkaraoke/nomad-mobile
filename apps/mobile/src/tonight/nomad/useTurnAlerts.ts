import type { MeResult } from '@nomad/api-kjbox';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { appStorage } from '../../storage';
import { entryIdOf, isLive, isOnStage, nextSong, songKey, songParts } from './model';

export type TurnState = 'up_next' | 'now_singing';

export type TurnAlert = { state: TurnState; title: string | null; artist: string | null };

/** How long the in-app banner stays up (ruling E10-R3). Mutable for tests. */
export const turnAlertTiming = { bannerMs: 10_000 };

/**
 * The singer's turn right now, from `/me`: on stage (their own live song is now singing; a friend's never counts,
 * A.13) or up next: `next.position` 1, or 2 while someone is on stage (the box's "Up Next", the status tile's
 * "You're next, right after this song"). `key` names the rotation entry, so each entry alerts once per state.
 */
export function turnOf(
  me: MeResult | undefined,
  someoneOnStage = false,
): { key: string; state: TurnState; alert: TurnAlert } | null {
  if (!me) return null;
  const onStage = me.songs.find((s) => s.owner !== 'friend' && isLive(s) && isOnStage(s));
  if (onStage) {
    const { title, artist } = songParts(onStage.request);
    const id = entryIdOf(onStage);
    return { key: id != null ? `e${id}` : songKey(onStage), state: 'now_singing', alert: { state: 'now_singing', title, artist } };
  }
  if (me.next && (me.next.position <= 1 || (someoneOnStage && me.next.position === 2))) {
    const song = nextSong(me);
    const parts = song ? songParts(song.request) : null;
    return {
      key: `e${me.next.entry_id}`,
      state: 'up_next',
      alert: { state: 'up_next', title: parts?.title || null, artist: parts?.artist || null },
    };
  }
  return null;
}

/** The banner on screen (an external store, so the alert effect updates it like any other system it talks to). */
const useTurnBanner = create<{ alert: TurnAlert | null }>(() => ({ alert: null }));
const setBanner = (alert: TurnAlert | null) => useTurnBanner.setState({ alert });

export const dismissTurnBanner = () => setBanner(null);

const firedKey = (userKey: string | null, nightId: string) => `tonight.turnAlerts.v1.${userKey ?? 'anon'}.${nightId}`;

function loadFired(key: string): Set<string> {
  try {
    const raw = appStorage.getString(key);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Whether the app is in the foreground, and since when (ms epoch). An app that starts in the foreground counts from
 * 0: everything it has fetched was fetched in the foreground. `inactive` (a call, Control Center) counts as foreground.
 */
function useForegroundSince(): { foreground: boolean; since: number } {
  const [state, setState] = useState(() => {
    const foreground = AppState.currentState !== 'background';
    return { foreground, since: foreground ? 0 : Date.now() };
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const foreground = s !== 'background';
      setState((prev) => (prev.foreground === foreground ? prev : { foreground, since: foreground ? Date.now() : prev.since }));
    });
    return () => sub?.remove(); // jest-expo's AppState mock returns no subscription
  }, []);
  return state;
}

/**
 * Turn awareness without remote push (spec §4.4, ruling E10-R3): one haptic and an in-app banner when the singer
 * becomes up next and when they're on, once per entry per state. Only while the app is in the foreground, and only on
 * `/me` data received in the foreground (`dataUpdatedAt` at or after the last return), so a stale cache never buzzes on
 * return; the refetch on return alerts if the turn still holds. The fired set is kept per user and night in MMKV, so a
 * restart never alerts twice. The banner hides after 10 s or when dismissed.
 */
export function useTurnAlerts(
  me: MeResult | undefined,
  dataUpdatedAt: number,
  userKey: string | null,
  nightId: string,
  someoneOnStage = false,
) {
  const { foreground, since } = useForegroundSince();
  const fresh = dataUpdatedAt >= since;
  const alert = useTurnBanner((s) => s.alert);
  const turn = turnOf(me, someoneOnStage);
  const turnId = turn ? `${turn.key}:${turn.state}` : null;

  useEffect(() => {
    if (!foreground || !fresh || !turn || !turnId) return;
    const key = firedKey(userKey, nightId);
    const fired = loadFired(key);
    if (fired.has(turnId)) return;
    fired.add(turnId);
    appStorage.set(key, JSON.stringify([...fired]));
    setBanner(turn.alert);
    try {
      void Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => undefined);
    } catch {
      /* no haptics engine: the banner still shows */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- turnId captures the turn; the alert text rides along
  }, [turnId, foreground, fresh, userKey, nightId]);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setBanner(null), turnAlertTiming.bannerMs);
    return () => clearTimeout(timer);
  }, [alert]);
  // A banner never outlives its night screen.
  useEffect(() => () => setBanner(null), []);

  return { alert, dismiss: dismissTurnBanner };
}
