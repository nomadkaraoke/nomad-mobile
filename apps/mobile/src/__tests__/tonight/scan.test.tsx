import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { renderRouter } from 'expo-router/testing-library';
import { Linking } from 'react-native';

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
    CameraView: (props: { onBarcodeScanned?: CameraMockState['onScan']; barcodeScannerSettings?: unknown }) => {
      mockCamera.onScan = props.onBarcodeScanned;
      mockCamera.settings = props.barcodeScannerSettings;
      return createElement(View, { testID: 'camera-view' });
    },
    useCameraPermissions: () => [mockCamera.permission, mockCamera.request],
  };
});

const api = kjbox as jest.Mocked<typeof kjbox>;
const haptic = Haptics.notificationAsync as jest.Mock;

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  signedInClean();
  mockCamera.onScan = undefined;
  mockCamera.permission = { granted: true, status: 'granted', canAskAgain: true };
  api.getNight.mockReturnValue(new Promise(() => {}));
});

const scan = (data: string) => act(() => mockCamera.onScan?.({ type: 'qr', data }));

describe('permission (ruling E3-R3)', () => {
  it('not asked yet: explains why and asks on tap', async () => {
    mockCamera.permission = { granted: false, status: 'undetermined', canAskAgain: true };
    renderRouter(getInRoutes(), { initialUrl: '/tonight/scan' });
    expect(await screen.findByTestId('tonight-scan-why')).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
    fireEvent.press(screen.getByTestId('tonight-scan-allow'));
    expect(mockCamera.request).toHaveBeenCalledTimes(1);
  });

  it('denied: offers Settings and the night code instead', async () => {
    mockCamera.permission = { granted: false, status: 'denied', canAskAgain: false };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const app = renderRouter(getInRoutes(), { initialUrl: '/tonight/scan' });
    expect(await screen.findByTestId('tonight-scan-denied')).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
    fireEvent.press(screen.getByTestId('tonight-scan-settings'));
    expect(openSettings).toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('tonight-code-input'), '2121');
    fireEvent.press(screen.getByTestId('tonight-code-submit'));
    await waitFor(() => expect(app.getPathname()).toBe('/tonight/join'));
    expect(app.getSearchParams()).toMatchObject({ t: '2121' });
  });

  it('denied but askable again: offers to ask again, and the code', async () => {
    mockCamera.permission = { granted: false, status: 'denied', canAskAgain: true };
    renderRouter(getInRoutes(), { initialUrl: '/tonight/scan' });
    fireEvent.press(await screen.findByTestId('tonight-scan-allow'));
    expect(mockCamera.request).toHaveBeenCalled();
    expect(screen.getByTestId('tonight-code-input')).toBeTruthy();
  });
});

describe('scanning (ruling E3-R3)', () => {
  it('scans QR codes only', async () => {
    renderRouter(getInRoutes(), { initialUrl: '/tonight/scan' });
    await screen.findByTestId('camera-view');
    expect(mockCamera.settings).toEqual({ barcodeTypes: ['qr'] });
  });

  it('ignores anything that is not a night link, silently', async () => {
    const app = renderRouter(getInRoutes(), { initialUrl: '/tonight/scan' });
    await screen.findByTestId('camera-view');
    scan('https://example.com/menu');
    scan('WIFI:S:Nomad KJ Box;;');
    scan('https://kjbox.cc/');
    expect(haptic).not.toHaveBeenCalled();
    expect(app.getPathname()).toBe('/tonight/scan');
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('the printed QR (uppercase) opens the join route once, with one haptic', async () => {
    const app = renderRouter(getInRoutes(), { initialUrl: '/tonight/scan' });
    await screen.findByTestId('camera-view');
    scan('HTTP://KJBOX.CC/2121');
    scan('HTTP://KJBOX.CC/2121');
    await waitFor(() => expect(app.getPathname()).toBe('/tonight/join'));
    expect(app.getSearchParams()).toMatchObject({ t: '2121' });
    expect(haptic).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.getNight).toHaveBeenCalledWith('2121'));
    expect(api.getNight).toHaveBeenCalledTimes(1);
  });

  it('accepts the sing page link too', async () => {
    const app = renderRouter(getInRoutes(), { initialUrl: '/tonight/scan' });
    await screen.findByTestId('camera-view');
    scan('https://sing.nomadkaraoke.com/?t=4321');
    await waitFor(() => expect(app.getSearchParams()).toMatchObject({ t: '4321' }));
  });
});
