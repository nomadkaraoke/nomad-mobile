// Connect -> import a picked privacy export on the phone: parse, preview, queue, result, ListenBrainz (Phase 3b Task 21).
import * as decide from '@nomad/api-decide';
import type { ExportSummary } from '@nomad/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../../auth/store';
import { importQueueIdle, setImportQueueOnline, useImportQueue } from '../../discover/connect/importQueue';
import { NotAnExportError, readExportFile } from '../../discover/connect/readExport';
import { appStorage } from '../../storage';
import { gen, session } from '../../test-utils/genAuthMock';
import { fsState } from '../../test-utils/memoryFs';
import { appRoutes } from '../../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})), openAuthSessionAsync: jest.fn() }));
let mockConnected = true;
jest.mock('@react-native-community/netinfo', () => {
  const actual = jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js');
  return { ...actual, useNetInfo: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) };
});
jest.mock('../../../modules/apple-music-auth', () => ({
  nativeAppleMusicAvailable: () => false,
  requestAppleMusicUserToken: jest.fn(),
}));
jest.mock('../../discover/connect/readExport', () => ({
  ...jest.requireActual('../../discover/connect/readExport'),
  readExportFile: jest.fn(),
}));
jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  configureClient: jest.fn(),
  getServicesSummary: jest.fn(),
  getServiceCapabilities: jest.fn(),
  uploadExportChunk: jest.fn(),
  uploadExportToListenBrainz: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), getMe: jest.fn() }));

const m = (f: unknown) => f as jest.Mock;
const N = Notifications as jest.Mocked<typeof Notifications>;
const MiB = 1024 * 1024;
const FILE = 'file:///cache/my_spotify_data.zip';

const summary = (kind: ExportSummary['kind'], tracks = 3, extra: Partial<ExportSummary> = {}): ExportSummary => ({
  kind,
  generatedAt: '2026-10-01',
  tracks: Array.from({ length: tracks }, (_, i) => ({
    artist: 'Fixture Artist',
    title: `Fixture Song ${i}`,
    ms_played: 120_000,
    plays: 2,
    first_ts: 1_700_000_000,
    last_ts: 1_700_000_100,
  })),
  liked: [],
  playlists: [],
  skipped: { podcasts: 0, short: 0, malformed: 0 },
  truncated: false,
  ...extra,
});
const lbRow = (auth: 'oauth' | 'username') => ({ source: 'listenbrainz', connected: true, auth, status: 'ok' });

/** A picked file of `bytes` in the in-memory file system. */
const putFile = (bytes: number) => fsState.files.set(FILE, new Uint8Array(bytes));
const open = () =>
  renderRouter(appRoutes(), {
    initialUrl: `/discover/connect/import-file?file=${encodeURIComponent(FILE)}&name=my_spotify_data.zip`,
  });
const reads = (s: ExportSummary) =>
  m(readExportFile).mockImplementation(async (_uri: string, o?: { onProgress?: (r: number, t: number) => void }) => {
    o?.onProgress?.(50, 100);
    return s;
  });

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockConnected = true;
  await importQueueIdle();
  fsState.reset();
  appStorage.clearAll();
  setImportQueueOnline(false);
  useImportQueue.getState().rehydrate();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  m(decide.getServicesSummary).mockResolvedValue({ sources: [], capabilities: {} });
  m(decide.getServiceCapabilities).mockResolvedValue({
    screenshot_import: false,
    listenbrainz_oauth: true,
    listenbrainz_upload_max_bytes: 30 * MiB,
  });
  m(decide.uploadExportChunk).mockResolvedValue({
    source: 'spotify_export',
    artists_added: 1,
    songs_added: 3,
    songs_updated: 0,
    tracks_matched: 3,
    duplicate: false,
    chunks_done: 1,
    chunk_count: 1,
  });
  m(decide.uploadExportToListenBrainz).mockResolvedValue({ import_id: 'imp-1', status: 'queued' });
  putFile(1000);
  await act(() => useAuth.getState().signInWithSession(session()));
});

afterEach(async () => {
  setImportQueueOnline(false);
  await importQueueIdle();
});

