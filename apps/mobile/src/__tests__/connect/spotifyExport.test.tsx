// Connect -> Your Spotify history: the 3-step export guide (Phase 3b Task 21).
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Linking, Platform } from 'react-native';

import { useAuth } from '../../auth/store';
import { safeExportName } from '../../discover/connect/pickExportFile';
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

const N = Notifications as jest.Mocked<typeof Notifications>;
const open = () => renderRouter(appRoutes(), { initialUrl: '/discover/connect/spotify-export' });

beforeEach(async () => {
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  N.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true } as never);
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('Spotify export guide', () => {
  it('shows the three steps and opens Spotify privacy settings', async () => {
    open();
    expect(
      await screen.findByText(
        'Request your data at spotify.com/account/privacy. Tick Account data (ready in about 5 days) and Extended streaming history (up to 30 days): Extended has your whole history.',
      ),
    ).toBeTruthy();
    expect(screen.getByText("We'll remind you when it should be ready.")).toBeTruthy();
    expect(
      screen.getByText(
        "When Spotify's email arrives, save the zip to Files, then come back here and pick it.",
      ),
    ).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('connect-spotify-open')));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://www.spotify.com/account/privacy/');
  });

  // iOS has no Share -> Nomad Karaoke (share intake is Android only), so step 3 and the reminder say Files there.
  describe('on Android', () => {
    beforeEach(() => Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }));
    afterEach(() => Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true }));

    it('step 3 and the reminder offer Share -> Nomad Karaoke', async () => {
      open();
      expect(
        await screen.findByText(
          "When Spotify's email arrives, download the zip, then Share → Nomad Karaoke, or come back here and pick the file.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/save the zip to Files/)).toBeNull();
      await act(async () => fireEvent.press(screen.getByTestId('connect-spotify-remind')));
      expect(N.scheduleNotificationAsync.mock.calls[0]![0].content).toMatchObject({
        body: 'Open the email from Spotify, then share the zip with Nomad Karaoke.',
      });
    });
  });

  it('on iOS step 3 never mentions Share -> Nomad Karaoke', async () => {
    open();
    await screen.findByText("When Spotify's email arrives, save the zip to Files, then come back here and pick it.");
    expect(screen.queryByText(/Share → Nomad Karaoke/)).toBeNull();
  });

  it('remind asks permission only on tap', async () => {
    open();
    const remind = await screen.findByTestId('connect-spotify-remind');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(remind));
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(N.scheduleNotificationAsync.mock.calls[0]![0].content).toMatchObject({
      title: 'Your Spotify data may be ready',
      body: 'Open the email from Spotify, save the zip to Files, then pick it in Nomad Karaoke.',
    });
    expect(await screen.findByTestId('connect-spotify-reminded')).toBeTruthy();
  });

  it('denied permission shows settings hint', async () => {
    N.requestPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false } as never);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-spotify-remind')));
    expect(
      await screen.findByText('Notifications are off for Nomad Karaoke. Turn them on in Settings to get a reminder.'),
    ).toBeTruthy();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId('connect-spotify-settings')));
    expect(openSettings).toHaveBeenCalled();
  });

  it('pick copies to cache and opens the import screen', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/DocumentPicker/A1B2C3D4.zip', name: 'my_spotify_data.zip', size: 10, lastModified: 0 }],
    });
    const app = open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-spotify-pick')));
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      type: [
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
        'text/csv',
        'text/comma-separated-values',
      ],
      copyToCacheDirectory: true,
    });
    await waitFor(() => expect(app.getPathname()).toBe('/discover/connect/import-file'));
    expect(app.getSearchParams()).toMatchObject({ file: 'file:///cache/DocumentPicker/A1B2C3D4.zip', name: 'my_spotify_data.zip' });
    expect(await screen.findByTestId('connect-import-progress')).toBeTruthy();
  });

  it('a picked name with & or % reaches the import screen sanitised (it rides in the sign-in returnTo)', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/DocumentPicker/A1B2C3D4.zip', name: 'R&B 100%.zip', size: 10, lastModified: 0 }],
    });
    const app = open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-spotify-pick')));
    await waitFor(() => expect(app.getPathname()).toBe('/discover/connect/import-file'));
    expect(app.getSearchParams()).toMatchObject({ file: 'file:///cache/DocumentPicker/A1B2C3D4.zip', name: 'R_B_100_.zip' });
  });

  it('a cancelled pick stays on the guide', async () => {
    const app = open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-spotify-pick')));
    expect(app.getPathname()).toBe('/discover/connect/spotify-export');
  });

  it('a reminder tap that cold-starts the app lands on the guide, not the / redirect', async () => {
    N.getLastNotificationResponse.mockReturnValueOnce({
      notification: { request: { content: { data: { url: '/discover/connect/spotify-export' } } } },
    } as never);
    const app = renderRouter(appRoutes(), { initialUrl: '/' });
    await waitFor(() => expect(app.getPathname()).toBe('/discover/connect/spotify-export'));
    expect(await screen.findByTestId('connect-spotify-remind')).toBeTruthy();
    // and it stays there (the index redirect must not win afterwards)
    await act(async () => {});
    expect(app.getPathname()).toBe('/discover/connect/spotify-export');
    expect(N.clearLastNotificationResponse).toHaveBeenCalled();
    // Back from there goes to Discover (the redirect target), not an empty stack.
    await act(async () => router.back());
    await waitFor(() => expect(app.getPathname()).toBe('/discover'));
  });
});

describe('safeExportName', () => {
  it.each([
    ['my_spotify_data.zip', 'my_spotify_data.zip'],
    ['my spotify data.zip', 'my_spotify_data.zip'],
    ['R&B 100%.zip', 'R_B_100_.zip'],
    ['..hidden.csv', 'hidden.csv'],
    ['dir/sub\\Play Activity.csv', 'Play_Activity.csv'],
    ['%%%', ''],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%p -> %p', (raw, want) => {
    expect(safeExportName(raw)).toBe(want);
  });

  it('truncates a long name to 120 characters, keeping the extension', () => {
    const out = safeExportName(`${'a'.repeat(200)}.zip`);
    expect(out).toHaveLength(120);
    expect(out.endsWith('.zip')).toBe(true);
  });
});
