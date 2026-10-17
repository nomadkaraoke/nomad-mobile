import fixture from './fixtures/fake-search-tiers.json';
import { getSearchConfidence, AudioResultLike } from '../audioRank';

// The gen local stack's fake audio search shapes its results by the `search_confidence` fake-config knob.
// fixtures/fake-search-tiers.json is a verbatim copy of gen's
// frontend/lib/__tests__/fixtures/fake-search-tiers.json (kept current there by a backend test;
// regenerate in gen: poetry run python -m backend.services.fake_workers.search --write-fixture, then copy).
// Feeding those exact shapes to our ranking port keeps the app's tiers in step with the web's.
const shapes = fixture.shapes as unknown as Record<'perfect' | 'recommended' | 'unsure', AudioResultLike[]>;
const { title, artist } = fixture;

describe('getSearchConfidence on gen fake-search shapes', () => {
  it.each([
    ['perfect', 1],
    ['recommended', 2],
    ['unsure', 3],
  ] as const)('%s lands in tier %i', (shape, tier) => {
    expect(getSearchConfidence(shapes[shape], title, artist).tier).toBe(tier);
    // Some flows pass only the title; the tier must hold there too.
    expect(getSearchConfidence(shapes[shape], title).tier).toBe(tier);
  });

  it('perfect picks the well-seeded lossless torrent', () => {
    expect(getSearchConfidence(shapes.perfect, title, artist).best).toBe(shapes.perfect[0]);
  });

  it('unsure stays tier 3 with a single result', () => {
    expect(getSearchConfidence(shapes.unsure.slice(0, 1), title, artist).tier).toBe(3);
  });

  it('no results -> tier 3 with null best', () => {
    expect(getSearchConfidence([], title, artist)).toMatchObject({ tier: 3, best: null });
  });
});
