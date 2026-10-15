import {
  getPopularSongsApiCatalogSongsPopularGet,
  getSongApiCatalogSongsSongIdGet,
  searchCatalogApiCatalogSongsGet,
} from './client';

export * from './client';
export { ApiError, configureClient, type ClientDeps } from './configure';

// Readable facades over FastAPI's generated operation names.
export const searchSongs = async (q: string, page = 1) =>
  (await searchCatalogApiCatalogSongsGet({ query: { q, page, per_page: 20 } })).data;

export const popularSongs = async (limit = 30) =>
  (await getPopularSongsApiCatalogSongsPopularGet({ query: { limit } })).data;

export const getSong = async (id: number) =>
  (await getSongApiCatalogSongsSongIdGet({ path: { song_id: id } })).data;
