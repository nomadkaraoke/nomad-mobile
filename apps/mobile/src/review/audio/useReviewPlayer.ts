import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ensurePlaybackAudioMode } from '../../audio/playbackMode';
import { reviewAudioUrl, type ReviewSource } from './mediaSources';
import { replaceAndWait, safePlay, type AudioErrorCode } from './playback';

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
  /** The current source has loaded (gate playback on this). */
  loaded: boolean;
  position: number;
  duration: number;
  /** Synchronous player clock (Tap To Sync stamps from this, never from React state). */
  now(): number;
  /** Seek to `from`, play, and pause automatically at `to`. */
  playRange(from: number, to: number): void;
  error: AudioErrorCode | null;
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
  const [error, setError] = useState<AudioErrorCode | null>(null);
  const [loaded, setLoaded] = useState(false);

  const playerRef = useRef<AudioPlayer | null>(null);
  const rateRef = useRef(1);
  const rangeEndRef = useRef<number | null>(null);
  // Bumped by every playback command and by teardown: async continuations bail when it moved on.
  const genRef = useRef(0);
  // Bumped per source swap: a newer swap invalidates the older swap's continuation entirely.
  const swapRef = useRef(0);
  // Whether the swap in flight should resume playback (a rapid second swap inherits it: the first paused).
  const resumeRef = useRef<boolean | null>(null);
  const loadedSrcRef = useRef<{ jobId: string; source: ReviewSource } | null>(null);

  // The player exists per job; the source is swapped inside it so position and play state carry over.
  useEffect(() => {
    // Ruling E10-R7: set the playback audio mode before the first play (the singer taps play well after this).
    void ensurePlaybackAudioMode();
    const player = createAudioPlayer({ uri: reviewAudioUrl(jobId, 'song') }, { updateInterval: UPDATE_INTERVAL_MS });
    playerRef.current = player;
    loadedSrcRef.current = { jobId, source: 'song' };
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      setPlaying(s.playing);
      setPosition(s.currentTime);
      setDuration(s.duration);
      setLoaded(s.isLoaded);
      setError((prev) => (s.error ? 'load_failed' : prev === 'load_failed' ? null : prev));
      const end = rangeEndRef.current;
      if (end !== null && s.currentTime >= end) {
        rangeEndRef.current = null;
        player.pause();
      }
    });
    return () => {
      genRef.current += 1;
      swapRef.current += 1;
      resumeRef.current = null;
      sub.remove();
      player.remove();
      if (playerRef.current === player) playerRef.current = null;
      loadedSrcRef.current = null;
      rangeEndRef.current = null;
    };
  }, [jobId]);

  useEffect(() => {
    const player = playerRef.current;
    const cur = loadedSrcRef.current;
    if (!player || !cur || cur.jobId !== jobId || cur.source === source) return;
    const at = player.currentTime;
    const wasPlaying = resumeRef.current ?? player.playing;
    resumeRef.current = wasPlaying;
    const gen = ++genRef.current;
    const swap = ++swapRef.current;
    cur.source = source;
    void replaceAndWait(player, { uri: reviewAudioUrl(jobId, source) })
      .then(async () => {
        if (playerRef.current !== player || swap !== swapRef.current) return;
        player.setPlaybackRate(rateRef.current);
        await player.seekTo(at);
        // A pause/seek/play issued meanwhile wins over the automatic resume.
        if (swap !== swapRef.current) return;
        resumeRef.current = null;
        if (wasPlaying && gen === genRef.current && playerRef.current === player) safePlay(player, setError);
      })
      .catch(() => {
        if (playerRef.current === player && swap === swapRef.current) {
          resumeRef.current = null;
          setError('load_failed');
        }
      });
  }, [jobId, source]);

  const play = useCallback(() => {
    genRef.current += 1;
    resumeRef.current = null;
    setError((prev) => (prev === 'play_failed' ? null : prev));
    rangeEndRef.current = null;
    if (playerRef.current) safePlay(playerRef.current, setError);
  }, []);
  const pause = useCallback(() => {
    genRef.current += 1;
    resumeRef.current = null;
    rangeEndRef.current = null;
    playerRef.current?.pause();
  }, []);
  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    genRef.current += 1;
    resumeRef.current = null;
    rangeEndRef.current = null;
    if (p.playing) p.pause();
    else {
      setError((prev) => (prev === 'play_failed' ? null : prev));
      safePlay(p, setError);
    }
  }, []);
  const seekTo = useCallback(async (t: number) => {
    genRef.current += 1;
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
    const gen = ++genRef.current;
    rangeEndRef.current = null;
    // Arm the stop only once the seek has landed: a stale position past `to` must not pause us instantly.
    void Promise.resolve(p.seekTo(from))
      .then(() => {
        if (gen !== genRef.current || playerRef.current !== p) return;
        rangeEndRef.current = to;
        safePlay(p, setError);
      })
      .catch(() => undefined);
  }, []);

  return { play, pause, toggle, seekTo, setRate, rate, source, setSource, playing, loaded, position, duration, now, playRange, error };
}
