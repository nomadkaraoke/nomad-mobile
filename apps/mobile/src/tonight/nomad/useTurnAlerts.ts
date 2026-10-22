import type { MeResult } from '@nomad/api-kjbox';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { create } from 'zustand';

import { appStorage } from '../../storage';
import { entryIdOf, isLive, isOnStage, nextSong, songKey, songParts } from './model';
import { useAppForeground } from './queries';

export type TurnState = 'up_next' | 'now_singing';

export type TurnAlert = { state: TurnState; title: string | null; artist: string | null };

/** How long the in-app banner stays up (ruling E10-R3). Mutable for tests. */
export const turnAlertTiming = { bannerMs: 10_000 };

/**
 * The singer's turn right now, from `/me`: on stage (their own live song is now singing; a friend's never counts,
 * A.13) or up next (`next.position` 1). `key` names the rotation entry, so each entry alerts once per state.
 */
export function turnOf(me: MeResult | undefined): { key: string; state: TurnState; alert: TurnAlert } | null {
  if (!me) return null;
  const onStage = me.songs.find((s) => s.owner !== 'friend' && isLive(s) && isOnStage(s));
  if (onStage) {
    const { title, artist } = songParts(onStage.request);
    const id = entryIdOf(onStage);
    return { key: id != null ? `e${id}` : songKey(onStage), state: 'now_singing', alert: { state: 'now_singing', title, artist } };
  }
  if (me.next && me.next.position <= 1) {
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
 * Turn awareness without remote push (spec §4.4, ruling E10-R3): one haptic and an in-app banner when the singer
 * becomes up next and when they're on, once per entry per state. Only while the app is in the foreground (a turn
 * reached in the background alerts on return if it still holds). The fired set is kept per user and night in MMKV, so
 * a restart never alerts twice. The banner hides after 10 s or when dismissed.
 */
export function useTurnAlerts(me: MeResult | undefined, userKey: string | null, nightId: string) {
  const foreground = useAppForeground();
  const alert = useTurnBanner((s) => s.alert);
  const turn = turnOf(me);
  const turnId = turn ? `${turn.key}:${turn.state}` : null;

  useEffect(() => {
    if (!foreground || !turn || !turnId) return;
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
  }, [turnId, foreground, userKey, nightId]);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setBanner(null), turnAlertTiming.bannerMs);
    return () => clearTimeout(timer);
  }, [alert]);
  // A banner never outlives its night screen.
  useEffect(() => () => setBanner(null), []);

  return { alert, dismiss: dismissTurnBanner };
}
