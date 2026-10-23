// The after-song quiz of a voice session (Phase 3d): the app's draft answers and decide's `QuizIn` body.

export type QuizFeel = 'loved' | 'fine' | 'not_for_me';
export type QuizPosition = 'too_low' | 'comfortable' | 'too_high' | 'both_ends';
export type QuizDifficulty = 'easy' | 'stretch' | 'couldnt';
export type QuizKnew = 'well' | 'partly' | 'barely';
export type QuizWouldSing = 'yes' | 'yes_other_key' | 'no';
export type QuizWouldWorkIf = 'warmer' | 'other_key' | 'other_octave' | 'practice' | 'fine';
export type QuizVoiceNow = 'fresh' | 'warm' | 'tired';
export type QuizVersionQuality = 'good' | 'not_great';
export type QuizVersionIssue = 'no_intro' | 'wrong_lyrics' | 'bad_sync' | 'low_quality';
export type QuizTag = 'fast_lyrics' | 'long_gaps' | 'needed_warmup' | 'crowd_song' | 'mood_only';

export type QuizAnswers = {
  /** Q1 (required). */
  feel: QuizFeel | null;
  /** Q2 (required). */
  position: QuizPosition | null;
  difficulty: QuizDifficulty | null;
  knew: QuizKnew | null;
  wouldSing: QuizWouldSing | null;
  wouldWorkIf: QuizWouldWorkIf[];
  voiceNow: QuizVoiceNow | null;
  versionQuality: QuizVersionQuality | null;
  versionIssues: QuizVersionIssue[];
  tags: QuizTag[];
};

/** Nothing answered. (Named apart from Discover's taste-quiz `EMPTY_QUIZ`, which `@nomad/core` also exports.) */
export const EMPTY_SESSION_QUIZ: QuizAnswers = {
  feel: null,
  position: null,
  difficulty: null,
  knew: null,
  wouldSing: null,
  wouldWorkIf: [],
  voiceNow: null,
  versionQuality: null,
  versionIssues: [],
  tags: [],
};

/** decide's `QuizIn` (extra="forbid"): `feel` and `position` required, the rest optional. */
export type QuizIn = {
  feel: QuizFeel;
  position: QuizPosition;
  difficulty?: QuizDifficulty;
  knew?: QuizKnew;
  would_sing?: QuizWouldSing;
  would_work_if: QuizWouldWorkIf[];
  voice_now?: QuizVoiceNow;
  version_quality?: QuizVersionQuality;
  version_issues: QuizVersionIssue[];
  tags: QuizTag[];
};

/** Submit needs Q1 (feel) and Q2 (position); every other answer is optional. */
export const canSubmitQuiz = (q: QuizAnswers): boolean => q.feel !== null && q.position !== null;

/** Toggles a "would work if" choice: `fine` clears the others, any other choice clears `fine`. */
export function toggleWouldWorkIf(q: QuizAnswers, v: QuizWouldWorkIf): QuizAnswers {
  let next: QuizWouldWorkIf[];
  if (q.wouldWorkIf.includes(v)) next = q.wouldWorkIf.filter((x) => x !== v);
  else if (v === 'fine') next = ['fine'];
  else next = [...q.wouldWorkIf.filter((x) => x !== 'fine'), v];
  return { ...q, wouldWorkIf: next };
}

/** The attempt's `quiz` body: snake_case, unanswered single choices omitted. Throws unless `canSubmitQuiz`. */
export function toQuizIn(q: QuizAnswers): QuizIn {
  if (q.feel === null || q.position === null) throw new Error('toQuizIn: feel and position are required');
  const body: QuizIn = {
    feel: q.feel,
    position: q.position,
    would_work_if: [...q.wouldWorkIf],
    version_issues: [...q.versionIssues],
    tags: [...q.tags],
  };
  if (q.difficulty !== null) body.difficulty = q.difficulty;
  if (q.knew !== null) body.knew = q.knew;
  if (q.wouldSing !== null) body.would_sing = q.wouldSing;
  if (q.voiceNow !== null) body.voice_now = q.voiceNow;
  if (q.versionQuality !== null) body.version_quality = q.versionQuality;
  return body;
}
