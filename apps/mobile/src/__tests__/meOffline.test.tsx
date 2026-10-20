// Me's offline song list controls (spec §7.1): download (with its size), progress, updated date, remove, retry.
import * as decide from '@nomad/api-decide';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { appRoutes } from '../test-utils/routes';

jest.mock('@nomad/api-decide', () => ({
  getOfflineIndexManifest: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
}));

type MockOffline = {
  status: 'none' | 'downloading' | 'ready' | 'error';
  downloadedAt: number | null;
  bytes: number | null;
  progress: number | null;
  download: jest.Mock;
  remove: jest.Mock;
};
let mockOffline: MockOffline;
jest.mock('../offline/offlineIndex', () => ({
  useOfflineIndex: () => mockOffline,
  openOfflineReader: () => null,
  maybeRefreshOfflineIndex: async () => {},
}));

const manifest = decide.getOfflineIndexManifest as jest.Mock;
const DAY = 24 * 60 * 60 * 1000;

const offline = (p: Partial<MockOffline> = {}): MockOffline => ({
  status: 'none',
  downloadedAt: null,
  bytes: null,
  progress: null,
  download: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
  ...p,
});

beforeEach(() => {
  jest.useRealTimers();
  manifest.mockReset();
  manifest.mockResolvedValue({ run: 'r1', schema: 1, normalizer: 3, url: 'https://x/offline.db.gz', bytes: 48_300_000, sha256: 'abc' });
  mockOffline = offline();
});

/** Remove asks first: taps the Alert's button labelled `label`. */
const answerAlert = (alert: jest.SpyInstance, label: string) => {
  const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as AlertButton[];
  buttons.find((b) => b.text === label)!.onPress?.();
};

/** Matches the text as rendered (the default normalizer turns a non-breaking space into a plain one). */
const RAW_TEXT = { normalizer: (text: string) => text };

const renderMe = async () => {
  renderRouter(appRoutes(), { initialUrl: '/me' });
  return screen.findByTestId('me-offline');
};

it('no list: Download shows the size from the manifest and calls download()', async () => {
  await renderMe();
  expect(await screen.findByText('Download song list for offline use (48\u00a0MB)')).toBeTruthy();
  expect(manifest).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('me-offline-download'));
  expect(mockOffline.download).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('me-offline-remove')).toBeNull();
});

it('no list and the manifest cannot be fetched: Download is still offered, without a size', async () => {
  manifest.mockRejectedValue(new Error('offline'));
  await renderMe();
  expect(await screen.findByText('Download song list for offline use')).toBeTruthy();
  fireEvent.press(screen.getByTestId('me-offline-download'));
  expect(mockOffline.download).toHaveBeenCalled();
});

it('downloading: shows the progress', async () => {
  mockOffline = offline({ status: 'downloading', progress: 0.42 });
  await renderMe();
  expect(screen.getByTestId('me-offline-progress')).toHaveTextContent('Downloading the song list… 42%');
  expect(screen.queryByTestId('me-offline-download')).toBeNull();
});

it('ready: the size and updated date render, and Remove calls remove(); the manifest is not fetched', async () => {
  mockOffline = offline({ status: 'ready', bytes: 131_500_000, downloadedAt: Date.now() - 3 * DAY - 1000 });
  await renderMe();
  expect(screen.getByTestId('me-offline-size')).toHaveTextContent('Song list saved on this phone (132\u00a0MB)', RAW_TEXT);
  expect(screen.getByTestId('me-offline-updated')).toHaveTextContent('Song list updated 3 days ago');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  fireEvent.press(screen.getByTestId('me-offline-remove'));
  expect(alert).toHaveBeenCalledWith('Remove the offline song list?', expect.any(String), expect.any(Array));
  // Cancel keeps it; Remove removes it.
  answerAlert(alert, 'Cancel');
  expect(mockOffline.remove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('me-offline-remove'));
  answerAlert(alert, 'Remove');
  expect(mockOffline.remove).toHaveBeenCalledTimes(1);
  alert.mockRestore();
  expect(screen.queryByTestId('me-offline-download')).toBeNull();
  expect(manifest).not.toHaveBeenCalled();
});

it('ready today: "updated today"; a small list shows one decimal', async () => {
  mockOffline = offline({ status: 'ready', bytes: 2_340_000, downloadedAt: Date.now() });
  await renderMe();
  expect(screen.getByTestId('me-offline-updated')).toHaveTextContent('Song list updated today');
  // A non-breaking space keeps "2.3 MB" together when the line wraps.
  expect(screen.getByTestId('me-offline-size')).toHaveTextContent(/\(2\.3\u00a0MB\)$/, RAW_TEXT);
});

it('error with no earlier list: says so, Try again calls download(); the manifest is not fetched', async () => {
  mockOffline = offline({ status: 'error' });
  await renderMe();
  expect(manifest).not.toHaveBeenCalled();
  expect(screen.getByTestId('me-offline-error')).toHaveTextContent("Couldn't download the song list.");
  fireEvent.press(screen.getByTestId('me-offline-retry'));
  expect(mockOffline.download).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('me-offline-remove')).toBeNull();
});

it('error with the earlier list kept: still shows it and Remove, plus the retry', async () => {
  mockOffline = offline({ status: 'error', bytes: 50_000_000, downloadedAt: Date.now() - DAY });
  await renderMe();
  expect(screen.getByTestId('me-offline-updated')).toHaveTextContent('Song list updated 1 day ago');
  expect(screen.getByTestId('me-offline-error')).toBeTruthy();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  fireEvent.press(screen.getByTestId('me-offline-remove'));
  answerAlert(alert, 'Remove');
  expect(mockOffline.remove).toHaveBeenCalled();
  alert.mockRestore();
});

it('refreshing a list already on the phone: its size and date stay, with the progress and no Remove', async () => {
  mockOffline = offline({ status: 'downloading', progress: 0.5, bytes: 50_000_000, downloadedAt: Date.now() - 8 * DAY });
  await renderMe();
  expect(screen.getByTestId('me-offline-size')).toHaveTextContent('Song list saved on this phone (50\u00a0MB)');
  expect(screen.getByTestId('me-offline-updated')).toHaveTextContent('Song list updated 8 days ago');
  expect(screen.getByTestId('me-offline-progress')).toHaveTextContent('Downloading the song list… 50%');
  expect(screen.queryByTestId('me-offline-remove')).toBeNull();
  expect(screen.queryByTestId('me-offline-download')).toBeNull();
  expect(manifest).not.toHaveBeenCalled();
});
