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
  /** A user action is running (its button's second tap is ignored): disable the session's buttons. */
  busy: boolean;
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

  /** Bumped by reset() and by a new begin(): async work from before then must not touch the session. */
  const generation = useRef(0);
  /**
   * The user action (begin, pick, submit, finish, retry, or sending a context change) now running, else null: further
   * taps are ignored. Each run owns a token, so a stale call settling after reset() can't release a newer one.
   */
  const inFlight = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  /** A context change decide hasn't got yet (sent once the running action settles, or retried after the next). */
  const pendingPatch = useRef<{ sessionId: string; patch: SessionPatch } | null>(null);

  const actions = useMemo(() => {
    /** True while the session (and the hook's generation) is still the one `id` / `gen` were captured from. */
    const current = (id: string | null, gen: number) => generation.current === gen && get().sessionId === id;

    /**
     * One user action at a time (double taps are dropped); `busy` mirrors it for the screens. When a main action
     * settles, a context change that waited for it (or failed earlier) is sent.
     */
    const guarded =
      <A extends unknown[]>(fn: (...a: A) => Promise<void>) =>
      async (...a: A): Promise<void> => {
        if (inFlight.current) return;
        const token = {};
        inFlight.current = token;
        setBusy(true);
        try {
          await fn(...a);
        } finally {
          if (inFlight.current === token) {
            inFlight.current = null;
            setBusy(false);
            if (pendingPatch.current) void sendPendingPatch();
          }
        }
      };

    /**
     * Sends the waiting context change, as a user action of its own (busy while it runs; skipped while another runs,
     * which sends it when it settles). It never takes over `error` / `retry()` (those belong to the session's own
     * flow): a lost connection keeps it waiting for the next action; a refusal is logged.
     */
    async function sendPendingPatch(): Promise<void> {
      const p = pendingPatch.current;
      if (!p || inFlight.current) return;
      pendingPatch.current = null;
      if (get().sessionId !== p.sessionId) return;
      const token = {};
      inFlight.current = token;
      setBusy(true);
      const gen = generation.current;
      try {
        await patchVoiceSession(p.sessionId, p.patch);
      } catch (e) {
        if (generation.current !== gen || get().sessionId !== p.sessionId) return;
        const f = classify(e);
        if (f.kind === 'disabled') {
          await dropRunningTake();
          update({ step: 'disabled' });
        } else if (f.kind === 'retry') {
          // Keep it (merged under any newer change) for the next action or retry.
          const newer = pendingPatch.current as { patch: SessionPatch } | null;
          pendingPatch.current = { sessionId: p.sessionId, patch: { ...p.patch, ...newer?.patch } };
        } else if (f.kind === 'fatal') {
          warn('context change refused', e);
        }
      } finally {
        if (inFlight.current === token) {
          inFlight.current = null;
          setBusy(false);
        }
      }
    }

    /** Stops the running take; returns it (null when another stop got there first). */
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

    /** Leaving `play` other than into the quiz (error, result, disabled, reset): the take is stopped and dropped. */
    const dropRunningTake = async () => {
      if (get().step !== 'play') return;
      const take = await stopTake();
      deleteFileQuietly(take?.file?.uri);
    };

    type Stage = {
      /** The decide call; `ok()` says whether its result may still be applied (call it after every await). */
      fn: (ok: () => boolean) => Promise<void>;
      /** Runs after a success (also a retried one) and handles its own failures. */
      then?: () => Promise<void>;
      /** Instead of going to the result on 409 session_not_active / max_attempts. */
      onEnded?: () => Promise<void>;
      /** begin(): the stage creates the session, so only the generation is checked. */
      createsSession?: boolean;
    };

    /**
     * Runs one decide call for the session as it is now: clears the error, and on failure records how to retry it
     * and moves the step. Never nest attempt() inside `fn` (the outer success would clear the inner retry): chain
     * with `then`. Work for a session that has since been reset or replaced is dropped silently.
     */
    const attempt = async (stage: Stage, id: string | null = get().sessionId): Promise<void> => {
      const gen = generation.current;
      const ok = () => (stage.createsSession ? generation.current === gen : current(id, gen));
      retryRef.current = () => attempt(stage, id);
      setError(null);
      try {
        await stage.fn(ok);
      } catch (e) {
        if (!ok()) return;
        const f = classify(e);
        if (f.kind === 'disabled') {
          retryRef.current = null;
          await dropRunningTake();
          if (ok()) update({ step: 'disabled' });
        } else if (f.kind === 'ended') {
          retryRef.current = null;
          await (stage.onEnded ?? goResult)();
        } else {
          if (f.kind === 'fatal') {
            await dropRunningTake();
            if (!ok()) return;
            update({ step: 'error' });
          }
          setError(f.error);
          // Offline and warming up are expected (the screen offers retry); anything else is worth a log line.
          if (f.error === 'server') warn('call failed', e);
        }
        return;
      }
      if (!ok()) return;
      retryRef.current = null;
      await stage.then?.();
    };

    const goResult = (): Promise<void> =>
      attempt({
        fn: async (ok) => {
          const id = get().sessionId;
          if (!id) return;
          const r = await getVoiceResult(id);
          if (!ok()) return;
          await dropRunningTake();
          if (!ok()) return;
          discardTake();
          setResult(r);
          update({ step: 'result' });
        },
      });

    /** The next offer. The song the singer already said they know (a version skip) goes straight back to play. */
    const loadNext = (autoPlayKey: string | null = null): Promise<void> => {
      const reply = { done: false };
      return attempt({
        fn: async (ok) => {
          const id = get().sessionId;
          if (!id) return;
          update({ step: 'loading' });
          const n = await nextVoiceSong(id);
          if (!ok()) return;
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
        then: async () => {
          if (reply.done) await goResult();
        },
      });
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
      // The attempt's times are fixed here, once: a retried or re-sent attempt carries the same ones.
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
      if (get().sessionId !== sessionId) return;
      const body: SkipIn = { song_key: song.song_key, reason: 'not_embeddable', video_id: song.version.video_id };
      await attempt({ fn: () => skipVoiceSong(sessionId, body), then: () => loadNext(song.song_key) });
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

    /** Queues the finished song's take as attempt `n` when recording consent is on now; otherwise deletes it. */
    const queueTake = (sessionId: string, n: number, device: string | null) => {
      const take = get().take;
      if (!take) return;
      if (get().setup?.record === true) {
        const queue = useRecordingQueue.getState();
        queue.enqueue({
          sessionId,
          attemptN: n,
          uri: take.uri,
          contentType: take.contentType,
          durationS: take.durationS,
          device,
        });
        void queue.flush();
      } else {
        deleteFileQuietly(take.uri);
      }
      update({ take: null });
    };

    /**
     * Posts the quiz's attempt. Also used on a relaunch whose attempt decide may already have: decide dedupes on
     * session + song + started_at and returns the existing `n`, so the body (times included) must be the stored one.
     */
    const postAttempt = async (): Promise<void> => {
      const st = get();
      if (st.step !== 'quiz' || !st.song || !st.sessionId || !st.setup || !canSubmitQuiz(st.quiz)) return;
      const { sessionId, song, setup, quiz, attemptN } = st;
      // endSong / a relaunch set both; fix them in the store if an older copy lacks one, so they never move.
      const startedAt = st.playStartedAt ?? Date.now();
      const endedAt = st.playEndedAt ?? startedAt;
      if (st.playStartedAt === null || st.playEndedAt === null)
        update({ playStartedAt: startedAt, playEndedAt: endedAt });
      const body: AttemptIn = {
        song_key: song.song_key,
        video_id: song.version.video_id,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        stopped_early: st.stoppedEarly,
        quiz: toQuizIn(quiz),
        pitch: toPitchIn(st.pitch),
      };
      const device = setup.device ?? null;
      const posted = { done: false };
      await attempt({
        fn: async (ok) => {
          const out = await postVoiceAttempt(sessionId, body);
          if (!ok()) return;
          posted.done = out.done;
          queueTake(sessionId, out.n, device);
          // Q7 "Warm": the singer has warmed up since the setup (decide reads the attempt's quiz itself).
          const now = get().setup ?? setup;
          update({
            ...FRESH_SONG,
            step: 'loading',
            setup: quiz.voiceNow === 'warm' ? { ...now, warmth: 'warm' } : now,
          });
        },
        then: () => (posted.done ? goResult() : loadNext()),
        // A retry after a lost response whose attempt ended the session: the attempt is there as `attemptN` when
        // decide counts it; then the take still belongs to it.
        onEnded: async () => {
          if (get().take) {
            try {
              const so = await getVoiceSession(sessionId);
              if (get().sessionId !== sessionId) return;
              if (so.attempts >= attemptN) queueTake(sessionId, attemptN, device);
              else warn('attempt not recorded, take dropped', `session ${sessionId} attempt ${attemptN}`);
            } catch (e) {
              warn('take dropped (session unreadable)', e);
            }
            discardTake();
          }
          await goResult();
        },
      });
    };

    const reset = () => {
      generation.current++;
      void dropRunningTake();
      discardTake();
      get().clear();
      retryRef.current = null;
      // A call still hanging for the old session must not keep the buttons locked.
      inFlight.current = null;
      pendingPatch.current = null;
      setBusy(false);
      setResult(null);
      setError(null);
    };

    return {
      goResult,
      loadNext,
      unplayable,
      onPlayer,
      reset,
      openSetup() {
        const step = get().step;
        if (step === 'intro' || step === 'result' || step === 'error') {
          if (step !== 'intro') reset();
          update({ step: 'setup' });
        }
      },
      begin: guarded(async (setup: SessionSetup, floor?: number) => {
        // A new session: anything still running for an older one is dropped.
        generation.current++;
        const f = floor ?? get().floor;
        await attempt({
          fn: async (ok) => {
            const { session_id } = await createVoiceSession(setup);
            if (!ok()) return;
            update({ ...EMPTY_SESSION, sessionId: session_id, setup, floor: f, step: 'loading' });
            setResult(null);
          },
          then: () => loadNext(),
          createsSession: true,
        });
      }),
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
      pickKnow: guarded(async () => {
        if (get().step !== 'pick') return;
        readyFor.current = null;
        update({ ...FRESH_SONG, step: 'play' });
      }),
      pickSkip: guarded(async (reason: SkipReason) => {
        const { step, song, sessionId } = get();
        if (step !== 'pick' || !song || !sessionId) return;
        await attempt({
          fn: () => skipVoiceSong(sessionId, { song_key: song.song_key, reason }),
          then: () => loadNext(),
        });
      }),
      stopEarly: () => endSong(true),
      setAnswer(patch: Partial<QuizAnswers>) {
        update({ quiz: { ...get().quiz, ...patch } });
      },
      submitQuiz: guarded(postAttempt),
      finish: guarded(async () => {
        const id = get().sessionId;
        if (!id) return;
        await dropRunningTake();
        if (get().sessionId !== id) return;
        discardTake();
        await goResult();
      }),
      async patchContext(patch: SessionPatch) {
        const { sessionId, setup } = get();
        if (!sessionId || !setup) return;
        // Applied here at once, whatever else is running (consent withdrawal must never wait or be dropped).
        const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
        update({ setup: { ...setup, ...changes } });
        if (patch.record === false) {
          // Consent withdrawn: nothing recorded in this session is uploaded, including the take now running.
          takeConsent.current = false;
          useRecordingQueue.getState().dropSession(sessionId);
          discardTake();
        }
        const prev = pendingPatch.current?.sessionId === sessionId ? pendingPatch.current.patch : {};
        pendingPatch.current = { sessionId, patch: { ...prev, ...patch } };
        // While another action runs, it is sent when that one settles.
        await sendPendingPatch();
      },
      retry: guarded(async () => {
        await retryRef.current?.();
      }),
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
      const { sessionId, step, attemptN, quiz } = get();
      if (!sessionId) {
        if (step === 'disabled' && flags) update({ step: 'intro' });
        setRestoring(false);
        return;
      }
      let server: Awaited<ReturnType<typeof getVoiceSession>> | null = null;
      let fatal = false;
      try {
        server = await getVoiceSession(sessionId);
      } catch (e) {
        fatal = classify(e).kind === 'fatal';
      }
      if (!live || get().sessionId !== sessionId) return;
      setRestoring(false);
      // Gone or refused: start fresh.
      if (fatal) return actions.reset();
      const waiting = step === 'loading' || step === 'error' || step === 'disabled';
      if (!server) {
        // Offline: carry on from the phone's copy. A step that waits on decide asks again, so the error and its
        // retry show instead of a spinner.
        if (waiting) await actions.loadNext();
        else if (step === 'result') await actions.goResult();
        return;
      }
      if (server.state === 'abandoned') {
        actions.reset();
      } else if (server.state === 'done' || step === 'result') {
        await actions.goResult();
      } else if (step === 'quiz' && server.attempts >= attemptN) {
        // decide may already have this song's attempt (the app died right after posting it): send the same body
        // again (decide returns the existing n) so the take is queued under it.
        if (canSubmitQuiz(quiz))
          await actions.submitQuiz(); // guarded: a tap while restoring cannot post it twice
        else {
          discardTake();
          await actions.loadNext();
        }
      } else if (waiting) {
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
    busy,
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
