import { toUploadChunks, type ExportSummary, type ExportUploadChunk, type ListenAggregate } from '../index';
import { SONGS } from '../__fixtures__/buildExport';

const track = (i: number, plays = 1): ListenAggregate => ({ artist: `Artist ${i}`, title: `Song ${i}`, ms_played: plays * 200_000, plays, first_ts: 1_700_000_000, last_ts: 1_700_000_000 + i });

/** The body of a chunk that must be a Spotify one. */
const sp = (c: ExportUploadChunk) => {
  if (c.endpoint !== 'spotify-export') throw new Error(`expected a Spotify chunk, got ${c.endpoint}`);
  return c.body;
};

const summary = (over: Partial<ExportSummary>): ExportSummary => ({
  kind: 'spotify-account',
  generatedAt: '2024-05-03',
  tracks: [],
  liked: [],
  playlists: [],
  skipped: { podcasts: 0, short: 0, malformed: 0 },
  truncated: false,
  ...over,
});

describe('toUploadChunks', () => {
  it('splits 45,001 tracks into 3, sorted by plays, liked and playlists only in chunk 0', () => {
    const tracks = Array.from({ length: 45_001 }, (_, i) => track(i, (i % 7) + 1));
    const s = summary({ kind: 'spotify-extended', tracks, liked: [SONGS.hello], playlists: [{ name: 'Mix', tracks: [SONGS.rocket] }] });
    const chunks = toUploadChunks(s);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => (c.body.tracks as unknown[]).length)).toEqual([20_000, 20_000, 5_001]);
    chunks.forEach((c, i) => {
      expect(c.endpoint).toBe('spotify-export');
      expect(c.body).toMatchObject({ kind: 'extended', generated_at: '2024-05-03', chunk_index: i, chunk_count: 3 });
    });
    expect(sp(chunks[0]!).liked).toEqual([SONGS.hello]);
    expect(sp(chunks[0]!).playlists).toEqual([{ name: 'Mix', tracks: [SONGS.rocket] }]);
    for (const c of chunks.slice(1)) {
      expect(sp(c).liked).toEqual([]);
      expect(sp(c).playlists).toEqual([]);
    }
    // Every song lands in exactly one chunk, sorted by plays descending.
    const all = chunks.flatMap((c) => c.body.tracks as ListenAggregate[]);
    expect(new Set(all.map((t) => t.title)).size).toBe(45_001);
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.plays).toBeGreaterThanOrEqual(all[i]!.plays);
    expect(all[0]).toEqual({ artist: expect.any(String), title: expect.any(String), ms_played: 1_400_000, plays: 7, first_ts: 1_700_000_000, last_ts: expect.any(Number) });
  });

  it('account kind, custom maxTracks, at most 50 chunks', () => {
    const tracks = Array.from({ length: 60 }, (_, i) => track(i));
    const chunks = toUploadChunks(summary({ tracks }), 1);
    expect(chunks).toHaveLength(50);
    expect(sp(chunks[0]!).kind).toBe('account');
    expect(chunks.every((c) => c.body.chunk_count === 50)).toBe(true);
    expect(toUploadChunks(summary({ tracks }), 0)).toHaveLength(50); // clamped to ≥ 1
    expect(toUploadChunks(summary({ tracks }), 99_999)).toHaveLength(1); // clamped to ≤ 20,000
  });

  it('Apple bodies omit kind, liked and playlists', () => {
    const chunks = toUploadChunks(summary({ kind: 'apple', tracks: [track(1)], liked: [SONGS.hello] }));
    expect(chunks).toEqual([
      { endpoint: 'apple-export', body: { generated_at: '2024-05-03', chunk_index: 0, chunk_count: 1, tracks: [track(1)] } },
    ]);
  });

  it('a Spotify export with only liked songs is one chunk with no tracks; nothing at all is none', () => {
    expect(toUploadChunks(summary({ liked: [SONGS.hello] }))).toEqual([
      { endpoint: 'spotify-export', body: { kind: 'account', generated_at: '2024-05-03', chunk_index: 0, chunk_count: 1, tracks: [], liked: [SONGS.hello], playlists: [] } },
    ]);
    expect(toUploadChunks(summary({}))).toEqual([]);
    expect(toUploadChunks(summary({ kind: 'apple', liked: [SONGS.hello] }))).toEqual([]);
  });

  it('clips text to the API limits and drops refs that are blank', () => {
    const long = 'x'.repeat(299) + '😀'; // 301 UTF-16 units: the surrogate pair must not be split
    const chunks = toUploadChunks(
      summary({
        tracks: [{ ...track(1), artist: long, title: '  Hello  ' }, { ...track(2), title: '   ' }],
        liked: [{ artist: '', title: 'x' }, SONGS.hello],
        playlists: [{ name: 'n'.repeat(250), tracks: [{ artist: 'Adele', title: ' ' }, SONGS.machu] }],
      }),
    );
    const body = sp(chunks[0]!);
    const t = (body.tracks as ListenAggregate[])[0]!;
    expect(t.artist).toBe('x'.repeat(299));
    expect(t.title).toBe('Hello');
    expect(body.tracks).toHaveLength(1);
    expect(body.liked).toEqual([SONGS.hello]);
    expect(body.playlists).toEqual([{ name: 'n'.repeat(200), tracks: [SONGS.machu] }]);
  });

  it('keeps total playlist refs within 20,000 (export order, songs already sent dropped, ≤ 10,000 per playlist, ≤ 500 playlists)', () => {
    const refs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ artist: prefix, title: `${prefix} ${i}` }));
    const playlists = [
      { name: 'Big', tracks: refs('A', 12_000) }, // capped to 10,000
      { name: 'Dupes', tracks: [...refs('A', 5), SONGS.hello] }, // all already sent → dropped
      { name: 'Mid', tracks: refs('B', 8_000) },
      { name: 'Crosses', tracks: refs('C', 5_000) }, // truncated to the 2,000 left
      { name: 'Late', tracks: refs('D', 10) }, // budget gone → dropped
    ];
    const body = sp(toUploadChunks(summary({ liked: [SONGS.hello], playlists }))[0]!);
    const pl = body.playlists as { name: string; tracks: unknown[] }[];
    expect(pl.map((p) => [p.name, p.tracks.length])).toEqual([
      ['Big', 10_000],
      ['Mid', 8_000],
      ['Crosses', 2_000],
    ]);
    const many = Array.from({ length: 600 }, (_, i) => ({ name: `P${i}`, tracks: [{ artist: 'X', title: `t${i}` }] }));
    expect((sp(toUploadChunks(summary({ playlists: many }))[0]!).playlists as unknown[]).length).toBe(500);
  });

  it('caps liked at 20,000', () => {
    const liked = Array.from({ length: 20_005 }, (_, i) => ({ artist: 'A', title: `L${i}` }));
    expect((sp(toUploadChunks(summary({ liked }))[0]!).liked as unknown[]).length).toBe(20_000);
  });
});
