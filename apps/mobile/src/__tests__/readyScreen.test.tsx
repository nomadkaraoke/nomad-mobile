import type { JobDetail } from '@nomad/api-gen';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useVideoPlayer } from 'expo-video';
import { Linking, Platform, Share, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth/store';
import { copiedToast } from '../jobs/readyUi';
import { jobsPoll } from '../jobs/useMyJobs';
import { appRoutes } from '../test-utils/routes';
import { gen, session } from '../test-utils/genAuthMock';
import { job } from '../test-utils/jobFixtures';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  listMyJobs: jest.fn(),
  getJob: jest.fn(),
  getMe: jest.fn(),
}));

const download = File.downloadFileAsync as jest.Mock;
const requestPermissions = requestPermissionsAsync as jest.Mock;
const createAsset = Asset.create as jest.Mock;

const LONG_TITLE = 'A Very Long Song Title That Goes On And On Well Past Any Phone Width (Extended Remix)';

const ready = (over: Partial<JobDetail> = {}): JobDetail =>
  job({
    job_id: 'r1',
    status: 'complete',
    progress: 100,
    state_data: { youtube_url: 'https://youtu.be/dQw4w9WgXcQ', brand_code: 'NOMAD-1234' },
    ...over,
  } as never) as JobDetail;

const open = (detail: JobDetail = ready()) => {
  gen.getJob.mockResolvedValue(detail);
  return renderRouter(appRoutes(), { initialUrl: '/job/r1' });
};

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  jobsPoll.intervalMs = 60_000;
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([]);
  download.mockImplementation(async (_url: string, dest: { uri: string }) => dest);
  requestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
  createAsset.mockResolvedValue({ id: 'asset-1' });
});

afterAll(() => {
  jobsPoll.intervalMs = 10_000;
});

it('with a YouTube URL shows the block (thumbnail, title, youtu.be link) and no player', async () => {
  open();
  expect(await screen.findByTestId('ready-youtube')).toBeTruthy();
  expect(screen.getByTestId('ready-youtube-thumbnail').props.source).toEqual({
    uri: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  });
  expect(screen.getByTestId('ready-youtube-title')).toHaveTextContent('Muse - Starlight (Karaoke)');
  expect(screen.getByTestId('ready-youtube-link')).toHaveTextContent('youtu.be/dQw4w9WgXcQ');
  expect(screen.queryByTestId('ready-player')).toBeNull();
  expect(screen.getByTestId('ready-download')).toBeTruthy();
  expect(gen.getJob).toHaveBeenCalledWith('r1');
});

it('tapping the thumbnail or title opens YouTube', async () => {
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-youtube-open')));
  expect(openUrl).toHaveBeenCalledWith('youtube://dQw4w9WgXcQ');
});

it('a long title wraps to 2 lines and the link shrinks rather than overflowing (Review Focus 5)', async () => {
  open(ready({ title: LONG_TITLE }));
  const title = await screen.findByTestId('ready-youtube-title');
  // Over 95 characters, so cut like gen's YouTube title.
  expect(title).toHaveTextContent(`Muse - ${LONG_TITLE} (Karaoke)`.slice(0, 92) + ' ...');
  expect(title.props.numberOfLines).toBe(2);
  const link = screen.getByTestId('ready-youtube-link');
  expect(link.props.selectable).toBe(true);
  expect(StyleSheet.flatten(link.props.style)).toEqual(expect.objectContaining({ flexShrink: 1 }));
});

it('Copy link puts the youtu.be URL on the clipboard and says Copied', async () => {
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-copy')));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
  expect(screen.getByTestId('ready-copied')).toHaveTextContent('Copied');
});

it('Share opens the native share sheet with the link', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-share')));
  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://youtu.be/dQw4w9WgXcQ', message: expect.stringContaining('Muse - Starlight') }),
  );
});

it('without a YouTube URL plays the signed 720p MP4 in the app, and still offers Download', async () => {
  open(ready({ state_data: undefined, download_urls: { lossy_720p_mp4: 'https://gcs/signed.mp4' } }));
  expect(await screen.findByTestId('ready-player')).toBeTruthy();
  expect(screen.queryByTestId('ready-youtube')).toBeNull();
  // Streams the signed URL directly: nothing is pre-downloaded.
  expect(useVideoPlayer).toHaveBeenLastCalledWith('https://gcs/signed.mp4');
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByTestId('ready-download')).toBeTruthy();
});

it('without a YouTube URL or a signed URL, Play fetches the MP4 to the cache and plays it', async () => {
  open(ready({ state_data: undefined }));
  await act(async () => fireEvent.press(await screen.findByTestId('ready-play')));
  expect(await screen.findByTestId('ready-player')).toBeTruthy();
  expect(useVideoPlayer).toHaveBeenLastCalledWith('file:///cache/nomad-r1-720p.mp4');
  // Download then saves the file already fetched.
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-saved')).toBeTruthy();
  expect(download).toHaveBeenCalledTimes(1);
});

it('Download MP4 saves to Photos', async () => {
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-saved')).toHaveTextContent('Saved to Photos');
  expect(requestPermissions).toHaveBeenCalledWith(true);
  expect(createAsset).toHaveBeenCalledWith('file:///cache/nomad-r1-720p.mp4');
});

it('shows download progress while the file arrives', async () => {
  let finish!: () => void;
  download.mockImplementation(
    (_url, dest, opts) =>
      new Promise((resolve) => {
        opts.onProgress({ bytesWritten: 40, totalBytes: 100 });
        finish = () => resolve(dest);
      }),
  );
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-progress')).toHaveTextContent('Downloading… 40%');
  await act(async () => finish());
  expect(await screen.findByTestId('ready-saved')).toBeTruthy();
});

