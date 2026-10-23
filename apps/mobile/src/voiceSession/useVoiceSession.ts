// The voice session's state machine (Phase 3d D5): setup → (warm-up) → pick → play → quiz → … → result, over decide's
// /api/voice/sessions calls, the song recorder (D4) and the karaoke player (D3). State lives in sessionStore (MMKV) so
// a killed app resumes; on mount the stored session is checked against decide. No UI and no copy here: errors are
// kinds that the screens (D6) turn into words.
import {
  ApiError,
  createVoiceSession,
  getVoiceFlags,
  getVoiceResult,
  getVoiceSession,
  nextVoiceSong,
  patchVoiceSession,
  postVoiceAttempt,
  skipVoiceSong,
  voiceErrorCode,
  type AttemptIn,
  type ResultOut,
  type SessionPatch,
  type SessionSetup,
  type SkipIn,
} from '@nomad/api-decide';
import {
  canSubmitQuiz,
  EMPTY_SESSION_QUIZ,
  prefillPosition,
  toQuizIn,
  type PitchSummary,
  type PositionPrefill,
  type QuizAnswers,
} from '@nomad/core';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { PLAYER_MODE } from '../config';
import { usePitchSource } from '../voice/usePitchSource';
import type { PlayerEvent, PlayerHandle } from './player/KaraokePlayer';
import type { PlayerMode } from './player/playerMode';
import { AAC_DIR_NAMES, AAC_FILE_PREFIX, deleteFileQuietly, WAV_DIR_NAME } from './recording/files';
import { useRecordingQueue } from './recording/recordingQueue';
import { useSongRecorder } from './recording/useSongRecorder';
import { EMPTY_SESSION, useVoiceSessionStore, type SessionState, type VsStep } from './sessionStore';

export type { VsStep } from './sessionStore';

/** An embed that reports neither `ready` nor an error in this long (offline, a stuck WebView) counts as unplayable. */
export const PLAYER_READY_TIMEOUT_MS = 20_000;

/**
 * What went wrong, for the screens to word. `network` / `warming_up` / `server` keep the step and offer `retry()`;
 * `session_lost` (decide no longer has the session, or refused it) moves to the `error` step: start again.
 */
export type VsErrorKind = 'network' | 'warming_up' | 'server' | 'session_lost';
export type SkipReason = Exclude<SkipIn['reason'], 'not_embeddable'>;

export type VoiceSession = {
  step: VsStep;
  setup: SessionSetup | null;
  song: SessionState['song'];
  /** decide's attempt number for this song and the session's cap (progress). */
  attemptN: number;
  maxAttempts: number | null;
  quiz: QuizAnswers;
  /** Q2's prefill from the song's pitch summary (null without one). */
  prefill: PositionPrefill | null;
  result: ResultOut | null;
  /** The singer's live note (MIDI) while the recorder runs (play, warm-up). */
  livePitch: number | null;
  /** The player for this song: link-out when decide marks the offered version not embeddable. */
  playerMode: PlayerMode;
  /** Pass to `KaraokePlayer`'s `ref`: the session starts the video itself once the recorder runs. */
  playerRef: RefObject<PlayerHandle | null>;
  error: VsErrorKind | null;
  /** True while the stored session is being checked with decide on mount. */
  restoring: boolean;
  /** intro → setup (a finished or broken session is forgotten first). */
  openSetup(): void;
  begin(setup: SessionSetup, floor?: number): Promise<void>;
  startWarmup(floor?: number): Promise<void>;
  endWarmup(): Promise<void>;
  pickKnow(): Promise<void>;
  pickSkip(reason: SkipReason): Promise<void>;
  onPlayer(e: PlayerEvent): Promise<void>;
  stopEarly(): Promise<void>;
  setAnswer(patch: Partial<QuizAnswers>): void;
  submitQuiz(): Promise<void>;
  finish(): Promise<void>;
  patchContext(patch: SessionPatch): Promise<void>;
  /** Repeats the call that failed (`error` set). */
  retry(): Promise<void>;
  /** Forgets the session: back to the intro. */
  reset(): void;
};

