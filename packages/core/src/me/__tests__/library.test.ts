import { songKey } from '../../search/normalize';
import {
  isGoTo,
  libraryKey,
  overlayLibrary,
  queryLibrary,
  type LibraryQuery,
  type MeSong,
  type PendingLog,
} from '../library';

const song = (o: Partial<MeSong> & { artist: string; title: string }): MeSong => ({
  key: libraryKey(o.artist, o.title, o.song_key ?? null),
  song_key: null,
  times_sung: 0,
  backfill_times: 0,
  feel_counts: { great: 0, ok: 0, bad: 0 },
  latest_feel: null,
  latest_key: null,
  crowd_pleaser_count: 0,
  vibes: [],
  loved: false,
  hidden: false,
  setlist_ids: [],
  facets: null,
  ...o,
});

const empty = { log: [] as PendingLog[], loves: {}, setlists: [] };

describe('libraryKey', () => {
  it('uses song_key when present, else u: + songKey', () => {
    expect(libraryKey('Adele', 'Hello', null)).toBe('u:' + songKey('Adele', 'Hello'));
    expect(libraryKey('Adele', 'Hello')).toBe('u:' + songKey('Adele', 'Hello'));
    expect(libraryKey('Adele', 'Hello', 'mb:123')).toBe('mb:123');
  });
});

describe('isGoTo', () => {
  it('truth table', () => {
    expect(isGoTo(song({ artist: 'a', title: 'b', times_sung: 1, latest_feel: 'great' }))).toBe(true);
    expect(isGoTo(song({ artist: 'a', title: 'b', times_sung: 2, latest_feel: 'ok' }))).toBe(true);
    expect(isGoTo(song({ artist: 'a', title: 'b', times_sung: 5, latest_feel: 'bad' }))).toBe(false);
    expect(isGoTo(song({ artist: 'a', title: 'b', times_sung: 5, latest_feel: 'great', hidden: true }))).toBe(false);
    expect(isGoTo(song({ artist: 'a', title: 'b', times_sung: 1, latest_feel: 'ok' }))).toBe(false);
    expect(isGoTo(song({ artist: 'a', title: 'b', times_sung: 2, latest_feel: null }))).toBe(true);
  });
});

