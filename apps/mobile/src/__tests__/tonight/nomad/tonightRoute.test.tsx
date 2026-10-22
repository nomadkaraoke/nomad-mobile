import * as kjbox from '@nomad/api-kjbox';
import { screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../../auth/store';
import { useNightStore } from '../../../tonight/nightStore';
import { nightPoll } from '../../../tonight/nomad/queries';
import { gen, session } from '../../../test-utils/genAuthMock';
import { makeRoutes } from '../../../test-utils/makeFixtures';
import { at, entry, me, nightOpen, nowResult, rotationResult, song } from '../../../test-utils/tonightFixtures';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn(), listMyJobs: jest.fn() }));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const YESTERDAY = 'aaaaaaaaaaaaaaaa';
const TONIGHT = 'bbbbbbbbbbbbbbbb';
const DEFAULT_POLL = { ...nightPoll };

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([]);
  useNightStore.getState().joinNomad('2121', YESTERDAY, 'Andrew');
  api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 1, song_title: 'Yesterday Song' }, estimate: at(3) })] }));
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([entry(1)]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: YESTERDAY }));
});

afterAll(() => Object.assign(nightPoll, DEFAULT_POLL));

it('shows the night home while a Nomad night is active', async () => {
  renderRouter(makeRoutes(), { initialUrl: '/tonight' });
  expect(await screen.findByTestId('tonight-song-r1')).toBeTruthy();
  expect(screen.queryByTestId('tonight-screen')).toBeNull();
});

describe('night screen leaves when night_id changes (Review Focus 2, A.89)', () => {
  it('a 409 night_changed from /me ends the night: the empty state, never yesterday\'s songs', async () => {
    api.getMe.mockRejectedValue(
      new KjboxError('night_changed', 409, undefined, { error: 'night_changed', night_id: TONIGHT }),
    );
    renderRouter(makeRoutes(), { initialUrl: '/tonight' });
    expect(await screen.findByTestId('tonight-screen')).toBeTruthy();
    expect(useNightStore.getState().active).toBeNull();
    expect(screen.queryByTestId('tonight-song-r1')).toBeNull();
  });

  it('GET /night returning another night id leaves after yesterday\'s songs were shown', async () => {
    let release!: () => void;
    api.getNight.mockReturnValue(new Promise((r) => (release = () => r(nightOpen({ night_id: TONIGHT })))));
    renderRouter(makeRoutes(), { initialUrl: '/tonight' });
    expect(await screen.findByTestId('tonight-song-r1')).toBeTruthy();
    release();
    expect(await screen.findByTestId('tonight-screen')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('tonight-song-r1')).toBeNull());
    expect(useNightStore.getState().active).toBeNull();
  });
});
