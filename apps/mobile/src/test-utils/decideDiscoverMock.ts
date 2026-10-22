// Discover's recommendations/feedback facades for tests that mock @nomad/api-decide for search only. Use inside
// a jest.mock factory: `...jest.requireActual<typeof import('…/decideDiscoverMock')>('…/decideDiscoverMock').discoverMocks()`.
// Picks never load (the Discover tab shows its loading state above the popular list), so screens keep
// their Phase 1b layout.
export function discoverMocks() {
  const actual = jest.requireActual('@nomad/api-decide') as typeof import('@nomad/api-decide');
  return {
    ApiError: actual.ApiError,
    isWarmingUp: actual.isWarmingUp,
    getRecommendationsV2: jest.fn(() => new Promise(() => {})),
    hideSong: jest.fn(async () => {}),
    unhideSong: jest.fn(async () => {}),
    loveSong: jest.fn(async () => {}),
    unloveSong: jest.fn(async () => {}),
  };
}
