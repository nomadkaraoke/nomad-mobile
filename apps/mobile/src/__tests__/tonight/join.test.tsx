import * as kjbox from '@nomad/api-kjbox';
import type { NightClosed } from '@nomad/api-kjbox';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { openSignIn } from '../../auth/signInUi';
import { useNightStore } from '../../tonight/nightStore';
import { nightOpen } from '../../test-utils/tonightFixtures';
import { getInRoutes, type CameraMockState } from './getInHelpers';
import { otherNight, signedInClean } from './other/setup';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  pingSearch: jest.fn(async () => true),
  popularSongs: jest.fn(async () => []),
}));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getNight: jest.fn(),
  joinNight: jest.fn(),
  getMe: jest.fn(() => new Promise(() => {})),
  getNow: jest.fn(() => new Promise(() => {})),
  getRotation: jest.fn(() => new Promise(() => {})),
}));
jest.mock('../../auth/signInUi', () => ({ ...jest.requireActual('../../auth/signInUi'), openSignIn: jest.fn() }));
const mockCamera: CameraMockState = { permission: null, request: jest.fn() };
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [mockCamera.permission, mockCamera.request] }));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const TONIGHT = 'cccccccccccccccc';
const OTHER = 'dddddddddddddddd';

const closed = (over: Partial<NightClosed> = {}): NightClosed => ({ api_version: '1.0', open: false, error: 'not_open', reason: 'closed', ...over });
const open = (path = '/tonight/join?t=2121') => renderRouter(getInRoutes(), { initialUrl: path });

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  signedInClean();
  api.getNight.mockResolvedValue(nightOpen({ night_id: TONIGHT, kj_name: 'Andrew' }));
  api.joinNight.mockResolvedValue({ api_version: '1.0', me: { name: 'Sam' } });
});

it('signed out: opens sign-in that comes back to this join', async () => {
  useAuth.setState({ state: { status: 'signedOut' } });
  useNightStore.getState().rehydrate(null);
  open();
  await waitFor(() => expect(openSignIn).toHaveBeenCalledWith('/tonight/join?t=2121'));
  expect(openSignIn).toHaveBeenCalledTimes(1);
  expect(api.getNight).not.toHaveBeenCalled();
  // Dismissed without signing in: a way to try again.
  fireEvent.press(screen.getByTestId('tonight-join-sign-in'));
  expect(openSignIn).toHaveBeenCalledTimes(2);
});

it('already named: joins and lands on the night', async () => {
  const app = open();
  await waitFor(() => expect(app.getPathname()).toBe('/tonight'));
  expect(api.getNight).toHaveBeenCalledWith('2121');
  expect(api.joinNight).not.toHaveBeenCalled();
  expect(useNightStore.getState().active).toMatchObject({ kind: 'nomad', code: '2121', nightId: TONIGHT, kjName: 'Andrew' });
  expect(screen.queryByTestId('tonight-name-sheet')).toBeNull();
});

describe('first time: name confirm (spec §4.1 Join tonight)', () => {
  it('prefills the suggested name, then joinNight → joinNomad → the night', async () => {
    api.getNight.mockResolvedValue(nightOpen({ night_id: TONIGHT, kj_name: 'Andrew', needs_name: true, suggested_name: 'Sam' }));
    const app = open();
    expect(await screen.findByTestId('tonight-name-input')).toHaveProp('value', 'Sam');
    expect(screen.getByText('The host will call you up with this name.')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('tonight-name-input'), '  Sammy ');
    fireEvent.press(screen.getByTestId('tonight-name-confirm'));
    await waitFor(() => expect(api.joinNight).toHaveBeenCalledWith('2121', 'Sammy', TONIGHT));
    await waitFor(() => expect(app.getPathname()).toBe('/tonight'));
    expect(useNightStore.getState().active).toMatchObject({ kind: 'nomad', code: '2121', nightId: TONIGHT });
  });

  it.each([[''], [null]])('no prefill when suggested_name is %p; a name is required', async (suggested) => {
    api.getNight.mockResolvedValue(nightOpen({ night_id: TONIGHT, needs_name: true, suggested_name: suggested }));
    open();
    const input = await screen.findByTestId('tonight-name-input');
    expect(input).toHaveProp('value', '');
    fireEvent.press(screen.getByTestId('tonight-name-confirm'));
    expect(api.joinNight).not.toHaveBeenCalled();
    fireEvent.changeText(input, '   ');
    fireEvent.press(screen.getByTestId('tonight-name-confirm'));
    expect(api.joinNight).not.toHaveBeenCalled();
    expect(useNightStore.getState().active).toBeNull();
  });

  it('a failed join keeps the sheet with the error and does not join', async () => {
    api.getNight.mockResolvedValue(nightOpen({ night_id: TONIGHT, needs_name: true, suggested_name: 'Sam' }));
    api.joinNight.mockRejectedValue(new KjboxError('invalid', 400, undefined, { error: 'invalid' }));
    open();
    fireEvent.press(await screen.findByTestId('tonight-name-confirm'));
    expect(await screen.findByTestId('tonight-name-error')).toBeTruthy();
    expect(screen.getByTestId('tonight-name-input')).toBeTruthy();
    expect(useNightStore.getState().active).toBeNull();
  });
});

