// Make-it rows on the night screen: "Review it now" and "⚡ Sing it now" (spec §4.1 Make-its, A.70, A.75; Task E7).
import * as kjbox from '@nomad/api-kjbox';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { useAuth } from '../../../auth/store';
import { useNightStore } from '../../../tonight/nightStore';
import { nightPoll } from '../../../tonight/nomad/queries';
import { gen, session } from '../../../test-utils/genAuthMock';
import { at, me, nightOpen, nowResult, rotationResult, song } from '../../../test-utils/tonightFixtures';
import { requestRoutes } from '../request/helpers';

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
  useQuick: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const NIGHT = 'aaaaaaaaaaaaaaaa';

const routes = () => ({ ...requestRoutes(), 'review/[id]': () => <View testID="review-stub" /> });

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([]);
  useNightStore.getState().joinNomad('2121', NIGHT, 'Andrew');
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
  api.useQuick.mockResolvedValue({ api_version: '1.0', ok: true } as never);
});

it('review it now opens /review/[jobId]', async () => {
  const s = song({ make: 'review', gen_job_id: 'job-77', request: { source_type: 'make' } });
  api.getMe.mockResolvedValue(me({ songs: [s] }));
  const { getPathname } = renderRouter(routes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId(`tonight-song-review-r${s.request.id}`));
  await waitFor(() => expect(getPathname()).toBe('/review/job-77'));
  expect(await screen.findByTestId('review-stub')).toBeTruthy();
});

it("a friend's make-it (made in my gen account) can be reviewed too", async () => {
  const s = song({ owner: 'friend', make: 'review_host', gen_job_id: 'job-78', request: { source_type: 'make', for_friend: true, singer_name: 'Alex' } });
  api.getMe.mockResolvedValue(me({ songs: [s] }));
  const { getPathname } = renderRouter(routes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId(`tonight-song-review-r${s.request.id}`));
  await waitFor(() => expect(getPathname()).toBe('/review/job-78'));
});

it('no "Review it now" before gen has the job (gen_job_id null)', async () => {
  const s = song({ make: 'review', gen_job_id: null, request: { source_type: 'make' } });
  api.getMe.mockResolvedValue(me({ songs: [s] }));
  renderRouter(routes(), { initialUrl: '/tonight' });
  await screen.findByTestId(`tonight-song-r${s.request.id}`);
  expect(screen.queryByTestId(`tonight-song-review-r${s.request.id}`)).toBeNull();
});

it('sing it now asks first, then uses the quick version', async () => {
  const s = song({ make: 'making', quick: 'ready', estimate: at(3), request: { source_type: 'make' } });
  api.getMe.mockResolvedValue(me({ songs: [s] }));
  renderRouter(routes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId(`tonight-song-quick-sing-r${s.request.id}`));
  expect(await screen.findByTestId('tonight-quick-confirm')).toBeTruthy();
  expect(api.useQuick).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('tonight-quick-confirm-yes'));
  await waitFor(() => expect(api.useQuick).toHaveBeenCalledWith('2121', s.request.id, NIGHT));
  expect(await screen.findByTestId('tonight-notice')).toHaveTextContent(/quick version/);
  await waitFor(() => expect(api.getMe.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('sing it now: "Not now" sends nothing', async () => {
  const s = song({ make: 'making', quick: 'ready', estimate: at(3), request: { source_type: 'make' } });
  api.getMe.mockResolvedValue(me({ songs: [s] }));
  renderRouter(routes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId(`tonight-song-quick-sing-r${s.request.id}`));
  fireEvent.press(await screen.findByTestId('tonight-quick-confirm-no'));
  await waitFor(() => expect(screen.queryByTestId('tonight-quick-confirm') === null).toBe(true));
  expect(api.useQuick).not.toHaveBeenCalled();
});

it('sing it now refused on stage shows the on_stage copy', async () => {
  const s = song({ make: 'making', quick: 'ready', estimate: at(3), request: { source_type: 'make' } });
  api.getMe.mockResolvedValue(me({ songs: [s] }));
  api.useQuick.mockRejectedValue(new KjboxError('on_stage', 409));
  renderRouter(routes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId(`tonight-song-quick-sing-r${s.request.id}`));
  fireEvent.press(await screen.findByTestId('tonight-quick-confirm-yes'));
  expect(await screen.findByTestId('tonight-notice')).toHaveTextContent(/on stage/);
});

it('no sing it now on a song that is not mine (host-added) or already on stage', async () => {
  const host = song({ owner: 'host', quick: 'ready', make: 'making', entry_id: 900, request: { id: null } });
  const onStage = song({ quick: 'ready', make: 'making', estimate: at(1, 0, true) });
  api.getMe.mockResolvedValue(me({ songs: [onStage, host] }));
  renderRouter(routes(), { initialUrl: '/tonight' });
  await screen.findByTestId(`tonight-song-r${onStage.request.id}`);
  expect(screen.queryByTestId(/^tonight-song-quick-sing-/)).toBeNull();
});
