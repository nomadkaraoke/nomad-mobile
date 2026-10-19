// Discover's four search outcomes (spec §4.1) over mocked useSearch states.
import * as decide from '@nomad/api-decide';
import type { SongGroup, SongRef, Version } from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { useMakeIntent } from '../../make/intentStore';
import { appRoutes } from '../../test-utils/routes';
import { logEvent } from '../searchSession';
import type { SearchState } from '../useSearch';

jest.mock('@nomad/api-decide', () => ({
  resolveQuery: jest.fn(),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('../searchSession', () => ({ logEvent: jest.fn(), renewSid: jest.fn(() => 'new'), currentSid: () => 'sid-1' }));

let mockState: SearchState;
jest.mock('../useSearch', () => ({ MIN_QUERY_CHARS: 2, useSearch: () => mockState }));

let mockOffline: { status: string; downloadedAt: number | null; bytes: number | null; progress: number | null; download: jest.Mock; remove: jest.Mock };
jest.mock('../../offline/offlineIndex', () => ({
  useOfflineIndex: () => mockOffline,
  openOfflineReader: () => null,
  maybeRefreshOfflineIndex: async () => {},
}));

const resolveQuery = decide.resolveQuery as jest.Mock;
const log = logEvent as jest.Mock;

const ref = (artist: string, title: string, karaoke = true): SongRef => ({
  artist,
  title,
  song_key: `${artist.toLowerCase()}|${title.toLowerCase()}`,
  popularity: 50,
  karaoke,
});
const version = (i: number, kind: Version['kind'] = 'community', youtube = true): Version => ({
  brand_code: `B${i}`,
  brand_name: `Brand ${i}`,
  kind,
  youtube_url: youtube ? `https://youtu.be/v${i}` : null,
  rank: i,
});
const group = (s: SongRef, versions: Version[] = [version(0)], count = versions.length): SongGroup => ({
  song_key: s.song_key,
  artist: s.artist,
  title: s.title,
  version_count: count,
  versions,
});

const STARLIGHT = ref('Muse', 'Starlight');
const MACHU = ref('The Strokes', 'Machu Picchu', false);
const state = (p: Partial<SearchState> = {}): SearchState => ({
  query: 'starlite muse',
  resultsQuery: 'starlite muse',
  source: 'cloud',
  loading: false,
  warmingUp: false,
  offline: false,
  identification: null,
  groups: [],
  resolve: null,
  error: null,
  retry: jest.fn(),
  ...p,
});
const confident = (best: SongRef, kind: 'same' | 'cosmetic' | 'content' = 'content', candidates: SongRef[] = [best]) => ({
  status: 'confident' as const,
  kind,
  best,
  candidates,
});

/** Renders Discover and lets the 300 ms tap guard pass (renderRouter switches jest to fake timers). */
async function renderDiscover(settle = true) {
  const app = renderRouter(appRoutes(), { initialUrl: '/discover' });
  await screen.findByTestId('discover-search-input');
  if (settle) await act(() => jest.advanceTimersByTimeAsync(300));
  return app;
}

beforeEach(() => {
  log.mockClear();
  resolveQuery.mockReset();
  useMakeIntent.getState().clear();
  mockOffline = { status: 'none', downloadedAt: null, bytes: null, progress: null, download: jest.fn(async () => {}), remove: jest.fn() };
  mockState = state();
});

describe('1 · confident, has karaoke versions', () => {
  beforeEach(() => {
    mockState = state({
      identification: confident(STARLIGHT, 'content', [STARLIGHT, ref('Taylor Swift', 'Starlight')]),
      groups: [
        group(STARLIGHT, [version(0), version(1, 'commercial', false)]),
        group(ref('Taylor Swift', 'Starlight')),
      ],
    });
  });

  it('shows the song card with the correction, its versions and the similar songs; no missing card or make bar', async () => {
    await renderDiscover();
    expect(screen.getByTestId('song-card')).toBeTruthy();
    expect(screen.getByText('Corrected to ⁨Starlight · Muse⁩ — you typed “⁨starlite muse⁩”')).toBeTruthy();
    expect(screen.getByTestId('song-card-undo')).toBeTruthy();
    expect(screen.getByTestId('song-card-not-it')).toBeTruthy();
    expect(screen.getByText('Karaoke versions (2)')).toBeTruthy();
    expect(screen.getByTestId('version-row-0')).toBeTruthy();
    expect(screen.getByTestId('version-row-1')).toBeTruthy();
    expect(screen.getByText('Community')).toBeTruthy();
    expect(screen.getByText('Commercial')).toBeTruthy();
    expect(screen.getByTestId('similar-row-0')).toBeTruthy();
    expect(screen.getByText('Other songs with similar names (1)')).toBeTruthy();
    expect(screen.queryByTestId('missing-card')).toBeNull();
    expect(screen.queryByTestId('make-bar')).toBeNull();
    expect(screen.queryByTestId('versions-show-all')).toBeNull();
  });

  it('cosmetic: "Tidied to … · keep what I typed"', async () => {
    mockState = { ...mockState, identification: confident(STARLIGHT, 'cosmetic') };
    await renderDiscover();
    expect(screen.getByText('Tidied to ⁨Starlight · Muse⁩')).toBeTruthy();
    expect(screen.getByText('keep what I typed')).toBeTruthy();
  });

  it('same: no announcement and nothing to undo', async () => {
    mockState = { ...mockState, identification: confident(STARLIGHT, 'same') };
    await renderDiscover();
    expect(screen.getByTestId('song-card')).toBeTruthy();
    expect(screen.queryByTestId('song-card-announce')).toBeNull();
    expect(screen.queryByTestId('song-card-undo')).toBeNull();
  });

  it('Undo logs keep_typed and shows the typed-query results with the make bar', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByTestId('song-card-undo'));
    expect(log).toHaveBeenCalledWith('keep_typed', { song_key: 'muse|starlight' });
    expect(screen.queryByTestId('song-card')).toBeNull();
    expect(screen.getByText('Starlight')).toBeTruthy(); // Taylor Swift's row
    expect(screen.getByText('Taylor Swift')).toBeTruthy();
    expect(screen.getByTestId('make-bar')).toBeTruthy();
  });

  it('Not it? logs not_it and opens the other candidates', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByTestId('song-card-not-it'));
    expect(log).toHaveBeenCalledWith('not_it', { song_key: 'muse|starlight' });
    expect(screen.queryByTestId('song-card')).toBeNull();
    expect(screen.getByTestId('which-one-chip-0')).toBeTruthy();
    expect(screen.queryByTestId('which-one-chip-1')).toBeNull(); // Muse itself isn't offered again
  });

  it('taps are ignored for 300 ms after the results render', async () => {
    const app = await renderDiscover(false);
    fireEvent.press(screen.getByTestId('song-card'));
    expect(app.getPathname()).toBe('/discover');
    await act(() => jest.advanceTimersByTimeAsync(300));
    fireEvent.press(screen.getByTestId('song-card'));
    await waitFor(() => expect(app.getPathname()).toBe('/song/muse|starlight'));
  });

  it("never shows the previous query's card while a new query loads", async () => {
    mockState = { ...mockState, query: 'help', resultsQuery: 'starlite muse', loading: true };
    await renderDiscover();
    expect(screen.queryByTestId('song-card')).toBeNull();
    expect(screen.queryByTestId('make-bar')).toBeNull();
    expect(screen.getByTestId('discover-loading')).toBeTruthy();
  });
});

