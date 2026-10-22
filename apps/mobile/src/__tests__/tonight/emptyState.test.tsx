import * as kjbox from '@nomad/api-kjbox';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useNightStore } from '../../tonight/nightStore';
import { nightOpen } from '../../test-utils/tonightFixtures';
import { getInRoutes, type CameraMockState } from './getInHelpers';
import { signedInClean } from './other/setup';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  pingSearch: jest.fn(async () => true),
  popularSongs: jest.fn(async () => []),
}));
jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getNight: jest.fn(),
  getMe: jest.fn(() => new Promise(() => {})),
  getNow: jest.fn(() => new Promise(() => {})),
  getRotation: jest.fn(() => new Promise(() => {})),
}));
const mockCamera: CameraMockState = { permission: null, request: jest.fn() };
jest.mock('expo-camera', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    CameraView: (props: { onBarcodeScanned?: CameraMockState['onScan'] }) => {
      mockCamera.onScan = props.onBarcodeScanned;
      return createElement(View, { testID: 'camera-view' });
    },
    useCameraPermissions: () => [mockCamera.permission, mockCamera.request],
  };
});

const api = kjbox as jest.Mocked<typeof kjbox>;

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  signedInClean();
  mockCamera.permission = { granted: true, status: 'granted', canAskAgain: true };
  api.getNight.mockResolvedValue(nightOpen({ night_id: 'cccccccccccccccc', kj_name: 'Andrew' }));
});

// Ruling E3-R5: three ways in from an empty Tonight.
it('the empty state offers scan, enter the code, and start logging another night', async () => {
  renderRouter(getInRoutes(), { initialUrl: '/tonight' });
  expect(await screen.findByTestId('tonight-scan')).toHaveTextContent("Scan the host's QR code");
  expect(screen.getByTestId('tonight-enter-code')).toHaveTextContent('Enter the night code');
  // E9's entry: "At another karaoke night?" above its "Start logging tonight" button.
  expect(screen.getByText('At another karaoke night?')).toBeTruthy();
  expect(screen.getByTestId('tonight-start-other')).toHaveTextContent('Start logging tonight');
  // The code field only opens on request.
  expect(screen.queryByTestId('tonight-code-input')).toBeNull();
});

it('scan opens the scanner', async () => {
  const app = renderRouter(getInRoutes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId('tonight-scan'));
  expect(await screen.findByTestId('camera-view')).toBeTruthy();
  expect(app.getPathname()).toBe('/tonight/scan');
});

it('entering a code joins that night', async () => {
  const app = renderRouter(getInRoutes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId('tonight-enter-code'));
  fireEvent.changeText(screen.getByTestId('tonight-code-input'), ' 2121 ');
  fireEvent.press(screen.getByTestId('tonight-code-submit'));
  await waitFor(() => expect(api.getNight).toHaveBeenCalledWith('2121'));
  await waitFor(() => expect(useNightStore.getState().active).toMatchObject({ kind: 'nomad', code: '2121', nightId: 'cccccccccccccccc' }));
  await waitFor(() => expect(app.getPathname()).toBe('/tonight'));
});

it('a pasted night link works in the code field too', async () => {
  renderRouter(getInRoutes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId('tonight-enter-code'));
  fireEvent.changeText(screen.getByTestId('tonight-code-input'), 'HTTP://KJBOX.CC/2121');
  fireEvent.press(screen.getByTestId('tonight-code-submit'));
  await waitFor(() => expect(api.getNight).toHaveBeenCalledWith('2121'));
});

it('a code that is not a night code stays on the empty state with a hint', async () => {
  const app = renderRouter(getInRoutes(), { initialUrl: '/tonight' });
  fireEvent.press(await screen.findByTestId('tonight-enter-code'));
  fireEvent.changeText(screen.getByTestId('tonight-code-input'), 'abc');
  fireEvent.press(screen.getByTestId('tonight-code-submit'));
  expect(await screen.findByTestId('tonight-code-error')).toBeTruthy();
  expect(app.getPathname()).toBe('/tonight');
  expect(api.getNight).not.toHaveBeenCalled();
});
