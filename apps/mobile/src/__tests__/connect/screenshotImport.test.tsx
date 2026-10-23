// Connect -> Screenshot import: pick -> resize -> extract -> confirm list -> save (Phase 3b Task 19).
import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import * as memoryFs from '../../test-utils/memoryFs';
import { gen, session } from '../../test-utils/genAuthMock';
import { appRoutes } from '../../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: true, isInternetReachable: true }) };
});
jest.mock('../../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => false,
  requestAppleMusicUserToken: jest.fn(),
}));
jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn() },
}));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  extractScreenshots: jest.fn(),
  confirmScreenshotItems: jest.fn(),
  getServicesSummary: jest.fn(async () => ({ sources: [], capabilities: {} })),
  getServiceCapabilities: jest.fn(async () => ({ screenshot_import: true, listenbrainz_oauth: false })),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const m = (f: unknown) => f as jest.Mock;
const manipulate = m(ImageManipulator.ImageManipulator.manipulate);
const resize = jest.fn();
const saveAsync = jest.fn();

const asset = (i: number, width: number) => ({ uri: `file:///shots/${i}.png`, width, height: width * 2 });
const candidates = [
  { kind: 'artist', artist: 'Fixture Artist', title: null, confidence: 0.9, matched: true, song_key: null },
  { kind: 'song', artist: 'Fixture Band', title: 'Fixture Song', confidence: 0.8, matched: true, song_key: 'k1' },
  { kind: 'artist', artist: 'Invented Duo', title: null, confidence: 0.7, matched: false, song_key: null },
];

const open = () => renderRouter(appRoutes(), { initialUrl: '/discover/connect/screenshot' });
const pickShots = async (widths: number[] = [1170]) => {
  m(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: widths.map((w, i) => asset(i, w)) });
  open();
  const pick = await screen.findByTestId('connect-shot-pick');
  await act(async () => fireEvent.press(pick));
};

beforeEach(async () => {
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  resize.mockClear();
  saveAsync.mockImplementation(async () => ({ uri: 'file:///out/shot.jpg' }));
  manipulate.mockImplementation(() => {
    const ctx = { resize: (o: unknown) => (resize(o), ctx), renderAsync: async () => ({ saveAsync }) };
    return ctx;
  });
  m(decide.extractScreenshots).mockResolvedValue({ candidates });
  m(decide.confirmScreenshotItems).mockResolvedValue({
    source: 'screenshot',
    artists_added: 1,
    songs_added: 1,
    songs_updated: 0,
    tracks_matched: 1,
  });
  await act(() => useAuth.getState().signInWithSession(session()));
});

