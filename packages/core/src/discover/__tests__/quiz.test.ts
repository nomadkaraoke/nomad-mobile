import { artistKeys, canAdvance, cycleAffinity, EMPTY_QUIZ, fromProgress, mergeProgress, mergeSubmit, toggle, toProgressRequest, toSubmitRequest } from '../index';
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
    let d = cycleAffinity(EMPTY_QUIZ, 'Muse', { mbid: 'm-1' });
    expect(d.artists).toEqual([{ name: 'Muse', mbid: 'm-1', affinity: 'like' }]);
    d = cycleAffinity(d, 'Muse', { mbid: 'm-1' });
    expect(d.artists[0]?.affinity).toBe('love');
    d = cycleAffinity(d, 'Muse', { mbid: 'm-1' });
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

describe('mergeProgress (decide PUT /api/quiz/progress replaces the whole doc)', () => {
  const saved = {
    step: 5,
    genres: ['rock'],
    decades: ['1990s'],
    energy_preference: 'high',
    vocal_comfort_pref: 'easy',
    crowd_pleaser_pref: 'deep_cuts',
    artist_affinities: [
      { artist_name: 'Muse', affinity: 'occasionally' },
      { artist_name: 'Queen', affinity: 'occasionally' },
    ],
    manual_artists: [{ artist_name: 'Muse', mbid: 'm-1', artist_id: 'sp-1', genres: ['rock'] }],
    enjoy_songs: [{ song_id: 'k1', artist: 'Band', title: 'Invented', singing_tags: ['belter'], notes: 'n' }],
  };
  const draft = fromProgress(saved) as QuizDraft;

  it('keeps the web-only fields mobile does not edit', () => {
    const out = mergeProgress(saved, toProgressRequest({ ...draft, step: 2 }));
    expect(out.vocal_comfort_pref).toBe('easy');
    expect(out.crowd_pleaser_pref).toBe('deep_cuts');
    expect(out.step).toBe(2);
    expect(out.manual_artists).toEqual([{ artist_name: 'Muse', mbid: 'm-1', artist_id: 'sp-1', genres: ['rock'] }]);
    expect(out.enjoy_songs).toEqual([
      { song_id: 'k1', artist: 'Band', title: 'Invented', singing_tags: ['belter'], notes: 'n' },
    ]);
  });
  it('keeps "occasionally" while mobile still says like, and lets mobile edits win', () => {
    const edited = cycleAffinity(draft, 'Queen'); // like -> love
    const out = mergeProgress(saved, toProgressRequest(edited));
    expect(out.artist_affinities).toEqual([
      { artist_name: 'Muse', affinity: 'occasionally' },
      { artist_name: 'Queen', affinity: 'love' },
    ]);
  });
  it('drops removed artists and songs, and is the plain request without a saved doc', () => {
    const removed = { ...cycleAffinity(cycleAffinity(draft, 'Muse'), 'Muse'), songs: [] };
    const out = mergeProgress(saved, toProgressRequest(removed), artistKeys(['Muse', 'Queen']));
    expect(out.artist_affinities).toEqual([{ artist_name: 'Queen', affinity: 'occasionally' }]);
    expect(out.manual_artists).toEqual([]);
    expect(out.enjoy_songs).toEqual([]);
    const plain = toProgressRequest(draft);
    expect(mergeProgress(null, plain)).toEqual(plain);
  });
});

describe('mergeSubmit', () => {
  it('carries the web-only prefs and "occasionally" into the submit body', () => {
    const saved = {
      step: 3,
      vocal_comfort_pref: 'challenging',
      crowd_pleaser_pref: 'hits',
      artist_affinities: [{ artist_name: 'Muse', affinity: 'occasionally' }],
    };
    const d = fromProgress(saved) as QuizDraft;
    const out = mergeSubmit(saved, toSubmitRequest(d));
    expect(out.vocal_comfort_pref).toBe('challenging');
    expect(out.crowd_pleaser_pref).toBe('hits');
    expect(out.artist_affinities).toEqual([{ artist_name: 'Muse', affinity: 'occasionally' }]);
    expect(out).not.toHaveProperty('step');
    expect(mergeSubmit(undefined, toSubmitRequest(d))).toEqual(toSubmitRequest(d));
  });
});

describe('decide web manual_artists (their own list, not a copy of the affinities)', () => {
  const saved = {
    step: 3,
    genres: ['rock'],
    decades: [],
    artist_affinities: [{ artist_name: 'Muse', affinity: 'like' }],
    manual_artists: [
      { artist_name: 'Web Only Band', artist_id: 'sp-web', genres: ['indie'] },
      { artist_name: 'Muse', artist_id: 'sp-muse' },
    ],
  };
  const draft = fromProgress(saved) as QuizDraft;
  const touched = artistKeys(draft.artists.map((a) => a.name));

  it('reads artist_id into the draft and sends it back', () => {
    expect(draft.artists).toEqual([{ name: 'Muse', artistId: 'sp-muse', affinity: 'like' }]);
    expect(toProgressRequest(draft).manual_artists).toEqual([{ artist_name: 'Muse', artist_id: 'sp-muse' }]);
    const d = cycleAffinity(EMPTY_QUIZ, 'Found', { mbid: null, artistId: 'sp-found' });
    expect(toSubmitRequest(d).manual_artists).toEqual([{ artist_name: 'Found', artist_id: 'sp-found' }]);
  });

  it('a web manual artist mobile never had survives a mobile save and submit, ids intact', () => {
    const edited = cycleAffinity(draft, 'New Pick', { mbid: 'mb-new' });
    const allTouched = artistKeys([...touched, 'New Pick']);
    const progress = mergeProgress(saved, toProgressRequest(edited), allTouched);
    const submit = mergeSubmit(saved, toSubmitRequest(edited), allTouched);
    for (const body of [progress, submit]) {
      expect(body.manual_artists).toEqual([
        { artist_name: 'Web Only Band', artist_id: 'sp-web', genres: ['indie'] },
        { artist_name: 'Muse', artist_id: 'sp-muse' },
        { artist_name: 'New Pick', mbid: 'mb-new' },
      ]);
    }
  });

  it('an artist_id-only entry for a pick mobile still has keeps its id even when the draft lost it', () => {
    const noIds: QuizDraft = { ...draft, artists: [{ name: 'muse', affinity: 'love' }] };
    const out = mergeProgress(saved, toProgressRequest(noIds), touched);
    expect(out.manual_artists).toContainEqual({ artist_name: 'Muse', artist_id: 'sp-muse' });
  });

  it('drops a manual artist the user removed on mobile, keeps the web-only one', () => {
    const removed = cycleAffinity(cycleAffinity(draft, 'Muse'), 'Muse');
    expect(removed.artists).toEqual([]);
    const out = mergeSubmit(saved, toSubmitRequest(removed), touched);
    expect(out.manual_artists).toEqual([{ artist_name: 'Web Only Band', artist_id: 'sp-web', genres: ['indie'] }]);
  });
});
