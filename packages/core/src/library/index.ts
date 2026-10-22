// Shared library filter (spec §7): which karaoke catalogue a song comes from. Used by the Discover
// filters and Phase 5 Tonight. KaraFun = KaraokeNerds brand/library code 'KV'; community = a version
// with kind 'community'.
export type LibraryFilter = 'any' | 'community' | 'karafun';

export interface LibraryTagged {
  libraries?: readonly string[];
  versions?: readonly { kind: 'community' | 'commercial'; brand_code?: string }[];
}

export const LIBRARY_FILTERS: readonly LibraryFilter[] = ['any', 'community', 'karafun'];

/** KaraokeNerds brand / library code for KaraFun (Karaoke Version). */
export const KARAFUN_LIBRARY_CODE = 'KV';

/** The concrete library tags a song has (never contains 'any'). */
export function songLibraries(song: LibraryTagged): Set<'community' | 'karafun'> {
  const tags = new Set<'community' | 'karafun'>();
  if (song.libraries?.includes(KARAFUN_LIBRARY_CODE) || song.versions?.some((v) => v.brand_code === KARAFUN_LIBRARY_CODE)) {
    tags.add('karafun');
  }
  if (song.versions?.some((v) => v.kind === 'community')) tags.add('community');
  return tags;
}

export function matchesLibrary(song: LibraryTagged, filter: LibraryFilter): boolean {
  if (filter === 'any') return true;
  return songLibraries(song).has(filter);
}
