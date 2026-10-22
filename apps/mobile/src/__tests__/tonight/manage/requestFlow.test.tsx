import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import * as tipsRoute from '../../../app/tonight/tips';
import { useAuth } from '../../../auth/store';
import { appStorage } from '../../../storage';
import { sortedSingers } from '../../../tonight/manage/DuetPicker';
import { consentFields, loadNightConsent, sanitizeInstagram, saveNightConsent } from '../../../tonight/manage/NightConsent';
import { usePhoneStore } from '../../../tonight/manage/PhoneSheet';
import { useNightStore } from '../../../tonight/nightStore';
import { nightPoll } from '../../../tonight/nomad/queries';
import { requestSignature, useRequestStore } from '../../../tonight/request/requestStore';
import { gen, session } from '../../../test-utils/genAuthMock';
import { at, me, nightOpen, nowResult, rotationResult, song } from '../../../test-utils/tonightFixtures';
import { group, kn, requestRoutes, results } from '../request/helpers';
import { requestResult, restoreTiming } from './setup';

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
  getMyStats: jest.fn(),
  searchSongs: jest.fn(),
  identify: jest.fn(),
  resolve: jest.fn(),
  logSearchEvent: jest.fn(async () => {}),
  submitRequest: jest.fn(),
  changeRequest: jest.fn(),
  getSingers: jest.fn(),
  getTips: jest.fn(),
  setSongConsent: jest.fn(),
  updateMe: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const NIGHT = 'aaaaaaaaaaaaaaaa';
const starlight = () => group('Starlight', 'Muse', [kn(1), kn(2)]);

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  useRequestStore.getState().clear();
  useRequestStore.setState({ ambiguous: null });
  usePhoneStore.setState({ phones: {} });
  appStorage.clearAll();
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([]);
  useNightStore.getState().joinNomad('2121', NIGHT, 'Andrew');
  api.getMe.mockResolvedValue(me());
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
  api.getMyStats.mockResolvedValue({ api_version: '1.0', top_songs: [] });
  api.searchSongs.mockResolvedValue(results([starlight()]));
  api.identify.mockResolvedValue({ api_version: '1.0', status: 'none' });
  api.submitRequest.mockResolvedValue(requestResult());
  api.changeRequest.mockResolvedValue(requestResult());
});
afterAll(restoreTiming);

