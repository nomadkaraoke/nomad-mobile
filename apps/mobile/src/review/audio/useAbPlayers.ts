import type { InstrumentalChoice, InstrumentalOption } from '@nomad/review-core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLockstep } from './lockstep';
import { instrumentalUrl, MAX_URL_REFRESHES, refreshInstrumentalOptions } from './mediaSources';

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
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(active);
  const refreshes = useRef(0);
  const refreshing = useRef(false);

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
    const make = (uri: string, id: InstrumentalChoice) => {
      const p = createAudioPlayer({ uri }, { updateInterval: UPDATE_INTERVAL_MS });
      setMuted(p, id !== activeRef.current);
      return p;
    };
    const clean = make(urls[0]!, 'clean');
    const withBacking = make(urls[1]!, 'with_backing');
    const players = { clean, with_backing: withBacking };
    refreshes.current = 0;
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
        // Signed/proxied URLs can expire mid-review: re-fetch them (bounded), then give up with the error.
        if (refreshes.current >= MAX_URL_REFRESHES) {
          setError(s.error);
          return;
        }
        if (refreshing.current) return;
        refreshing.current = true;
        refreshes.current += 1;
        void refreshInstrumentalOptions(jobId)
          .then((fresh) => {
            const at = players[activeRef.current].currentTime;
            const wasPlaying = players[activeRef.current].playing;
            for (const pid of IDS) {
              const url = instrumentalUrl(jobId, fresh, pid);
              if (!url) continue;
              players[pid].replace({ uri: url });
              void Promise.resolve(players[pid].seekTo(at)).then(() => {
                if (wasPlaying) players[pid].play();
              });
            }
          })
          .catch(() => undefined)
          .finally(() => {
            refreshing.current = false;
          });
      }),
    );
    return () => {
      subs.forEach((s) => s.remove());
      clean.remove();
      withBacking.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the URLs of `options`
  }, [jobId, key]);

  useLockstep(pair?.[active] ?? null, pair?.[active === 'clean' ? 'with_backing' : 'clean'] ?? null);

  const setActive = useCallback(
    (c: InstrumentalChoice) => {
      activeRef.current = c;
      setActiveState(c);
      if (!pair) return;
      for (const id of IDS) setMuted(pair[id], id !== c);
    },
    [pair],
  );
  const play = useCallback(() => {
    if (pair) IDS.forEach((id) => pair[id].play());
  }, [pair]);
  const pause = useCallback(() => {
    if (pair) IDS.forEach((id) => pair[id].pause());
  }, [pair]);
  const seekTo = useCallback(
    async (t: number) => {
      if (pair) await Promise.all(IDS.map((id) => pair[id].seekTo(t)));
    },
    [pair],
  );

  return { active, setActive, play, pause, seekTo, playing, position, duration, loading: !pair || !loaded.clean || !loaded.with_backing, error };
}
