import {
  getPopularSongsApiCatalogSongsPopularGet,
  getSongApiCatalogSongsSongIdGet,
  searchCatalogApiCatalogSongsGet,
} from './client';
import {
  eventApiSearchEventPost,
  offlineIndexApiSearchOfflineIndexGet,
  popularApiSearchPopularGet,
  readyApiSearchReadyGet,
  resolveApiSearchResolveGet,
  searchApiSearchGet,
  songApiSearchSongGet,
} from './search-client';

export * from './client';
export { ApiError, configureClient, type ClientDeps } from './configure';
// Search-service models (the search client's other generated names would collide with the catalog client's).
export type {
  Identification,
  IndexInfo,
  OfflineIndexManifest,
  ResolveResponse,
  SearchResponse,
  SongDetail,
  SongGroup,
  SongRef,
  Split,
  Version,
} from './search-client';

// Readable facades over FastAPI's generated operation names.

// Legacy catalog endpoints (decide /api/catalog/songs). Kept compiling for the current Discover screen;
// Task C4 moves the app to the search service and deletes these callers.
export const searchCatalogSongs = async (q: string, page = 1) =>
  (await searchCatalogApiCatalogSongsGet({ query: { q, page, per_page: 20 } })).data;

export const popularCatalogSongs = async (limit = 30) =>
  (await getPopularSongsApiCatalogSongsPopularGet({ query: { limit } })).data;

export const getSong = async (id: number) =>
  (await getSongApiCatalogSongsSongIdGet({ path: { song_id: id } })).data;

// Search service (decide /api/search/*).
export const searchSongs = async (q: string, opts: { limit?: number; signal?: AbortSignal } = {}) =>
  (await searchApiSearchGet({ query: { q, limit: opts.limit }, signal: opts.signal })).data;

export const popularSongs = async (limit = 30) =>
  (await popularApiSearchPopularGet({ query: { limit } })).data;

export const getSongDetail = async (key: string) => (await songApiSearchSongGet({ query: { key } })).data;

export const resolveQuery = async (q: string, sid?: string) =>
  (await resolveApiSearchResolveGet({ query: { q, sid } })).data;

export const getOfflineIndexManifest = async () => (await offlineIndexApiSearchOfflineIndexGet()).data;

/** Fire-and-forget telemetry: never throws, whatever the network or server does. */
export const logSearchEvent = async (e: { sid: string; type: string; data?: Record<string, unknown> }): Promise<void> => {
  try {
    await eventApiSearchEventPost({ body: e });
  } catch {
    /* telemetry must never break search */
  }
};

/** True when the search service is up and has an index loaded; false on any error (cold start, offline, 503). */
export const pingSearch = async (): Promise<boolean> => {
  try {
    await readyApiSearchReadyGet();
    return true;
  } catch {
    return false;
  }
};