it('permission denied explains and offers Open settings', async () => {
  requestPermissions.mockResolvedValue({ granted: false, status: 'denied' });
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-denied')).toBeTruthy();
  expect(createAsset).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByTestId('ready-open-settings')));
  expect(settings).toHaveBeenCalled();
});

it('an archived video (410 output_archived) says so', async () => {
  download.mockRejectedValue(new Error('Unable to download a file: response has status 410'));
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-archived')).toHaveTextContent(
    'This video has been archived. Ask for it to be re-made from the website.',
  );
});

it('a failed download says so and can be tried again', async () => {
  download.mockRejectedValueOnce(new Error('Unable to download a file: response has status 500'));
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-download-failed')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-saved')).toBeTruthy();
});

it('opens from a finished job card on the Make tab', async () => {
  gen.listMyJobs.mockResolvedValue([ready()]);
  gen.getJob.mockResolvedValue(ready());
  const app = renderRouter(appRoutes(), { initialUrl: '/make' });
  await act(async () => fireEvent.press(await screen.findByTestId('job-card-r1')));
  expect(await screen.findByTestId('ready-youtube')).toBeTruthy();
  expect(app.getPathname()).toBe('/job/r1');
  // The duration sheet route next to it still resolves.
  act(() => router.push('/job/duration/r1'));
  await waitFor(() => expect(app.getPathname()).toBe('/job/duration/r1'));
});

it('Copy again restarts the Copied timer', async () => {
  open();
  await screen.findByTestId('ready-youtube');
  // renderRouter runs on fake timers.
  const elapse = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
  await act(async () => fireEvent.press(screen.getByTestId('ready-copy')));
  await elapse(copiedToast.ms - 500);
  await act(async () => fireEvent.press(screen.getByTestId('ready-copy')));
  await elapse(1000);
  // Past the first tap's 2s, within the second's: still showing.
  expect(screen.getByTestId('ready-copied')).toBeTruthy();
  await elapse(copiedToast.ms);
  expect(screen.queryByTestId('ready-copied')).toBeNull();
});

it('a progress event arriving after the save does not bring the progress line back', async () => {
  let late!: () => void;
  download.mockImplementation(async (_url, dest, opts) => {
    late = () => opts.onProgress({ bytesWritten: 100, totalBytes: 100 });
    return dest;
  });
  open();
  await screen.findByTestId('ready-youtube');
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-saved')).toBeTruthy();
  act(() => late());
  expect(screen.getByTestId('ready-saved')).toBeTruthy();
  expect(screen.queryByTestId('ready-progress')).toBeNull();
});

it('on Android says Saved to your gallery', async () => {
  const os = Platform.OS;
  Platform.OS = 'android';
  try {
    open();
    await screen.findByTestId('ready-youtube');
    await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
    expect(await screen.findByTestId('ready-saved')).toHaveTextContent('Saved to your gallery');
  } finally {
    Platform.OS = os;
  }
});

it("the player's cached MP4 is kept for Download and deleted when the screen goes away", async () => {
  let fetched!: { delete: jest.Mock };
  download.mockImplementation(async (_url, dest) => (fetched = dest));
  const app = open(ready({ state_data: undefined }));
  await act(async () => fireEvent.press(await screen.findByTestId('ready-play')));
  await act(async () => fireEvent.press(screen.getByTestId('ready-download')));
  expect(await screen.findByTestId('ready-saved')).toBeTruthy();
  expect(fetched.delete).not.toHaveBeenCalled();
  app.unmount();
  expect(fetched.delete).toHaveBeenCalledTimes(1);
});

it('a job that is not finished says so', async () => {
  open(ready({ status: 'rendering_video' }));
  expect(await screen.findByTestId('ready-not-ready')).toBeTruthy();
  expect(screen.queryByTestId('ready-download')).toBeNull();
});

it('a job waiting for review offers Review lyrics, which opens the native review', async () => {
  gen.getJob.mockResolvedValue(ready({ status: 'awaiting_review' }));
  const app = renderRouter({ ...appRoutes(), 'review/[id]': () => <View testID="review-stub" /> }, { initialUrl: '/job/r1' });
  fireEvent.press(await screen.findByTestId('ready-review'));
  expect(await screen.findByTestId('review-stub')).toBeTruthy();
  await waitFor(() => expect(app.getPathname()).toBe('/review/r1'));
  expect(screen.queryByTestId('ready-not-ready')).toBeNull();
});

it('a failed load offers Try again', async () => {
  // The app's QueryClient retries once before giving up.
  gen.getJob
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(ready());
  renderRouter(appRoutes(), { initialUrl: '/job/r1' });
  await act(async () => fireEvent.press(await screen.findByTestId('ready-reload', {}, { timeout: 5000 })));
  expect(await screen.findByTestId('ready-youtube')).toBeTruthy();
});

it('a no-YouTube job from the Make tab shows a spinner, not Play, until the full job (with a signed URL) loads', async () => {
  const listed = ready({ state_data: undefined });
  gen.listMyJobs.mockResolvedValue([listed]);
  let resolve!: (j: JobDetail) => void;
  gen.getJob.mockImplementation(() => new Promise((r) => (resolve = r)));
  renderRouter(appRoutes(), { initialUrl: '/make' });
  await act(async () => fireEvent.press(await screen.findByTestId('job-card-r1')));
  expect(await screen.findByTestId('ready-loading')).toBeTruthy();
  expect(screen.queryByTestId('ready-play')).toBeNull();
  await act(async () => resolve({ ...listed, download_urls: { lossy_720p_mp4: 'https://gcs/signed.mp4' } }));
  expect(await screen.findByTestId('ready-player')).toBeTruthy();
});
