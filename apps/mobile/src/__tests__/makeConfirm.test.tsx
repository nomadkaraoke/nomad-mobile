import * as decide from '@nomad/api-decide';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/store';
import { useMakeIntent } from '../make/intentStore';
import { apiError, gen, session } from '../test-utils/genAuthMock';
import { bestChoice, makeRoutes, spotify, youtube } from '../test-utils/makeFixtures';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(async () => []),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  searchAudio: jest.fn(),
  createJobFromSearch: jest.fn(),
  createJobFromUrl: jest.fn(),
  getMe: jest.fn(),
  listMyJobs: jest.fn(),
}));

const TIER1 = { sessionId: 's1', results: [bestChoice(0), youtube(1), spotify(2)] };
const TIER3 = { sessionId: 's3', results: [youtube(0), youtube(1, 'Starlight (live)'), spotify(2)] };

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await useAuth.getState().signInWithSession(session());
  useMakeIntent.getState().set({ artist: 'Muse', title: 'Starlight', decideSongId: 7, createdAt: Date.now() });
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 });
  gen.searchAudio.mockResolvedValue(TIER1);
  gen.createJobFromSearch.mockResolvedValue('job-1');
  gen.createJobFromUrl.mockResolvedValue('job-2');
  gen.listMyJobs.mockResolvedValue([]);
});

const openMake = () => renderRouter(makeRoutes(), { initialUrl: '/make/new' });

it('searches once, then tier 1 shows the pick card, the cost and a single Make it', async () => {
  let finish!: (v: typeof TIER1) => void;
  gen.searchAudio.mockReturnValueOnce(new Promise((r) => (finish = r)));
  openMake();
  expect(await screen.findByText('Finding the best audio…')).toBeTruthy();
  expect(screen.getByTestId('make-searching')).toBeTruthy();
  await act(async () => finish(TIER1));

  expect(await screen.findByTestId('make-pick')).toBeTruthy();
  expect(screen.getByTestId('make-pick-badge')).toHaveTextContent('Perfect match');
  // Plain language from the category and quality fields; never the tracker name.
  const reason = screen.getByTestId('make-pick-reason');
  expect(reason).toHaveTextContent(/Studio album/);
  expect(reason).toHaveTextContent(/lossless/);
  expect(reason).not.toHaveTextContent(/RED/);
  expect(screen.getByText('See other sources (2)')).toBeTruthy();
  expect(screen.queryByTestId('make-source-1')).toBeNull();
  expect(await screen.findByText('Cost 1 credit · You have 3')).toBeTruthy();
  expect(screen.getByText('Posted publicly on YouTube so you can share it')).toBeTruthy();
  expect(screen.getAllByText('Make it')).toHaveLength(1);
  expect(gen.searchAudio).toHaveBeenCalledTimes(1);
  expect(gen.searchAudio).toHaveBeenCalledWith('Muse', 'Starlight');
});

it('Make it creates the job, clears the intent, refreshes jobs and lands on the Make tab', async () => {
  const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
  const app = openMake();
  await act(async () => fireEvent.press(await screen.findByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledWith({ sessionId: 's1', index: 0, artist: 'Muse', title: 'Starlight' });
  expect(await screen.findByTestId('make-tab-screen')).toBeTruthy();
  expect(app.getSegments()).toEqual(['(tabs)', 'make']);
  expect(useMakeIntent.getState().intent).toBeNull();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  invalidate.mockRestore();
});

it('tier 2 shows "Recommended"; See other sources lets you choose another', async () => {
  // Not a perfect match: well seeded but by another artist (a cover).
  gen.searchAudio.mockResolvedValue({ sessionId: 's2', results: [{ ...bestChoice(0), artist: 'Someone Else' }, youtube(1)] });
  openMake();
  expect(await screen.findByTestId('make-pick-badge')).toHaveTextContent('Recommended');
  fireEvent.press(screen.getByTestId('make-other-sources'));
  fireEvent.press(await screen.findByTestId('make-source-1'));
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's2', index: 1 }));
});

