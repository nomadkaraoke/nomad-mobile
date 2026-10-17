import type { JobDetail } from '@nomad/api-gen';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { jobsPoll } from '../jobs/useMyJobs';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { job, jobRoutes } from '../test-utils/jobFixtures';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  listMyJobs: jest.fn(),
  getJob: jest.fn(),
  confirmDuration: jest.fn(),
  cancelJob: jest.fn(),
  getMe: jest.fn(),
}));

// 14:32 long, 1 credit already charged, 1 more to confirm.
const LONG = job({
  job_id: 'd1',
  status: 'awaiting_duration_confirm',
  state_data: { credits_charged: 1, pending_additional_credits: 1, duration_actual_seconds: 872 },
});

/** Opens the Make tab, then the sheet over it (as Confirm cost does), so there is history to go back to. */
const openSheet = async () => {
  const app = renderRouter(jobRoutes(), { initialUrl: '/make' });
  await screen.findByTestId('job-confirm-d1');
  act(() => router.push('/job/duration/d1'));
  expect(await screen.findByTestId('duration-body')).toBeTruthy();
  return app;
};

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  jobsPoll.intervalMs = 60_000;
  await useAuth.getState().signInWithSession(session());
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 1 });
  gen.listMyJobs.mockResolvedValue([LONG]);
  gen.getJob.mockResolvedValue(LONG as JobDetail);
  gen.confirmDuration.mockResolvedValue(undefined);
  gen.cancelJob.mockResolvedValue(undefined);
});

afterAll(() => {
  jobsPoll.intervalMs = 10_000;
});

it('says how long the track is and what it costs in total, and that a cancel refunds what was charged', async () => {
  await openSheet();
  expect(screen.getByTestId('duration-body')).toHaveTextContent(
    'This track is 14:32 long, so it costs 2 credits in total (1 more).',
  );
  expect(screen.getByTestId('duration-refund-note')).toHaveTextContent(
    'If you cancel, any credits charged for this video are refunded.',
  );
  expect(gen.getJob).toHaveBeenCalledWith('d1');
});

it('Confirm acknowledges the full total (credits_charged + pending), then returns to the Make tab', async () => {
  const app = await openSheet();
  const fetched = gen.listMyJobs.mock.calls.length;
  await act(async () => fireEvent.press(screen.getByTestId('duration-confirm')));
  expect(gen.confirmDuration).toHaveBeenCalledWith('d1', 2);
  await waitFor(() => expect(app.getPathname()).toBe('/make'));
  await waitFor(() => expect(gen.listMyJobs.mock.calls.length).toBeGreaterThan(fetched));
});

it('Confirm without enough credits (402) goes to credits, returning to this sheet', async () => {
  gen.confirmDuration.mockRejectedValue(apiError(402, 'insufficient_credits'));
  const app = await openSheet();
  await act(async () => fireEvent.press(screen.getByTestId('duration-confirm')));
  expect(await screen.findByTestId('credits-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/credits');
  expect(app.getSearchParams()).toMatchObject({ returnTo: '/job/duration/d1' });
});

it('Cancel this video cancels the job and returns to the Make tab', async () => {
  const app = await openSheet();
  await act(async () => fireEvent.press(screen.getByTestId('duration-cancel')));
  expect(gen.cancelJob).toHaveBeenCalledWith('d1');
  expect(gen.confirmDuration).not.toHaveBeenCalled();
  await waitFor(() => expect(app.getPathname()).toBe('/make'));
});

it('any other error stays on the sheet and says so', async () => {
  gen.cancelJob.mockRejectedValue(apiError(500, 'boom'));
  const app = await openSheet();
  await act(async () => fireEvent.press(screen.getByTestId('duration-cancel')));
  expect(await screen.findByTestId('duration-error')).toBeTruthy();
  expect(app.getPathname()).toBe('/job/duration/d1');
});

it('opened directly (no Make tab behind it) it loads the job itself', async () => {
  gen.listMyJobs.mockResolvedValue([]);
  renderRouter(jobRoutes(), { initialUrl: '/job/duration/d1' });
  expect(await screen.findByTestId('duration-body')).toHaveTextContent(/14:32/);
});

it('no refund note when nothing was charged (gen has nothing to refund)', async () => {
  const free = job({
    job_id: 'd1',
    status: 'awaiting_duration_confirm',
    state_data: { credits_charged: 0, pending_additional_credits: 1, duration_actual_seconds: 700 },
  });
  gen.listMyJobs.mockResolvedValue([free]);
  gen.getJob.mockResolvedValue(free as JobDetail);
  await openSheet();
  expect(screen.queryByTestId('duration-refund-note')).toBeNull();
});

it('a job that no longer needs confirming shows "Nothing to confirm" and Close only', async () => {
  gen.getJob.mockResolvedValue(job({ job_id: 'd1', status: 'separating_stage1' }) as JobDetail);
  gen.listMyJobs.mockResolvedValue([]);
  const app = renderRouter(jobRoutes(), { initialUrl: '/make' });
  await screen.findByTestId('make-empty');
  act(() => router.push('/job/duration/d1'));
  expect(await screen.findByTestId('duration-nothing')).toHaveTextContent(/^Nothing to confirm/);
  expect(screen.queryByTestId('duration-confirm')).toBeNull();
  expect(screen.queryByTestId('duration-cancel')).toBeNull();
  fireEvent.press(screen.getByTestId('duration-close'));
  await waitFor(() => expect(app.getPathname()).toBe('/make'));
});
