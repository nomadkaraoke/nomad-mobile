import { DECADES, DEFAULT_REC_FILTERS, GENRE_IDS, type RecFilters } from '@nomad/core';
import { create } from 'zustand';

import { appStorage } from '../storage';

const KEY = 'discover.filters.v1';

export const SORTS = ['best', 'popular', 'newest', 'oldest', 'shortest', 'az'] as const;
export const MOODS = ['happy', 'chill', 'sad', 'intense'] as const;

const strings = (v: unknown, allowed: readonly string[]) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)) : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const oneOrNull = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(v as T) ? (v as T) : null;

/** Whatever was stored, field by field: anything unknown falls back to its default. */
function sanitize(raw: unknown): RecFilters {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_REC_FILTERS;
  const pop = o.popularity;
  return {
    genre: strings(o.genre, GENRE_IDS),
    mood: strings(o.mood, MOODS) as RecFilters['mood'],
    energy: oneOrNull(o.energy, ['low', 'mid', 'high'] as const),
    decade: strings(o.decade, DECADES),
    popularity: typeof pop === 'number' && Number.isFinite(pop) && pop >= 0 && pop <= 100 ? pop : d.popularity,
    leadGender: oneOrNull(o.leadGender, ['male', 'female', 'mixed'] as const),
    duration: oneOrNull(o.duration, ['short', 'medium', 'long'] as const),
    classic: o.classic === true,
    explicit: oneOf(o.explicit, ['include', 'exclude'] as const, d.explicit),
    hasKaraoke: oneOf(o.hasKaraoke, ['any', 'yes', 'make'] as const, d.hasKaraoke),
    sort: oneOf(o.sort, SORTS, d.sort),
  };
}

/** The stored filters, or the defaults when nothing (valid) is stored. */
export function loadFilters(): RecFilters {
  try {
    const raw = appStorage.getString(KEY);
    if (raw !== undefined) return sanitize(JSON.parse(raw));
  } catch {
    // Unreadable: treated as unset.
    appStorage.remove(KEY);
  }
  return DEFAULT_REC_FILTERS;
}

type FiltersStore = {
  filters: RecFilters;
  set(patch: Partial<RecFilters>): void;
  clear(): void;
};

/** Discover's recommendation filters and sort (not the venue library, see useLibraryFilter), persisted across launches. */
export const useRecFilters = create<FiltersStore>((setState, get) => ({
  filters: loadFilters(),
  set(patch) {
    const filters = { ...get().filters, ...patch };
    appStorage.set(KEY, JSON.stringify(filters));
    setState({ filters });
  },
  clear() {
    appStorage.remove(KEY);
    setState({ filters: DEFAULT_REC_FILTERS });
  },
}));
