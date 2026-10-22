// Music service facades: which services are connected, and the Apple Music browser hand-off.
import {
  appleMusicAppDeveloperTokenApiServicesAppleMusicAppDeveloperTokenGet,
  appleMusicLinkApiServicesAppleMusicLinkPost,
  connectAppleMusicApiServicesAppleMusicConnectPost,
  disconnectServiceApiServicesServiceTypeDelete,
  listServicesApiServicesGet,
  type AppleMusicLinkResponse,
  type ConnectedServiceResponse,
} from './client';

/** decide's music service type for Apple Music (the others: spotify, lastfm, listenbrainz). */
export const APPLE_MUSIC = 'apple_music';

/** The user's connected music services, with sync status and counts. */
export const listMusicServices = async (): Promise<ConnectedServiceResponse[]> =>
  (await listServicesApiServicesGet()).data;

/**
 * A one-time decide web link (10 min) that signs the user in to Apple Music with MusicKit JS and stores the
 * token for them, then returns to `nomadkaraoke://music-connected`. The app opens it in an auth session.
 */
export const startAppleMusicLink = async (): Promise<AppleMusicLinkResponse> =>
  (await appleMusicLinkApiServicesAppleMusicLinkPost()).data;

/** Disconnect a music service (decide keeps the songs it already read). */
export const disconnectMusicService = async (serviceType: string): Promise<void> => {
  await disconnectServiceApiServicesServiceTypeDelete({ path: { service_type: serviceType } });
};

/** Developer token for the iOS app's native MusicKit sign-in (signed in; no origin restriction). */
export const getAppleMusicAppDeveloperToken = async (): Promise<string> =>
  (await appleMusicAppDeveloperTokenApiServicesAppleMusicAppDeveloperTokenGet()).data.developer_token;

/** Connect Apple Music with a Music User Token from native MusicKit; decide checks it with Apple and starts a sync. */
export const connectAppleMusic = async (musicUserToken: string): Promise<void> => {
  await connectAppleMusicApiServicesAppleMusicConnectPost({ body: { music_user_token: musicUserToken } });
};