describe('queryLibrary', () => {
  const items = [
    song({
      artist: 'Adele', title: 'Hello', times_sung: 3, latest_feel: 'great',
      feel_counts: { great: 3, ok: 0, bad: 0 }, last_sung_at: '2026-03-01T00:00:00Z',
      vibes: ['ballad'], loved: true, facets: { mood: 'sad', has_karaoke: true, community: true, karafun: false },
    }),
    song({
      artist: 'ABBA', title: 'Dancing Queen', times_sung: 1, latest_feel: 'ok',
      feel_counts: { great: 1, ok: 1, bad: 2 }, last_sung_at: '2026-05-01T00:00:00Z',
      vibes: ['party'], setlist_ids: ['pl_x'], facets: { mood: 'happy', has_karaoke: true, community: false, karafun: true },
    }),
    song({
      artist: 'Blur', title: 'Parklife', times_sung: 2, latest_feel: 'bad',
      feel_counts: { great: 0, ok: 0, bad: 2 }, last_sung_at: '2026-04-01T00:00:00Z',
    }),
    song({ artist: 'Cher', title: 'Believe', times_sung: 0, loved: true }),
    song({ artist: 'Hidden', title: 'Song', times_sung: 9, latest_feel: 'bad', hidden: true }),
  ];
  const q = (o: Partial<LibraryQuery> = {}): LibraryQuery => ({ sort: 'az', ...o });
  const titles = (r: MeSong[]) => r.map((s) => s.title);

  it('hides hidden unless feel includes their rating', () => {
    expect(titles(queryLibrary(items, q()))).not.toContain('Song');
    expect(titles(queryLibrary(items, q({ feel: ['bad'] })))).toEqual(expect.arrayContaining(['Song', 'Parklife']));
    expect(titles(queryLibrary(items, q({ feel: ['great'] })))).toEqual(['Hello']);
  });
  it('unrated feel', () => {
    expect(titles(queryLibrary(items, q({ feel: ['unrated'] })))).toEqual(['Believe']);
  });
  it('often filters', () => {
    expect(titles(queryLibrary(items, q({ often: 'twice' })))).toEqual(['Hello', 'Parklife']);
    expect(titles(queryLibrary(items, q({ often: 'once' })))).toEqual(['Dancing Queen']);
    expect(titles(queryLibrary(items, q({ often: 'unsung' })))).toEqual(['Believe']);
    expect(queryLibrary(items, q({ often: null }))).toHaveLength(4);
  });
  it('mood, vibe, library, savedOnly', () => {
    expect(titles(queryLibrary(items, q({ moods: ['sad'] })))).toEqual(['Hello']);
    expect(titles(queryLibrary(items, q({ vibes: ['party', 'ballad'] })))).toEqual(['Dancing Queen', 'Hello']);
    expect(titles(queryLibrary(items, q({ library: 'community' })))).toEqual(['Hello']);
    expect(titles(queryLibrary(items, q({ library: 'karafun' })))).toEqual(['Dancing Queen']);
    expect(titles(queryLibrary(items, q({ library: 'any' })))).toHaveLength(4);
    expect(queryLibrary(items, q({ savedOnly: true })).map((s) => s.artist).sort()).toEqual(['Adele', 'Cher']);
    expect(titles(queryLibrary(items, q({ savedOnly: true })))).not.toContain('Dancing Queen'); // setlist-only
  });
  it('text via normalize, combined with filters', () => {
    expect(titles(queryLibrary(items, q({ text: 'ADELE' })))).toEqual(['Hello']);
    expect(titles(queryLibrary(items, q({ text: 'dancing q' })))).toEqual(['Dancing Queen']);
    expect(titles(queryLibrary(items, q({ text: 'a', often: 'once' })))).toEqual(['Dancing Queen']);
    expect(queryLibrary(items, q({ text: 'zzz' }))).toEqual([]);
    expect(queryLibrary(items, q({ text: 'adele', feel: ['bad'] }))).toEqual([]);
  });
  it('sorts', () => {
    expect(titles(queryLibrary(items, q({ sort: 'az' })))).toEqual(['Dancing Queen', 'Hello', 'Parklife', 'Believe']);
    expect(titles(queryLibrary(items, q({ sort: 'most' })))).toEqual(['Hello', 'Parklife', 'Dancing Queen', 'Believe']);
    expect(titles(queryLibrary(items, q({ sort: 'recent' })))).toEqual(['Dancing Queen', 'Parklife', 'Hello', 'Believe']);
    expect(titles(queryLibrary(items, q({ sort: 'rated' })))).toEqual(['Hello', 'Dancing Queen', 'Parklife', 'Believe']);
    expect(titles(queryLibrary(items, q({ sort: 'goto' })))).toEqual(['Hello', 'Parklife', 'Dancing Queen', 'Believe']);
  });
  it('goto puts go-tos first then most sung', () => {
    const r = queryLibrary(
      [
        song({ artist: 'A', title: 'Few', times_sung: 1, latest_feel: 'great' }),
        song({ artist: 'B', title: 'Many', times_sung: 8, latest_feel: 'bad' }),
        song({ artist: 'C', title: 'Twice', times_sung: 2, latest_feel: 'ok' }),
      ],
      q({ sort: 'goto' }),
    );
    expect(titles(r)).toEqual(['Twice', 'Few', 'Many']);
  });
  it('does not mutate input', () => {
    const copy = [...items];
    queryLibrary(items, q({ sort: 'most' }));
    expect(items).toEqual(copy);
  });
});