it('tier 3: no pick card, the grouped list is open, and choosing a row enables Make it', async () => {
  gen.searchAudio.mockResolvedValue(TIER3);
  openMake();
  expect(await screen.findByTestId('make-source-2')).toBeTruthy();
  expect(screen.queryByTestId('make-pick')).toBeNull();
  expect(screen.getByText('YouTube')).toBeTruthy();
  expect(screen.getByText('Spotify')).toBeTruthy();
  expect(screen.getByTestId('make-submit')).toBeDisabled();
  fireEvent.press(screen.getByTestId('make-source-2'));
  expect(screen.getByTestId('make-submit')).toBeEnabled();
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's3', index: 2 }));
});

it('a double tap on Make it creates one job; the button is disabled while it is in flight', async () => {
  let finish!: (id: string) => void;
  gen.createJobFromSearch.mockReturnValue(new Promise((r) => (finish = r)));
  openMake();
  const submit = await screen.findByTestId('make-submit');
  fireEvent.press(submit);
  fireEvent.press(submit);
  await waitFor(() => expect(screen.getByTestId('make-submit')).toBeDisabled());
  fireEvent.press(screen.getByTestId('make-submit'));
  expect(gen.createJobFromSearch).toHaveBeenCalledTimes(1);
  await act(async () => finish('job-1'));
  expect(await screen.findByTestId('make-tab-screen')).toBeTruthy();
});

it('402 from the search goes to credits and returns to /make/new', async () => {
  gen.searchAudio.mockRejectedValue(apiError(402, { credits_available: 0, credits_required: 1 }));
  const app = openMake();
  expect(await screen.findByTestId('credits-stub')).toBeTruthy();
  expect(app.getPathname()).toBe('/credits');
  expect(app.getSearchParams()).toMatchObject({ returnTo: '/make/new' });
});

it('402 from create goes to credits and keeps the intent', async () => {
  gen.createJobFromSearch.mockRejectedValue(apiError(402, { credits_available: 0, credits_required: 1 }));
  const app = openMake();
  await act(async () => fireEvent.press(await screen.findByTestId('make-submit')));
  expect(await screen.findByTestId('credits-stub')).toBeTruthy();
  expect(app.getSearchParams()).toMatchObject({ returnTo: '/make/new' });
  expect(useMakeIntent.getState().get()).toMatchObject({ title: 'Starlight' });
});

it('another create error shows a message and Make it works again', async () => {
  gen.createJobFromSearch.mockRejectedValueOnce(apiError(500, 'boom'));
  openMake();
  await act(async () => fireEvent.press(await screen.findByTestId('make-submit')));
  expect(await screen.findByTestId('make-error')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenCalledTimes(2);
  expect(await screen.findByTestId('make-tab-screen')).toBeTruthy();
});

it('Paste a YouTube link instead → createJobFromUrl', async () => {
  openMake();
  fireEvent.press(await screen.findByTestId('make-youtube-toggle'));
  fireEvent.changeText(screen.getByTestId('make-youtube-input'), 'not a link');
  expect(screen.getByTestId('make-submit')).toBeDisabled();
  fireEvent.changeText(screen.getByTestId('make-youtube-input'), ' https://youtu.be/abc123 ');
  await act(async () => fireEvent.press(screen.getByTestId('make-submit')));
  expect(gen.createJobFromUrl).toHaveBeenCalledWith({ url: 'https://youtu.be/abc123', artist: 'Muse', title: 'Starlight' });
  expect(gen.createJobFromSearch).not.toHaveBeenCalled();
  expect(await screen.findByTestId('make-tab-screen')).toBeTruthy();
});

it('no results: says so and opens the YouTube option', async () => {
  gen.searchAudio.mockResolvedValue({ sessionId: 's0', results: [] });
  openMake();
  expect(await screen.findByText("We couldn't find audio for this song")).toBeTruthy();
  expect(screen.getByTestId('make-youtube-input')).toBeTruthy();
  expect(screen.getByTestId('make-submit')).toBeDisabled();
});

it('a failed search can be retried', async () => {
  gen.searchAudio.mockRejectedValueOnce(apiError(503, 'unavailable'));
  openMake();
  await act(async () => fireEvent.press(await screen.findByTestId('make-retry')));
  expect(await screen.findByTestId('make-pick')).toBeTruthy();
  expect(gen.searchAudio).toHaveBeenCalledTimes(2);
});

it('without a fresh intent there is nothing to make', async () => {
  useMakeIntent.getState().set({ artist: 'Muse', title: 'Old', createdAt: Date.now() - 31 * 60 * 1000 });
  openMake();
  expect(await screen.findByTestId('make-no-intent')).toBeTruthy();
  expect(gen.searchAudio).not.toHaveBeenCalled();
});

it('an expired search session (404 on create) searches again for a fresh pick', async () => {
  gen.createJobFromSearch.mockRejectedValueOnce(apiError(404, 'Search expired — please search again'));
  gen.searchAudio.mockResolvedValueOnce(TIER1).mockResolvedValueOnce({ ...TIER1, sessionId: 's1b' });
  openMake();
  await act(async () => fireEvent.press(await screen.findByTestId('make-submit')));
  expect(await screen.findByText('That search expired, so we looked again.')).toBeTruthy();
  expect(gen.searchAudio).toHaveBeenCalledTimes(2);
  await act(async () => fireEvent.press(await screen.findByTestId('make-submit')));
  expect(gen.createJobFromSearch).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 's1b', index: 0 }));
});

