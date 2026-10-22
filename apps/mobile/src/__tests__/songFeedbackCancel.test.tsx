// songFeedbackCancel: a hide cancels refetches of picks already on screen (they would bring the song back), but
// never a first load still in flight (cancelling it would strand the previous filter's rows under keepPreviousData).
import * as decide from '@nomad/api-decide';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useSongFeedback } from '../discover/useSongFeedback';
import { RECS_KEY } from '../discover/useRecommendations';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  hideSong: jest.fn(async () => {}),
  unhideSong: jest.fn(async () => {}),
  loveSong: jest.fn(async () => {}),
}));

const song = { song_key: 'band a|song a', artist: 'Band A', title: 'Song A' } as decide.RecSong;
const page = (songs: decide.RecSong[]) => ({
  pages: [{ sections: [{ id: 's', songs }], has_profile: true, next_cursor: null }],
  pageParams: [undefined],
});

it('cancels a refetch of loaded picks but lets a first load finish', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const loadedKey = [...RECS_KEY, 'loaded'];
  const firstKey = [...RECS_KEY, 'first'];
  queryClient.setQueryData(loadedKey, page([song]));

  let finishFirst!: (v: unknown) => void;
  const first = queryClient.fetchQuery({ queryKey: firstKey, queryFn: () => new Promise((r) => (finishFirst = r)) });
  const refetch = queryClient.fetchQuery({
    queryKey: loadedKey,
    queryFn: () => new Promise(() => {}),
    staleTime: 0,
  });
  refetch.catch(() => {});

  const { result } = renderHook(() => useSongFeedback(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  act(() => result.current.hide(song));

  await waitFor(() => expect(queryClient.getQueryState(loadedKey)?.fetchStatus).toBe('idle'));
  expect(queryClient.getQueryState(firstKey)?.fetchStatus).toBe('fetching');
  finishFirst(page([]));
  await expect(first).resolves.toEqual(page([]));
  expect(queryClient.getQueryData(firstKey)).toEqual(page([]));
});
