import * as decide from '@nomad/api-decide';
import type { SearchResponse, SongGroup } from '@nomad/api-decide';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { UNKNOWN_ARTIST, useLogStore } from '../../../tonight/log/logStore';
import { outboxIdle, useOutbox } from '../../../tonight/log/outbox';
import { setNightClock, useNightStore } from '../../../tonight/nightStore';
import { AddSong, splitQuery } from '../../../tonight/other/AddSong';
import { renderTonight } from '../../../test-utils/tonightFixtures';
import { otherNight, signedInClean } from './setup';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  putKaraokeLog: jest.fn(),
  deleteKaraokeLog: jest.fn(),
  listKaraokeLog: jest.fn(),
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  resolveQuery: jest.fn(),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
}));
jest.mock('../../../offline/offlineIndex', () => ({ openOfflineReader: () => null }));
let mockOffline = false;
jest.mock('../../../net/useOffline', () => ({ useOffline: () => mockOffline }));
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { back: jest.fn(), push: jest.fn(), canGoBack: () => true } }));

const dapi = decide as jest.Mocked<typeof decide>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router } = require('expo-router') as { router: { back: jest.Mock } };

const starlight: SongGroup = {
  song_key: 'muse|starlight',
  artist: 'Muse',
  title: 'Starlight',
  version_count: 1,
  versions: [{ brand_code: 'C1', brand_name: 'Community', kind: 'community', youtube_url: 'https://youtu.be/abcdefghijk', rank: 0 }],
};
const response = (groups: SongGroup[]): SearchResponse => ({
  identification: { status: groups.length ? 'confident' : 'none', kind: null, best: null, candidates: [] },
  groups,
  index: {} as SearchResponse['index'],
  sid: 's',
});

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockOffline = false;
  signedInClean();
  otherNight();
  dapi.putKaraokeLog.mockResolvedValue({ id: 'x', user_id: 'u', source: 'app' });
  dapi.listKaraokeLog.mockResolvedValue({ entries: [], next_cursor: null });
  dapi.resolveQuery.mockResolvedValue({ status: 'none' } as never);
});
afterEach(async () => {
  await outboxIdle();
});

const entries = () => Object.values(useLogStore.getState().entries);