describe('Review Focus 4: disc-only versions and 50+ versions', () => {
  it('a version with no YouTube URL says "In a library or on disc" and has no link', async () => {
    mockState = state({
      identification: confident(STARLIGHT, 'same'),
      groups: [group(STARLIGHT, [version(0, 'community', true), version(1, 'commercial', false), version(2, 'community', false)])],
    });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderDiscover();
    expect(screen.getByTestId('version-row-0-youtube')).toBeTruthy();
    expect(screen.queryByTestId('version-row-1-youtube')).toBeNull();
    expect(screen.queryByTestId('version-row-2-youtube')).toBeNull();
    expect(screen.getAllByText('In a library or on disc')).toHaveLength(2);
    fireEvent.press(screen.getByTestId('version-row-0-youtube'));
    expect(open).toHaveBeenCalledWith('https://youtu.be/v0');
    open.mockRestore();
  });

  it('a 55-version song shows the best 5 plus "Show all 55", which opens the song page', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => version(i)); // the search API caps a group at 12
    mockState = state({ identification: confident(STARLIGHT, 'same'), groups: [group(STARLIGHT, twelve, 55)] });
    const app = await renderDiscover();
    expect(screen.getByText('Karaoke versions (55)')).toBeTruthy();
    expect(screen.getByTestId('version-row-4')).toBeTruthy();
    expect(screen.queryByTestId('version-row-5')).toBeNull();
    expect(screen.getByText('Show all 55')).toBeTruthy();
    fireEvent.press(screen.getByTestId('versions-show-all'));
    await waitFor(() => expect(app.getPathname()).toBe('/song/muse|starlight'));
  });

  it('"Show all" expands in place when every version is already loaded', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => version(i));
    mockState = state({ identification: confident(STARLIGHT, 'same'), groups: [group(STARLIGHT, seven)] });
    await renderDiscover();
    expect(screen.queryByTestId('version-row-5')).toBeNull();
    fireEvent.press(screen.getByTestId('versions-show-all'));
    expect(screen.getByTestId('version-row-6')).toBeTruthy();
    expect(screen.queryByTestId('versions-show-all')).toBeNull();
  });
});