describe('Screenshot import', () => {
  it('cancel picking returns to idle', async () => {
    m(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
    open();
    const pick = await screen.findByTestId('connect-shot-pick');
    await act(async () => fireEvent.press(pick));
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });
    expect(screen.getByTestId('connect-shot-pick')).toBeTruthy();
    expect(screen.queryByTestId('connect-shot-progress')).toBeNull();
    expect(decide.extractScreenshots).not.toHaveBeenCalled();
  });

  it('resizes before upload', async () => {
    await pickShots([1800, 1170]);
    await screen.findByTestId('connect-shot-confirm');
    expect(resize).toHaveBeenCalledTimes(1); // only the 1800 px one is wider than 1290
    expect(resize).toHaveBeenCalledWith({ width: 1290 });
    expect(saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
    // expo-file-system Files (expo/fetch reads their bytes), not React Native { uri } parts: those never send.
    const [parts] = m(decide.extractScreenshots).mock.calls[0] as [memoryFs.File[]];
    expect(parts.map((p) => [p instanceof memoryFs.File, p.uri, p.type, typeof p.bytes])).toEqual([
      [true, 'file:///out/shot.jpg', 'image/jpeg', 'function'],
      [true, 'file:///out/shot.jpg', 'image/jpeg', 'function'],
    ]);
  });

  it('shows progress, then every item checked with the unmatched hint', async () => {
    let finish!: (v: unknown) => void;
    m(decide.extractScreenshots).mockReturnValue(new Promise((r) => (finish = r)));
    await pickShots();
    expect(await screen.findByText('Reading your screenshots…')).toBeTruthy();
    await act(async () => finish({ candidates }));
    for (let i = 0; i < 3; i++) {
      expect(screen.getByTestId(`connect-shot-item-${i}`).props.accessibilityState.checked).toBe(true);
    }
    expect(screen.getByText('Fixture Band · Fixture Song')).toBeTruthy();
    expect(screen.getAllByText('Not in our karaoke catalog yet')).toHaveLength(1);
  });

  it('extract then confirm sends only checked items', async () => {
    await pickShots();
    const first = await screen.findByTestId('connect-shot-item-0');
    await act(async () => fireEvent.press(first));
    expect(screen.getByTestId('connect-shot-item-0').props.accessibilityState.checked).toBe(false);
    await act(async () => fireEvent.press(screen.getByTestId('connect-shot-confirm')));
    expect(await screen.findByTestId('connect-import-result')).toBeTruthy();
    expect(decide.confirmScreenshotItems).toHaveBeenCalledWith([
      { kind: 'song', artist: 'Fixture Band', title: 'Fixture Song' },
      { kind: 'artist', artist: 'Invented Duo', title: null },
    ]);
    expect(screen.getByText('Added 1 artist and 1 song you know')).toBeTruthy();
  });

  it('a song with no title is saved as an artist', async () => {
    m(decide.extractScreenshots).mockResolvedValue({
      candidates: [{ kind: 'song', artist: 'Fixture Band', title: null, confidence: 0.8, matched: true, song_key: null }],
    });
    await pickShots();
    expect(await screen.findByText('Fixture Band')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('connect-shot-confirm')));
    await screen.findByTestId('connect-import-result');
    expect(decide.confirmScreenshotItems).toHaveBeenCalledWith([{ kind: 'artist', artist: 'Fixture Band', title: null }]);
  });

  it('a double tap on the picker opens it once', async () => {
    let release!: (v: unknown) => void;
    m(ImagePicker.launchImageLibraryAsync).mockReturnValue(new Promise((r) => (release = r)));
    open();
    const pick = await screen.findByTestId('connect-shot-pick');
    await act(async () => {
      fireEvent.press(pick);
      fireEvent.press(pick);
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    await act(async () => release({ canceled: true, assets: null }));
  });

  it('checked boxes show a check mark', async () => {
    await pickShots();
    await screen.findByTestId('connect-shot-item-0');
    expect(screen.getAllByText('\u2713')).toHaveLength(3);
    await act(async () => fireEvent.press(screen.getByTestId('connect-shot-item-0')));
    expect(screen.getAllByText('\u2713')).toHaveLength(2);
  });

  it('429 shows the daily-limit copy', async () => {
    m(decide.extractScreenshots).mockRejectedValue(new decide.ApiError(429, 'daily_limit'));
    await pickShots();
    expect(await screen.findByText("You've used today's 10 screenshots. Try again tomorrow.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('connect-shot-retry')));
    expect(await screen.findByTestId('connect-shot-pick')).toBeTruthy();
  });

  it('a 503 uses the unavailable copy', async () => {
    m(decide.extractScreenshots).mockRejectedValue(new decide.ApiError(503, 'screenshot_unavailable'));
    await pickShots();
    expect(await screen.findByText(/couldn't reach the service/)).toBeTruthy();
  });

  it('a failed save keeps the picks for another try', async () => {
    m(decide.confirmScreenshotItems).mockRejectedValueOnce(new decide.ApiError(503, 'down'));
    await pickShots();
    const confirm = await screen.findByTestId('connect-shot-confirm');
    await act(async () => fireEvent.press(confirm));
    expect(await screen.findByTestId('connect-shot-error')).toBeTruthy();
    expect(screen.getByTestId('connect-shot-item-1')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('connect-shot-confirm')));
    expect(await screen.findByTestId('connect-import-result')).toBeTruthy();
  });

  it('says so when nothing was found', async () => {
    m(decide.extractScreenshots).mockResolvedValue({ candidates: [] });
    await pickShots();
    expect(await screen.findByTestId('connect-shot-empty')).toBeTruthy();
    expect(decide.confirmScreenshotItems).not.toHaveBeenCalled();
  });
});
