// The song page (spec §4.2): a song_key → its grouped versions (decide getSongDetail online, the offline list
// otherwise) and "Make it" with the canonical artist/title; `new` → the free-text "make any song" form.
import * as decide from '@nomad/api-decide';
import type { SongDetail, Version } from '@nomad/api-decide';
import type { SqlReader } from '@nomad/core';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import Database from 'better-sqlite3';
import { renderRouter } from 'expo-router/testing-library';
import path from 'node:path';
import { Linking, View } from 'react-native';

import { useAuth } from '../auth/store';
import { logEvent } from '../find/searchSession';
import { EMPTY_DRAFT, useMakeIntent } from '../make/intentStore';
import { profileFromSelfReport, useVoiceStore } from '../voice/voiceStore';
import { session } from '../test-utils/genAuthMock';
import { signInRoutes } from '../test-utils/signInRoutes';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSongDetail: jest.fn(),
  getSongVocalRange: jest.fn(),
  ApiError: class ApiError extends Error {},
  getLibrary: jest.fn(async () => ({ notModified: false, etag: 'e', items: [] })),
  listSetlists: jest.fn(async () => []),
  listKaraokeLog: jest.fn(async () => ({ entries: [] })),
  listSongHistory: jest.fn(async () => []),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));
jest.mock('../find/searchSession', () => ({ logEvent: jest.fn(), renewSid: jest.fn(), currentSid: () => 'sid-1' }));

// The offline list: the core package's fixture offline.db (has Muse "Starlight" with 5 versions).
let mockReader: SqlReader | null = null;
jest.mock('../offline/offlineIndex', () => ({
  openOfflineReader: () => mockReader,
  useOfflineIndex: () => ({ status: 'none', downloadedAt: null, bytes: null, progress: null, download: jest.fn(), remove: jest.fn() }),
  maybeRefreshOfflineIndex: async () => {},
}));

let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});

const getSongDetail = decide.getSongDetail as jest.Mock;
const getSongVocalRange = decide.getSongVocalRange as jest.Mock;
const log = logEvent as jest.Mock;

const raw = new Database(path.join(__dirname, '../../../../packages/core/src/search/__fixtures__/offline_fixture.db'), {
  readonly: true,
});
const fixtureReader: SqlReader = { all: <T,>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[] };
afterAll(() => raw.close());

const version = (i: number, kind: Version['kind'] = 'community', youtube = true): Version => ({
  brand_code: `B${i}`,
  brand_name: `Brand ${i}`,
  kind,
  youtube_url: youtube ? `https://youtu.be/v${i}` : null,
  rank: i,
});
const detail = (versions: Version[], over: Partial<SongDetail['song']> = {}): SongDetail => ({
  song: { artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight', popularity: 80, karaoke: versions.length > 0, ...over },
  versions,
});

const routes = () => ({ ...signInRoutes(), 'sign-in/index': () => <View testID="signin-stub" /> });
const KEY_URL = `/song/${encodeURIComponent('muse|starlight')}`;

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  useMakeIntent.getState().clear();
  mockReader = null;
  mockConnected = true;
  getSongDetail.mockResolvedValue(detail([version(0), version(1, 'commercial', false)]));
  getSongVocalRange.mockResolvedValue({ song_key: 'muse|starlight', range: null });
  useVoiceStore.getState().clear();
});

