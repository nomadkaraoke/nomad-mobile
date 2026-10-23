import { canSubmitQuiz, EMPTY_SESSION_QUIZ, toggleWouldWorkIf, toQuizIn, type QuizAnswers } from '../index';

const answered = (patch: Partial<QuizAnswers> = {}): QuizAnswers => ({
  ...EMPTY_SESSION_QUIZ,
  feel: 'fine',
  position: 'comfortable',
  ...patch,
});

describe('EMPTY_SESSION_QUIZ', () => {
  it('has nothing answered', () => {
    expect(EMPTY_SESSION_QUIZ).toEqual({
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
    });
  });
});

describe('canSubmitQuiz', () => {
  it('needs both Q1 (feel) and Q2 (position)', () => {
    expect(canSubmitQuiz(EMPTY_SESSION_QUIZ)).toBe(false);
    expect(canSubmitQuiz({ ...EMPTY_SESSION_QUIZ, feel: 'loved' })).toBe(false);
    expect(canSubmitQuiz({ ...EMPTY_SESSION_QUIZ, position: 'too_high' })).toBe(false);
    expect(canSubmitQuiz({ ...EMPTY_SESSION_QUIZ, feel: 'loved', position: 'too_high' })).toBe(true);
  });

  it('the optional answers never block it', () => {
    expect(canSubmitQuiz(answered({ difficulty: 'couldnt', tags: ['crowd_song'] }))).toBe(true);
  });
});

describe('toggleWouldWorkIf', () => {
  it('adds and removes a choice', () => {
    const a = toggleWouldWorkIf(EMPTY_SESSION_QUIZ, 'warmer');
    expect(a.wouldWorkIf).toEqual(['warmer']);
    const b = toggleWouldWorkIf(a, 'other_key');
    expect(b.wouldWorkIf).toEqual(['warmer', 'other_key']);
    expect(toggleWouldWorkIf(b, 'warmer').wouldWorkIf).toEqual(['other_key']);
  });

  it('`fine` clears the others', () => {
    const q = { ...EMPTY_SESSION_QUIZ, wouldWorkIf: ['warmer', 'practice'] as QuizAnswers['wouldWorkIf'] };
    expect(toggleWouldWorkIf(q, 'fine').wouldWorkIf).toEqual(['fine']);
  });

  it('any other choice clears `fine`', () => {
    const q = toggleWouldWorkIf(EMPTY_SESSION_QUIZ, 'fine');
    expect(toggleWouldWorkIf(q, 'other_octave').wouldWorkIf).toEqual(['other_octave']);
  });

  it('`fine` toggles itself off', () => {
    const q = toggleWouldWorkIf(EMPTY_SESSION_QUIZ, 'fine');
    expect(toggleWouldWorkIf(q, 'fine').wouldWorkIf).toEqual([]);
  });

  it('does not mutate its input', () => {
    const q = { ...EMPTY_SESSION_QUIZ, wouldWorkIf: ['warmer'] as QuizAnswers['wouldWorkIf'] };
    toggleWouldWorkIf(q, 'practice');
    expect(q.wouldWorkIf).toEqual(['warmer']);
  });
});

describe('toQuizIn', () => {
  it('only the two required answers: snake_case, nulls omitted, empty lists kept', () => {
    expect(toQuizIn(answered())).toEqual({
      feel: 'fine',
      position: 'comfortable',
      would_work_if: [],
      version_issues: [],
      tags: [],
    });
  });

  it('every answer, snake_case', () => {
    const q = answered({
      feel: 'loved',
      position: 'both_ends',
      difficulty: 'stretch',
      knew: 'partly',
      wouldSing: 'yes_other_key',
      wouldWorkIf: ['other_key', 'practice'],
      voiceNow: 'tired',
      versionQuality: 'not_great',
      versionIssues: ['bad_sync', 'low_quality'],
      tags: ['fast_lyrics', 'needed_warmup'],
    });
    expect(toQuizIn(q)).toEqual({
      feel: 'loved',
      position: 'both_ends',
      difficulty: 'stretch',
      knew: 'partly',
      would_sing: 'yes_other_key',
      would_work_if: ['other_key', 'practice'],
      voice_now: 'tired',
      version_quality: 'not_great',
      version_issues: ['bad_sync', 'low_quality'],
      tags: ['fast_lyrics', 'needed_warmup'],
    });
  });

  it('copies the lists (later edits do not leak into the body)', () => {
    const q = answered({ tags: ['crowd_song'] });
    const body = toQuizIn(q);
    q.tags.push('mood_only');
    expect(body.tags).toEqual(['crowd_song']);
  });

  it('throws when Q1 or Q2 is missing (canSubmitQuiz guards the button)', () => {
    expect(() => toQuizIn(EMPTY_SESSION_QUIZ)).toThrow(/feel and position/);
    expect(() => toQuizIn({ ...EMPTY_SESSION_QUIZ, feel: 'fine' })).toThrow(/feel and position/);
  });
});