it('back from credits with a balance: the blocked search runs again', async () => {
  gen.searchAudio.mockRejectedValueOnce(apiError(402, { credits_available: 0, credits_required: 1 }));
  gen.getMe.mockResolvedValueOnce({ email: 'me@example.com', credits: 0 });
  openMake();
  expect(await screen.findByTestId('credits-stub')).toBeTruthy();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 });
  await act(async () => router.back());
  expect(await screen.findByTestId('make-pick')).toBeTruthy();
  expect(gen.searchAudio).toHaveBeenCalledTimes(2);
});

it('back from credits without paying: no loop, a Get credits button instead', async () => {
  gen.searchAudio.mockRejectedValue(apiError(402, { credits_available: 0, credits_required: 1 }));
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 0 });
  const app = openMake();
  expect(await screen.findByTestId('credits-stub')).toBeTruthy();
  await act(async () => router.back());
  expect(await screen.findByTestId('make-get-credits')).toBeTruthy();
  expect(app.getPathname()).toBe('/make/new');
  expect(gen.searchAudio).toHaveBeenCalledTimes(1);
});

it('signed out on /make/new (session expired): reopens sign-in and keeps the intent', async () => {
  await useAuth.getState().signOut();
  const app = openMake();
  expect(await screen.findByTestId('signin-sheet')).toBeTruthy();
  expect(app.getSearchParams()).toMatchObject({ returnTo: '/make/new' });
  expect(gen.searchAudio).not.toHaveBeenCalled();
  expect(useMakeIntent.getState().get()).toMatchObject({ title: 'Starlight' });
});

it('Discover → song → Make it → created: the song and make screens are gone, the Make tab shows', async () => {
  (decide.getSong as jest.Mock).mockResolvedValue({ id: 7, artist: 'Muse', title: 'Starlight', brands: [], brand_count: 0 });
  const app = renderRouter(makeRoutes(), { initialUrl: '/discover' });
  await screen.findByTestId('discover-screen');
  act(() => router.push('/song/7'));
  await screen.findByText('Starlight');
  fireEvent.press(screen.getByTestId('song-make'));
  await act(async () => fireEvent.press(await screen.findByTestId('make-submit')));
  expect(await screen.findByTestId('make-tab-screen')).toBeTruthy();
  const root = app.getRouterState()?.routes[0]?.state;
  expect(root?.routes?.map((r) => r.name)).toEqual(['(tabs)']);
});

it('after create the screen keeps its song until it is gone (no "Pick a song" flash); unmount clears the intent', async () => {
  const dismiss = jest.spyOn(router, 'dismissTo').mockImplementation(() => {});
  const app = openMake();
  await act(async () => fireEvent.press(await screen.findByTestId('make-submit')));
  expect(dismiss).toHaveBeenCalledWith('/(tabs)/make');
  expect(screen.queryByTestId('make-no-intent')).toBeNull();
  expect(screen.getByTestId('make-pick')).toBeTruthy();
  dismiss.mockRestore();
  app.unmount();
  expect(useMakeIntent.getState().intent).toBeNull();
});
