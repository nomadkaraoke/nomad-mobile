// The voice session in progress on this phone (Phase 3d), persisted in MMKV so a killed app can resume it (Review
// Focus 2). A copy older than 6 h is dropped: the singer starts fresh (decide abandons the old session on the next
// create). Only the session's own fields are stored: never a token. Cleared on sign-out (useClearDiscoverOnSignOut).
import type { NextSongOut, SessionSetup } from '@nomad/api-decide';
import {
  EMPTY_SESSION_QUIZ,
  type FalsettoCandidate,
  type HeldNote,
  type LabelledNote,
  type PitchContour,
  type PitchSummary,
  type QuizAnswers,
} from '@nomad/core';
import { create } from 'zustand';

import { appStorage } from '../storage';
import type { SongRecording } from './recording/useSongRecorder';

export const VOICE_SESSION_KEY = 'voiceSession.current.v1';
/** A stored session older than this is not resumed. */
export const SESSION_MAX_AGE_MS = 6 * 3600_000;

export type VsStep =
  'intro' | 'setup' | 'warmup' | 'loading' | 'pick' | 'play' | 'quiz' | 'result' | 'disabled' | 'error';

export type SessionState = {
  sessionId: string | null;
  setup: SessionSetup | null;
  /** The setup screen's noise floor (3c `noiseFloor`), for the song recorder's gate. */
  floor: number;
  song: NextSongOut | null;
  step: VsStep;
  /** decide's attempt number for the offered song (1-based; `NextSongOut.attempt_n`). */
  attemptN: number;
  quiz: QuizAnswers;
  pitch: PitchSummary | null;
  /** ms epoch: when the video started playing (null until `playing`). */
  playStartedAt: number | null;
  /** ms epoch: when the song ended or was stopped (the attempt's `ended_at`). */
  playEndedAt: number | null;
  stoppedEarly: boolean;
  /** The finished song's consented recording, waiting for the quiz (queued with the attempt's `n`). */
  take: SongRecording | null;
  /** The finished song's pitch at 10 Hz (null without one), for the chest-only summary sent with the quiz. */
  contour: PitchContour | null;
  /** The finished song's held notes (stream time). */
  held: HeldNote[];
  /** The singer's falsetto answers for this song (the live chip and the quiz catch-up). */
  noteLabels: LabelledNote[];
  /** Every falsetto candidate of this song, shown as a chip or not (the quiz asks about unanswered ones). */
  candidates: FalsettoCandidate[];
  /** Stream time when the take's recording started (to replay a moment of the local take). */
  takeOffsetS: number;
  /** ms epoch of the last write. */
  savedAt: number;
};

/** 3c's minimum noise floor (`noiseFloor` never goes below it). */
export const DEFAULT_FLOOR = 0.003;

export const EMPTY_SESSION: SessionState = {
  sessionId: null,
  setup: null,
  floor: DEFAULT_FLOOR,
  song: null,
  step: 'intro',
  attemptN: 0,
  quiz: EMPTY_SESSION_QUIZ,
  pitch: null,
  playStartedAt: null,
  playEndedAt: null,
  stoppedEarly: false,
  take: null,
  contour: null,
  held: [],
  noteLabels: [],
  candidates: [],
  takeOffsetS: 0,
  savedAt: 0,
};

/** Only the stored fields, so nothing else (a token, a callback) is ever persisted. */
const toStored = (s: SessionState): SessionState => ({
  sessionId: s.sessionId,
  setup: s.setup,
  floor: s.floor,
  song: s.song,
  step: s.step,
  attemptN: s.attemptN,
  quiz: s.quiz,
  pitch: s.pitch,
  playStartedAt: s.playStartedAt,
  playEndedAt: s.playEndedAt,
  stoppedEarly: s.stoppedEarly,
  take: s.take,
  contour: s.contour,
  held: s.held,
  noteLabels: s.noteLabels,
  candidates: s.candidates,
  takeOffsetS: s.takeOffsetS,
  savedAt: s.savedAt,
});

/** The falsetto fields of a stored copy, or their defaults (copies saved before batch 1 have none). */
function falsettoFields(v: Record<string, unknown>): Pick<
  SessionState,
  'contour' | 'held' | 'noteLabels' | 'candidates' | 'takeOffsetS'
