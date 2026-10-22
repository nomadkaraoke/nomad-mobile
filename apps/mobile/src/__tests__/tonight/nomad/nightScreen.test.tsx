import * as kjbox from '@nomad/api-kjbox';
import { CancelledError } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { useAuth } from '../../../auth/store';
import { appStorage } from '../../../storage';
import { useNightStore, type NomadNight } from '../../../tonight/nightStore';
import { useEditingStore } from '../../../tonight/nomad/editingStore';
import { NightScreen } from '../../../tonight/nomad/NightScreen';
import { isUnreachable, nextPollDelay, nightPoll } from '../../../tonight/nomad/queries';
import { at, by, entry, me, nightOpen, nowResult, renderTonight, rotationResult, song } from '../../../test-utils/tonightFixtures';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const NIGHT_ID = 'aaaaaaaaaaaaaaaa';
const DEFAULT_POLL = { ...nightPoll, backoffMs: [...nightPoll.backoffMs] };
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const unreachable = () => new KjboxError('internal', 0, undefined, {}, true);

let night: NomadNight;

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  appStorage.clearAll();
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000, backoffMs: [60_000] });
  useEditingStore.setState({ editing: false });
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'sam@example.com', createdAt: 0 } } });
  useNightStore.getState().rehydrate('sam@example.com');
  useNightStore.getState().joinNomad('2121', NIGHT_ID, 'Andrew');
  night = useNightStore.getState().current() as NomadNight;
  api.getMe.mockResolvedValue(me({ songs: [song({ request: { song_title: 'Starlight' }, estimate: at(4, 900) })] }));
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"7"', data: rotationResult([entry(1), entry(2)]) });
  api.getNight.mockResolvedValue(nightOpen());
});

afterAll(() => Object.assign(nightPoll, DEFAULT_POLL));

const show = (focused = true) => renderTonight(<NightScreen night={night} focused={focused} />);

it('paints status, your songs, now on stage, the rotation and venue info', async () => {
  api.getNight.mockResolvedValue(
    nightOpen({ notices: ['chargers', 'c-1'], notice_defs: { 'c-1': { icon: '🍕', text: 'Pizza at 10' } }, footer_message: 'Be kind', contact: { phone: '+15551234567' }, social: { instagram: 'https://instagram.com/nomad' } }),
  );
  show();
  expect(await screen.findByTestId('tonight-status-tile')).toBeTruthy();
  expect(screen.getAllByText(by('Starlight')).length).toBeGreaterThan(0);
  expect(await screen.findByTestId('tonight-stage-tile')).toBeTruthy();
  expect(await screen.findByTestId('tonight-rotation-502')).toBeTruthy();
  expect(await screen.findByTestId('tonight-venue')).toBeTruthy();
  expect(screen.getByTestId('tonight-notice-c-1')).toHaveTextContent('🍕 Pizza at 10');
  expect(screen.getByTestId('tonight-host-message')).toHaveTextContent('Be kind');
  fireEvent.press(screen.getByTestId('tonight-contact-text'));
  expect(Linking.openURL).toHaveBeenCalledWith('sms:+15551234567');
  expect(api.getMe).toHaveBeenCalledWith('2121', NIGHT_ID);
});

it('unreachable shows web fallback and keeps last songs', async () => {
  nightPoll.meMs = 30;
  api.getMe.mockResolvedValueOnce(me({ songs: [song({ previewable: true, request: { id: 7, song_title: 'Starlight' }, estimate: at(4) })] }));
  api.getMe.mockRejectedValue(unreachable());
  show();
  expect(await screen.findByTestId('tonight-unreachable')).toBeTruthy();
  // The last-known songs stay, read-only.
  expect(screen.getByTestId('tonight-song-r7')).toBeTruthy();
  expect(screen.queryByTestId('tonight-song-cancel-r7')).toBeNull();
  expect(screen.queryByTestId('tonight-song-preview-r7')).toBeNull();
  fireEvent.press(screen.getByTestId('tonight-open-web'));
  expect(Linking.openURL).toHaveBeenCalledWith('http://l.kjbox.cc/');
});

it('a 503 gen_unavailable also counts as unreachable; a cancellation never does', () => {
  expect(isUnreachable(new KjboxError('gen_unavailable', 503, 5, { error: 'gen_unavailable' }))).toBe(true);
  expect(isUnreachable(unreachable())).toBe(true);
  expect(isUnreachable(new KjboxError('internal', 500, undefined, { error: 'internal' }))).toBe(false);
  expect(isUnreachable(new CancelledError())).toBe(false);
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  expect(isUnreachable(abort)).toBe(false);
});

it('unreachable retries back off 15 s, 30 s, then 60 s (capped)', () => {
  Object.assign(nightPoll, DEFAULT_POLL);
  const e = unreachable();
  expect(nextPollDelay(15_000, 1, e)).toBe(15_000);
  expect(nextPollDelay(15_000, 2, e)).toBe(30_000);
  expect(nextPollDelay(15_000, 3, e)).toBe(60_000);
  expect(nextPollDelay(15_000, 9, e)).toBe(60_000);
  expect(nextPollDelay(15_000, 0, null)).toBe(15_000);
  expect(nextPollDelay(15_000, 1, new KjboxError('rate_limited', 429, 40))).toBe(40_000);
  expect(nextPollDelay(15_000, 1, new KjboxError('not_open', 403))).toBe(false);
});

