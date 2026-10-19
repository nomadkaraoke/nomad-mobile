import { popularCatalogSongs, searchCatalogSongs, type SongResponse } from '@nomad/api-decide';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Popular songs for an empty query, otherwise a debounced decide catalog search. */
export function useSongSearch(rawQuery: string) {
  const q = useDebounced(rawQuery.trim());
  const mode: 'popular' | 'search' = q.length === 0 ? 'popular' : 'search';
  const popular = useQuery({
    queryKey: ['decide', 'popular'],
    queryFn: () => popularCatalogSongs(30),
    enabled: mode === 'popular',
    staleTime: 60 * 60 * 1000,
  });
  const search = useQuery({
    queryKey: ['decide', 'search', q],
    queryFn: () => searchCatalogSongs(q),
    enabled: mode === 'search',
    staleTime: 5 * 60 * 1000,
  });
  const active = mode === 'popular' ? popular : search;
  const songs: SongResponse[] = (mode === 'popular' ? popular.data : search.data?.songs) ?? [];
  return {
    mode,
    query: q,
    songs,
    isLoading: active.isLoading,
    isError: active.isError,
    refetch: () => void active.refetch(),
  };
}
