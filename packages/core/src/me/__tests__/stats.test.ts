import { libraryKey, type MeSong, type PendingLog } from '../library';
import { karaokeStats } from '../stats';

const item = (artist: string, title: string, o: Partial<MeSong> = {}): MeSong => ({
  key: libraryKey(artist, title, null), song_key: null, artist, title, times_sung: 1, backfill_times: 0,
  feel_counts: { great: 0, ok: 0, bad: 0 }, latest_feel: null, latest_key: null, crowd_pleaser_count: 0,
  vibes: [], loved: false, hidden: false, setlist_ids: [], facets: null, ...o,
});
const rec = (id: string, artist: string, title: string, o: Partial<PendingLog> = {}): PendingLog => ({
  id, artist, title, state: 'sung', ...o,
});

describe('karaokeStats', () => {
  const items = [
    item('Adele', 'Hello', { times_sung: 4, backfill_times: 2, latest_feel: 'great' }),
    item('adele', 'Skyfall', { times_sung: 1, latest_feel: 'ok' }),
    item('Blur', 'Parklife', { times_sung: 2, latest_feel: 'bad' }),
    item('Unloved', 'Nope', { times_sung: 0, loved: true }),
  ];
  const log: PendingLog[] = [
    rec('1', 'Adele', 'Hello', { survey: { feel: 'great' }, sung_at: '2025-03-01T20:00:00Z', night: { id: 'n1', venue_name: 'The Bar' } }),
    rec('2', 'Adele', 'Hello', { sung_at: '2025-03-01T21:00:00Z', night: { id: 'n1', venue_name: 'The Bar' } }),
    rec('3', 'Adele', 'Hello', { survey: { feel: 'great' }, sung_at: '2026-04-02T21:00:00Z', night: { date: '2026-04-02', venue_name: 'Pub' } }),
    rec('4', 'Blur', 'Parklife', { survey: { feel: 'bad' }, sung_at: '2026-04-09T21:00:00Z', night: { date: '2026-04-09', venue_name: 'Pub' }, times: 2 }),
    rec('5', 'ADELE', 'Skyfall', { survey: { feel: 'ok' }, sung_at: '2026-04-09T22:00:00Z', night: { date: '2026-04-09', venue_name: 'Pub' } }),
    rec('6', 'Adele', 'Hello', { origin: 'backfill', times: 2, sung_at: '2026-01-01T00:00:00Z', night: { venue_name: 'Old Place' } }),
    rec('7', 'Blur', 'Parklife', { origin: 'backfill', times: 5 }),
    rec('8', 'Blur', 'Gone', { sung_at: '2026-04-09T22:00:00Z', deleted: true, night: { date: '2026-04-09', venue_name: 'Pub' } }),
    rec('9', 'Blur', 'Queued', { state: 'queued', sung_at: '2026-04-09T22:00:00Z' }),
  ];

  it('all-time uses items for songs/performances, log for nights/venues', () => {
    const s = karaokeStats(items, log, {});
    expect(s).toMatchObject({ songs: 3, performances: 7, nights: 3, venues: 2 });
    expect(s.mostSung).toEqual({ artist: 'Adele', title: 'Hello', count: 4 });
    expect(s.topArtist).toBe('Adele');
    expect(s.greatShare).toBeCloseTo(1 / 3);
  });

  it('year scope excludes other years and backfill nights', () => {
    const s = karaokeStats(items, log, { year: 2026 });
    // records 3,4,5 + dated backfill 6 count as performances; undated backfill 7 excluded
    expect(s.performances).toBe(1 + 2 + 1 + 2);
    expect(s.songs).toBe(3);
    expect(s.nights).toBe(2);
    expect(s.venues).toBe(1);
    expect(s.mostSung).toEqual({ artist: 'Adele', title: 'Hello', count: 3 });
    expect(s.topArtist).toBe('Adele');
    expect(s.greatShare).toBeCloseTo(1 / 3);
    const s25 = karaokeStats(items, log, { year: 2025 });
    expect(s25).toMatchObject({ songs: 1, performances: 2, nights: 1, venues: 1, greatShare: 1 });
  });

  it("a year's greatShare uses that year's own latest feel, not the song's current one", () => {
    const hello = item('Adele', 'Hello', { times_sung: 2, latest_feel: 'bad' });
    const l = [
      rec('a', 'Adele', 'Hello', { sung_at: '2025-03-01T20:00:00Z', survey: { feel: 'great', answered_at: '2025-03-01T21:00:00Z' } }),
      rec('b', 'Adele', 'Hello', { sung_at: '2026-03-01T20:00:00Z', survey: { feel: 'bad', answered_at: '2026-03-01T21:00:00Z' } }),
    ];
    expect(karaokeStats([hello], l, { year: 2025 }).greatShare).toBe(1);
    expect(karaokeStats([hello], l, { year: 2026 }).greatShare).toBe(0);
    expect(karaokeStats([hello], l, {}).greatShare).toBe(0); // all-time: the song's current feel
  });

  it('empty scope', () => {
    expect(karaokeStats([], [], { year: 1999 })).toEqual({
      songs: 0, performances: 0, nights: 0, venues: 0, topArtist: null, mostSung: null, greatShare: null,
    });
    expect(karaokeStats(items, log, { year: 1999 }).greatShare).toBeNull();
  });

  it('top artist shows the most common spelling', () => {
    const s = karaokeStats(
      [item('The Killers', 'A', { times_sung: 1 }), item('the killers', 'B', { times_sung: 3 }), item('Blur', 'C', { times_sung: 3 })],
      [], {},
    );
    expect(s.topArtist).toBe('the killers');
  });

  it('breaks ties deterministically', () => {
    const a = karaokeStats([item('Zed', 'Z', { times_sung: 2 }), item('Abe', 'B', { times_sung: 2 }), item('Abe', 'A', { times_sung: 2 })], [], {});
    const b = karaokeStats([item('Abe', 'A', { times_sung: 2 }), item('Abe', 'B', { times_sung: 2 }), item('Zed', 'Z', { times_sung: 2 })], [], {});
    expect(a.mostSung).toEqual({ artist: 'Abe', title: 'A', count: 2 });
    expect(b.mostSung).toEqual(a.mostSung);
    expect(a.topArtist).toBe('Abe');
    expect(b.topArtist).toBe('Abe');
  });
});
