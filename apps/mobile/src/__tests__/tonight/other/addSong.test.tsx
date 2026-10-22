import * as decide from '@nomad/api-decide';
import type { SearchResponse, SongGroup } from '@nomad/api-decide';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLogStore } from '../../../tonight/log/logStore';
import { outboxIdle } from '../../../tonight/log/outbox';
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

it('without a library the search call carries none (decide search unchanged)', async () => {
  dapi.searchSongs.mockResolvedValue(response([starlight]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
  expect(await screen.findByTestId('other-add-result-0')).toBeTruthy();
  expect(dapi.searchSongs.mock.calls[0]?.[1]?.library).toBeUndefined();
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

it('log anyway is not offered while there are matches', async () => {
  dapi.searchSongs.mockResolvedValue(response([starlight]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'starlight');
  expect(await screen.findByTestId('other-add-result-0')).toBeTruthy();
  expect(screen.queryByTestId('other-add-log-anyway')).toBeNull();
});

it('log anyway needs an artist and a title', async () => {
  dapi.searchSongs.mockResolvedValue(response([]));
  renderTonight(<AddSong />);
  fireEvent.changeText(screen.getByTestId('other-add-query'), 'our song');
  fireEvent.press(await screen.findByTestId('other-add-log-anyway'));
  expect(screen.getByTestId('other-add-title').props.value).toBe('our song');
  fireEvent.press(screen.getByTestId('other-add-as-planned'));
  expect(entries()).toEqual([]);
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

it('splitQuery reads "Artist - Title" and "Title by Artist"', () => {
  expect(splitQuery('Queen - Bohemian Rhapsody')).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' });
  expect(splitQuery('Bohemian Rhapsody by Queen')).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' });
  expect(splitQuery('bohemian rhapsody')).toEqual({ artist: '', title: 'bohemian rhapsody' });
});
