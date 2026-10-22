import * as kjbox from '@nomad/api-kjbox';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../../auth/store';
import { useNightStore } from '../../../tonight/nightStore';
import { nightPoll } from '../../../tonight/nomad/queries';
import { ConfirmCard } from '../../../tonight/request/ConfirmCard';
import { useRequestStore } from '../../../tonight/request/requestStore';
import { gen, session } from '../../../test-utils/genAuthMock';
import { me, nightOpen, nowResult, renderTonight, rotationResult } from '../../../test-utils/tonightFixtures';
import { group, kn, local, requestRoutes } from './helpers';

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
  searchSongs: jest.fn(),
  identify: jest.fn(),
  resolve: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
  submitRequest: jest.fn(),
  changeRequest: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const NIGHT = 'aaaaaaaaaaaaaaaa';
const ok = (): kjbox.RequestResult => ({
  api_version: '1.0',
  auto_approved: true,
  request: {
    id: 9,
    singer_name: 'Sam',
    song_artist: 'Muse',
    song_title: 'Starlight',
    source_type: 'kj_pick',
    status: 'approved',
    created_at: null,
    linked_entry_id: 3,
    additional_singers: null,
    supersedes_request_id: null,
    media_consent: null,
    for_friend: false,
  },
});

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  useRequestStore.getState().clear();
  useRequestStore.setState({ ambiguous: null });
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([]);
  useNightStore.getState().joinNomad('2121', NIGHT, 'Andrew');
  api.getMe.mockResolvedValue(me());
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
});

describe('confirm shows searched breadcrumb except for make (A.19, E5-R3)', () => {
  const card = (source: Parameters<typeof ConfirmCard>[0]['source']) =>
    renderTonight(
      <ConfirmCard title="Starlight" artist="Muse" source={source} searched="starl" sending={false} onSend={jest.fn()} onBack={jest.fn()} />,
    );

  it('shows "You searched" for a catalogue song, with the hardened buttons', () => {
    card('auto');
    expect(screen.getByTestId('tonight-confirm-searched').props.children).toBe('You searched: “⁨starl⁩”');
    expect(screen.getByText('Yes, send')).toBeTruthy();
    expect(screen.getByText('Pick a different song')).toBeTruthy();
    expect(screen.getByTestId('tonight-confirm-title').props.children).toBe('Starlight');
  });

  it('hides it for a make-it', () => {
    card('make');
    expect(screen.queryByTestId('tonight-confirm-searched')).toBeNull();
    expect(screen.getByTestId('tonight-confirm-source')).toBeTruthy();
  });

  it('source line follows the version', () => {
    card(local());
    expect(screen.getByTestId('tonight-confirm-source').props.children).toBe("On the host's machine. Definitely available.");
  });
});

it('retry reuses client_request_id (Review Focus 3)', async () => {
  useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1), kn(2)]), 'auto', 'starl');
  const id = useRequestStore.getState().pending!.clientRequestId;
  api.submitRequest.mockRejectedValueOnce(new KjboxError('internal', 0, undefined, {}, true)).mockResolvedValueOnce(ok());
  const { getPathname } = renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
  expect(await screen.findByTestId('tonight-confirm-error')).toBeTruthy();
  expect(screen.getByText("Can't reach tonight's night. Check your connection and try again.")).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-confirm-send'));
  await waitFor(() => expect(api.submitRequest).toHaveBeenCalledTimes(2));
  const [first, second] = api.submitRequest.mock.calls;
  expect(first![1].client_request_id).toBe(id);
  expect(second![1].client_request_id).toBe(id);
  expect(second![1]).toMatchObject({ source_type: 'kj_pick', night_id: NIGHT, song_title: 'Starlight' });
  await waitFor(() => expect(getPathname()).toBe('/tonight'));
});

it('a sent request invalidates the night queries and goes back to the night (E5-R6)', async () => {
  useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1)]), kn(1), 'starl');
  api.submitRequest.mockResolvedValue(ok());
  const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
  const { getPathname } = renderRouter(requestRoutes(), { initialUrl: '/tonight' });
  expect(await screen.findByTestId('tonight-night')).toBeTruthy();
  await waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(1));
  const { router } = jest.requireActual<typeof import('expo-router')>('expo-router');
  router.push('/tonight/confirm');
  fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
  await waitFor(() => expect(getPathname()).toBe('/tonight'));
  expect(api.submitRequest).toHaveBeenCalledWith('2121', expect.objectContaining({ source_type: 'kn', source_ref: 'https://youtu.be/1' }));
  // Invalidated (refetched), never patched with the partial response (A.85).
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['kjbox', useNightStore.getState().userKey, NIGHT] });
  await waitFor(() => expect(api.getMe.mock.calls.length).toBeGreaterThanOrEqual(2));
  invalidate.mockRestore();
  await waitFor(() => expect(useRequestStore.getState().pending).toBeNull(), { timeout: 2000 });
});

it('a change keeps the slot: POST /requests/{id}/change with the replaced id, "Replacing" shown (A.39)', async () => {
  useRequestStore.getState().startChange({ id: 41, title: 'Old Song' });
  useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1), kn(2)]), 'auto', 'starl');
  api.changeRequest.mockResolvedValue(ok());
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  expect(await screen.findByTestId('tonight-confirm-replacing')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-confirm-send'));
  await waitFor(() => expect(api.changeRequest).toHaveBeenCalledWith('2121', 41, expect.objectContaining({ source_type: 'kj_pick' })));
  expect(api.submitRequest).not.toHaveBeenCalled();
});

it('busy_retry is ambiguous: re-picking the same song keeps the client_request_id', async () => {
  const p = useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1), kn(2)]), 'auto', 'starl');
  api.submitRequest.mockRejectedValue(new KjboxError('busy_retry', 409, 2));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
  expect(await screen.findByTestId('tonight-confirm-error')).toBeTruthy();
  expect(useRequestStore.getState().ambiguous?.clientRequestId).toBe(p.clientRequestId);
  const again = useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1), kn(2)]), 'auto', 'starl');
  expect(again.clientRequestId).toBe(p.clientRequestId);
});

it('a night that ended while confirm was open says so, not "Pick a song first"', async () => {
  useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1), kn(2)]), 'auto', 'starl');
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  expect(await screen.findByTestId('tonight-confirm')).toBeTruthy();
  act(() => useNightStore.getState().end());
  expect(await screen.findByTestId('tonight-confirm-night-ended')).toBeTruthy();
  expect(screen.queryByTestId('tonight-confirm-missing')).toBeNull();
});

it('rate_limited shows the wait from retry_after (E5-R5)', async () => {
  useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1), kn(2)]), 'auto', 'starl');
  api.submitRequest.mockRejectedValue(new KjboxError('rate_limited', 429, 120));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
  expect(await screen.findByText("You've sent a lot of requests. Try again in 2 minutes.")).toBeTruthy();
});

it('a song for a friend sends for_friend + friend_name', async () => {
  useRequestStore.getState().startFriend('Alex');
  useRequestStore.getState().pick(group('Starlight', 'Muse', [kn(1), kn(2)]), 'auto', 'starl');
  api.submitRequest.mockResolvedValue(ok());
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  expect(await screen.findByTestId('tonight-confirm-friend')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-confirm-send'));
  await waitFor(() =>
    expect(api.submitRequest).toHaveBeenCalledWith('2121', expect.objectContaining({ for_friend: true, friend_name: 'Alex' })),
  );
});