describe('the night is not open (A.37)', () => {
  it('closed: the closed state with the host message, and retry', async () => {
    api.getNight.mockResolvedValue(closed({ kj_name: 'Andrew', footer_message: 'Back after the break!' }));
    open();
    expect(await screen.findByTestId('tonight-join-closed')).toBeTruthy();
    expect(screen.getByText('Back after the break!')).toBeTruthy();
    api.getNight.mockResolvedValue(nightOpen({ night_id: TONIGHT }));
    fireEvent.press(screen.getByTestId('tonight-join-retry'));
    await waitFor(() => expect(useNightStore.getState().active).toMatchObject({ nightId: TONIGHT }));
  });

  it('no night yet: says it has not started', async () => {
    api.getNight.mockResolvedValue(closed({ reason: 'no_night' }));
    open();
    expect(await screen.findByTestId('tonight-join-closed')).toHaveTextContent(/hasn't started/);
    expect(useNightStore.getState().active).toBeNull();
  });

  it("bad_code: \"That code isn't tonight's\" with code re-entry", async () => {
    api.getNight.mockResolvedValue(closed({ reason: 'bad_code' }));
    open('/tonight/join?t=9999');
    expect(await screen.findByTestId('tonight-join-bad-code')).toHaveTextContent(/That code isn't tonight's/);
    api.getNight.mockResolvedValue(nightOpen({ night_id: TONIGHT }));
    fireEvent.changeText(screen.getByTestId('tonight-code-input'), '2121');
    fireEvent.press(screen.getByTestId('tonight-code-submit'));
    await waitFor(() => expect(api.getNight).toHaveBeenLastCalledWith('2121'));
    await waitFor(() => expect(useNightStore.getState().active).toMatchObject({ code: '2121', nightId: TONIGHT }));
  });

  it('a malformed code never reaches the box', async () => {
    open('/tonight/join?t=abc');
    expect(await screen.findByTestId('tonight-join-bad-code')).toBeTruthy();
    expect(api.getNight).not.toHaveBeenCalled();
  });

  it('the box unreachable: the venue-wifi message and retry', async () => {
    api.getNight.mockRejectedValue(new KjboxError('internal', 0, undefined, undefined, true));
    open();
    expect(await screen.findByTestId('tonight-unreachable')).toBeTruthy();
    expect(screen.getByTestId('tonight-join-retry')).toBeTruthy();
  });
});

describe('switching nights (ruling E3-R4)', () => {
  it('another Nomad night is active: asks; keeping it leaves the old night', async () => {
    useNightStore.getState().joinNomad('5555', OTHER, 'Someone');
    const app = open();
    expect(await screen.findByTestId('tonight-switch-sheet')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tonight-switch-keep'));
    await waitFor(() => expect(app.getPathname()).toBe('/tonight'));
    expect(useNightStore.getState().active).toMatchObject({ code: '5555', nightId: OTHER });
  });

  it('another Nomad night is active: switching joins the new one', async () => {
    useNightStore.getState().joinNomad('5555', OTHER, 'Someone');
    open();
    fireEvent.press(await screen.findByTestId('tonight-switch-confirm'));
    await waitFor(() => expect(useNightStore.getState().active).toMatchObject({ code: '2121', nightId: TONIGHT }));
  });

  it('an Other-bar night is active: asks too, then the name if needed', async () => {
    otherNight();
    api.getNight.mockResolvedValue(nightOpen({ night_id: TONIGHT, needs_name: true, suggested_name: 'Sam' }));
    open();
    fireEvent.press(await screen.findByTestId('tonight-switch-confirm'));
    fireEvent.press(await screen.findByTestId('tonight-name-confirm'));
    await waitFor(() => expect(useNightStore.getState().active).toMatchObject({ kind: 'nomad', nightId: TONIGHT }));
  });

  it('the same night again: no question', async () => {
    useNightStore.getState().joinNomad('2121', TONIGHT, 'Andrew');
    const app = open();
    await waitFor(() => expect(app.getPathname()).toBe('/tonight'));
    expect(screen.queryByTestId('tonight-switch-sheet')).toBeNull();
  });
});