describe('a song (online: decide getSongDetail)', () => {
  it('shows the title, artist and every version from getSongDetail', async () => {
    getSongDetail.mockResolvedValue(detail([0, 1, 2, 3, 4, 5, 6].map((i) => version(i, i % 2 ? 'commercial' : 'community', i % 2 === 0))));
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(screen.getByTestId('song-make')).toBeDisabled();
    expect(await screen.findByText('Starlight')).toBeTruthy();
    expect(getSongDetail).toHaveBeenCalledWith('muse|starlight');
    expect(screen.getByText('Muse')).toBeTruthy();
    expect(screen.getByTestId('song-badge')).toHaveTextContent('Karaoke versions exist');
    expect(screen.getByText('Karaoke versions (7)')).toBeTruthy();
    expect(screen.getByTestId('version-row-0-youtube')).toBeTruthy();
    expect(screen.getByTestId('version-row-1')).toHaveTextContent(/In a library or on disc/);
    // The best 5, then "Show all 7" expands in place (the page has them all).
    expect(screen.queryByTestId('version-row-5')).toBeNull();
    fireEvent.press(screen.getByTestId('versions-show-all'));
    expect(screen.getByTestId('version-row-6')).toBeTruthy();
    expect(screen.queryByTestId('song-offline-note')).toBeNull();
    expect(screen.getByTestId('song-art', { includeHiddenElements: true })).toHaveTextContent('S');
  });

  it('opened from a merged Discover card: lists the same merged versions (main key + `also` keys)', async () => {
    getSongDetail.mockImplementation(async (key: string) =>
      key === 'muse|starlight (live)'
        ? detail([version(0), version(7), version(8, 'commercial', false)], { song_key: key, title: 'Starlight (Live)' })
        : key === 'muse|gone'
          ? Promise.reject({ status: 404, detail: 'not found' })
          : detail([version(0), version(1, 'commercial', false), version(2)]),
    );
    const also = encodeURIComponent(JSON.stringify(['muse|starlight (live)', 'muse|gone']));
    renderRouter(routes(), { initialUrl: `${KEY_URL}?also=${also}` });
    // 3 + 3 - the shared B0 duplicate = 5; the missing key is skipped; the main key's song is shown.
    expect(await screen.findByText('Karaoke versions (5)')).toBeTruthy();
    expect(screen.getByText('Starlight')).toBeTruthy();
    expect(getSongDetail).toHaveBeenCalledWith('muse|starlight (live)');
    expect(getSongDetail).toHaveBeenCalledWith('muse|gone');
    // Playable first (B0, B2, B7), then by rank (B1, B8).
    expect(screen.getByTestId('version-row-2-youtube')).toBeTruthy();
    expect(screen.getByTestId('version-row-3')).toHaveTextContent(/In a library or on disc/);
  });

  it('a malformed `also` param is ignored', async () => {
    renderRouter(routes(), { initialUrl: `${KEY_URL}?also=not-json` });
    expect(await screen.findByText('Karaoke versions (2)')).toBeTruthy();
    expect(getSongDetail).toHaveBeenCalledTimes(1);
  });

  it('a song with no karaoke version: gold badge, no version list, Make it still offered', async () => {
    getSongDetail.mockResolvedValue(detail([]));
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByText('Starlight')).toBeTruthy();
    expect(screen.getByTestId('song-badge')).toHaveTextContent('No karaoke version found');
    expect(screen.getByTestId('song-badge-card')).toHaveTextContent(/Make your own karaoke video/);
    expect(screen.queryByTestId('version-list')).toBeNull();
    expect(screen.getByTestId('song-make')).toHaveTextContent('Make it · 1 credit');
    expect(screen.getByTestId('song-make')).toBeEnabled();
  });

  it('opening a YouTube version logs it with where song_page', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderRouter(routes(), { initialUrl: KEY_URL });
    fireEvent.press(await screen.findByTestId('version-row-0-youtube'));
    expect(open).toHaveBeenCalledWith('https://youtu.be/v0');
    expect(log).toHaveBeenCalledWith('open_youtube', { where: 'song_page', song_key: 'muse|starlight' });
    open.mockRestore();
  });

  it('a failed load with no offline list shows the error and retries', async () => {
    getSongDetail.mockRejectedValue(new Error('503'));
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('song-retry', {}, { timeout: 4000 })).toBeTruthy();
    getSongDetail.mockResolvedValue(detail([version(0)]));
    fireEvent.press(screen.getByTestId('song-retry'));
    expect(await screen.findByText('Starlight')).toBeTruthy();
  });
});