describe('overlayLibrary', () => {
  it('adds a new u: item for a pending backfill', () => {
    const out = overlayLibrary([], {
      ...empty,
      log: [{ id: '1', artist: 'Adele', title: 'Hello', state: 'sung', times: 3, origin: 'backfill' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'u:' + songKey('Adele', 'Hello'), song_key: null, times_sung: 3, backfill_times: 3,
    });
  });
  it('counts live entries (default 1) and tracks sung dates', () => {
    const base = [song({ artist: 'Adele', title: 'Hello', times_sung: 1, first_sung_at: '2026-01-01T00:00:00Z', last_sung_at: '2026-01-01T00:00:00Z' })];
    const out = overlayLibrary(base, {
      ...empty,
      log: [
        { id: '1', artist: 'Adele', title: 'Hello', state: 'sung_unplayed', sung_at: '2026-06-01T00:00:00Z' },
        { id: '2', artist: 'Adele', title: 'Hello', state: 'queued' },
        { id: '3', artist: 'Adele', title: 'Hello', state: 'sung', deleted: true },
        { id: '4', artist: '', title: 'Hello', state: 'sung' },
      ],
    });
    expect(out[0]).toMatchObject({ times_sung: 2, backfill_times: 0, last_sung_at: '2026-06-01T00:00:00Z', first_sung_at: '2026-01-01T00:00:00Z' });
    expect(base[0]!.times_sung).toBe(1);
  });
  it('a pending bad survey flips latest_feel and bumps feel_counts', () => {
    const base = [song({ artist: 'Adele', title: 'Hello', times_sung: 1, latest_feel: 'great', latest_key: 'right', feel_counts: { great: 1, ok: 0, bad: 0 } })];
    const out = overlayLibrary(base, {
      ...empty,
      log: [{ id: '1', artist: 'Adele', title: 'Hello', state: 'sung', times: 0, survey: { feel: 'bad', crowd_pleaser: true, vibes: ['ballad'], answered_at: '2026-07-01T00:00:00Z' } }],
    });
    expect(out[0]).toMatchObject({ latest_feel: 'bad', latest_key: 'right', feel_counts: { great: 1, ok: 0, bad: 1 }, crowd_pleaser_count: 1, vibes: ['ballad'] });
  });
  it('per-field survey semantics: newest answer per field wins', () => {
    const base = [song({ artist: 'A', title: 'B', times_sung: 1, latest_feel: 'ok', latest_key: 'too_low' })];
    const out = overlayLibrary(base, {
      ...empty,
      log: [
        { id: '1', artist: 'A', title: 'B', state: 'sung', times: 0, survey: { feel: 'great', key: 'too_high', answered_at: '2026-01-01' } },
        { id: '2', artist: 'A', title: 'B', state: 'sung', times: 0, survey: { feel: 'bad', answered_at: '2026-02-01' } },
        { id: '3', artist: 'A', title: 'B', state: 'sung', times: 0, survey: { feel: 'ok', answered_at: '2025-01-01' } },
      ],
    });
    expect(out[0]).toMatchObject({ latest_feel: 'bad', latest_key: 'too_high' });
    expect(out[0]!.feel_counts).toEqual({ great: 1, ok: 1, bad: 1 });
  });
  it('a pending survey skipping key keeps the server key', () => {
    const base = [song({ artist: 'A', title: 'B', times_sung: 1, latest_feel: 'ok', latest_key: 'right' })];
    const out = overlayLibrary(base, {
      ...empty,
      log: [{ id: '1', artist: 'A', title: 'B', state: 'sung', times: 0, survey: { feel: 'great' } }],
    });
    expect(out[0]).toMatchObject({ latest_feel: 'great', latest_key: 'right' });
  });
  it('pending unlove clears loved and drops an unsung, unlisted song', () => {
    const k = libraryKey('Cher', 'Believe', null);
    const base = [
      song({ artist: 'Cher', title: 'Believe', loved: true }),
      song({ artist: 'Adele', title: 'Hello', loved: true, times_sung: 2 }),
    ];
    const out = overlayLibrary(base, {
      ...empty,
      loves: {
        [k]: { loved: false, artist: 'Cher', title: 'Believe', song_key: k },
        [libraryKey('Adele', 'Hello', null)]: { loved: false, artist: 'Adele', title: 'Hello', song_key: libraryKey('Adele', 'Hello', null) },
      },
    });
    expect(out.map((s) => s.title)).toEqual(['Hello']);
    expect(out[0]!.loved).toBe(false);
  });
  it('keeps an unloved unsung song that is in a setlist', () => {
    const base = [song({ artist: 'Cher', title: 'Believe', loved: true, setlist_ids: ['pl_abcdefgh'] })];
    const k = base[0]!.key;
    const out = overlayLibrary(base, { ...empty, loves: { [k]: { loved: false, artist: 'Cher', title: 'Believe', song_key: k } } });
    expect(out).toHaveLength(1);
  });
  it('a survey on a non-counting record creates no phantom item', () => {
    const out = overlayLibrary([], {
      ...empty,
      log: [{ id: '1', artist: 'A', title: 'B', state: 'queued', survey: { feel: 'great' } }],
    });
    expect(out).toEqual([]);
  });
  it('pending love adds a new item', () => {
    const k = 'mb:9';
    const out = overlayLibrary([], { ...empty, loves: { [k]: { loved: true, artist: 'X', title: 'Y', song_key: k } } });
    expect(out[0]).toMatchObject({ key: 'mb:9', song_key: 'mb:9', loved: true, times_sung: 0 });
  });
  it('pending setlist item adds its id; removed items and deleted lists drop it', () => {
    const base = [
      song({ artist: 'A', title: 'Old', times_sung: 1, setlist_ids: ['pl_abcdefgh', 'pl_zzzzzzzz'] }),
    ];
    const out = overlayLibrary(base, {
      ...empty,
      setlists: [
        { id: 'pl_abcdefgh', items: [{ song_key: null, artist: 'New', title: 'One' }] },
        { id: 'pl_zzzzzzzz', items: [], deleted: true },
      ],
    });
    const byTitle = Object.fromEntries(out.map((s) => [s.title, s]));
    expect(byTitle['One']!.setlist_ids).toEqual(['pl_abcdefgh']);
    expect(byTitle['Old']!.setlist_ids).toEqual([]);
  });
});
