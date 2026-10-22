import { canAdvance, cycleAffinity, EMPTY_QUIZ, fromProgress, toggle, toProgressRequest, toSubmitRequest } from '../index';
import type { QuizDraft } from '../index';

describe('toggle', () => {
  it('adds and removes without mutating', () => {
    const a = ['rock'];
    expect(toggle(a, 'pop')).toEqual(['rock', 'pop']);
    expect(toggle(a, 'rock')).toEqual([]);
    expect(a).toEqual(['rock']);
  });
});

describe('cycleAffinity', () => {
  it('cycles none -> like -> love -> none', () => {
    let d = cycleAffinity(EMPTY_QUIZ, 'Muse', 'm-1');
    expect(d.artists).toEqual([{ name: 'Muse', mbid: 'm-1', affinity: 'like' }]);
    d = cycleAffinity(d, 'Muse', 'm-1');
    expect(d.artists[0]?.affinity).toBe('love');
    d = cycleAffinity(d, 'Muse', 'm-1');
    expect(d.artists).toEqual([]);
    expect(EMPTY_QUIZ.artists).toEqual([]);
  });
  it('matches names case-insensitively and leaves others alone', () => {
    let d = cycleAffinity(EMPTY_QUIZ, 'Muse');
    d = cycleAffinity(d, 'Queen');
    d = cycleAffinity(d, 'muse');
    expect(d.artists.map((a) => [a.name, a.affinity])).toEqual([
      ['Muse', 'love'],
      ['Queen', 'like'],
    ]);
    expect(d.artists).toHaveLength(2);
  });
});

describe('canAdvance', () => {
  it('step 1 needs a genre; others always pass', () => {
    expect(canAdvance(EMPTY_QUIZ)).toBe(false);
    expect(canAdvance({ ...EMPTY_QUIZ, genres: ['rock'] })).toBe(true);
    expect(canAdvance({ ...EMPTY_QUIZ, step: 2 })).toBe(true);
    expect(canAdvance({ ...EMPTY_QUIZ, step: 3 })).toBe(true);
    expect(canAdvance({ ...EMPTY_QUIZ, step: 4 })).toBe(true);
  });
});

const draft: QuizDraft = {
  step: 3,
  genres: ['rock', 'pop'],
  decades: ['1990s'],
  energy: 'high',
  artists: [
    { name: 'Muse', mbid: 'm-1', affinity: 'love' },
    { name: 'Queen', affinity: 'like' },
  ],
  songs: [{ songKey: 'k1', artist: 'Muse', title: 'Invented Song' }],
};

describe('toSubmitRequest', () => {
  it('has the decide shape', () => {
    expect(toSubmitRequest(draft)).toEqual({
      genres: ['rock', 'pop'],
      decade_preferences: ['1990s'],
      energy_preference: 'high',
      artist_affinities: [
        { artist_name: 'Muse', affinity: 'love' },
        { artist_name: 'Queen', affinity: 'like' },
      ],
      manual_artists: [{ artist_name: 'Muse', mbid: 'm-1' }],
      known_song_ids: [],
    });
  });
  it('null energy stays null', () => {
    expect(toSubmitRequest(EMPTY_QUIZ).energy_preference).toBeNull();
  });
});

describe('progress', () => {
  it('round-trips', () => {
    const req = toProgressRequest(draft);
    expect(req.step).toBe(3);
    expect(req.decades).toEqual(['1990s']);
    expect(req.energy_preference).toBe('high');
    expect(fromProgress(JSON.parse(JSON.stringify(req)))).toEqual(draft);
  });
  it('returns null for garbage', () => {
    for (const g of [null, undefined, 5, 'x', [], {}, { step: 'a' }, { step: 0 }, { step: 2, genres: 'rock' }]) {
      expect(fromProgress(g)).toBeNull();
    }
  });
  it('is lenient: clamps step 5, maps occasionally to like, drops bad entries', () => {
    const d = fromProgress({
      step: 5,
      genres: ['rock', 7],
      decades: ['1980s'],
      energy_preference: 'weird',
      artist_affinities: [
        { artist_name: 'A', affinity: 'occasionally' },
        { artist_name: 'B', affinity: 'nope' },
        { nope: 1 },
      ],
      manual_artists: [{ artist_name: 'A', mbid: 'a-1' }],
      enjoy_songs: [{ song_id: 's', artist: 'x', title: 'y' }, { song_id: 1 }],
    });
    expect(d).toEqual({
      step: 4,
      genres: ['rock'],
      decades: ['1980s'],
      energy: null,
      artists: [{ name: 'A', mbid: 'a-1', affinity: 'like' }],
      songs: [{ songKey: 's', artist: 'x', title: 'y' }],
    });
  });
});
