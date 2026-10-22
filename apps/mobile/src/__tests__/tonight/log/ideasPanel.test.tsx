import * as decide from '@nomad/api-decide';
import * as kjbox from '@nomad/api-kjbox';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../../auth/store';
import { IdeasPanel, mostSung } from '../../../tonight/log/IdeasPanel';
import { UNKNOWN_ARTIST } from '../../../tonight/log/logStore';
import { useNightStore } from '../../../tonight/nightStore';
import { nightPoll } from '../../../tonight/nomad/queries';
import { useRequestStore } from '../../../tonight/request/requestStore';
import { gen, session } from '../../../test-utils/genAuthMock';
import { me, nightOpen, nowResult, renderTonight, rotationResult } from '../../../test-utils/tonightFixtures';
import { noIdent, requestRoutes, results } from '../request/helpers';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSong: jest.fn(),
  configureClient: jest.fn(),
  listKaraokeLog: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn(), listMyJobs: jest.fn() }));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
  searchSongs: jest.fn(),
  identify: jest.fn(),
  resolve: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
  getMyStats: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const dapi = decide as jest.Mocked<typeof decide>;
const NIGHT = 'aaaaaaaaaaaaaaaa';
type Entry = decide.KaraokeLogEntry;
const logged = (artist: string, title: string, over: Partial<Entry> = {}): Entry => ({
  id: `app_${Math.random()}`,
  user_id: 'u',
  source: 'app',
  state: 'sung',
  artist,
  title,
  sung_at: '2026-10-01T21:00:00Z',
  ...over,
});

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  useRequestStore.getState().clear();
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([]);
  useNightStore.getState().joinNomad('2121', NIGHT, 'Andrew');
  api.getMe.mockResolvedValue(me());
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
  api.identify.mockResolvedValue(noIdent);
  api.resolve.mockResolvedValue({ api_version: '1.0' });
  api.searchSongs.mockResolvedValue(results([]));
});

it('ideas panel fills search', async () => {
  dapi.listKaraokeLog.mockResolvedValue({
    entries: [
      logged('Muse', 'Starlight'),
      logged('muse ', 'starlight', { sung_at: '2026-10-10T21:00:00Z' }),
      logged('Adele', 'Hello'),
      logged('Adele', 'Hello', { state: 'planned' }),
    ],
  });
  api.getMyStats.mockResolvedValue({ api_version: '1.0', top_songs: [{ artist: 'Queen', title: 'Bohemian Rhapsody', plays: 3 }] });
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  expect(await screen.findByTestId('tonight-ideas')).toBeTruthy();
  expect(await screen.findByTestId('tonight-ideas-crowd-0')).toBeTruthy();
  expect(screen.getByText('Sung here before? Need ideas?')).toBeTruthy();
  expect(screen.getByTestId('tonight-ideas-mine-0')).toHaveTextContent(/Starlight.*Sung 2 times/);
  expect(screen.getByTestId('tonight-ideas-mine-1')).toHaveTextContent(/Hello.*Sung 1 time/);
  expect(api.getMyStats).toHaveBeenCalledWith('2121', NIGHT);

  fireEvent.press(screen.getByTestId('tonight-ideas-mine-0'));
  expect(screen.getByTestId('tonight-search-input').props.value).toBe('Muse Starlight');
  await waitFor(() => expect(api.searchSongs).toHaveBeenCalledWith('2121', 'Muse Starlight', expect.any(String), NIGHT));
  // The panel steps aside once there is a query.
  expect(screen.queryByTestId('tonight-ideas')).toBeNull();

  fireEvent.changeText(screen.getByTestId('tonight-search-input'), '');
  fireEvent.press(await screen.findByTestId('tonight-ideas-crowd-0'));
  expect(screen.getByTestId('tonight-search-input').props.value).toBe('Queen Bohemian Rhapsody');
});

it('hides itself when both lists are empty (or unavailable)', async () => {
  dapi.listKaraokeLog.mockRejectedValue(new Error('401'));
  api.getMyStats.mockResolvedValue({ api_version: '1.0', top_songs: [] });
  renderRouter(requestRoutes(), { initialUrl: '/tonight/search' });
  await screen.findByTestId('tonight-search-input');
  await waitFor(() => expect(api.getMyStats).toHaveBeenCalled());
  await waitFor(() => expect(dapi.listKaraokeLog).toHaveBeenCalled());
  expect(screen.queryByTestId('tonight-ideas')).toBeNull();
});

it('mostSung counts sung records by artist + title across bars, top 5, ignoring deleted and unsung', () => {
  const entries = [
    ...['A', 'B', 'C', 'D', 'E', 'F'].flatMap((t, i) => Array.from({ length: 6 - i }, () => logged('X', t))),
    logged('X', 'Z', { deleted: true }),
    logged('X', 'Z', { deleted: true }),
    logged('X', 'Z', { deleted: true }),
    logged('X', 'Y', { state: 'skipped' }),
    logged('X', 'G', { state: 'sung_unplayed' }),
  ];
  expect(mostSung(entries).map((s) => [s.title, s.count])).toEqual([
    ['A', 6],
    ['B', 5],
    ['C', 4],
    ['D', 3],
    ['E', 2],
  ]);
  // Ties: the most recently sung first.
  expect(mostSung([logged('X', 'Old', { sung_at: '2026-01-01' }), logged('X', 'New', { sung_at: '2026-09-01' })]).map((s) => s.title)).toEqual([
    'New',
    'Old',
  ]);
});

it('the unknown-artist sentinel never renders raw and never goes into the query (title only)', async () => {
  dapi.listKaraokeLog.mockResolvedValue({ entries: [logged(UNKNOWN_ARTIST, 'Our Song'), logged(UNKNOWN_ARTIST, 'Our Song')] });
  api.getMyStats.mockResolvedValue({ api_version: '1.0', top_songs: [{ artist: UNKNOWN_ARTIST, title: 'Crowd Song', plays: 2 }] });
  const onPick = jest.fn();
  renderTonight(<IdeasPanel onPick={onPick} />);
  const mine = await screen.findByTestId('tonight-ideas-mine-0');
  const crowd = await screen.findByTestId('tonight-ideas-crowd-0');
  expect(mine).toHaveTextContent(/Our Song.*Unknown artist/);
  expect(crowd).toHaveTextContent(/Crowd Song.*Unknown artist/);
  expect(screen.queryByText(/Unknown Artist/)).toBeNull();
  fireEvent.press(mine);
  expect(onPick).toHaveBeenLastCalledWith('Our Song');
  fireEvent.press(crowd);
  expect(onPick).toHaveBeenLastCalledWith('Crowd Song');
});
