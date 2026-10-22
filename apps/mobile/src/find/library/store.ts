import { LIBRARY_FILTERS, type LibraryFilter } from '@nomad/core';
import { create } from 'zustand';

import { appStorage } from '../../storage';

const KEY = 'discover.library.v1';

function load(): LibraryFilter {
  try {
    const raw = appStorage.getString(KEY);
    if (raw === undefined) return 'any';
    if ((LIBRARY_FILTERS as readonly string[]).includes(raw)) return raw as LibraryFilter;
  } catch {
    // Unreadable: treated as unset.
  }
  appStorage.remove(KEY);
  return 'any';
}

type LibraryStore = { filter: LibraryFilter; set(f: LibraryFilter): void };

/** The venue library chosen for Discover (search and recommendations), persisted across launches. */
export const useLibraryFilter = create<LibraryStore>((setState) => ({
  filter: load(),
  set(filter) {
    appStorage.set(KEY, filter);
    setState({ filter });
  },
}));