describe('2 · confident, no karaoke version yet', () => {
  const near = [ref('Evaluna Montaner', 'Machu Picchu'), ref('Camilo', 'Machu Picchu'), ref('A', 'Machu'), ref('B', 'Picchu')];
  beforeEach(() => {
    mockState = state({
      query: 'machu picchu strokes',
      resultsQuery: 'machu picchu strokes',
      identification: confident(MACHU, 'completed' as 'same'),
      groups: near.map((s) => group(s)),
    });
  });

  it('shows the missing card and ≤3 similar songs plus "Show 1 more"; no make bar; logs make_offer_shown', async () => {
    await renderDiscover();
    expect(screen.getByTestId('missing-card')).toBeTruthy();
    expect(screen.getByTestId('missing-card-make')).toBeTruthy();
    expect(screen.queryByTestId('song-card')).toBeNull();
    expect(screen.queryByTestId('make-bar')).toBeNull();
    expect(screen.getByTestId('similar-row-2')).toBeTruthy();
    expect(screen.queryByTestId('similar-row-3')).toBeNull();
    expect(screen.getByText('Show 1 more')).toBeTruthy();
    expect(log).toHaveBeenCalledWith('make_offer_shown', expect.objectContaining({ where: 'missing_card' }));
    fireEvent.press(screen.getByTestId('similar-show-more'));
    expect(screen.getByTestId('similar-row-3')).toBeTruthy();
  });

  it('Make it stores exactly the identified artist/title and logs make_offer_tap', async () => {
    const app = await renderDiscover();
    fireEvent.press(screen.getByTestId('missing-card-make'));
    expect(log).toHaveBeenCalledWith('make_offer_tap', { where: 'missing_card', song_key: 'the strokes|machu picchu' });
    expect(useMakeIntent.getState().intent).toMatchObject({ artist: 'The Strokes', title: 'Machu Picchu' });
    await waitFor(() => expect(app.getPathname()).toBe('/sign-in')); // signed out: sign-in carries on to make
  });

  it("the index's karaoke flag vetoes the card: a karaoke song missing from the groups gets the song card", async () => {
    mockState = { ...mockState, identification: confident({ ...MACHU, karaoke: true }, 'same') };
    await renderDiscover();
    expect(screen.queryByTestId('missing-card')).toBeNull();
    expect(screen.getByTestId('song-card')).toBeTruthy();
  });

  it('a group that is the same song (sameSong) also vetoes it', async () => {
    mockState = { ...mockState, groups: [group(ref('The Strokes', 'Machu Picchu (Live)'))] };
    await renderDiscover();
    expect(screen.queryByTestId('missing-card')).toBeNull();
    expect(screen.getByTestId('song-card')).toBeTruthy();
  });
});