describe('Make it', () => {
  it('signed out: stores source identified with the canonical values and opens sign-in for /make/new', async () => {
    getSongDetail.mockResolvedValue(detail([version(0)], { artist: 'MUSE', title: 'Starlight' }));
    const app = renderRouter(routes(), { initialUrl: KEY_URL });
    await screen.findByText('Starlight');
    expect(log).toHaveBeenCalledWith('make_offer_shown', { where: 'song_page', song_key: 'muse|starlight' });
    fireEvent.press(screen.getByTestId('song-make'));
    expect(await screen.findByTestId('signin-stub')).toBeTruthy();
    expect(app.getPathname()).toBe('/sign-in');
    expect(app.getSearchParams()).toMatchObject({ returnTo: '/make/new' });
    expect(log).toHaveBeenCalledWith('make_offer_tap', { where: 'song_page', song_key: 'muse|starlight' });
    expect(useMakeIntent.getState().get()).toEqual({
      artist: 'MUSE',
      title: 'Starlight',
      canonicalArtist: 'MUSE',
      canonicalTitle: 'Starlight',
      songKey: 'muse|starlight',
      source: 'identified',
      editedFields: [],
      createdAt: expect.any(Number),
    });
  });

  it('signed in: goes straight to the make flow', async () => {
    await useAuth.getState().signInWithSession(session());
    const app = renderRouter(routes(), { initialUrl: KEY_URL });
    await screen.findByText('Starlight');
    fireEvent.press(screen.getByTestId('song-make'));
    expect(await screen.findByTestId('make-stub')).toBeTruthy();
    expect(app.getPathname()).toBe('/make/new');
    expect(useMakeIntent.getState().get()).toMatchObject({ title: 'Starlight', source: 'identified' });
  });
});

describe('offline', () => {
  it('no connection: the versions come from the offline list, and the cloud is not asked', async () => {
    mockConnected = false;
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByText('Starlight')).toBeTruthy();
    expect(getSongDetail).not.toHaveBeenCalled();
    expect(screen.getByTestId('song-offline-note')).toHaveTextContent(/saved on this phone/);
    expect(screen.getByText('Karaoke versions (5)')).toBeTruthy();
    expect(screen.getByTestId('version-row-0')).toHaveTextContent(/CC Karaoke/);
    expect(screen.getByTestId('version-row-2')).toHaveTextContent(/Karaoke Version.*In a library or on disc/);
    // Making needs a connection.
    expect(screen.queryByTestId('song-make')).toBeNull();
    expect(screen.getByTestId('song-make-offline')).toHaveTextContent('Making a song needs a connection');
  });

  it('online but the cloud fails: falls back to the offline list', async () => {
    getSongDetail.mockRejectedValue(new Error('unreachable'));
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('song-offline-note', {}, { timeout: 4000 })).toHaveTextContent(
      "Can't reach search right now · showing the song list saved on this phone",
    );
    expect(screen.getByText('Karaoke versions (5)')).toBeTruthy();
    expect(screen.queryByTestId('song-retry')).toBeNull();
    // Online: Make it is still offered with the offline list's canonical values.
    fireEvent.press(screen.getByTestId('song-make'));
    expect(useMakeIntent.getState().get()).toMatchObject({ canonicalArtist: 'Muse', canonicalTitle: 'Starlight', source: 'identified' });
  });

  it('a decide 404 (key only in the offline list) is "not on the server": no error note, offline data shown, not retried', async () => {
    getSongDetail.mockRejectedValue({ status: 404, detail: 'not found' });
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: KEY_URL });
    jest.useRealTimers(); // renderRouter switches to fake timers
    expect(await screen.findByText('Karaoke versions (5)')).toBeTruthy();
    await waitFor(() => expect(getSongDetail).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 1200)); // react-query's first retry delay is 1 s
    expect(getSongDetail).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('song-offline-note')).toBeNull();
    expect(screen.queryByTestId('song-retry')).toBeNull();
  });

  it('online: the cloud answer replaces the offline one when it arrives', async () => {
    let answer!: (d: SongDetail) => void;
    getSongDetail.mockReturnValue(new Promise((r) => (answer = r)));
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByText('Karaoke versions (5)')).toBeTruthy();
    // Online and still loading: the offline list fills in without claiming to be offline.
    expect(screen.queryByTestId('song-offline-note')).toBeNull();
    answer(detail([version(0)]));
    expect(await screen.findByText('Karaoke versions (1)')).toBeTruthy();
    expect(screen.queryByTestId('song-offline-note')).toBeNull();
  });

  it('no connection and the song is not in the offline list: says so', async () => {
    mockConnected = false;
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: `/song/${encodeURIComponent('nobody|nothing')}` });
    expect(await screen.findByTestId('song-offline-missing')).toBeTruthy();
    expect(screen.queryByTestId('song-make')).toBeNull();
  });

  it('no connection and no offline list: says so', async () => {
    mockConnected = false;
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('song-offline-missing')).toBeTruthy();
  });
});

