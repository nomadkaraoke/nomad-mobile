import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { GEN_WEB_URL } from '../config';
import { jobsPoll } from '../jobs/useMyJobs';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { job, jobRoutes } from '../test-utils/jobFixtures';

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
  retryJob: jest.fn(),
  createHandoffUrl: jest.fn(),
  getJob: jest.fn(),
  getMe: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(), openAuthSessionAsync: jest.fn() }));

const browser = WebBrowser as jest.Mocked<typeof WebBrowser>;
// The module is mocked, so its WebBrowserResultType enum isn't available at runtime.
const CLOSED = { type: 'cancel' } as WebBrowser.WebBrowserResult;
const openTab = () => renderRouter(jobRoutes(), { initialUrl: '/make' });
const show = (...jobs: ReturnType<typeof job>[]) => gen.listMyJobs.mockResolvedValue(jobs);

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  jobsPoll.intervalMs = 60_000; // these tests count fetches themselves
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  browser.openBrowserAsync.mockResolvedValue(CLOSED);
});

afterAll(() => {
  jobsPoll.intervalMs = 10_000;
});

it('working: progress bar and five steps, done before the current stage and pending after', async () => {
  show(job({ job_id: 'w', status: 'some_new_gen_status', progress: 0 }), job({ job_id: 'j', status: 'generating_screens', progress: 45 }));
  openTab();
  expect(await screen.findByTestId('job-progress-j')).toBeTruthy();
  expect(screen.getByTestId('job-progress-j').props.accessibilityValue).toMatchObject({ now: 45 });
  // generating_screens is stage 3 ("Syncing lyrics"), as in the mockup.
  const state = (n: number) => screen.getByTestId(`job-step-j-${n}`).props.accessibilityState;
  expect(state(1)).toEqual({ checked: true, selected: false });
  expect(state(2)).toEqual({ checked: true, selected: false });
  expect(state(3)).toEqual({ checked: false, selected: true });
  expect(state(4)).toEqual({ checked: false, selected: false });
  expect(state(5)).toEqual({ checked: false, selected: false });
  expect(screen.getByTestId('job-step-j-1')).toHaveTextContent('Got the audio');
  expect(screen.getByTestId('job-step-j-5')).toHaveTextContent('Posting to YouTube');
  expect(screen.queryByTestId('job-slow-j')).toBeNull();
  // An unknown status is still "working" and starts with every step pending.
  expect(screen.getByTestId('job-step-w-1').props.accessibilityState).toEqual({ checked: false, selected: false });
});

it('working: a job parked on capacity shows the slow line, not an error', async () => {
  show(job({ job_id: 'j', status: 'render_pending_capacity', progress: 70 }));
  openTab();
  expect(await screen.findByTestId('job-slow-j')).toHaveTextContent("Still working, this one's taking a little longer");
});

it('working: a download waiting to retry shows the slow line too', async () => {
  show(job({ job_id: 'j', status: 'download_pending_retry', progress: 12 }));
  openTab();
  expect(await screen.findByTestId('job-slow-j')).toHaveTextContent("Still working, this one's taking a little longer");
});

