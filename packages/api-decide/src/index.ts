import {
  deleteKaraokeLogApiMyKaraokeLogEntryIdDelete,
  getSongApiCatalogSongsSongIdGet,
  listKaraokeLogApiMyKaraokeLogGet,
  putKaraokeLogApiMyKaraokeLogEntryIdPut,
} from './client';
import type { KaraokeLogEntry, LogMedia, LogNight, Survey } from './client';
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

// Legacy catalog song by numeric id (decide /api/catalog/songs/{id}): the song page until it reads the search service.
export const getSong = async (id: number) =>
  (await getSongApiCatalogSongsSongIdGet({ path: { song_id: id } })).data;

// Karaoke log (decide /api/my/karaoke-log, bearer gen token). Errors are ApiError with `detail` = the code
// (`invalid` 400, `not_owner` 403, `not_found` 404; 422 for schema errors).

/** The fields the app may write. `app_` ids: any of these (a new entry needs state, artist, title). `kj_` ids: only `survey` and `deleted`. */
export type KaraokeLogPatch = {
  state?: NonNullable<KaraokeLogEntry['state']>;
  artist?: string;
  title?: string;
  song_key?: string | null;
  night?: LogNight;
  sung_at?: string | null;
  ended_at?: string | null;
  media?: LogMedia;
  survey?: Survey;
  deleted?: boolean;
};

/** One page of the user's records, newest `updated_at` first. With `since`, deleted records are included (sync pull). */
export const listKaraokeLog = async (
  opts: { since?: string; nightId?: string; limit?: number; cursor?: string; signal?: AbortSignal } = {},
) =>
  (
    await listKaraokeLogApiMyKaraokeLogGet({
      query: { since: opts.since, night_id: opts.nightId, limit: opts.limit, cursor: opts.cursor },
      signal: opts.signal,
    })
  ).data;

/** Upsert with field-level merge → the entry. */
export const putKaraokeLog = async (id: string, patch: KaraokeLogPatch) =>
  (await putKaraokeLogApiMyKaraokeLogEntryIdPut({ path: { entry_id: id }, body: patch })).data;

/** Soft delete → the entry (`deleted: true`). */
export const deleteKaraokeLog = async (id: string) =>
  (await deleteKaraokeLogApiMyKaraokeLogEntryIdDelete({ path: { entry_id: id } })).data;

// Search service (decide /api/search/*).
/** Only a real venue library narrows the search (`any`, or none, searches every song). */
const libraryParam = (library?: string) => (library && library !== 'any' ? { library } : {});

/**
 * `sid` is the client's search-session id (decide logs it with the search; it makes one up when absent). `library`
 * narrows results to a venue library (Phase 3's LibraryFilter: `community`, `karafun`; `any` = every song).
 */
export const searchSongs = async (
  q: string,
  opts: { limit?: number; sid?: string; library?: string; signal?: AbortSignal } = {},
) =>
  (
    await searchApiSearchGet({
      query: { q, limit: opts.limit, sid: opts.sid, ...libraryParam(opts.library) },
      signal: opts.signal,
    })
  ).data;

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
