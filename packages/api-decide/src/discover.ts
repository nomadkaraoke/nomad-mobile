// Discover facades over decide's recommendations v2, song feedback (hide/love), quiz and preferences endpoints.
import {
  getAllArtistsApiMyDataArtistsGet,
  getPreferencesApiMyDataPreferencesGet,
  getQuizProgressApiQuizProgressGet,
  getQuizStatusApiQuizStatusGet,
  getRecommendationsV2ApiMyRecommendationsV2Get,
  getSmartQuizArtistsApiQuizArtistsSmartPost,
  hideSongApiMySongsSongKeyHidePost,
  listHiddenApiMySongsHiddenGet,
  listLovedApiMySongsLovedGet,
  loveSongApiMySongsSongKeyLovePost,
  removeArtistApiMyDataArtistsArtistNameDelete,
  saveQuizProgressApiQuizProgressPut,
  searchArtistsApiCatalogArtistsGet,
  submitQuizApiQuizSubmitPost,
  unhideSongApiMySongsSongKeyHideDelete,
  unloveSongApiMySongsSongKeyLoveDelete,
  updatePreferencesApiMyDataPreferencesPut,
  type FeedbackBody,
  type FeedbackSong,
  type GetRecommendationsV2ApiMyRecommendationsV2GetData,
  type QuizProgressRequest,
  type QuizSubmitRequest,
  type RecommendationsV2Response,
  type SmartArtistRequest,
  type UpdatePreferencesRequest,
} from './client';
import { ApiError } from './configure';

type RecQuery = NonNullable<GetRecommendationsV2ApiMyRecommendationsV2GetData['query']>;

/**
 * GET /api/my/recommendations/v2. `query` is core's `toRecQuery(filters, library)` plus an optional `sort`;
 * repeated params (genre, mood, decade) are sent as repeated keys. `cursor` pages a non-`best` sort.
 */
export const getRecommendationsV2 = async (
  query: Record<string, string | string[]>,
  cursor?: string,
): Promise<RecommendationsV2Response> =>
  (
    await getRecommendationsV2ApiMyRecommendationsV2Get({
      // The server validates the enums; the facade accepts core's loosely typed record.
      query: { ...(query as RecQuery), ...(cursor ? { cursor } : {}) },
    })
  ).data;

/** The catalog is still loading on this instance: a 503 with detail `warming_up` (retry after `Retry-After`). */
export const isWarmingUp = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 503 && e.detail === 'warming_up';

// Song feedback. Song keys contain `|`, `/`, `&`, `#`, `?`, `%`, accents and non-Latin scripts. The generated client
// already runs encodeURIComponent on every path param (verified by the "encodes the key" tests), so the raw key is
// passed through: encoding here too would double-encode (`%` -> `%25`) and 404 on the server.
const key = (songKey: string) => ({ song_key: songKey });
const meta = (m?: { artist: string; title: string }): { body?: FeedbackBody } => (m ? { body: m } : {});

export const hideSong = async (songKey: string, m?: { artist: string; title: string }): Promise<void> => {
  await hideSongApiMySongsSongKeyHidePost({ path: key(songKey), ...meta(m) });
};
export const unhideSong = async (songKey: string): Promise<void> => {
  await unhideSongApiMySongsSongKeyHideDelete({ path: key(songKey) });
};
export const loveSong = async (songKey: string, m?: { artist: string; title: string }): Promise<void> => {
  await loveSongApiMySongsSongKeyLovePost({ path: key(songKey), ...meta(m) });
};
export const unloveSong = async (songKey: string): Promise<void> => {
  await unloveSongApiMySongsSongKeyLoveDelete({ path: key(songKey) });
};

export const listHiddenSongs = async (): Promise<FeedbackSong[]> => (await listHiddenApiMySongsHiddenGet()).data.songs;
export const listLovedSongs = async (): Promise<FeedbackSong[]> => (await listLovedApiMySongsLovedGet()).data.songs;

// Quiz.
/** Saved quiz progress, or null when none is saved (decide answers 204). */
export const getQuizProgress = async (): Promise<QuizProgressRequest | null> => {
  const res = await getQuizProgressApiQuizProgressGet();
  return res.response.status === 204 ? null : (res.data ?? null);
};
export const saveQuizProgress = async (body: QuizProgressRequest) =>
  (await saveQuizProgressApiQuizProgressPut({ body })).data;
export const submitQuiz = async (body: QuizSubmitRequest) => (await submitQuizApiQuizSubmitPost({ body })).data;
export const getQuizStatus = async () => (await getQuizStatusApiQuizStatusGet()).data;
export const smartQuizArtists = async (body: SmartArtistRequest) =>
  (await getSmartQuizArtistsApiQuizArtistsSmartPost({ body })).data;
export const searchArtists = async (q: string, limit = 10) =>
  (await searchArtistsApiCatalogArtistsGet({ query: { q, limit } })).data;

// Preferences and the user's artists.
export const getPreferences = async () => (await getPreferencesApiMyDataPreferencesGet()).data;
export const updatePreferences = async (body: UpdatePreferencesRequest) =>
  (await updatePreferencesApiMyDataPreferencesPut({ body })).data;
export const listMyArtists = async () => (await getAllArtistsApiMyDataArtistsGet()).data;
export const removeMyArtist = async (name: string) =>
  (await removeArtistApiMyDataArtistsArtistNameDelete({ path: { artist_name: name } })).data;
