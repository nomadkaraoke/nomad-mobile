import type { InstrumentalChoice, InstrumentalOption } from '@nomad/review-core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ensurePlaybackAudioMode } from '../../audio/playbackMode';
import { useLockstep } from './lockstep';
import { instrumentalUrl, MAX_URL_REFRESHES, refreshInstrumentalOptions } from './mediaSources';
import { replaceAndWait, safePlay, type AudioErrorCode } from './playback';

export interface AbPlayers {
  active: InstrumentalChoice;
  /** Switches the audible stem at the same position: swaps `muted`, no seek. */
  setActive(c: InstrumentalChoice): void;
  play(): void;
  pause(): void;
  seekTo(t: number): Promise<void>;
  playing: boolean;
  position: number;
  duration: number;
  loading: boolean;
  error: AudioErrorCode | null;
}

const IDS: readonly InstrumentalChoice[] = ['clean', 'with_backing'];
const UPDATE_INTERVAL_MS = 100;

// Native player properties are written outside the component body (the compiler lint treats hook values as immutable).
const setMuted = (player: AudioPlayer, muted: boolean): void => {
  player.muted = muted;
};

/**
 * Both instrumental stems play in lockstep; only the active one is audible (the other is `muted`), so
 * A/B switching is instant and gapless. A 1 s watchdog (`useLockstep`) pulls the muted one back if it drifts.
 */
export function useAbPlayers(jobId: string, options: InstrumentalOption[]): AbPlayers {
  const [active, setActiveState] = useState<InstrumentalChoice>('clean');
  const [pair, setPair] = useState<{ clean: AudioPlayer; with_backing: AudioPlayer } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState({ clean: false, with_backing: false });
  const [error, setError] = useState<AudioErrorCode | null>(null);

  const activeRef = useRef(active);
  const refreshes = useRef(0);
  const refreshing = useRef(false);
  // Bumped by every playback command and by teardown: async continuations bail when it moved on.
  const genRef = useRef(0);

  // A change in the stems' URLs (not in the array identity) rebuilds the pair.
  const key = IDS.map((id) => options.find((o) => o.id === id)?.audio_url ?? '').join('|');

  useEffect(() => {
    const urls = IDS.map((id) => instrumentalUrl(jobId, options, id));
    // The pair is native state created here, so syncing it into React state from the effect is intended.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (urls.some((u) => !u)) {
      setPair(null);
      return;
    }
    // Ruling E10-R7: set the playback audio mode before the first play.
    void ensurePlaybackAudioMode();
    const make = (uri: string, id: InstrumentalChoice) => {
      const p = createAudioPlayer({ uri }, { updateInterval: UPDATE_INTERVAL_MS });
      setMuted(p, id !== activeRef.current);
      return p;
    };
    const clean = make(urls[0]!, 'clean');
    const withBacking = make(urls[1]!, 'with_backing');
    const players = { clean, with_backing: withBacking };
    // Cap = 3 refreshes in total for this pair (not per error); it only resets when the stem URLs change.
    refreshes.current = 0;
    refreshing.current = false;
    let disposed = false;
    setLoaded({ clean: false, with_backing: false });
    setError(null);
    setPair(players);
    /* eslint-enable react-hooks/set-state-in-effect */

    const subs = IDS.map((id) =>
      players[id].addListener('playbackStatusUpdate', (s) => {
        setLoaded((l) => (l[id] === s.isLoaded ? l : { ...l, [id]: s.isLoaded }));
        if (id === activeRef.current) {
          setPlaying(s.playing);
          setPosition(s.currentTime);
          setDuration(s.duration);
        }
        if (!s.error) return;
        // Signed/proxied URLs can expire mid-review: re-fetch them (bounded), then give up.
        if (refreshes.current >= MAX_URL_REFRESHES) {
          setError('load_failed');
          return;
        }
        if (refreshing.current) return;
        refreshing.current = true;
        refreshes.current += 1;
        const gen = ++genRef.current;
        void refreshInstrumentalOptions(jobId)
          .then(async (fresh) => {
            if (disposed) return;
            const cur = players[activeRef.current];
            const at = cur.currentTime;
            const wasPlaying = cur.playing;
            await Promise.all(
              IDS.map(async (pid) => {
                const url = instrumentalUrl(jobId, fresh, pid);
                if (!url) return;
                await replaceAndWait(players[pid], { uri: url });
                if (disposed) return;
                await players[pid].seekTo(at);
                if (wasPlaying && gen === genRef.current && !disposed) safePlay(players[pid], setError);
              }),
            );
          })
          .catch(() => {
            if (!disposed) setError('load_failed');
          })
          .finally(() => {
            refreshing.current = false;
          });
      }),
    );
    return () => {
      disposed = true;
      genRef.current += 1;
      subs.forEach((s) => s.remove());
      clean.remove();
      withBacking.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the URLs of `options`
  }, [jobId, key]);

  useLockstep(pair?.[active] ?? null, pair?.[active === 'clean' ? 'with_backing' : 'clean'] ?? null);

  const setActive = useCallback(
    (c: InstrumentalChoice) => {
      // Muting is not a playback command: it must not cancel a pending auto-resume.
      activeRef.current = c;
      setActiveState(c);
      if (!pair) return;
      for (const id of IDS) setMuted(pair[id], id !== c);
    },
    [pair],
  );
  const play = useCallback(() => {
    genRef.current += 1;
    setError((prev) => (prev === 'play_failed' ? null : prev));
    if (pair) IDS.forEach((id) => safePlay(pair[id], setError));
  }, [pair]);
  const pause = useCallback(() => {
    genRef.current += 1;
    if (pair) IDS.forEach((id) => pair[id].pause());
  }, [pair]);
  const seekTo = useCallback(
    async (t: number) => {
      genRef.current += 1;
      if (pair) await Promise.all(IDS.map((id) => pair[id].seekTo(t)));
    },
    [pair],
  );

  return { active, setActive, play, pause, seekTo, playing, position, duration, loading: !error && (!pair || !loaded.clean || !loaded.with_backing), error };
}
