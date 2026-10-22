import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '../auth/store';
import { jobsPoll } from '../jobs/useMyJobs';
import { gen, session } from '../test-utils/genAuthMock';
import { job, jobRoutes } from '../test-utils/jobFixtures';

jest.mock('@nomad/api-decide', () => ({
  ...require('../test-utils/decideDiscoverMock').discoverMocks(),
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({ ...jest.requireActual('@nomad/api-gen'), listMyJobs: jest.fn(), getMe: jest.fn() }));

// renderRouter switches jest to fake timers; waitFor/findBy advance them, and this lets time pass explicitly.
const elapse = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const openTab = () => renderRouter(jobRoutes(), { initialUrl: '/make' });

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  jobsPoll.intervalMs = 30;
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
});

afterAll(() => {
  jobsPoll.intervalMs = 10_000;
});

it('lists needs-you first, then working, done and failed, newest first within each', async () => {
  gen.listMyJobs.mockResolvedValue([
    job({ job_id: 'old-done', status: 'complete' }),
    job({ job_id: 'failed', status: 'failed' }),
    job({ job_id: 'working', status: 'transcribing' }),
    job({ job_id: 'new-done', status: 'complete' }),
    job({ job_id: 'review', status: 'awaiting_review' }),
  ]);
  openTab();
  await screen.findByTestId('job-card-review');
  const order = screen.getAllByTestId(/^job-card-/).map((n) => n.props.testID);
  expect(order).toEqual(['job-card-review', 'job-card-working', 'job-card-new-done', 'job-card-old-done', 'job-card-failed']);
  expect(gen.listMyJobs).toHaveBeenCalledWith('me@example.com');
});

it('polls while a job is unfinished and stops once everything is done', async () => {
  gen.listMyJobs
    .mockResolvedValueOnce([job({ job_id: 'j1', status: 'rendering_video' })])
    .mockResolvedValueOnce([job({ job_id: 'j1', status: 'encoding' })])
    .mockResolvedValue([job({ job_id: 'j1', status: 'complete' })]);
  openTab();
  expect(await screen.findByTestId('job-ready-j1')).toBeTruthy();
  const calls = gen.listMyJobs.mock.calls.length;
  expect(calls).toBe(3);
  await elapse(200);
  expect(gen.listMyJobs).toHaveBeenCalledTimes(calls);
});

it('never polls when every job is finished (done, failed or cancelled)', async () => {
  gen.listMyJobs.mockResolvedValue([
    job({ job_id: 'a', status: 'complete' }),
    job({ job_id: 'b', status: 'failed' }),
    job({ job_id: 'c', status: 'cancelled' }),
  ]);
  openTab();
  await screen.findByTestId('job-card-a');
  await elapse(200);
  expect(gen.listMyJobs).toHaveBeenCalledTimes(1);
});

it('pauses polling in the background and refetches at once on becoming active', async () => {
  // react-native's jest setup mocks AppState.addEventListener; its calls hold the listeners.
  const listeners = () =>
    (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([type]) => type === 'change')
      .map(([, fn]) => fn as (s: AppStateStatus) => void);
  const emit = (s: AppStateStatus) => act(() => listeners().forEach((fn) => fn(s)));
  gen.listMyJobs.mockResolvedValue([job({ job_id: 'j1', status: 'separating_stage1' })]);
  openTab();
  await screen.findByTestId('job-card-j1');
  expect(listeners().length).toBeGreaterThan(0);

  await emit('background');
  const paused = gen.listMyJobs.mock.calls.length;
  await elapse(200);
  expect(gen.listMyJobs).toHaveBeenCalledTimes(paused);

  jobsPoll.intervalMs = 60_000; // only the foreground refetch can fetch now
  await emit('active');
  await waitFor(() => expect(gen.listMyJobs).toHaveBeenCalledTimes(paused + 1));
});

it('empty: "Nothing made yet" with Find a song going to Discover', async () => {
  gen.listMyJobs.mockResolvedValue([]);
  const app = openTab();
  expect(await screen.findByTestId('make-empty')).toHaveTextContent(/Nothing made yet/);
  fireEvent.press(screen.getByTestId('make-find'));
  await waitFor(() => expect(app.getPathname()).toBe('/discover'));
});

it('a load error offers Try again', async () => {
  gen.listMyJobs.mockRejectedValue(new Error('offline'));
  openTab();
  expect(await screen.findByTestId('make-retry', {}, { timeout: 4000 })).toBeTruthy();
  gen.listMyJobs.mockResolvedValue([job({ job_id: 'j1', status: 'complete' })]);
  fireEvent.press(screen.getByTestId('make-retry'));
  expect(await screen.findByTestId('job-card-j1')).toBeTruthy();
});

it('a failed poll keeps the cards and says it could not refresh', async () => {
  gen.listMyJobs
    .mockResolvedValueOnce([job({ job_id: 'j1', status: 'encoding' })])
    .mockRejectedValue(new Error('offline'));
  openTab();
  expect(await screen.findByTestId('job-card-j1')).toBeTruthy();
  expect(await screen.findByTestId('make-refresh-failed', {}, { timeout: 4000 })).toHaveTextContent(/^Couldn't refresh/);
  expect(screen.getByTestId('job-card-j1')).toBeTruthy();
  expect(screen.queryByTestId('make-retry')).toBeNull();
});

it('signed out: the sign-in prompt and no job request', async () => {
  await useAuth.getState().signOut();
  openTab();
  expect(await screen.findByTestId('make-tab-signin')).toBeTruthy();
  expect(gen.listMyJobs).not.toHaveBeenCalled();
});
