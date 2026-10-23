// Connect -> Apple Music history: the privacy-export fallback guide (Phase 3b Task 22).
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { gen, session } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})), openAuthSessionAsync: jest.fn() }));
jest.mock('../../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => false,
  requestAppleMusicUserToken: jest.fn(),
}));
// The import screen the picker opens: keep it reading forever (its own suite covers it).
jest.mock('../../discover/connect/readExport', () => ({
  ...jest.requireActual('../../discover/connect/readExport'),
  readExportFile: jest.fn(() => new Promise(() => {})),
}));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: {} })),
  getServiceCapabilities: jest.fn(async () => ({ screenshot_import: false, listenbrainz_oauth: false })),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const open = () => renderRouter(appRoutes(), { initialUrl: '/discover/connect/apple' });

beforeEach(async () => {
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('Apple Music export guide', () => {
  it('opens privacy.apple.com', async () => {
    open();
    expect(await screen.findByText('Go to privacy.apple.com and sign in.')).toBeTruthy();
    expect(
      screen.getByText(
        'Choose Request a copy of your data, tick Apple Media Services information, and submit. Apple emails you in a few days.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Download the files, then pick the zip or the Play Activity CSV here.')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('connect-apple-open')));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://privacy.apple.com/');
  });

  it('picked csv routes to import-file', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/Play Activity.csv', name: 'Play Activity.csv', size: 10, lastModified: 0 }],
    });
    const app = open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-apple-pick')));
    const { type } = (DocumentPicker.getDocumentAsync as jest.Mock).mock.calls[0]![0];
    expect(type).toEqual(expect.arrayContaining(['application/zip', 'text/csv', 'text/comma-separated-values']));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/connect/import-file'));
    expect(app.getSearchParams()).toMatchObject({ file: 'file:///cache/Play Activity.csv', name: 'Play Activity.csv' });
    expect(await screen.findByTestId('connect-import-progress')).toBeTruthy();
  });

  it('a cancelled pick stays on the guide', async () => {
    const app = open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-apple-pick')));
    expect(app.getPathname()).toBe('/discover/connect/apple');
  });
});