describe('make any song (/song/new)', () => {
  it('typed artist and title become a typed intent with the edited fields', async () => {
    await useAuth.getState().signInWithSession(session());
    renderRouter(routes(), { initialUrl: '/song/new' });
    expect(await screen.findByTestId('song-make')).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('song-artist'), ' Muse ');
    fireEvent.changeText(screen.getByTestId('song-title'), 'Uprising');
    fireEvent.press(screen.getByTestId('song-make'));
    expect(await screen.findByTestId('make-stub')).toBeTruthy();
    expect(useMakeIntent.getState().get()).toEqual({
      artist: 'Muse',
      title: 'Uprising',
      source: 'typed',
      editedFields: ['artist', 'title'],
      createdAt: expect.any(Number),
    });
    expect(getSongDetail).not.toHaveBeenCalled();
  });

  it('starts pre-filled from the current identification; an edited field survives a later pre-fill', async () => {
    useMakeIntent.getState().prefill({ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' });
    renderRouter(routes(), { initialUrl: '/song/new' });
    expect(await screen.findByTestId('song-artist')).toHaveProp('value', 'Muse');
    expect(screen.getByTestId('song-title')).toHaveProp('value', 'Starlight');
    fireEvent.changeText(screen.getByTestId('song-title'), 'Uprising');
    // A new identification arrives (Discover, underneath): only the untouched artist follows it.
    useMakeIntent.getState().prefill({ artist: 'Adele', title: 'Hello', song_key: 'adele|hello' });
    await waitFor(() => expect(screen.getByTestId('song-artist')).toHaveProp('value', 'Adele'));
    expect(screen.getByTestId('song-title')).toHaveProp('value', 'Uprising');
    fireEvent.press(screen.getByTestId('song-make'));
    expect(useMakeIntent.getState().get()).toMatchObject({
      artist: 'Adele',
      title: 'Uprising',
      canonicalArtist: 'Adele',
      canonicalTitle: 'Hello',
      songKey: 'adele|hello',
      source: 'typed',
      editedFields: ['title'],
    });
  });

  it('the draft is untouched by opening a song page', async () => {
    renderRouter(routes(), { initialUrl: KEY_URL });
    await screen.findByText('Starlight');
    expect(useMakeIntent.getState().draft).toEqual(EMPTY_DRAFT);
  });
});

describe('vocal fit (Phase 3c)', () => {
  const baritone = () => useVoiceStore.getState().save(profileFromSelfReport('baritone', '2026-10-22T10:00:00Z'));
  const range = (over: Partial<decide.SongVocalRangeOut> = {}): decide.SongVocalRangeOut => ({
    low: 47, high: 66, p10: 51, p50: 57, p90: 63, tier: 'measured', octave_confidence: null, is_duet: false, ...over,
  });

  it('online: decide\'s range, the fit badge and the tier line', async () => {
    baritone();
    getSongVocalRange.mockResolvedValue({ song_key: 'muse|starlight', range: range() });
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('fit-badge-song')).toHaveTextContent('Fits your voice');
    expect(screen.getByTestId('fit-tier')).toHaveTextContent('Range measured from the recording');
    expect(getSongVocalRange).toHaveBeenCalledWith('muse|starlight');
  });

  it('online with a rough range (decide stores the artist fallback per song): says it is a guess', async () => {
    baritone();
    getSongVocalRange.mockResolvedValue({ song_key: 'muse|starlight', range: range({ tier: 'rough', low: 30, high: 50, p10: 33, p50: 40, p90: 47 }) });
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('fit-tier')).toHaveTextContent('Rough guess from the artist');
    expect(screen.getByTestId('fit-badge-song')).toHaveTextContent(/Fits an octave up|key/);
  });

  it('force-offline: the offline list\'s range (offlineVocalRange) gives the badge and the tier line', async () => {
    baritone();
    mockConnected = false;
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('fit-tier')).toHaveTextContent('Range measured from the recording');
    expect(screen.getByTestId('fit-badge-song')).toBeTruthy();
    expect(getSongVocalRange).not.toHaveBeenCalled();
  });

  it('offline, a song with no range but an artist row: the rough guess', async () => {
    baritone();
    mockConnected = false;
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: `/song/${encodeURIComponent('muse|hysteria')}` });
    expect(await screen.findByTestId('fit-tier')).toHaveTextContent('Rough guess from the artist');
  });

  it('offline, no range data at all: no badge and no tier line', async () => {
    baritone();
    mockConnected = false;
    mockReader = fixtureReader;
    renderRouter(routes(), { initialUrl: `/song/${encodeURIComponent('toto|africa')}` });
    expect(await screen.findByText('Africa')).toBeTruthy();
    expect(screen.queryByTestId('fit-badge-song')).toBeNull();
    expect(screen.queryByTestId('fit-tier')).toBeNull();
  });

  it('decide unreachable: falls back to the offline list\'s range', async () => {
    baritone();
    mockReader = fixtureReader;
    getSongVocalRange.mockRejectedValue({ status: 0 });
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('fit-tier')).toHaveTextContent('Range measured from the recording');
  });

  it('a song outside the range: no badge, no tier line', async () => {
    baritone();
    getSongVocalRange.mockResolvedValue({ song_key: 'muse|starlight', range: range({ low: 70, high: 96, p10: 75, p50: 85, p90: 93 }) });
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByText('Starlight')).toBeTruthy();
    await waitFor(() => expect(getSongVocalRange).toHaveBeenCalled());
    expect(screen.queryByTestId('fit-badge-song')).toBeNull();
    expect(screen.queryByTestId('fit-tier')).toBeNull();
  });

  it('no voice profile on the phone but a range: offers the voice test instead of a badge', async () => {
    getSongVocalRange.mockResolvedValue({ song_key: 'muse|starlight', range: range() });
    renderRouter({ ...routes(), 'discover/voice': () => <View testID="voice-stub" /> }, { initialUrl: KEY_URL });
    fireEvent.press(await screen.findByTestId('fit-song-cta'));
    expect(await screen.findByTestId('voice-stub')).toBeTruthy();
    expect(screen.queryByTestId('fit-badge-song')).toBeNull();
  });
});

