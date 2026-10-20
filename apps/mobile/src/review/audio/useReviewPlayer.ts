import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { reviewAudioUrl, type ReviewSource } from './mediaSources';

export type { ReviewSource } from './mediaSources';
type Rate = 1 | 0.75 | 0.5;

export interface ReviewPlayer {
  play(): void;
  pause(): void;
  toggle(): void;
  seekTo(t: number): Promise<void>;
  setRate(r: Rate): void;
  rate: number;
  source: ReviewSource;
  setSource(s: ReviewSource): void;
  playing: boolean;
  position: number;
  duration: number;
  /** Synchronous player clock (Tap To Sync stamps from this, never from React state). */
  now(): number;
  /** Seek to `from`, play, and pause automatically at `to`. */
  playRange(from: number, to: number): void;
  error: string | null;
}

const UPDATE_INTERVAL_MS = 33;

/** One player over the song or the vocals stem; vocals fall back to the song until `vocalsReady`. */
export function useReviewPlayer(jobId: string, opts: { vocalsReady: boolean }): ReviewPlayer {
  const [wanted, setSource] = useState<ReviewSource>('song');
  const source: ReviewSource = wanted === 'vocals' && opts.vocalsReady ? 'vocals' : 'song';
  const [rate, setRateState] = useState<number>(1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const rateRef = useRef(1);
  const rangeEndRef = useRef<number | null>(null);
  const loadedRef = useRef<{ jobId: string; source: ReviewSource } | null>(null);

  // The player exists per job; the source is swapped inside it so position and play state carry over.
  useEffect(() => {
    const player = createAudioPlayer({ uri: reviewAudioUrl(jobId, 'song') }, { updateInterval: UPDATE_INTERVAL_MS });
    playerRef.current = player;
    loadedRef.current = { jobId, source: 'song' };
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      setPlaying(s.playing);
      setPosition(s.currentTime);
      setDuration(s.duration);
      setError(s.error ?? null);
      const end = rangeEndRef.current;
      if (end !== null && s.currentTime >= end) {
        rangeEndRef.current = null;
        player.pause();
      }
    });
    return () => {
      sub.remove();
      player.remove();
      if (playerRef.current === player) playerRef.current = null;
      loadedRef.current = null;
      rangeEndRef.current = null;
    };
  }, [jobId]);

  useEffect(() => {
    const player = playerRef.current;
    const loaded = loadedRef.current;
    if (!player || !loaded || loaded.jobId !== jobId || loaded.source === source) return;
    const at = player.currentTime;
    const wasPlaying = player.playing;
    loaded.source = source;
    player.replace({ uri: reviewAudioUrl(jobId, source) });
    player.setPlaybackRate(rateRef.current);
    void Promise.resolve(player.seekTo(at)).then(() => {
      if (wasPlaying) player.play();
    });
  }, [jobId, source]);

  const play = useCallback(() => {
    rangeEndRef.current = null;
    playerRef.current?.play();
  }, []);
  const pause = useCallback(() => {
    rangeEndRef.current = null;
    playerRef.current?.pause();
  }, []);
  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    rangeEndRef.current = null;
    if (p.playing) p.pause();
    else p.play();
  }, []);
  const seekTo = useCallback(async (t: number) => {
    rangeEndRef.current = null;
    await playerRef.current?.seekTo(t);
  }, []);
  const setRate = useCallback((r: Rate) => {
    rateRef.current = r;
    setRateState(r);
    playerRef.current?.setPlaybackRate(r);
  }, []);
  const now = useCallback(() => playerRef.current?.currentTime ?? 0, []);
  const playRange = useCallback((from: number, to: number) => {
    const p = playerRef.current;
    if (!p) return;
    rangeEndRef.current = null;
    // Arm the stop only once the seek has landed: a stale position past `to` must not pause us instantly.
    void Promise.resolve(p.seekTo(from)).then(() => {
      rangeEndRef.current = to;
      p.play();
    });
  }, []);

  return { play, pause, toggle, seekTo, setRate, rate, source, setSource, playing, position, duration, now, playRange, error };
}
