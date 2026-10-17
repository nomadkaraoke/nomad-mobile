import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { AppState, Keyboard } from 'react-native';

import { appRoutes } from '../test-utils/routes';

jest.mock('@nomad/api-decide', () => ({
  searchSongs: jest.fn(),
  popularSongs: jest.fn(),
  getSong: jest.fn(),
  configureClient: jest.fn(),
}));
const searchSongs = decide.searchSongs as jest.Mock;
const popularSongs = decide.popularSongs as jest.Mock;

beforeEach(() => {
  popularSongs.mockReset().mockResolvedValue([
    { id: 1, artist: 'Lionel Richie', title: 'Hello', brands: [], brand_count: 3, is_popular: true },
  ]);
  searchSongs.mockReset().mockResolvedValue({
    songs: [{ id: 2, artist: 'Adele', title: 'Hello', brands: [], brand_count: 1, is_popular: true }],
    total: 1,
    page: 1,
    per_page: 20,
    has_more: false,
  });
});

it('shows popular songs with a karaoke-version badge, then search results', async () => {
  renderRouter(appRoutes(), { initialUrl: '/discover' });
  expect(await screen.findByTestId('discover-search-input')).toBeTruthy();
  expect(await screen.findByText('3 karaoke versions')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('discover-search-input'), 'hello');
  expect(await screen.findByTestId('song-row-2', {}, { timeout: 2000 })).toBeTruthy();
  expect(screen.getByText('1 karaoke version')).toBeTruthy();
});

it('opening Discover never raises the keyboard: no autofocus, and a keyboard left up is dismissed', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  renderRouter(appRoutes(), { initialUrl: '/discover' });
  const input = await screen.findByTestId('discover-search-input');
  expect(input.props.autoFocus).toBeFalsy();
  expect(dismiss).toHaveBeenCalled();
  dismiss.mockRestore();
});

it('coming back to the app (a launcher tap resumes it on Android) puts the keyboard away too', async () => {
  const listeners: ((s: string) => void)[] = [];
  const add = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    const listener = fn as (s: string) => void;
    listeners.push(listener);
    const remove = () => listeners.splice(listeners.indexOf(listener), 1);
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  renderRouter(appRoutes(), { initialUrl: '/discover' });
  await screen.findByTestId('discover-search-input');
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  act(() => listeners.forEach((fn) => fn('active')));
  expect(dismiss).toHaveBeenCalled();
  dismiss.mockRestore();
  add.mockRestore();
});

it('coming back to the app with another screen on top (the code field waiting for a pasted code) leaves the keyboard alone', async () => {
  const listeners: ((s: string) => void)[] = [];
  const add = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    const listener = fn as (s: string) => void;
    listeners.push(listener);
    const remove = () => listeners.splice(listeners.indexOf(listener), 1);
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  const app = renderRouter(appRoutes(), { initialUrl: '/discover' });
  await screen.findByTestId('discover-search-input');
  act(() => router.push('/song/new'));
  await waitFor(() => expect(app.getPathname()).toBe('/song/new'));
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  act(() => listeners.forEach((fn) => fn('active')));
  expect(dismiss).not.toHaveBeenCalled();
  dismiss.mockRestore();
  add.mockRestore();
});

it('shows an error with a working retry button', async () => {
  // Fail the first load and the query client's one automatic retry, then recover.
  popularSongs
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([]);
  renderRouter(appRoutes(), { initialUrl: '/discover' });
  const retry = await screen.findByTestId('discover-retry', {}, { timeout: 3000 });
  await act(async () => fireEvent.press(retry));
  await waitFor(() => expect(screen.queryByTestId('discover-retry')).toBeNull());
  expect(popularSongs.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('shows a no-results message for an empty search', async () => {
  searchSongs.mockReset().mockResolvedValue({ songs: [], total: 0, page: 1, per_page: 20, has_more: false });
  renderRouter(appRoutes(), { initialUrl: '/discover' });
  fireEvent.changeText(await screen.findByTestId('discover-search-input'), 'zzzz');
  expect(await screen.findByText('No songs found for “zzzz”.', {}, { timeout: 2000 })).toBeTruthy();
});

it('dismisses the search keyboard when a result is opened', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  renderRouter(appRoutes(), { initialUrl: '/discover' });
  fireEvent.changeText(await screen.findByTestId('discover-search-input'), 'hello');
  fireEvent.press(await screen.findByTestId('song-row-2', {}, { timeout: 2000 }));
  expect(dismiss).toHaveBeenCalled();
});
