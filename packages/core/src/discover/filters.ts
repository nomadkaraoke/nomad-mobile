// Discover filter state <-> decide's GET /api/my/recommendations/v2 query params (spec §8.1).
// The library filter is NOT part of RecFilters: it lives in useLibraryFilter and is merged at query time.
import type { LibraryFilter } from '../library';

/** `fit` (Phase 3c) orders by how well each song fits the user's voice; it needs a voice profile. */
export type RecSort = 'best' | 'popular' | 'newest' | 'oldest' | 'shortest' | 'az' | 'fit';
export type Mood = 'happy' | 'chill' | 'sad' | 'intense';

export interface RecFilters {
  genre: string[];
  mood: Mood[];
  energy: 'low' | 'mid' | 'high' | null;
  decade: string[];
  /** Minimum popularity 0-100. */
  popularity: number | null;
  leadGender: 'male' | 'female' | 'mixed' | null;
  duration: 'short' | 'medium' | 'long' | null;
  classic: boolean;
  explicit: 'include' | 'exclude';
  hasKaraoke: 'any' | 'yes' | 'make';
  /** Only songs in the user's range (Phase 3c); needs a voice profile. */
  singable: boolean;
  sort: RecSort;
}

export const DEFAULT_REC_FILTERS: RecFilters = {
  genre: [],
  mood: [],
  energy: null,
  decade: [],
  popularity: null,
  leadGender: null,
  duration: null,
  classic: false,
  explicit: 'include',
  hasKaraoke: 'any',
  singable: false,
  sort: 'best',
};

/** decide's 22 genre ids (21 genres plus `other`, labelled "Something else"). */
export const GENRE_IDS = [
  'pop',
  'rock',
  'hiphop',
  'rnb',
  'country',
  'electronic',
  'metal',
  'punk',
  'emo',
  'grunge',
  'jazz',
  'latin',
  'indie',
  'kpop',
  'disco',
  'classic-rock',
  'folk',
  'blues',
  'ska',
  'musical',
  'reggae',
  'other',
] as const;

export const DECADES = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'] as const;

/** snake_case query params for the v2 endpoint; defaults are omitted. Numbers/booleans are stringified. */
export function toRecQuery(f: RecFilters, library: LibraryFilter): Record<string, string | string[]> {
  const q: Record<string, string | string[]> = {};
  if (f.genre.length) q.genre = [...f.genre];
  if (f.mood.length) q.mood = [...f.mood];
  if (f.energy) q.energy = f.energy;
  if (f.decade.length) q.decade = [...f.decade];
  if (f.popularity !== null) q.popularity = String(f.popularity);
  if (f.leadGender) q.lead_gender = f.leadGender;
  if (f.duration) q.duration = f.duration;
  if (f.classic) q.classic = 'true';
  if (f.explicit !== DEFAULT_REC_FILTERS.explicit) q.explicit = f.explicit;
  if (f.hasKaraoke !== DEFAULT_REC_FILTERS.hasKaraoke) q.has_karaoke = f.hasKaraoke;
  if (f.singable) q.singable = 'true';
  if (library !== 'any') q.library = library;
  if (f.sort !== DEFAULT_REC_FILTERS.sort) q.sort = f.sort;
  return q;
}

/** The filters without the voice ones (Singable, the fit sort): what applies while the phone has no voice profile. */
export function withoutVoiceFilters(f: RecFilters): RecFilters {
  if (!f.singable && f.sort !== 'fit') return f;
  return { ...f, singable: false, sort: f.sort === 'fit' ? DEFAULT_REC_FILTERS.sort : f.sort };
}

/** Number of active (non-default) filters. Sort does not count; the library filter has its own chip row. */
export function activeFilterCount(f: RecFilters): number {
  const { sort: _sort, ...rest } = toRecQuery(f, 'any');
  void _sort;
  return Object.keys(rest).length;
}

/** Stable cache key: query keys sorted, array values sorted. */
export function filtersKey(f: RecFilters, library: LibraryFilter): string {
  const q = toRecQuery(f, library);
  return JSON.stringify(
    Object.keys(q)
      .sort()
      .map((k) => {
        const v = q[k] as string | string[];
        return [k, Array.isArray(v) ? [...v].sort() : v];
      }),
  );
}