describe('3 · not sure which song', () => {
  const babies = ['Justin Bieber', 'Brandy', 'Ashanti', 'Shakira', 'Lil Baby'].map((a) => ref(a, 'Baby'));
  beforeEach(() => {
    mockState = state({
      query: 'baby',
      resultsQuery: 'baby',
      identification: { status: 'candidates', kind: null, best: babies[0], candidates: babies },
      groups: [group(babies[0]!, [version(0), version(1)]), group(ref('Britney Spears', 'Baby One More Time'))],
    });
  });

  it('shows ≤4 chips plus More…, the karaoke results and the sticky make bar', async () => {
    await renderDiscover();
    expect(screen.getByText('Which song do you mean?')).toBeTruthy();
    expect(screen.getByTestId('which-one-chip-3')).toBeTruthy();
    expect(screen.queryByTestId('which-one-chip-4')).toBeNull();
    expect(screen.getByTestId('similar-row-1')).toBeTruthy();
    expect(screen.getByTestId('make-bar')).toBeTruthy();
    expect(screen.queryByTestId('song-card')).toBeNull();
    expect(log).toHaveBeenCalledWith('make_offer_shown', expect.objectContaining({ where: 'make_bar' }));
    fireEvent.press(screen.getByTestId('which-one-more'));
    expect(screen.getByTestId('which-one-chip-4')).toBeTruthy();
  });

  it('a chip opens that song card with its versions and logs pick_candidate; the make bar goes', async () => {
    await renderDiscover();
    fireEvent.press(screen.getByTestId('which-one-chip-0'));
    expect(log).toHaveBeenCalledWith('pick_candidate', { i: 0, song_key: 'justin bieber|baby' });
    expect(screen.getByTestId('song-card')).toBeTruthy();
    expect(screen.getByTestId('version-row-1')).toBeTruthy();
    expect(screen.queryByTestId('make-bar')).toBeNull();
  });

  it('the make bar opens Make any song and logs make_offer_tap', async () => {
    const app = await renderDiscover();
    fireEvent.press(screen.getByTestId('make-bar'));
    expect(log).toHaveBeenCalledWith('make_offer_tap', { where: 'make_bar' });
    await waitFor(() => expect(app.getPathname()).toBe('/song/new'));
  });

  it('offline candidates (one group per candidate) render as rows too', async () => {
    mockState = { ...mockState, source: 'offline', groups: babies.slice(0, 3).map((b) => group(b)) };
    await renderDiscover();
    expect(screen.getByTestId('similar-row-2')).toBeTruthy();
  });
});