type Failure =
  | { kind: 'disabled' }
  | { kind: 'ended' }
  | { kind: 'retry'; error: VsErrorKind }
  | { kind: 'fatal'; error: VsErrorKind };

/** decide's refusal (or a lost connection) as what the session does next. */
function classify(e: unknown): Failure {
  const code = voiceErrorCode(e);
  if (code === 'voice_session_disabled') return { kind: 'disabled' };
  if (code === 'session_not_active' || code === 'max_attempts') return { kind: 'ended' };
  if (code === 'warming_up') return { kind: 'retry', error: 'warming_up' };
  if (!(e instanceof ApiError) || e.status === 0) return { kind: 'retry', error: 'network' };
  if (e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429)
    return { kind: 'retry', error: 'server' };
  if (e.status === 404 || code === 'session_forbidden') return { kind: 'fatal', error: 'session_lost' };
  return { kind: 'fatal', error: 'server' };
}

const toPitchIn = (p: PitchSummary | null): AttemptIn['pitch'] =>
  p && {
    voiced_s: p.voicedS,
    held_count: p.heldCount,
    held_low: p.heldLow,
    held_high: p.heldHigh,
    p10: p.p10,
    p50: p.p50,
    p90: p.p90,
  };

/** The per-song fields reset for a new offer. */
const FRESH_SONG = {
  quiz: EMPTY_SESSION_QUIZ,
  pitch: null,
  playStartedAt: null,
  playEndedAt: null,
  stoppedEarly: false,
  take: null,
} satisfies Partial<SessionState>;

const warn = (what: string, e: unknown) => console.warn(`[voice session] ${what}: ${String(e)}`);

/**
 * Deletes take files nothing refers to (a song killed mid-way, iOS keep-alive takes): every WAV take and every
 * expo-audio `recording-*` file that is neither queued for upload nor the session's take awaiting its quiz.
 */
function sweepOrphanRecordings(): void {
  const keep = new Set(useRecordingQueue.getState().items.map((i) => i.uri));
  const take = useVoiceSessionStore.getState().take;
  if (take) keep.add(take.uri);
  const sweep = (name: string, match: (file: string) => boolean) => {
    try {
      const dir = new Directory(Paths.document, name);
      if (!dir.exists) return;
      for (const f of dir.list()) {
        if (f instanceof File && match(f.name) && !keep.has(f.uri)) deleteFileQuietly(f.uri);
      }
    } catch (e) {
      warn('orphan sweep failed', e);
    }
  };
  sweep(WAV_DIR_NAME, () => true);
  for (const d of AAC_DIR_NAMES) sweep(d, (n) => n.startsWith(AAC_FILE_PREFIX));
}

const get = () => useVoiceSessionStore.getState();
const update = (patch: Partial<SessionState>) => get().update(patch);

/** Forgets the finished song's take (not queued) and its file. */
const discardTake = () => {
  const take = get().take;
  if (!take) return;
  deleteFileQuietly(take.uri);
  update({ take: null });
};

