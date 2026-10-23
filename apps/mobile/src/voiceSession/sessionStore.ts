// The voice session in progress on this phone (Phase 3d), persisted in MMKV so a killed app can resume it (Review
// Focus 2). A copy older than 6 h is dropped: the singer starts fresh (decide abandons the old session on the next
// create). Only the session's own fields are stored: never a token. Cleared on sign-out (useClearDiscoverOnSignOut).
import type { NextSongOut, SessionSetup } from '@nomad/api-decide';
import { EMPTY_SESSION_QUIZ, type PitchSummary, type QuizAnswers } from '@nomad/core';
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
  savedAt: s.savedAt,
});

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
      const s = toStored({ ...v, quiz: { ...EMPTY_SESSION_QUIZ, ...v.quiz } });
      if (s.step === 'play' && s.song) {
        return {
          ...s,
          step: 'quiz',
          stoppedEarly: true,
          playEndedAt: s.savedAt,
          playStartedAt: s.playStartedAt ?? s.savedAt,
          pitch: null,
          take: null,
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
