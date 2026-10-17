import { getSearchConfidence, AudioResultLike } from '../audioRank';

// Local fixtures shaped like the gen local-stack fake search (search_confidence =
// perfect / recommended / unsure). TODO(controller): re-sync with gen's
// FRONTEND_FIXTURE once the fake_workers PR lands.
const title = 'Song';
const artist = 'Artist';
const red = (over: Partial<AudioResultLike>): AudioResultLike => ({
  title, artist, provider: 'RED', is_lossless: true, release_type: 'Album',
  target_file: `01 - ${title}.flac`, quality_data: { format: 'FLAC', bit_depth: 16, media: 'CD' }, ...over,
});
const spotify = (over: Partial<AudioResultLike> = {}): AudioResultLike => ({
  title, artist, provider: 'Spotify', is_lossless: false, ...over,
});
const youtube = (over: Partial<AudioResultLike> = {}): AudioResultLike => ({
  title: `${artist} - ${title} (Official Video)`, artist, provider: 'YouTube', is_lossless: false,
  channel: `${artist}VEVO`, view_count: 1000000, ...over,
});

const perfect = [red({ seeders: 120 }), spotify(), youtube()];
const recommended = [red({ seeders: 25 }), spotify(), youtube()];
const unsure = [
  red({ seeders: 2, title: 'Other', target_file: '01 - Other Thing.flac' }),
  spotify({ title: 'Other' }),
  youtube({ title: 'Artist - Other Thing (Official Video)' }),
];

describe('getSearchConfidence on fake-search shaped results', () => {
  it('perfect -> tier 1 with the well-seeded torrent', () => {
    const c = getSearchConfidence(perfect, title, artist);
    expect(c.tier).toBe(1);
    expect(c.best).toBe(perfect[0]);
  });
  it('recommended -> tier 2', () => {
    expect(getSearchConfidence(recommended, title, artist).tier).toBe(2);
  });
  it('unsure -> tier 3', () => {
    expect(getSearchConfidence(unsure, title, artist).tier).toBe(3);
  });
  it('no results -> tier 3 with null best', () => {
    expect(getSearchConfidence([], title, artist)).toMatchObject({ tier: 3, best: null });
  });
});
