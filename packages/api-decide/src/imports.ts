// Import facades (Phase 3b): services summary, screenshot / playlist / privacy-export imports, ListenBrainz.
import type { ExportUploadChunk } from '@nomad/core';
import {
  appleExportApiServicesAppleExportPost,
  confirmScreenshotApiServicesScreenshotConfirmPost,
  connectLastfmApiServicesLastfmConnectPost,
  connectListenbrainzApiServicesListenbrainzConnectPost,
  disconnectServiceApiServicesServiceTypeDelete,
  extractScreenshotApiServicesScreenshotExtractPost,
  getCapabilitiesApiServicesCapabilitiesGet,
  getSourcesSummaryApiServicesSummaryGet,
  importSpotifyPlaylistApiServicesSpotifyPlaylistImportPost,
  importYoutubeMusicPlaylistApiServicesYoutubeMusicImportPost,
  listenbrainzOauthStartApiServicesListenbrainzOauthStartGet,
  removeSourceDataApiServicesSourcesSourceDataDelete,
  spotifyExportApiServicesSpotifyExportPost,
  triggerSyncApiServicesSyncPost,
  uploadListenbrainzExportApiServicesListenbrainzUploadExportPost,
  type AppleExportRequest,
  type ConfirmItem,
  type SpotifyExportRequest,
} from './client';

/** A React Native file part: `FormData.append(name, file)` reads `uri`, `name` and `type`. */
export type RNFile = { uri: string; name: string; type: string };

/**
 * Multipart options: the FormData goes through untouched (the generated serializer would re-wrap it), and the
 * generated `Content-Type: null` makes fetch set the multipart boundary itself.
 */
const multipart = (form: FormData) => ({ body: form as never, bodySerializer: (b: unknown) => b as FormData });

/** Per-source counts and sync state for the Connect hub. */
export const getServicesSummary = async () => (await getSourcesSummaryApiServicesSummaryGet()).data;

/** What this server can do right now (screenshot import, ListenBrainz OAuth, ...); hide cards that are off. */
export const getServiceCapabilities = async () => (await getCapabilitiesApiServicesCapabilitiesGet()).data;

/** Read artists and songs from up to 5 screenshots (Gemini on the server); candidates come back for review. */
export const extractScreenshots = async (files: RNFile[]) => {
  const form = new FormData();
  for (const f of files) form.append('images', f as never);
  return (await extractScreenshotApiServicesScreenshotExtractPost(multipart(form))).data;
};

/** Save the screenshot candidates the user kept. */
export const confirmScreenshotItems = async (items: ConfirmItem[]) =>
  (await confirmScreenshotApiServicesScreenshotConfirmPost({ body: { items } })).data;

export const importSpotifyPlaylist = async (url: string) =>
  (await importSpotifyPlaylistApiServicesSpotifyPlaylistImportPost({ body: { url } })).data;

export const importYouTubeMusicPlaylist = async (url: string) =>
  (await importYoutubeMusicPlaylistApiServicesYoutubeMusicImportPost({ body: { playlist_url: url } })).data;

/** One chunk of an on-device-parsed Spotify / Apple privacy export (idempotent per chunk on the server). */
export const uploadExportChunk = async (chunk: ExportUploadChunk) =>
  chunk.endpoint === 'spotify-export'
    ? (await spotifyExportApiServicesSpotifyExportPost({ body: chunk.body as SpotifyExportRequest })).data
    : (await appleExportApiServicesAppleExportPost({ body: chunk.body as AppleExportRequest })).data;

export const connectLastfm = async (username: string) =>
  (await connectLastfmApiServicesLastfmConnectPost({ body: { username } })).data;

export const connectListenBrainz = async (username: string) =>
  (await connectListenbrainzApiServicesListenbrainzConnectPost({ body: { username } })).data;

/** MetaBrainz sign-in URL; the callback returns to `nomadkaraoke://services/listenbrainz`. */
export const startListenBrainzOAuth = async () =>
  (await listenbrainzOauthStartApiServicesListenbrainzOauthStartGet({ query: { return_to: 'app' } })).data;

/** Hand a Spotify export zip to ListenBrainz on the user's behalf (decide proxies it, 30 MiB max). */
export const uploadExportToListenBrainz = async (file: RNFile) => {
  const form = new FormData();
  form.append('file', file as never);
  return (await uploadListenbrainzExportApiServicesListenbrainzUploadExportPost(multipart(form))).data;
};

/** Remove everything one source (`screenshot`, `spotify_export`, ...) added. */
export const removeSourceData = async (source: string) =>
  (await removeSourceDataApiServicesSourcesSourceDataDelete({ path: { source } })).data;

/** Disconnect a polled service (decide keeps the songs it already read). */
export const disconnectService = async (type: 'lastfm' | 'listenbrainz'): Promise<void> => {
  await disconnectServiceApiServicesServiceTypeDelete({ path: { service_type: type } });
};

/** Start a background sync of every connected service. */
export const triggerSync = async () => (await triggerSyncApiServicesSyncPost()).data;
