import * as kjbox from '@nomad/api-kjbox';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { phoneExample, storedPhone } from '../../../tonight/manage/PhoneSheet';
import { useNightStore, type NomadNight } from '../../../tonight/nightStore';
import { at, me, song } from '../../../test-utils/tonightFixtures';
import { restoreTiming, setupNight, showNight } from './setup';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
  updateMe: jest.fn(),
}));
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn(), back: jest.fn(), dismissTo: jest.fn() } }));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const profile = (over: Partial<kjbox.MeProfile> = {}): kjbox.UpdateMeResult => ({
  api_version: '1.0',
  me: { name: 'Sam', phone: null, photo_consent: null, instagram: null, ...over },
});
const guard = () => new KjboxError('conflict', 409, undefined, { error: 'conflict', reason: 'rename_guard', from: 'Sam', to: 'Alex' });

let night: NomadNight;
beforeEach(() => {
  night = setupNight(api);
  api.getMe.mockResolvedValue(me({ songs: [song({ request: { id: 1 }, estimate: at(3) })] }));
});
afterAll(restoreTiming);

const openRename = async (name: string) => {
  showNight(night);
  expect(await screen.findByTestId('tonight-singing-as')).toHaveTextContent('Singing as ⁨Sam⁩');
  fireEvent.press(screen.getByTestId('tonight-edit-name'));
  fireEvent.changeText(await screen.findByTestId('tonight-rename-input'), name);
  fireEvent.press(screen.getByTestId('tonight-rename-save'));
};

describe('name with the rename guard (A.6–A.11, ruling E6-R1)', () => {
  it('a rename with no guard goes straight through', async () => {
    api.updateMe.mockResolvedValue(profile({ name: 'Sammy' }));
    await openRename('Sammy');
    await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith('2121', { name: 'Sammy', night_id: night.nightId }));
    expect(await screen.findByTestId('tonight-notice')).toHaveTextContent('✓ Name saved');
  });

  it('rename guard buttons order: friend, rename me, cancel', async () => {
    api.updateMe.mockRejectedValue(guard());
    await openRename('Alex');
    const box = await screen.findByTestId('tonight-rename-guard');
    expect(box).toHaveTextContent(/Rename yourself to ⁨Alex⁩\?/);
    const ids = within(box)
      .getAllByRole('button')
      .map((b) => b.props.testID as string);
    expect(ids).toEqual(['tonight-rename-guard-friend', 'tonight-rename-guard-rename', 'tonight-rename-guard-cancel']);
    expect(screen.getByTestId('tonight-rename-guard-friend')).toHaveTextContent('⁨Alex⁩ is a friend: request a song for them');
    expect(screen.getByTestId('tonight-rename-guard-rename')).toHaveTextContent("Yes, I'm ⁨Alex⁩: rename me");
  });

  it('"Yes, I\'m X" resends with confirm_rename', async () => {
    api.updateMe.mockRejectedValueOnce(guard()).mockResolvedValueOnce(profile({ name: 'Alex' }));
    await openRename('Alex');
    fireEvent.press(await screen.findByTestId('tonight-rename-guard-rename'));
    await waitFor(() => expect(api.updateMe).toHaveBeenLastCalledWith('2121', { name: 'Alex', night_id: night.nightId, confirm_rename: true }));
  });

  it('"X is a friend" opens the friend flow instead of renaming', async () => {
    api.updateMe.mockRejectedValue(guard());
    await openRename('Alex');
    fireEvent.press(await screen.findByTestId('tonight-rename-guard-friend'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/tonight/search', params: { friend: 'Alex' } });
    expect(api.updateMe).toHaveBeenCalledTimes(1);
  });

  it('host_named only says to ask the host (no rename option)', async () => {
    api.updateMe.mockRejectedValue(new KjboxError('conflict', 409, undefined, { error: 'conflict', reason: 'host_named', from: 'Sam', to: 'Alex' }));
    await openRename('Alex');
    expect(await screen.findByTestId('tonight-rename-host-named')).toHaveTextContent(/^The host set your name, so ask the host to change it\./);
    expect(screen.queryByTestId('tonight-rename-guard-rename')).toBeNull();
  });
});

describe('phone: text me when I\'m up (A.80, A.114, ruling E6-R5)', () => {
  it('shows an example in the region\'s format', async () => {
    expect(phoneExample('GB')).toBe('07700 900123');
    expect(phoneExample('zz')).toBe('(555) 123-4567');
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-phone-add'));
    expect(await screen.findByTestId('tonight-phone-example')).toHaveTextContent(`For example: ${phoneExample()}`);
  });

  it('with songs: saved on the phone and sent through PUT /me', async () => {
    api.updateMe.mockResolvedValue(profile({ phone: '+1 555 123 4567' }));
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-phone-add'));
    fireEvent.changeText(await screen.findByTestId('tonight-phone-input'), '+1 555 123 4567');
    fireEvent.press(screen.getByTestId('tonight-phone-save'));
    await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith('2121', { phone: '+1 555 123 4567', night_id: night.nightId }));
    expect(storedPhone(useNightStore.getState().userKey)).toBe('+1 555 123 4567');
    expect(await screen.findByTestId('tonight-phone-status')).toHaveTextContent("We'll text ⁨+1 555 123 4567⁩ when you're nearly up.");
  });

  it('with no songs yet: kept on the phone only (sent with the next request)', async () => {
    api.getMe.mockResolvedValue(me({ songs: [] }));
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-phone-add'));
    fireEvent.changeText(await screen.findByTestId('tonight-phone-input'), '07700 900123');
    fireEvent.press(screen.getByTestId('tonight-phone-save'));
    expect(await screen.findByTestId('tonight-phone-status')).toHaveTextContent(/starts with your next request/);
    expect(api.updateMe).not.toHaveBeenCalled();
  });

  it('with songs: a failed PUT /me keeps nothing and says it wasn\'t saved', async () => {
    api.updateMe.mockRejectedValue(new KjboxError('internal', 0, undefined, {}, true));
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-phone-add'));
    fireEvent.changeText(await screen.findByTestId('tonight-phone-input'), '+1 555 123 4567');
    fireEvent.press(screen.getByTestId('tonight-phone-save'));
    expect(await screen.findByTestId('tonight-phone-error')).toHaveTextContent("Your number wasn't saved. Try again.");
    expect(storedPhone(useNightStore.getState().userKey)).toBeNull();
  });

  it('an invalid number is caught before sending', async () => {
    showNight(night);
    fireEvent.press(await screen.findByTestId('tonight-phone-add'));
    fireEvent.changeText(await screen.findByTestId('tonight-phone-input'), 'call me');
    fireEvent.press(screen.getByTestId('tonight-phone-save'));
    expect(await screen.findByTestId('tonight-phone-error')).toBeTruthy();
    expect(api.updateMe).not.toHaveBeenCalled();
  });
});

