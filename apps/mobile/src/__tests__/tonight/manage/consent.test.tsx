import * as kjbox from '@nomad/api-kjbox';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { NomadNight } from '../../../tonight/nightStore';
import { at, me, nightOpen, song } from '../../../test-utils/tonightFixtures';
import { requestResult, restoreTiming, setupNight, showNight, sleep } from './setup';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
  setSongConsent: jest.fn(),
  updateMe: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const asking = (on: boolean) =>
  nightOpen({ features: { make: true, simple_mode: false, ask_photo_consent: on, quick_version: true, tips: true } });

let night: NomadNight;
beforeEach(() => {
  night = setupNight(api);
  api.getNight.mockResolvedValue(asking(true));
  api.setSongConsent.mockResolvedValue(requestResult());
  api.updateMe.mockResolvedValue({ api_version: '1.0', me: { name: 'Sam', phone: null, photo_consent: 'no', instagram: null } });
});
afterAll(restoreTiming);

it('shows only when the host asks (ask_photo_consent), on own songs, never on friend songs (A.92, A.94)', async () => {
  api.getNight.mockResolvedValue(asking(false));
  api.getMe.mockResolvedValue(
    me({ songs: [song({ request: { id: 1 }, estimate: at(3) }), song({ owner: 'friend', request: { id: 2, for_friend: true, singer_name: 'Bob' }, estimate: at(5) })] }),
  );
  const view = showNight(night);
  expect(await screen.findByTestId('tonight-song-r1')).toBeTruthy();
  await sleep(20);
  expect(screen.queryByTestId('tonight-song-consent-r1')).toBeNull();

  view.unmount();
  api.getNight.mockResolvedValue(asking(true));
  showNight(night);
  expect(await screen.findByTestId('tonight-song-consent-r1')).toBeTruthy();
  expect(screen.queryByTestId('tonight-song-consent-r2')).toBeNull();
});

it('unknown consent reads as no (A.91)', async () => {
  api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 1, media_consent: null }, estimate: at(3) })] }));
  showNight(night);
  expect(await screen.findByTestId('tonight-song-consent-r1')).toHaveTextContent("📷 Don't post");
});

it('consent debounced and skips unchanged (A.95, ruling E6-R4)', async () => {
  api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 1 }, estimate: at(3) })] }));
  showNight(night);
  const toggle = await screen.findByTestId('tonight-song-consent-r1');
  // Five fast taps end on "yes": one PUT, after the debounce.
  for (let i = 0; i < 5; i++) fireEvent.press(toggle);
  expect(toggle).toHaveTextContent('📷 OK to post');
  expect(api.setSongConsent).not.toHaveBeenCalled();
  await waitFor(() => expect(api.setSongConsent).toHaveBeenCalledTimes(1));
  // The night choice is unknown, so "yes" is pinned on the song.
  expect(api.setSongConsent).toHaveBeenCalledWith('2121', 1, 'yes', night.nightId);

  // Two taps back to the confirmed value: nothing to send.
  fireEvent.press(toggle);
  fireEvent.press(toggle);
  await sleep(200);
  expect(api.setSongConsent).toHaveBeenCalledTimes(1);
});

it('a failed save puts the toggle back and says so', async () => {
  api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 1 }, estimate: at(3) })] }));
  api.setSongConsent.mockRejectedValue(new Error('boom'));
  showNight(night);
  const toggle = await screen.findByTestId('tonight-song-consent-r1');
  fireEvent.press(toggle);
  expect(await screen.findByText("Couldn't save that. Try again in a moment.")).toBeTruthy();
  expect(toggle).toHaveTextContent("📷 Don't post");
});

describe('yes→no after singing asks "Just this song" / "Nothing from tonight" (A.94)', () => {
  const sung = () =>
    me({
      me: { name: 'Sam', phone: null, photo_consent: 'yes', instagram: null },
      songs: [song({ request: { id: 2, media_consent: 'yes' }, estimate: at(4) })],
      sung_tonight: [song({ performed: true, request: { id: 1 }, history_id: `kj_${'a'.repeat(24)}` })],
    });

  const openSung = async () => {
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-sung-toggle'));
    fireEvent.press(await screen.findByTestId('tonight-song-consent-r1'));
    expect(await screen.findByTestId('tonight-consent-scope-r1')).toHaveTextContent(/Just this song.*Nothing from tonight/);
  };

  it('"Just this song" sets this song to no only', async () => {
    api.getMe.mockResolvedValue(sung());
    await openSung();
    expect(api.setSongConsent).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('tonight-consent-scope-one-r1'));
    await waitFor(() => expect(api.setSongConsent).toHaveBeenCalledWith('2121', 1, 'no', night.nightId));
    expect(api.updateMe).not.toHaveBeenCalled();
  });

  it('"Nothing from tonight" sets the night to no and clears own per-song yeses', async () => {
    api.getMe.mockResolvedValue(sung());
    await openSung();
    fireEvent.press(screen.getByTestId('tonight-consent-scope-all-r1'));
    await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith('2121', { photo_consent: 'no', night_id: night.nightId }));
    await waitFor(() => expect(api.setSongConsent).toHaveBeenCalledWith('2121', 2, null, night.nightId));
  });

  it('turning an unsung song off asks nothing', async () => {
    api.getMe.mockResolvedValue(sung());
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-song-consent-r2'));
    expect(screen.queryByTestId('tonight-consent-scope-r2')).toBeNull();
    // "no" while the night says yes: pinned on the song.
    await waitFor(() => expect(api.setSongConsent).toHaveBeenCalledWith('2121', 2, 'no', night.nightId));
  });
});