it('review: Needs you, then Review lyrics opens the native review (no web handoff)', async () => {
  show(job({ job_id: 'r', status: 'awaiting_review' }));
  const app = openTab();
  expect(await screen.findByTestId('job-needs-you-r')).toHaveTextContent('Needs you');
  expect(screen.getByText("Check the lyrics before it's finished")).toBeTruthy();
  fireEvent.press(screen.getByTestId('job-review-r'));
  expect(await screen.findByTestId('review-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/review/r');
  expect(gen.createHandoffUrl).not.toHaveBeenCalled();
  expect(browser.openBrowserAsync).not.toHaveBeenCalled();
});

it('review: an in_review job opens the native review too', async () => {
  show(job({ job_id: 'r', status: 'in_review' }));
  const app = openTab();
  fireEvent.press(await screen.findByTestId('job-review-r'));
  await waitFor(() => expect(app.getPathname()).toBe('/review/r'));
});

it('duration: Needs you and Confirm cost opens the duration sheet', async () => {
  show(job({ job_id: 'd', status: 'awaiting_duration_confirm' }));
  gen.getJob.mockReturnValue(new Promise(() => {}));
  const app = openTab();
  expect(await screen.findByTestId('job-needs-you-d')).toBeTruthy();
  fireEvent.press(screen.getByTestId('job-confirm-d'));
  await waitFor(() => expect(app.getPathname()).toBe('/job/duration/d'));
  expect(await screen.findByTestId('duration-sheet')).toBeTruthy();
});

it('other needs-you statuses: Finish this on the website, through the same handoff', async () => {
  show(job({ job_id: 'e', status: 'awaiting_audio_edit' }));
  gen.createHandoffUrl.mockRejectedValue(apiError(409, 'not_in_review'));
  openTab();
  expect(await screen.findByTestId('job-needs-you-e')).toBeTruthy();
  const button = screen.getByTestId('job-web-e');
  expect(button).toHaveTextContent('Finish this on the website');
  await act(async () => fireEvent.press(button));
  expect(gen.createHandoffUrl).toHaveBeenCalledWith('e', 'en');
  expect(browser.openBrowserAsync).toHaveBeenCalledWith(`${GEN_WEB_URL}/app`);
});

it('web handoff: any failure other than a 409 says so and opens nothing', async () => {
  show(job({ job_id: 'e', status: 'awaiting_audio_edit' }));
  gen.createHandoffUrl.mockRejectedValue(apiError(500, 'boom'));
  openTab();
  await act(async () => fireEvent.press(await screen.findByTestId('job-web-e')));
  expect(await screen.findByTestId('job-web-e-error')).toHaveTextContent("Couldn't open the website. Try again.");
  expect(browser.openBrowserAsync).not.toHaveBeenCalled();
});

it('failed: the message, collapsible details, and Try again calls retry then refetches', async () => {
  show(job({ job_id: 'f', status: 'failed', error_message: 'Separation worker crashed' }));
  gen.retryJob.mockResolvedValue(undefined);
  openTab();
  expect(await screen.findByText('Something went wrong making this one.')).toBeTruthy();
  expect(screen.queryByTestId('job-error-text-f')).toBeNull();
  fireEvent.press(screen.getByTestId('job-error-f'));
  expect(screen.getByTestId('job-error-text-f')).toHaveTextContent('Separation worker crashed');
  fireEvent.press(screen.getByTestId('job-error-f'));
  expect(screen.queryByTestId('job-error-text-f')).toBeNull();

  const fetched = gen.listMyJobs.mock.calls.length;
  await act(async () => fireEvent.press(screen.getByTestId('job-retry-f')));
  expect(gen.retryJob).toHaveBeenCalledWith('f');
  expect(gen.retryJob.mock.calls[0]).toHaveLength(1); // a plain retry, not keep-trying
  await waitFor(() => expect(gen.listMyJobs).toHaveBeenCalledTimes(fetched + 1));
});

it('stalled download: a plain notice with Keep trying (an hour) and the website, not the raw error', async () => {
  show(
    job({
      job_id: 's',
      status: 'failed',
      error_message: 'Torrent stalled: no peers after 20 minutes',
      error_details: { code: 'audio_download_stalled', stall_minutes: 20 },
    }),
  );
  gen.retryJob.mockResolvedValue(undefined);
  gen.createHandoffUrl.mockRejectedValue(apiError(409, 'not_in_review'));
  openTab();
  expect(await screen.findByTestId('job-stalled-s')).toHaveTextContent(/^We're still trying to reach the audio source/);
  expect(screen.queryByText('Something went wrong making this one.')).toBeNull();
  expect(screen.queryByTestId('job-error-s')).toBeNull();
  expect(screen.queryByTestId('job-retry-s')).toBeNull();

  const fetched = gen.listMyJobs.mock.calls.length;
  await act(async () => fireEvent.press(screen.getByTestId('job-keep-trying-s')));
  expect(gen.retryJob).toHaveBeenCalledWith('s', { keepTrying: true });
  await waitFor(() => expect(gen.listMyJobs).toHaveBeenCalledTimes(fetched + 1));

  // Choosing different audio happens on the website (gen 409s the review handoff for a failed job).
  await act(async () => fireEvent.press(screen.getByTestId('job-web-s')));
  expect(gen.createHandoffUrl).toHaveBeenCalledWith('s', 'en');
  expect(browser.openBrowserAsync).toHaveBeenCalledWith(`${GEN_WEB_URL}/app`);
});

it('stalled download already extended: says the source is still offline', async () => {
  show(job({ job_id: 's', status: 'failed', error_details: { code: 'audio_download_stalled', keep_trying: true } }));
  openTab();
  expect(await screen.findByTestId('job-stalled-s')).toHaveTextContent(/still offline/);
});

it('failed: a retry error is shown on the card', async () => {
  show(job({ job_id: 'f', status: 'failed' }));
  gen.retryJob.mockRejectedValue(apiError(400, 'not retryable'));
  openTab();
  await act(async () => fireEvent.press(await screen.findByTestId('job-retry-f')));
  expect(await screen.findByTestId('job-retry-error-f')).toBeTruthy();
});

it('failed: says the credit was refunded only when credit_refunded is set', async () => {
  show(
    job({ job_id: 'paid', status: 'failed', credit_refunded: true }),
    job({ job_id: 'kept', status: 'error', credit_refunded: false }),
    job({ job_id: 'unknown', status: 'failed' }),
  );
  openTab();
  expect(await screen.findByTestId('job-refunded-paid')).toHaveTextContent('Your credit was refunded');
  expect(screen.queryByTestId('job-refunded-kept')).toBeNull();
  expect(screen.queryByTestId('job-refunded-unknown')).toBeNull();
  expect(screen.getByTestId('job-retry-kept')).toBeTruthy();
});

it('cancelled: a muted card with no actions', async () => {
  show(job({ job_id: 'c', status: 'cancelled' }));
  openTab();
  expect(await screen.findByTestId('job-cancelled-c')).toHaveTextContent('Cancelled');
  expect(screen.queryByTestId('job-retry-c')).toBeNull();
  expect(screen.queryByText('Something went wrong making this one.')).toBeNull();
});

it('done: Ready, and a tap opens the job', async () => {
  show(job({ job_id: 'ok', status: 'complete', title: 'Mr. Brightside', artist: 'The Killers' }));
  const app = openTab();
  expect(await screen.findByTestId('job-ready-ok')).toHaveTextContent('Ready');
  expect(screen.getByText('The Killers')).toBeTruthy();
  fireEvent.press(screen.getByTestId('job-card-ok'));
  expect(await screen.findByTestId('job-ready-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/job/ok');
});

it('done with a YouTube link: the video thumbnail sits beside the title; without one, no thumbnail', async () => {
  show(
    job({ job_id: 'yt', status: 'complete', state_data: { youtube_url: 'https://youtu.be/dQw4w9WgXcQ' } }),
    job({ job_id: 'np', status: 'complete', title: 'Private Song' }),
  );
  openTab();
  const thumb = await screen.findByTestId('job-thumb-yt', { includeHiddenElements: true });
  expect(thumb.props.source).toEqual({ uri: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
  expect(screen.getByTestId('job-ready-np')).toBeTruthy();
  expect(screen.queryByTestId('job-thumb-np', { includeHiddenElements: true })).toBeNull();
});