> {
  const c = v.contour;
  const contour =
    obj(c) && num(c.t0) && num(c.dt) && Array.isArray(c.midi) && c.midi.every(numOrNull)
      ? ({
          t0: c.t0,
          dt: c.dt,
          midi: c.midi,
          // Frame counts and hop: only when well-formed (older copies have none; chestSummary then scales).
          ...(Array.isArray(c.n) && c.n.length === c.midi.length && c.n.every(num) && num(c.hop)
            ? { n: c.n, hop: c.hop }
            : {}),
        } as PitchContour)
      : null;
  const list = <T,>(x: unknown, ok: (e: Record<string, unknown>) => boolean): T[] =>
    Array.isArray(x) && x.every((e) => obj(e) && ok(e)) ? (x as T[]) : [];
  return {
    contour,
    held: list<HeldNote>(v.held, (h) => num(h.start) && num(h.end) && num(h.midi) && num(h.note)),
    noteLabels: list<LabelledNote>(
      v.noteLabels,
      (l) => num(l.tStart) && num(l.tEnd) && num(l.midi) && typeof l.label === 'string' && typeof l.source === 'string',
    ),
    candidates: list<FalsettoCandidate>(v.candidates, (l) => num(l.tStart) && num(l.tEnd) && num(l.midi)),
    takeOffsetS: num(v.takeOffsetS) ? (v.takeOffsetS as number) : 0,
  };
}

const STEPS: readonly VsStep[] = [
  'intro',
  'setup',
  'warmup',
  'loading',
  'pick',
  'play',
  'quiz',
  'result',
  'disabled',
  'error',
];
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const numOrNull = (x: unknown) => x === null || num(x);
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function isStored(v: unknown): v is SessionState {
  if (!obj(v)) return false;
  return (
    typeof v.sessionId === 'string' &&
    obj(v.setup) &&
    num(v.floor) &&
    (v.song === null || (obj(v.song) && typeof v.song.song_key === 'string' && obj(v.song.version))) &&
    STEPS.includes(v.step as VsStep) &&
    Number.isInteger(v.attemptN) &&
    obj(v.quiz) &&
    (v.pitch === null || obj(v.pitch)) &&
    numOrNull(v.playStartedAt) &&
    numOrNull(v.playEndedAt) &&
    typeof v.stoppedEarly === 'boolean' &&
    (v.take === null || (obj(v.take) && typeof v.take.uri === 'string')) &&
    num(v.savedAt)
  );
}

/**
 * The stored session as the app should resume it, or EMPTY_SESSION (none, unreadable, older than 6 h: the copy is then
 * removed). A song that was playing when the app died resumes at its quiz, stopped early at the last save; a take
 * recorded mid-song was never finished, so there is none.
 */
export function loadVoiceSession(now = Date.now()): SessionState {
  try {
    const raw = appStorage.getString(VOICE_SESSION_KEY);
    if (raw === undefined) return EMPTY_SESSION;
    const v: unknown = JSON.parse(raw);
    if (isStored(v) && now - v.savedAt < SESSION_MAX_AGE_MS && v.savedAt <= now) {
      const s = toStored({
        ...v,
        ...falsettoFields(v as unknown as Record<string, unknown>),
        quiz: { ...EMPTY_SESSION_QUIZ, ...v.quiz },
      });
      if (s.step === 'play' && s.song) {
        return {
          ...s,
          step: 'quiz',
          stoppedEarly: true,
          playEndedAt: s.savedAt,
          playStartedAt: s.playStartedAt ?? s.savedAt,
          pitch: null,
          take: null,
          contour: null,
          held: [],
          takeOffsetS: 0,
        };
      }
      return s;
    }
  } catch {
    // fall through: unreadable
  }
  appStorage.remove(VOICE_SESSION_KEY);
  return EMPTY_SESSION;
}

type SessionStore = SessionState & {
  /** Merges `patch` and saves (only while a session exists: setup and warm-up before `begin` are not stored). */
  update(patch: Partial<SessionState>): void;
  /** Forgets the session (memory and this phone's copy). */
  clear(): void;
};

export const useVoiceSessionStore = create<SessionStore>((set, get) => ({
  ...loadVoiceSession(),
  update(patch) {
    const next = toStored({ ...get(), ...patch, savedAt: Date.now() });
    if (next.sessionId) appStorage.set(VOICE_SESSION_KEY, JSON.stringify(next));
    else appStorage.remove(VOICE_SESSION_KEY);
    set(next);
  },
  clear() {
    appStorage.remove(VOICE_SESSION_KEY);
    set(EMPTY_SESSION);
  },
}));

/** Re-reads this phone's copy (app launch; tests simulate a relaunch with it). */
export function restoreVoiceSession(): void {
  useVoiceSessionStore.setState(loadVoiceSession());
}