it('library filter applies to add search (E9-R1: the slot is above the results, the library reaches decide search)', async () => {
  dapi.searchSongs.mockResolvedValue(response([starlight]));
  renderTonight(<AddSong library="karafun" />);
  expect(screen.getByTestId('other-add-library-slot')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
  expect(await screen.findByTestId('other-add-result-0')).toBeTruthy();
  expect(dapi.searchSongs).toHaveBeenCalledWith('starlight', expect.objectContaining({ library: 'karafun' }));
});

it('without a library the search uses the venue filter (Phase 3 default: any)', async () => {
  dapi.searchSongs.mockResolvedValue(response([starlight]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
  expect(await screen.findByTestId('other-add-result-0')).toBeTruthy();
  expect(dapi.searchSongs.mock.calls[0]?.[1]?.library).toBe('any');
});

it('picking a result logs it with its song_key in the chosen state', async () => {
  dapi.searchSongs.mockResolvedValue(response([starlight]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
  fireEvent.press(await screen.findByTestId('other-add-result-0'));
  expect(screen.queryByTestId('other-add-artist')).toBeNull(); // a catalogued song isn't retyped
  fireEvent.press(screen.getByTestId('other-add-as-requested'));
  expect(entries()).toEqual([expect.objectContaining({ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight', state: 'requested' })]);
  expect(router.back).toHaveBeenCalled();
  await waitFor(() => expect(dapi.putKaraokeLog).toHaveBeenCalledWith(expect.stringMatching(/^app_/), expect.objectContaining({ song_key: 'muse|starlight' })));
});

it('log anyway creates unresolved entry (E9-R6): only on no match, fields prefilled and editable, no song_key', async () => {
  dapi.searchSongs.mockResolvedValue(response([]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'Local Band - Our Song');
  fireEvent.press(await screen.findByTestId('other-add-log-anyway'));
  expect(screen.getByTestId('other-add-artist').props.value).toBe('Local Band');
  expect(screen.getByTestId('other-add-title').props.value).toBe('Our Song');
  fireEvent.changeText(screen.getByTestId('other-add-artist'), 'The Local Band');
  fireEvent.press(screen.getByTestId('other-add-as-planned'));
  const [e] = entries();
  expect(e).toEqual(expect.objectContaining({ artist: 'The Local Band', title: 'Our Song', state: 'planned' }));
  expect(e?.song_key).toBeUndefined();
  await waitFor(() => expect(dapi.putKaraokeLog).toHaveBeenCalled());
  expect(dapi.putKaraokeLog.mock.calls[0]?.[1]).not.toHaveProperty('song_key');
});

it('log anyway is always offered once results settle, as the last row after the matches (E9-R7)', async () => {
  dapi.searchSongs.mockResolvedValue(response([starlight]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
  expect(await screen.findByTestId('other-add-log-anyway')).toBeTruthy();
  const order = screen.getAllByTestId(/^other-add-(result-\d+|log-anyway)$/).map((n) => n.props.testID as string);
  expect(order).toEqual(['other-add-result-0', 'other-add-log-anyway']);
});

it('log anyway with no artist: empty field with a translated hint; left empty it saves the untranslated sentinel', async () => {
  dapi.searchSongs.mockResolvedValue(response([]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'our song');
  fireEvent.press(await screen.findByTestId('other-add-log-anyway'));
  expect(screen.getByTestId('other-add-title').props.value).toBe('our song');
  expect(screen.getByTestId('other-add-artist').props.value).toBe('');
  expect(screen.getByTestId('other-add-artist').props.placeholder).toBe('Unknown artist');
  fireEvent.changeText(screen.getByTestId('other-add-artist'), '  ');
  fireEvent.press(screen.getByTestId('other-add-as-planned'));
  expect(entries()).toEqual([expect.objectContaining({ artist: UNKNOWN_ARTIST, title: 'our song' })]);
  expect(UNKNOWN_ARTIST).toBe('Unknown Artist');
  await waitFor(() => expect(dapi.putKaraokeLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ artist: 'Unknown Artist' })));
});

it('a typed artist is kept; the title is still required', async () => {
  dapi.searchSongs.mockResolvedValue(response([]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'our song');
  fireEvent.press(await screen.findByTestId('other-add-log-anyway'));
  fireEvent.changeText(screen.getByTestId('other-add-title'), ' ');
  fireEvent.press(screen.getByTestId('other-add-as-planned'));
  expect(entries()).toEqual([]);
  fireEvent.changeText(screen.getByTestId('other-add-title'), 'Our Song');
  fireEvent.changeText(screen.getByTestId('other-add-artist'), 'Local Band');
  fireEvent.press(screen.getByTestId('other-add-as-planned'));
  expect(entries()).toEqual([expect.objectContaining({ artist: 'Local Band', title: 'Our Song' })]);
});

describe('search states, as Discover shows them', () => {
  it('a cold search says it is warming up', async () => {
    dapi.searchSongs.mockReturnValue(new Promise(() => {}));
    renderTonight(<AddSong />);
    fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
    expect(await screen.findByTestId('other-add-warming', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('a refused search shows the error with retry, and still offers log anyway', async () => {
    dapi.searchSongs.mockRejectedValue(Object.assign(new Error('bad'), { status: 400 }));
    renderTonight(<AddSong />);
    fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
    expect(await screen.findByText("Couldn't search for that. Try different words.")).toBeTruthy();
    expect(screen.getByTestId('other-add-log-anyway')).toBeTruthy();
    dapi.searchSongs.mockResolvedValue(response([starlight]));
    fireEvent.press(screen.getByTestId('other-add-retry'));
    expect(await screen.findByTestId('other-add-result-0')).toBeTruthy();
  });

  it('the auto-correct answer fills the results and the log-anyway split', async () => {
    dapi.searchSongs.mockResolvedValue(response([]));
    dapi.resolveQuery.mockResolvedValue({ groups: [starlight], split: { artist: 'Muse', title: 'Starlite' }, kind: 'content', typed: 'starlite muse' } as never);
    renderTonight(<AddSong />);
    fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlite muse');
    expect(await screen.findByTestId('other-add-figuring-out')).toBeTruthy();
    expect(await screen.findByTestId('other-add-result-0', {}, { timeout: 3000 })).toBeTruthy();
    fireEvent.press(screen.getByTestId('other-add-log-anyway'));
    expect(screen.getByTestId('other-add-artist').props.value).toBe('Muse');
    expect(screen.getByTestId('other-add-title').props.value).toBe('Starlite');
  });
});

it('offline with no offline list: log anyway, kept in the outbox, sent after reconnect', async () => {
  mockOffline = true;
  dapi.putKaraokeLog.mockRejectedValue(new TypeError('Network request failed'));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'Local Band - Our Song');
  fireEvent.press(await screen.findByTestId('other-add-log-anyway'));
  expect(dapi.searchSongs).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('other-add-as-requested'));
  const [e] = entries();
  expect(e).toEqual(expect.objectContaining({ artist: 'Local Band', title: 'Our Song', state: 'requested' }));
  await outboxIdle();
  expect(useOutbox.getState().items.map((i) => i.id)).toEqual([e!.id]);
  // Reconnect: LogSync flushes (logSync.test covers the trigger); the queued put now goes through.
  dapi.putKaraokeLog.mockResolvedValue({ id: e!.id, user_id: 'u', source: 'app' });
  await useOutbox.getState().flush();
  await outboxIdle();
  expect(dapi.putKaraokeLog).toHaveBeenLastCalledWith(e!.id, expect.objectContaining({ artist: 'Local Band', title: 'Our Song', state: 'requested' }));
  expect(useOutbox.getState().items).toEqual([]);
});

it('"I sang it" from add opens the survey, then leaves', async () => {
  renderTonight(<AddSong prefill={{ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' }} />);
  fireEvent.press(screen.getByTestId('other-add-as-sung'));
  expect(entries()).toEqual([expect.objectContaining({ state: 'sung', song_key: 'muse|starlight' })]);
  expect(await screen.findByTestId('survey')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('survey-skip'));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

it('AddSong\'s survey onDone touches the night', async () => {
  let now = Date.UTC(2026, 9, 21, 20, 0, 0);
  setNightClock(() => now);
  useNightStore.getState().startOther('The Crown');
  renderTonight(<AddSong prefill={{ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' }} />);
  fireEvent.press(screen.getByTestId('other-add-as-sung'));
  now += 3 * 60 * 60 * 1000;
  fireEvent.press(await screen.findByTestId('survey-feel-great'));
  fireEvent.press(screen.getByTestId('survey-save'));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect((useNightStore.getState().active as { lastActivityAt: number }).lastActivityAt).toBe(now);
  setNightClock();
});

it('splitQuery reads "Artist - Title" and "Title by Artist"', () => {
  expect(splitQuery('Queen - Bohemian Rhapsody')).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' });
  expect(splitQuery('Bohemian Rhapsody by Queen')).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' });
  expect(splitQuery('bohemian rhapsody')).toEqual({ artist: '', title: 'bohemian rhapsody' });
});