describe('Import file', () => {
  it('import-file parses, enqueues, shows waiting offline', async () => {
    mockConnected = false;
    reads(summary('spotify-account'));
    open();
    expect(await screen.findByText('3 songs from your Spotify account data')).toBeTruthy();
    expect(readExportFile).toHaveBeenCalledWith(FILE, expect.objectContaining({ signal: expect.anything() }));

    await act(async () => fireEvent.press(screen.getByTestId('connect-import-start')));
    expect(await screen.findByText('Waiting for connection')).toBeTruthy();
    expect(useImportQueue.getState().pending).toHaveLength(1);
    expect(decide.uploadExportChunk).not.toHaveBeenCalled();

    // Back online: the root runner sends it and the result shows.
    await act(async () => setImportQueueOnline(true));
    await act(() => importQueueIdle());
    expect(decide.uploadExportChunk).toHaveBeenCalledTimes(1);
    expect(m(decide.uploadExportChunk).mock.calls[0]![0].body).toMatchObject({ kind: 'account', chunk_index: 0 });
  });

  it('shows the result when the queue drains, and an account import cancels only the 5-day reminder', async () => {
    appStorage.set('connect.spotifyReminders', JSON.stringify({ account: 'rem-a', extended: 'rem-e' }));
    reads(summary('spotify-account'));
    open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-import-start')));
    expect(await screen.findByText('Added 1 artist and 3 songs you know')).toBeTruthy();
    await waitFor(() => expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-a'));
    expect(N.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('rem-e');
  });

  it('extended import cancels both reminders', async () => {
    appStorage.set('connect.spotifyReminders', JSON.stringify({ account: 'rem-a', extended: 'rem-e' }));
    reads(summary('spotify-extended'));
    open();
    expect(await screen.findByText('3 songs from your Spotify streaming history')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('connect-import-start')));
    expect(await screen.findByTestId('connect-import-result')).toBeTruthy();
    await waitFor(() => expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-e'));
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-a');
    expect(appStorage.getString('connect.spotifyReminders')).toBe('{}');
  });

  it('a chunk decide rejects shows the error', async () => {
    m(decide.uploadExportChunk).mockRejectedValue(new decide.ApiError(400, 'bad_chunk'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    reads(summary('spotify-account'));
    open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-import-start')));
    expect(await screen.findByText("This doesn't look like a Spotify or Apple data export.")).toBeTruthy();
    expect(screen.getByTestId('connect-import-result')).toBeTruthy(); // what did land (nothing here)
  });

  it('extended + oauth shows LB checkbox', async () => {
    m(decide.getServicesSummary).mockResolvedValue({ sources: [lbRow('oauth')], capabilities: {} });
    reads(summary('spotify-extended'));
    open();
    const box = await screen.findByTestId('connect-lb-also');
    expect(screen.getByText('Also add it to ListenBrainz so new listens keep flowing')).toBeTruthy();
    expect(box.props.accessibilityState.checked).toBe(false);
    await act(async () => fireEvent.press(box));
    await act(async () => fireEvent.press(screen.getByTestId('connect-import-start')));
    await waitFor(() =>
      expect(decide.uploadExportToListenBrainz).toHaveBeenCalledWith({
        uri: FILE,
        name: 'my_spotify_data.zip',
        type: 'application/zip',
      }),
    );
    expect(await screen.findByTestId('connect-lb-sent')).toBeTruthy();
  });

  it('no LB checkbox for a username-connected LB or an account export', async () => {
    m(decide.getServicesSummary).mockResolvedValue({ sources: [lbRow('username')], capabilities: {} });
    reads(summary('spotify-extended'));
    open();
    await screen.findByTestId('connect-import-start');
    expect(screen.queryByTestId('connect-lb-also')).toBeNull();
    expect(screen.queryByTestId('connect-lb-too-big')).toBeNull();
  });

  it('oversize shows LB link not checkbox', async () => {
    putFile(31 * MiB);
    m(decide.getServicesSummary).mockResolvedValue({ sources: [lbRow('oauth')], capabilities: {} });
    reads(summary('spotify-extended'));
    open();
    const link = await screen.findByTestId('connect-lb-too-big');
    expect(screen.getByText('Too big to send from the app: upload it on listenbrainz.org')).toBeTruthy();
    expect(screen.queryByTestId('connect-lb-also')).toBeNull();
    await act(async () => fireEvent.press(link));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://listenbrainz.org/settings/import/');
  });

  it('an LB import already running says so', async () => {
    m(decide.getServicesSummary).mockResolvedValue({ sources: [lbRow('oauth')], capabilities: {} });
    m(decide.uploadExportToListenBrainz).mockRejectedValue(new decide.ApiError(409, 'import_in_progress'));
    reads(summary('spotify-extended'));
    open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-lb-also')));
    await act(async () => fireEvent.press(screen.getByTestId('connect-import-start')));
    expect(await screen.findByText("ListenBrainz is already importing a file for you. Try again once it's done.")).toBeTruthy();
    expect(decide.uploadExportToListenBrainz).toHaveBeenCalledTimes(1); // a 409 is final
  });

  it('not an export copy', async () => {
    m(readExportFile).mockRejectedValue(new NotAnExportError());
    open();
    expect(await screen.findByText("This doesn't look like a Spotify or Apple data export.")).toBeTruthy();
    expect(screen.getByTestId('connect-import-pick')).toBeTruthy();
    expect(screen.queryByTestId('connect-import-start')).toBeNull();
  });

  it('shows skipped counts instead of an empty success, and flags an incomplete file', async () => {
    reads(summary('spotify-account', 0, { skipped: { podcasts: 4, short: 7, malformed: 1 }, truncated: true }));
    open();
    expect(await screen.findByTestId('connect-import-skipped')).toBeTruthy();
    expect(screen.getByText("We didn't find any songs to add in this file.")).toBeTruthy();
    expect(screen.getByText('4 podcast, audiobook or video plays')).toBeTruthy();
    expect(screen.getByText('7 plays under 30 seconds')).toBeTruthy();
    expect(screen.getByText('1 unreadable entry')).toBeTruthy();
    expect(screen.getByTestId('connect-import-truncated')).toBeTruthy();
    expect(screen.queryByTestId('connect-import-start')).toBeNull();
    expect(screen.queryByTestId('connect-import-result')).toBeNull();
  });

  it('lists only the non-zero skipped kinds', async () => {
    reads(summary('spotify-account', 0, { skipped: { podcasts: 0, short: 1, malformed: 0 } }));
    open();
    expect(await screen.findByText('1 play under 30 seconds')).toBeTruthy();
    expect(screen.queryByText(/podcast/)).toBeNull();
    expect(screen.queryByText(/unreadable/)).toBeNull();
  });

  it('a library-only export (no plays) can still be added, with its liked songs and playlists in the preview', async () => {
    const ref = { artist: 'Fixture Artist', title: 'Fixture Song' };
    reads(summary('spotify-account', 0, { liked: [ref, { ...ref, title: 'Fixture Song 2' }], playlists: [{ name: 'Mix', tracks: [ref] }] }));
    open();
    expect(await screen.findByText('Plus 2 liked songs and 1 playlist')).toBeTruthy();
    expect(screen.queryByText("We didn't find any songs to add in this file.")).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('connect-import-start')));
    expect(await screen.findByTestId('connect-import-result')).toBeTruthy();
    expect(m(decide.uploadExportChunk).mock.calls[0]![0].body.liked).toHaveLength(2);
  });

  it('signed out at enqueue: no result, no reminder cancelled, the button stays', async () => {
    appStorage.set('connect.spotifyReminders', JSON.stringify({ account: 'rem-a' }));
    const real = useImportQueue.getState().enqueue;
    useImportQueue.setState({ enqueue: () => null });
    try {
      reads(summary('spotify-account'));
      open();
      await act(async () => fireEvent.press(await screen.findByTestId('connect-import-start')));
      expect(await screen.findByTestId('connect-import-error')).toBeTruthy();
      expect(screen.queryByTestId('connect-import-result')).toBeNull();
      expect(screen.getByTestId('connect-import-start')).toBeTruthy();
      expect(N.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    } finally {
      useImportQueue.setState({ enqueue: real });
    }
  });

  it('cancels the reminders as soon as the import is queued (even offline)', async () => {
    mockConnected = false;
    appStorage.set('connect.spotifyReminders', JSON.stringify({ account: 'rem-a', extended: 'rem-e' }));
    reads(summary('spotify-extended'));
    open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-import-start')));
    expect(await screen.findByText('Waiting for connection')).toBeTruthy();
    await waitFor(() => expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-e'));
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-a');
  });

  it('deletes the picked cache copy once queued (no ListenBrainz)', async () => {
    mockConnected = false;
    reads(summary('spotify-account'));
    open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-import-start')));
    await waitFor(() => expect(fsState.files.has(FILE)).toBe(false));
  });

  it('keeps the cache copy until the ListenBrainz upload is done', async () => {
    m(decide.getServicesSummary).mockResolvedValue({ sources: [lbRow('oauth')], capabilities: {} });
    let finish!: (v: unknown) => void;
    m(decide.uploadExportToListenBrainz).mockReturnValue(new Promise((r) => (finish = r)));
    reads(summary('spotify-extended'));
    open();
    await act(async () => fireEvent.press(await screen.findByTestId('connect-lb-also')));
    await act(async () => fireEvent.press(screen.getByTestId('connect-import-start')));
    await waitFor(() => expect(decide.uploadExportToListenBrainz).toHaveBeenCalled());
    expect(fsState.files.has(FILE)).toBe(true);
    await act(async () => finish({ import_id: 'imp-1', status: 'queued' }));
    await waitFor(() => expect(fsState.files.has(FILE)).toBe(false));
  });

  it('never deletes a file outside the cache', async () => {
    const shared = 'file:///document/shared/export.zip';
    fsState.files.set(shared, new Uint8Array(10));
    reads(summary('spotify-account'));
    renderRouter(appRoutes(), { initialUrl: `/discover/connect/import-file?file=${encodeURIComponent(shared)}&name=export.zip` });
    await act(async () => fireEvent.press(await screen.findByTestId('connect-import-start')));
    expect(await screen.findByTestId('connect-import-result')).toBeTruthy();
    expect(fsState.files.has(shared)).toBe(true);
  });
});