it('backs off while unreachable: fewer polls than the normal interval', async () => {
  Object.assign(nightPoll, { meMs: 20, backoffMs: [20, 80, 400] });
  api.getMe.mockRejectedValue(unreachable());
  show();
  await screen.findByTestId('tonight-unreachable');
  await sleep(300);
  // 20 ms polling would be ~15 calls; backoff gives 1 + 20 + 80 (+ 400 pending) ≈ 3–4.
  expect(api.getMe.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(api.getMe.mock.calls.length).toBeLessThanOrEqual(5);
});

it('rotation keeps data on 304', async () => {
  nightPoll.rotationMs = 30;
  api.getRotation.mockResolvedValueOnce({ etag: '"7"', data: rotationResult([entry(1), entry(2)]) });
  api.getRotation.mockResolvedValue({ notModified: true });
  show();
  expect(await screen.findByTestId('tonight-rotation-502')).toBeTruthy();
  await waitFor(() => expect(api.getRotation.mock.calls.length).toBeGreaterThanOrEqual(3));
  // Each refetch sends the ETag back, and the rows stay.
  expect(api.getRotation).toHaveBeenLastCalledWith('2121', '"7"', NIGHT_ID);
  expect(screen.getByTestId('tonight-rotation-501')).toBeTruthy();
  expect(screen.getByTestId('tonight-rotation-502')).toBeTruthy();
  expect(screen.queryByTestId('tonight-rotation-empty')).toBeNull();
});

it('unlinked identity hint shown only when count > 0', async () => {
  const { unmount } = show();
  await screen.findByTestId('tonight-status-tile');
  expect(screen.queryByTestId('tonight-unlinked-hint')).toBeNull();
  unmount();

  api.getMe.mockResolvedValue(me({ songs: [song()], unlinked_identity_entries: 2 }));
  show();
  expect(await screen.findByTestId('tonight-unlinked-hint')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-unlinked-open'));
  expect(Linking.openURL).toHaveBeenCalledWith('https://sing.nomadkaraoke.com/?t=2121');
});

describe('ruling E4-R1: a stale code or a new night ends the night and stops polling', () => {
  it.each([
    ['403 not_open', () => new KjboxError('not_open', 403, undefined, { error: 'not_open' })],
    ['409 night_changed', () => new KjboxError('night_changed', 409, undefined, { error: 'night_changed', night_id: 'bbbbbbbbbbbbbbbb' })],
  ])('%s from /me', async (_, err) => {
    nightPoll.meMs = 20;
    api.getMe.mockRejectedValue(err());
    show();
    await waitFor(() => expect(useNightStore.getState().active).toBeNull());
    const calls = api.getMe.mock.calls.length;
    await sleep(150);
    expect(api.getMe).toHaveBeenCalledTimes(calls);
  });

  it('GET /night says the code is no longer valid', async () => {
    api.getNight.mockResolvedValue({ api_version: '1.0', open: false, error: 'not_open', reason: 'bad_code' });
    show();
    await waitFor(() => expect(useNightStore.getState().active).toBeNull());
  });

  it('GET /night reports another night id', async () => {
    api.getNight.mockResolvedValue(nightOpen({ night_id: 'cccccccccccccccc' }));
    show();
    await waitFor(() => expect(useNightStore.getState().active).toBeNull());
  });

  it('requests closed by the host keeps the night and shows the host message', async () => {
    api.getNight.mockResolvedValue({ api_version: '1.0', open: false, error: 'not_open', reason: 'closed', footer_message: 'Back at 9' });
    show();
    expect(await screen.findByTestId('tonight-closed')).toHaveTextContent(/Back at 9/);
    expect(useNightStore.getState().active).not.toBeNull();
  });
});

describe('ruling E4-R3: polls only while focused, foregrounded and not editing', () => {
  it('pauses while editing and refreshes at once when editing ends', async () => {
    nightPoll.meMs = 25;
    show();
    await waitFor(() => expect(api.getMe.mock.calls.length).toBeGreaterThanOrEqual(2));
    act(() => useEditingStore.getState().setEditing(true));
    await sleep(30);
    const calls = api.getMe.mock.calls.length;
    await sleep(150);
    expect(api.getMe).toHaveBeenCalledTimes(calls);
    act(() => useEditingStore.getState().setEditing(false));
    await waitFor(() => expect(api.getMe.mock.calls.length).toBeGreaterThan(calls));
  });

  it('does not poll while the tab is not focused', async () => {
    nightPoll.meMs = 25;
    show(false);
    await waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(1));
    await sleep(150);
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });
});

it('dismissing a host-removed song hides it for the rest of the night', async () => {
  api.getMe.mockResolvedValue(me({ songs: [song({ removed: true, request: { id: 9 } }), song({ request: { id: 10 } })] }));
  const { unmount } = show();
  fireEvent.press(await screen.findByTestId('tonight-song-dismiss-r9'));
  expect(screen.queryByTestId('tonight-song-r9')).toBeNull();
  expect(screen.getByTestId('tonight-song-r10')).toBeTruthy();
  unmount();
  show();
  await screen.findByTestId('tonight-song-r10');
  expect(screen.queryByTestId('tonight-song-r9')).toBeNull();
});