describe('library actions and history (Phase 4a)', () => {
  it('signed out: no library actions and no history', async () => {
    renderRouter(routes(), { initialUrl: KEY_URL });
    await screen.findByText('Starlight');
    expect(screen.queryByTestId('song-save')).toBeNull();
    expect(screen.queryByTestId('song-history')).toBeNull();
  });

  it('signed in: Save, Add to setlist and Mark as sung, and your history of the song', async () => {
    (decide.listKaraokeLog as jest.Mock).mockResolvedValue({
      entries: [
        {
          id: 'app_1', user_id: 'u', source: 'app', state: 'sung', artist: 'Muse', title: 'Starlight',
          song_key: 'muse|starlight', song_key_status: 'resolved', origin: 'backfill', times: 3,
          night: { kind: 'other', date_precision: 'unknown' },
        },
      ],
    });
    await useAuth.getState().signInWithSession(session('history@example.com'));
    renderRouter(routes(), { initialUrl: KEY_URL });
    expect(await screen.findByTestId('song-save')).toBeTruthy();
    expect(screen.getByTestId('song-add-setlist')).toBeTruthy();
    expect(screen.getByTestId('song-mark-sung')).toBeTruthy();
    await waitFor(() => expect(decide.listKaraokeLog).toHaveBeenCalled());
    expect(await screen.findByTestId('song-history-app_1')).toHaveTextContent(/Before the app ×3/);
  });
});
