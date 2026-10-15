import * as decide from '@nomad/api-decide';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useSongSearch } from '../find/useSongSearch';

jest.mock('@nomad/api-decide', () => ({ searchSongs: jest.fn(), popularSongs: jest.fn() }));
const searchSongs = decide.searchSongs as jest.Mock;
const popularSongs = decide.popularSongs as jest.Mock;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  jest.useFakeTimers();
  popularSongs.mockReset().mockResolvedValue([
    { id: 1, artist: 'A', title: 'Pop', brands: [], brand_count: 3, is_popular: true },
  ]);
  searchSongs.mockReset().mockImplementation(async (q: string) => ({
    songs: [{ id: 2, artist: 'B', title: q, brands: [], brand_count: 0, is_popular: false }],
    total: 1,
    page: 1,
    per_page: 20,
    has_more: false,
  }));
});
afterEach(() => jest.useRealTimers());

it('blank or whitespace query shows popular and never searches', async () => {
  const { result } = renderHook(() => useSongSearch('   '), { wrapper });
  act(() => jest.advanceTimersByTime(500));
  await waitFor(() => expect(result.current.songs[0]?.title).toBe('Pop'));
  expect(result.current.mode).toBe('popular');
  expect(searchSongs).not.toHaveBeenCalled();
});

it('debounces: rapid typing searches only the last trimmed query', async () => {
  const { result, rerender } = renderHook(({ q }: { q: string }) => useSongSearch(q), {
    wrapper,
    initialProps: { q: '' },
  });
  rerender({ q: 'h' });
  rerender({ q: 'he' });
  rerender({ q: 'hel ' });
  act(() => jest.advanceTimersByTime(350));
  await waitFor(() => expect(result.current.songs[0]?.title).toBe('hel'));
  expect(result.current.mode).toBe('search');
  expect(searchSongs).toHaveBeenCalledTimes(1);
  expect(searchSongs).toHaveBeenCalledWith('hel');
});

it('reports errors and can refetch', async () => {
  searchSongs.mockRejectedValueOnce(new Error('net'));
  const { result } = renderHook(() => useSongSearch('x'), { wrapper });
  act(() => jest.advanceTimersByTime(350));
  await waitFor(() => expect(result.current.isError).toBe(true));
  act(() => result.current.refetch());
  await waitFor(() => expect(result.current.songs[0]?.title).toBe('x'));
  expect(result.current.isError).toBe(false);
});