describe('4 · offline', () => {
  it('shows the banner with the list age and the song card from the offline list', async () => {
    mockOffline = { ...mockOffline, status: 'ready', downloadedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 - 1000 };
    mockState = state({
      offline: true,
      source: 'offline',
      identification: confident(STARLIGHT, 'content'),
      groups: [group(STARLIGHT, [version(0), version(1, 'commercial', false)])],
    });
    await renderDiscover();
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    expect(screen.getByText('Offline · searching songs saved on this phone (updated 2 days ago)')).toBeTruthy();
    expect(screen.queryByTestId('offline-download')).toBeNull();
    expect(screen.getByTestId('song-card')).toBeTruthy();
    expect(screen.getByTestId('version-row-0-youtube')).toBeTruthy();
  });

  it('with no list: the download button; making says it needs a connection', async () => {
    mockState = state({ offline: true, source: 'none', query: 'baby', resultsQuery: 'baby' });
    await renderDiscover();
    fireEvent.press(screen.getByTestId('offline-download'));
    expect(mockOffline.download).toHaveBeenCalled();
    expect(screen.getByTestId('make-bar')).toBeTruthy();
    expect(screen.getByText('Making a song needs a connection')).toBeTruthy();
  });

  it('the missing card says making needs a connection instead of offering it', async () => {
    mockState = state({ offline: true, source: 'offline', identification: confident(MACHU, 'same') });
    await renderDiscover();
    expect(screen.getByTestId('missing-card')).toBeTruthy();
    expect(screen.queryByTestId('missing-card-make')).toBeNull();
    expect(screen.getByText('Making a song needs a connection')).toBeTruthy();
  });

  it('no banner while online', async () => {
    await renderDiscover();
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});

describe('Describe it', () => {
  it('sends the description straight to resolveQuery and shows the corrected song card', async () => {
    mockState = state({ identification: confident(STARLIGHT, 'same'), groups: [group(STARLIGHT)] });
    resolveQuery.mockResolvedValue({
      kind: 'content',
      corrected: ref('Queen', 'Bohemian Rhapsody'),
      typed: null,
      groups: [group(ref('Queen', 'Bohemian Rhapsody'), [version(0), version(1)])],
      alternatives: [],
    });
    await renderDiscover();
    fireEvent.press(screen.getByTestId('describe-link'));
    fireEvent.changeText(screen.getByTestId('describe-input'), 'is this the real life');
    await act(async () => fireEvent.press(screen.getByTestId('describe-submit')));
    expect(resolveQuery).toHaveBeenCalledWith('is this the real life', 'sid-1');
    expect(log).toHaveBeenCalledWith('describe_submit', { chars: 21 });
    await act(() => jest.advanceTimersByTimeAsync(300));
    expect(await screen.findByText('Bohemian Rhapsody')).toBeTruthy();
    expect(screen.getByText('Corrected to ⁨Bohemian Rhapsody · Queen⁩ — you typed “⁨is this the real life⁩”')).toBeTruthy();
    expect(screen.getByTestId('version-row-1')).toBeTruthy();
  });

  it('alternatives render as "Did you mean?" chips', async () => {
    resolveQuery.mockResolvedValue({ kind: null, corrected: null, groups: [], alternatives: [ref('A', 'One'), ref('B', 'Two')] });
    await renderDiscover();
    fireEvent.press(screen.getByTestId('describe-link'));
    fireEvent.changeText(screen.getByTestId('describe-input'), 'a sad one');
    await act(async () => fireEvent.press(screen.getByTestId('describe-submit')));
    expect(await screen.findByText('Did you mean?')).toBeTruthy();
    expect(screen.getByTestId('which-one-chip-1')).toBeTruthy();
  });

  it('nothing found says so', async () => {
    resolveQuery.mockResolvedValue({ kind: null, corrected: null, groups: [], alternatives: [] });
    await renderDiscover();
    fireEvent.press(screen.getByTestId('describe-link'));
    fireEvent.changeText(screen.getByTestId('describe-input'), 'hmm');
    await act(async () => fireEvent.press(screen.getByTestId('describe-submit')));
    expect(await screen.findByTestId('describe-nothing')).toBeTruthy();
  });
});

describe('the cloud resolve fallback', () => {
  const NONE = { status: 'none' as const, kind: null, best: null, candidates: [] };

  it('shows "Figuring out which song you mean…" while it runs', async () => {
    mockState = state({ query: 'whale song', resultsQuery: 'whale song', loading: true, identification: NONE });
    await renderDiscover();
    expect(screen.getByText('Figuring out which song you mean…')).toBeTruthy();
    expect(screen.queryByTestId('make-bar')).toBeNull();
  });

  it("then shows Gemini's corrected song as the song card", async () => {
    mockState = state({
      query: 'whale song',
      resultsQuery: 'whale song',
      identification: NONE,
      resolve: { kind: 'content', corrected: ref('Whale', 'Song'), typed: 'whale song', groups: [], alternatives: [] },
    });
    await renderDiscover();
    expect(screen.getByTestId('song-card')).toBeTruthy();
    expect(screen.getByText('Corrected to ⁨Song · Whale⁩ — you typed “⁨whale song⁩”')).toBeTruthy();
  });

  it('nothing at all: the no-results line and the make bar', async () => {
    mockState = state({ query: 'zzzz', resultsQuery: 'zzzz', identification: NONE });
    await renderDiscover();
    expect(screen.getByText('No songs found for “zzzz”.')).toBeTruthy();
    expect(screen.getByTestId('make-bar')).toBeTruthy();
  });
});