export function useVoiceSession(): VoiceSession {
  const s = useVoiceSessionStore();
  const source = usePitchSource();
  const recorder = useSongRecorder(source, {
    record: s.step !== 'warmup' && !!s.setup?.record,
    floor: s.floor,
  });
  const recorderRef = useRef(recorder);
  useEffect(() => {
    recorderRef.current = recorder;
  });
  const playerRef = useRef<PlayerHandle | null>(null);
  const [result, setResult] = useState<ResultOut | null>(null);
  const [error, setError] = useState<VsErrorKind | null>(null);
  const [restoring, setRestoring] = useState(true);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  /** The video whose `ready` arrived (the ready timeout is armed for any other). */
  const readyFor = useRef<string | null>(null);
  /** The running take's consent: true only if recording was on at start() and never turned off since. */
  const takeConsent = useRef(false);
  /** A song is being stopped (ended / stop early / unplayable / finish all race for it). */
  const stopping = useRef(false);

  const actions = useMemo(() => {
    /**
     * Runs one decide call: clears the error, and on failure records how to retry it and moves the step. `then` runs
     * after a success (also after a retried one) and handles its own failures: never nest attempt() inside `fn`, or
     * the outer success would clear the inner failure's retry.
     */
    const attempt = async (fn: () => Promise<void>, then?: () => Promise<void>): Promise<void> => {
      retryRef.current = () => attempt(fn, then);
      setError(null);
      try {
        await fn();
        retryRef.current = null;
      } catch (e) {
        const f = classify(e);
        if (f.kind === 'disabled') {
          retryRef.current = null;
          update({ step: 'disabled' });
        } else if (f.kind === 'ended') {
          retryRef.current = null;
          await goResult();
        } else {
          if (f.kind === 'fatal') update({ step: 'error' });
          setError(f.error);
          // Offline and warming up are expected (the screen offers retry); anything else is worth a log line.
          if (f.error === 'server') warn('call failed', e);
        }
        return;
      }
      await then?.();
    };

    const goResult = (): Promise<void> =>
      attempt(async () => {
        const id = get().sessionId;
        if (!id) return;
        const r = await getVoiceResult(id);
        discardTake();
        setResult(r);
        update({ step: 'result' });
      });

    /** The next offer. The song the singer already said they know (a version skip) goes straight back to play. */
    const loadNext = (autoPlayKey: string | null = null): Promise<void> => {
      const reply = { done: false };
      return attempt(
        async () => {
          const id = get().sessionId;
          if (!id) return;
          update({ step: 'loading' });
          const n = await nextVoiceSong(id);
          if (n.kind === 'done') {
            reply.done = true;
            return;
          }
          const { kind: _kind, ...song } = n;
          update({
            ...FRESH_SONG,
            song,
            attemptN: song.attempt_n,
            step: song.song_key === autoPlayKey ? 'play' : 'pick',
          });
        },
        async () => {
          if (reply.done) await goResult();
        },
      );
    };

    /** Stops the running take; returns it (null when no song was playing or another stop got there first). */
    const stopTake = async () => {
      if (stopping.current) return null;
      stopping.current = true;
      try {
        return await recorderRef.current.stop();
      } catch (e) {
        warn('recorder stop failed', e);
        return { pitch: null, file: null };
      } finally {
        stopping.current = false;
      }
    };

    const endSong = async (stoppedEarly: boolean) => {
      if (get().step !== 'play' || stopping.current) return;
      const take = await stopTake();
      if (!take || get().step !== 'play') {
        deleteFileQuietly(take?.file?.uri);
        return;
      }
      const keep = take.file && takeConsent.current && get().setup?.record === true ? take.file : null;
      if (take.file && !keep) deleteFileQuietly(take.file.uri);
      const now = Date.now();
      update({
        step: 'quiz',
        pitch: take.pitch,
        take: keep,
        stoppedEarly,
        playStartedAt: get().playStartedAt ?? now,
        playEndedAt: now,
      });
    };

    const unplayable = async () => {
      const { step, song, sessionId } = get();
      if (step !== 'play' || !song || !sessionId) return;
      const take = await stopTake();
      deleteFileQuietly(take?.file?.uri);
      const body: SkipIn = {
        song_key: song.song_key,
        reason: 'not_embeddable',
        video_id: song.version.video_id,
      };
      await attempt(
        () => skipVoiceSong(sessionId, body),
        () => loadNext(song.song_key),
      );
    };

    const onPlayer = async (e: PlayerEvent) => {
      const { step, song } = get();
      if (step !== 'play' || !song) return;
      const videoId = song.version.video_id;
      switch (e.kind) {
        case 'ready': {
          if (readyFor.current === videoId) return;
          readyFor.current = videoId;
          // iOS start order (D1/D4): audio mode → stream → recorder, and only then the video.
          takeConsent.current = get().setup?.record === true;
          try {
            await recorderRef.current.start();
          } catch (err) {
            // No pitch for this song, but the singer can still sing it and answer the quiz.
            warn('recorder did not start', err);
          }
          if (get().step === 'play' && get().song?.version.video_id === videoId) playerRef.current?.play();
          return;
        }
        case 'playing':
          if (get().playStartedAt === null) update({ playStartedAt: Date.now() });
          return;
        case 'ended':
          return endSong(false);
        case 'unplayable':
          return unplayable();
      }
    };

    return {
      attempt,
      goResult,
      loadNext,
      unplayable,
      onPlayer,
      openSetup() {
        const step = get().step;
        if (step === 'intro' || step === 'result' || step === 'error') {
          if (step !== 'intro') get().clear();
          setResult(null);
          setError(null);
          update({ step: 'setup' });
        }
      },
      async begin(setup: SessionSetup, floor?: number) {
        const f = floor ?? get().floor;
        await attempt(
          async () => {
            const { session_id } = await createVoiceSession(setup);
            update({
              ...EMPTY_SESSION,
              sessionId: session_id,
              setup,
              floor: f,
              step: 'loading',
            });
            setResult(null);
          },
          () => loadNext(),
        );
      },
      async startWarmup(floor?: number) {
        // The recorder starts in an effect, once its options (no recording, this floor) have rendered.
        update({ step: 'warmup', ...(floor !== undefined && { floor }) });
      },
      async endWarmup() {
        if (get().step !== 'warmup') return;
        const take = await stopTake();
        deleteFileQuietly(take?.file?.uri);
        update({ step: 'setup' });
      },
      async pickKnow() {
        if (get().step !== 'pick') return;
        readyFor.current = null;
        update({ ...FRESH_SONG, step: 'play' });
      },
      async pickSkip(reason: SkipReason) {
        const { step, song, sessionId } = get();
        if (step !== 'pick' || !song || !sessionId) return;
        await attempt(
          () => skipVoiceSong(sessionId, { song_key: song.song_key, reason }),
          () => loadNext(),
        );
      },
      stopEarly: () => endSong(true),
      setAnswer(patch: Partial<QuizAnswers>) {
        update({ quiz: { ...get().quiz, ...patch } });
      },
      async submitQuiz() {
        const st = get();
        if (st.step !== 'quiz' || !st.song || !st.sessionId || !st.setup || !canSubmitQuiz(st.quiz)) return;
        const { sessionId, song, setup, quiz } = st;
        const body: AttemptIn = {
          song_key: song.song_key,
          video_id: song.version.video_id,
          started_at: new Date(st.playStartedAt ?? st.savedAt).toISOString(),
          ended_at: new Date(st.playEndedAt ?? st.savedAt).toISOString(),
          stopped_early: st.stoppedEarly,
          quiz: toQuizIn(quiz),
          pitch: toPitchIn(st.pitch),
        };
        const posted = { done: false };
        await attempt(
          async () => {
            const out = await postVoiceAttempt(sessionId, body);
            posted.done = out.done;
            // Recording consent as it stands now: turned off since the song, the take is not uploaded.
            const take = get().take;
            if (take && get().setup?.record === true) {
              const queue = useRecordingQueue.getState();
              queue.enqueue({
                sessionId,
                attemptN: out.n,
                uri: take.uri,
                contentType: take.contentType,
                durationS: take.durationS,
                device: setup.device ?? null,
              });
              void queue.flush();
            } else if (take) {
              deleteFileQuietly(take.uri);
            }
            // Q7 "Warm": the singer has warmed up since the setup (decide reads the attempt's quiz itself).
            const now = get().setup ?? setup;
            update({
              ...FRESH_SONG,
              step: 'loading',
              setup: quiz.voiceNow === 'warm' ? { ...now, warmth: 'warm' } : now,
            });
          },
          () => (posted.done ? goResult() : loadNext()),
        );
      },
      async finish() {
        const { step } = get();
        if (!get().sessionId) return;
        if (step === 'play') {
          const take = await stopTake();
          deleteFileQuietly(take?.file?.uri);
        }
        discardTake();
        await goResult();
      },
      async patchContext(patch: SessionPatch) {
        const { sessionId, setup } = get();
        if (!sessionId || !setup) return;
        const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
        update({ setup: { ...setup, ...changes } });
        if (patch.record === false) {
          // Consent withdrawn: nothing recorded in this session is uploaded, including the take now running.
          takeConsent.current = false;
          useRecordingQueue.getState().dropSession(sessionId);
          discardTake();
        }
        await attempt(() => patchVoiceSession(sessionId, patch));
      },
      async retry() {
        await retryRef.current?.();
      },
      reset() {
        discardTake();
        get().clear();
        retryRef.current = null;
        setResult(null);
        setError(null);
      },
    };
  }, []);

  // Mount: sweep orphaned takes, then check the stored session (and the feature flag) with decide.
  useEffect(() => {
    sweepOrphanRecordings();
    let live = true;
    void (async () => {
      const flags = await getVoiceFlags().catch(() => null);
      if (!live) return;
      if (flags && !flags.session_enabled) {
        update({ step: 'disabled' });
        setRestoring(false);
        return;
      }
      const { sessionId, step, attemptN } = get();
      if (!sessionId) {
        if (step === 'disabled' && flags) update({ step: 'intro' });
        setRestoring(false);
        return;
      }
      let server: Awaited<ReturnType<typeof getVoiceSession>> | null = null;
      try {
        server = await getVoiceSession(sessionId);
      } catch (e) {
        const f = classify(e);
        // Offline: carry on from the phone's copy. Gone or refused: start fresh.
        if (f.kind === 'fatal') get().clear();
      }
      if (!live) return;
      setRestoring(false);
      if (!server) return;
      if (server.state === 'abandoned') {
        actions.reset();
      } else if (server.state === 'done' || step === 'result') {
        await actions.goResult();
      } else if (step === 'quiz' && server.attempts >= attemptN) {
        // decide already has this song's attempt (the app died right after posting it).
        discardTake();
        await actions.loadNext();
      } else if (step === 'loading' || step === 'error' || step === 'disabled') {
        await actions.loadNext();
      }
    })();
    return () => {
      live = false;
    };
  }, [actions]);

  // Warm-up: the recorder runs (never recording) for the live pitch ribbon.
  useEffect(() => {
    if (s.step !== 'warmup') return;
    recorder.start().catch((e) => warn('warm-up mic did not start', e));
    // Started once per warm-up; endWarmup / unmount stop it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.step]);

  // Play: an embed that never reports ready (offline, a stuck WebView) is skipped as unplayable.
  const videoId = s.song?.version.video_id ?? null;
  useEffect(() => {
    if (s.step !== 'play' || !videoId || readyFor.current === videoId) return;
    const timer = setTimeout(() => {
      if (readyFor.current !== videoId) void actions.unplayable();
    }, PLAYER_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [s.step, videoId, actions]);

  const prefill = useMemo(() => prefillPosition(s.pitch, s.song?.song_range ?? null), [s.pitch, s.song]);

  return {
    step: s.step,
    setup: s.setup,
    song: s.song,
    attemptN: s.attemptN,
    maxAttempts: s.song?.max_attempts ?? null,
    quiz: s.quiz,
    prefill,
    result,
    livePitch: recorder.livePitch,
    playerMode: s.song?.version.embeddable === false ? 'linkout' : PLAYER_MODE,
    playerRef,
    error,
    restoring,
    openSetup: actions.openSetup,
    begin: actions.begin,
    startWarmup: actions.startWarmup,
    endWarmup: actions.endWarmup,
    pickKnow: actions.pickKnow,
    pickSkip: actions.pickSkip,
    onPlayer: actions.onPlayer,
    stopEarly: actions.stopEarly,
    setAnswer: actions.setAnswer,
    submitQuiz: actions.submitQuiz,
    finish: actions.finish,
    patchContext: actions.patchContext,
    retry: actions.retry,
    reset: actions.reset,
  };
}