it('change sends client_request_id and a retry reuses it (contract: change is idempotent, ruling E5-R9)', async () => {
  useRequestStore.getState().startChange({ id: 41, title: 'Old Song' });
  const p = useRequestStore.getState().pick(starlight(), 'auto', 'starl');
  api.changeRequest.mockRejectedValueOnce(new KjboxError('internal', 0, undefined, {}, true));
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
  expect(await screen.findByTestId('tonight-confirm-error')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-confirm-send'));
  await waitFor(() => expect(api.changeRequest).toHaveBeenCalledTimes(2));
  const ids = api.changeRequest.mock.calls.map((c) => c[2].client_request_id);
  expect(ids).toEqual([p.clientRequestId, p.clientRequestId]);
  // Change carries no duet partners (the song keeps its own).
  expect(screen.queryByTestId('tonight-confirm-duet')).toBeNull();
});

describe('song for a friend (A.10–A.14)', () => {
  it('search shows "Picking a song for X"; "Cancel: it\'s for me" goes back to a request for yourself', async () => {
    renderRouter(requestRoutes(), { initialUrl: '/tonight/search?friend=Bob' });
    expect(await screen.findByTestId('tonight-friend-banner')).toHaveTextContent(/Picking a song for ⁨Bob⁩/);
    expect(useRequestStore.getState().mode).toBe('friend');
    fireEvent.press(screen.getByTestId('tonight-friend-cancel'));
    await waitFor(() => expect(screen.queryByTestId('tonight-friend-banner') === null).toBe(true));
    expect(useRequestStore.getState().mode).toBe('new');
  });

  it('a friend request is for_friend with the name, "For X" on confirm, and never carries the singer\'s phone', async () => {
    usePhoneStore.getState().set(useNightStore.getState().userKey, '+1 555 123 4567');
    useRequestStore.getState().startFriend('Bob');
    useRequestStore.getState().pick(starlight(), 'auto', 'starl');
    renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
    expect(await screen.findByTestId('tonight-confirm-friend')).toHaveTextContent('For ⁨Bob⁩');
    fireEvent.press(screen.getByTestId('tonight-confirm-send'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
    const body = api.submitRequest.mock.calls[0]![1];
    expect(body).toMatchObject({ for_friend: true, friend_name: 'Bob' });
    expect(body.phone).toBeUndefined();
  });

  it('the night screen\'s "Song for a friend" asks the name, then opens search in friend mode', async () => {
    renderRouter(requestRoutes(), { initialUrl: '/tonight' });
    fireEvent.press(await screen.findByTestId('tonight-friend-open'));
    fireEvent.changeText(await screen.findByTestId('tonight-friend-name'), 'Bob');
    fireEvent.press(screen.getByTestId('tonight-friend-next'));
    expect(await screen.findByTestId('tonight-friend-banner')).toHaveTextContent(/⁨Bob⁩/);
  });
});

it('the stored phone goes with a request of your own (ruling E6-R5)', async () => {
  usePhoneStore.getState().set(useNightStore.getState().userKey, '+1 555 123 4567');
  useRequestStore.getState().pick(starlight(), 'auto', 'starl');
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
  await waitFor(() => expect(api.submitRequest).toHaveBeenCalledWith('2121', expect.objectContaining({ phone: '+1 555 123 4567' })));
});

describe('duet partners (A.1, A.113, ruling E6-R7)', () => {
  it('lists tonight\'s singers A–Z without the singer or duplicates', () => {
    expect(sortedSingers(['zoe', 'Sam', 'adam', 'Ben', 'ben ', ''], ['sam'])).toEqual(['adam', 'Ben', 'zoe']);
  });

  it('filterable A–Z picker, "+ Add X as a new singer", max 3, sent as additional_singers', async () => {
    api.getMe.mockResolvedValue(me({ me: { name: 'Sam', phone: null, photo_consent: null, instagram: null } }));
    api.getSingers.mockResolvedValue({ api_version: '1.0', singers: ['Zoe', 'Sam', 'Adam', 'Ben', 'Bella'] });
    renderRouter(requestRoutes(), { initialUrl: '/tonight' });
    expect(await screen.findByTestId('tonight-singing-as')).toBeTruthy(); // /me cached (the singer's own name)
    useRequestStore.getState().pick(starlight(), 'auto', 'starl');
    act(() => router.push('/tonight/confirm'));
    fireEvent.press(await screen.findByTestId('tonight-confirm-duet'));
    expect(await screen.findByTestId('tonight-duet-singer-Adam')).toBeTruthy();
    expect(screen.queryByTestId('tonight-duet-singer-Sam')).toBeNull();

    fireEvent.changeText(screen.getByTestId('tonight-duet-filter'), 'be');
    expect(screen.getByTestId('tonight-duet-singer-Ben')).toBeTruthy();
    expect(screen.getByTestId('tonight-duet-singer-Bella')).toBeTruthy();
    expect(screen.queryByTestId('tonight-duet-singer-Adam')).toBeNull();
    fireEvent.press(screen.getByTestId('tonight-duet-singer-Ben'));

    fireEvent.changeText(screen.getByTestId('tonight-duet-filter'), 'Carla');
    expect(screen.getByTestId('tonight-duet-add-new')).toHaveTextContent('+ Add “⁨Carla⁩” as a new singer');
    fireEvent.press(screen.getByTestId('tonight-duet-add-new'));
    fireEvent.press(screen.getByTestId('tonight-duet-singer-Zoe'));
    // Three chosen: the rest are disabled and "+ Add" is gone.
    expect(screen.getByTestId('tonight-duet-max')).toBeTruthy();
    expect(screen.getByTestId('tonight-duet-singer-Adam')).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('tonight-duet-filter'), 'Dee');
    expect(screen.queryByTestId('tonight-duet-add-new')).toBeNull();

    fireEvent.press(screen.getByTestId('tonight-duet-done'));
    expect(await screen.findByTestId('tonight-confirm-partners')).toHaveTextContent('With ⁨Ben⁩, ⁨Carla⁩ and ⁨Zoe⁩');
    fireEvent.press(screen.getByTestId('tonight-confirm-send'));
    await waitFor(() =>
      expect(api.submitRequest).toHaveBeenCalledWith(
        '2121',
        expect.objectContaining({ additional_singers: [{ name: 'Ben' }, { name: 'Carla' }, { name: 'Zoe' }] }),
      ),
    );
  });
});

it('"Tip the host" (when tips are on) opens the tips route', async () => {
  api.getTips.mockResolvedValue({ api_version: '1.0', enabled: true, threshold: 0, kj_name: 'Andrew', methods: [] });
  renderRouter({ ...requestRoutes(), 'tonight/tips': tipsRoute }, { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId('tonight-tips-open'));
  expect(await screen.findByTestId('tonight-tips-claim')).toBeTruthy();
});

describe('once-per-night photo consent + Instagram on confirm (ruling E6-R8, A.92)', () => {
  const asking = (on: boolean) =>
    nightOpen({ night_id: NIGHT, features: { make: true, simple_mode: false, ask_photo_consent: on, quick_version: true, tips: true } });
  const confirmOnce = async () => {
    useRequestStore.getState().pick(starlight(), 'auto', 'starl');
    const view = renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
    await screen.findByTestId('tonight-confirm-send');
    return view;
  };

  it('asked once per night; the answer and handle go with this and later own submits', async () => {
    api.getNight.mockResolvedValue(asking(true));
    const first = await confirmOnce();
    expect(await screen.findByTestId('tonight-confirm-consent')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tonight-confirm-consent-yes'));
    fireEvent.changeText(await screen.findByTestId('tonight-confirm-instagram'), '@sam');
    fireEvent.press(screen.getByTestId('tonight-confirm-send'));
    await waitFor(() =>
      expect(api.submitRequest).toHaveBeenLastCalledWith('2121', expect.objectContaining({ photo_consent: 'yes', instagram: 'sam' })),
    );
    first.unmount();

    await confirmOnce();
    await waitFor(() => expect(api.getNight).toHaveBeenCalled());
    expect(screen.queryByTestId('tonight-confirm-consent')).toBeNull();
    fireEvent.press(screen.getByTestId('tonight-confirm-send'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalledTimes(2));
    expect(api.submitRequest.mock.calls[1]![1]).toMatchObject({ photo_consent: 'yes', instagram: 'sam' });
  });

  it('unanswered (unknown) sends nothing; the question never blocks the send', async () => {
    api.getNight.mockResolvedValue(asking(true));
    await confirmOnce();
    expect(await screen.findByTestId('tonight-confirm-consent')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tonight-confirm-send'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
    expect(api.submitRequest.mock.calls[0]![1]).not.toHaveProperty('photo_consent');
    expect(api.submitRequest.mock.calls[0]![1]).not.toHaveProperty('instagram');
  });

  it('not asked or sent for friend submits', async () => {
    api.getNight.mockResolvedValue(asking(true));
    const first = await confirmOnce();
    fireEvent.press(await screen.findByTestId('tonight-confirm-consent-no'));
    first.unmount();
    useRequestStore.getState().startFriend('Bob');
    useRequestStore.getState().pick(starlight(), 'auto', 'starl');
    renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
    await screen.findByTestId('tonight-confirm-friend');
    await waitFor(() => expect(api.getNight).toHaveBeenCalled());
    expect(screen.queryByTestId('tonight-confirm-consent')).toBeNull();
    fireEvent.press(screen.getByTestId('tonight-confirm-send'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
    expect(api.submitRequest.mock.calls[0]![1]).not.toHaveProperty('photo_consent');
  });

  it('not asked when the host does not ask', async () => {
    api.getNight.mockResolvedValue(asking(false));
    await confirmOnce();
    await waitFor(() => expect(api.getNight).toHaveBeenCalled());
    expect(screen.queryByTestId('tonight-confirm-consent')).toBeNull();
    fireEvent.press(screen.getByTestId('tonight-confirm-send'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
    expect(api.submitRequest.mock.calls[0]![1]).not.toHaveProperty('photo_consent');
  });
});

describe('request signature (fix round 1)', () => {
  it('duet partners are part of it: other partners get a new id, the same ones reuse the ambiguous id', () => {
    const s = useRequestStore.getState();
    s.pick(starlight(), 'auto', 'starl');
    s.setPartners(['Ben']);
    const sent = useRequestStore.getState().pending!;
    s.noteSend(sent, 'ambiguous');
    s.setPartners(['Ben', 'Zoe']);
    expect(useRequestStore.getState().pending!.clientRequestId).not.toBe(sent.clientRequestId);
    s.setPartners(['Ben']);
    expect(useRequestStore.getState().pending!.clientRequestId).toBe(sent.clientRequestId);
  });

  it('a change-mode retry id differs for a different replaces.id', () => {
    const s = useRequestStore.getState();
    s.startChange({ id: 41, title: 'Old' });
    const a = s.pick(starlight(), 'auto', 'starl');
    s.noteSend(a, 'ambiguous');
    s.startChange({ id: 41, title: 'Old' });
    expect(s.pick(starlight(), 'auto', 'starl').clientRequestId).toBe(a.clientRequestId);
    s.startChange({ id: 42, title: 'Other' });
    expect(s.pick(starlight(), 'auto', 'starl').clientRequestId).not.toBe(a.clientRequestId);
  });
});

describe('Instagram handle sanitising (fix round 3)', () => {
  it('strips leading @s and spaces, keeps [A-Za-z0-9._], caps at 30, omits when empty', () => {
    expect(sanitizeInstagram('  @@sam.k_9 ')).toBe('sam.k_9');
    expect(sanitizeInstagram('sa m!#$%é/<script>')).toBe('samscript');
    expect(sanitizeInstagram('a'.repeat(40))).toBe('a'.repeat(30));
    expect(sanitizeInstagram('@@ !!')).toBe('');
    expect(consentFields({ consent: 'yes', instagram: '@ ✨' })).toEqual({ photo_consent: 'yes' });
    expect(consentFields({ consent: 'yes', instagram: `@${'b'.repeat(35)}` })).toEqual({ photo_consent: 'yes', instagram: 'b'.repeat(30) });
  });

  it('stores the sanitised handle', () => {
    saveNightConsent('u', 'n1', { consent: 'yes', instagram: '@Sam!' });
    expect(loadNightConsent('u', 'n1')).toEqual({ consent: 'yes', instagram: 'Sam' });
  });
});

it('confirm re-reads the stored consent when the night changes (fix round 3)', async () => {
  api.getNight.mockResolvedValue(
    nightOpen({ night_id: NIGHT, features: { make: true, simple_mode: false, ask_photo_consent: true, quick_version: true, tips: true } }),
  );
  saveNightConsent(useNightStore.getState().userKey, NIGHT, { consent: 'no' });
  useRequestStore.getState().pick(starlight(), 'auto', 'starl');
  renderRouter(requestRoutes(), { initialUrl: '/tonight/confirm' });
  await screen.findByTestId('tonight-confirm-send');
  await waitFor(() => expect(api.getNight).toHaveBeenCalled());
  expect(screen.queryByTestId('tonight-confirm-consent')).toBeNull();
  const OTHER = 'bbbbbbbbbbbbbbbb';
  api.getNight.mockResolvedValue(
    nightOpen({ night_id: OTHER, features: { make: true, simple_mode: false, ask_photo_consent: true, quick_version: true, tips: true } }),
  );
  act(() => useNightStore.getState().joinNomad('2121', OTHER, 'Andrew'));
  expect(await screen.findByTestId('tonight-confirm-consent')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-confirm-send'));
  await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
  expect(api.submitRequest.mock.calls[0]![1]).not.toHaveProperty('photo_consent');
});

describe('"Nothing from tonight" sticks across later requests (final review, privacy)', () => {
  const asking = () =>
    nightOpen({ night_id: NIGHT, features: { make: true, simple_mode: false, ask_photo_consent: true, quick_version: true, tips: true } });
  const sung = (consent: 'yes' | 'no') =>
    me({
      me: { name: 'Sam', phone: null, photo_consent: consent, instagram: consent === 'yes' ? 'samk' : null },
      songs: [song({ request: { id: 2, media_consent: 'yes' }, estimate: at(4) })],
      sung_tonight: [song({ performed: true, request: { id: 1 }, history_id: `kj_${'a'.repeat(24)}` })],
    });

  beforeEach(() => {
    api.getNight.mockResolvedValue(asking());
    api.setSongConsent.mockResolvedValue(requestResult());
    api.updateMe.mockResolvedValue({ api_version: '1.0', me: { name: 'Sam', phone: null, photo_consent: 'no', instagram: null } });
  });

  it('opting out of the night, then requesting, never sends yes or the handle', async () => {
    const userKey = useNightStore.getState().userKey;
    saveNightConsent(userKey, NIGHT, { consent: 'yes', instagram: 'samk' });
    api.getMe.mockResolvedValue(sung('yes'));
    renderRouter(requestRoutes(), { initialUrl: '/tonight' });
    fireEvent.press(await screen.findByTestId('tonight-sung-toggle'));
    fireEvent.press(await screen.findByTestId('tonight-song-consent-r1'));
    // The box now answers no (as kjbox does after the PUT).
    api.getMe.mockResolvedValue(sung('no'));
    fireEvent.press(await screen.findByTestId('tonight-consent-scope-all-r1'));
    await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith('2121', { photo_consent: 'no', night_id: NIGHT }));
    await waitFor(() => expect(loadNightConsent(userKey, NIGHT)).toEqual({ consent: 'no' }));

    useRequestStore.getState().pick(starlight(), 'auto', 'starl');
    act(() => router.push('/tonight/confirm'));
    fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
    const body = api.submitRequest.mock.calls[0]![1];
    expect(body.photo_consent).not.toBe('yes');
    expect(body).not.toHaveProperty('instagram');
  });

  it('/me saying no wins over a stored yes', async () => {
    saveNightConsent(useNightStore.getState().userKey, NIGHT, { consent: 'yes', instagram: 'samk' });
    api.getMe.mockResolvedValue(me({ me: { name: 'Sam', phone: null, photo_consent: 'no', instagram: null } }));
    renderRouter(requestRoutes(), { initialUrl: '/tonight' });
    await waitFor(() => expect(api.getMe).toHaveBeenCalled());
    useRequestStore.getState().pick(starlight(), 'auto', 'starl');
    act(() => router.push('/tonight/confirm'));
    fireEvent.press(await screen.findByTestId('tonight-confirm-send'));
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalled());
    const body = api.submitRequest.mock.calls[0]![1];
    expect(body.photo_consent).toBe('no');
    expect(body).not.toHaveProperty('instagram');
  });

  it('consentFields defers to a known /me value', () => {
    expect(consentFields({ consent: 'yes', instagram: 'samk' }, 'no')).toEqual({ photo_consent: 'no' });
    expect(consentFields({ consent: 'yes', instagram: 'samk' }, null)).toEqual({ photo_consent: 'yes', instagram: 'samk' });
    expect(consentFields({}, 'no')).toEqual({ photo_consent: 'no' });
    expect(consentFields({ consent: 'no' }, undefined)).toEqual({ photo_consent: 'no' });
  });
});

it('requestSignature includes the night: an ambiguous id never carries into a later night (final review)', () => {
  const p = { song: starlight(), version: 'auto' as const, mode: 'new' as const };
  expect(requestSignature({ ...p, nightId: 'n1' })).not.toBe(requestSignature({ ...p, nightId: 'n2' }));
  const s = useRequestStore.getState();
  const a = s.pick(starlight(), 'auto', 'starl');
  s.noteSend(a, 'ambiguous');
  expect(s.pick(starlight(), 'auto', 'starl').clientRequestId).toBe(a.clientRequestId);
  act(() => useNightStore.getState().joinNomad('2121', 'bbbbbbbbbbbbbbbb', 'Andrew'));
  expect(useRequestStore.getState().pick(starlight(), 'auto', 'starl').clientRequestId).not.toBe(a.clientRequestId);
});
