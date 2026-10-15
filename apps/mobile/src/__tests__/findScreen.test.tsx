import * as decide from '@nomad/api-decide';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

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
  renderRouter(appRoutes(), { initialUrl: '/find' });
  expect(await screen.findByTestId('find-search-input')).toBeTruthy();
  expect(await screen.findByText('3 karaoke versions')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('find-search-input'), 'hello');
  expect(await screen.findByTestId('song-row-2', {}, { timeout: 2000 })).toBeTruthy();
  expect(screen.getByText('1 karaoke version')).toBeTruthy();
});

it('shows an error with a working retry button', async () => {
  // Fail the first load and the query client's one automatic retry, then recover.
  popularSongs
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([]);
  renderRouter(appRoutes(), { initialUrl: '/find' });
  const retry = await screen.findByTestId('find-retry', {}, { timeout: 3000 });
  await act(async () => fireEvent.press(retry));
  await waitFor(() => expect(screen.queryByTestId('find-retry')).toBeNull());
  expect(popularSongs.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('shows a no-results message for an empty search', async () => {
  searchSongs.mockReset().mockResolvedValue({ songs: [], total: 0, page: 1, per_page: 20, has_more: false });
  renderRouter(appRoutes(), { initialUrl: '/find' });
  fireEvent.changeText(await screen.findByTestId('find-search-input'), 'zzzz');
  expect(await screen.findByText('No songs found for “zzzz”.', {}, { timeout: 2000 })).toBeTruthy();
});
