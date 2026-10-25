// Voice profile + per-song vocal range facades (decide /api/my/voice, /api/catalog/songs/{key}/vocal-range).
import {
  deleteVoiceApiMyVoiceDelete,
  getSongVocalRangeApiCatalogSongsSongKeyVocalRangeGet,
  getVoiceApiMyVoiceGet,
  putVoiceApiMyVoicePut,
  type SessionResultSummaryOut,
  type VoiceProfilePutIn,
  type VoiceProfileOut,
} from './client';

/** `GET /api/my/voice` in full: the saved profile, the last mic-test result and the latest session result. */
export type VoiceProfiles = {
  profile: VoiceProfileOut | null;
  /** The last mic-test result, kept beside the profile (null before decide v0.31 or without a mic test). */
  mic: VoiceProfileOut | null;
  /** The newest session with counting evidence, saved or not. */
  latestSession: SessionResultSummaryOut | null;
};

/** The saved profile, or null when the user has none. */
export const getVoiceProfile = async (): Promise<VoiceProfileOut | null> =>
  (await getVoiceApiMyVoiceGet()).data.profile;

/** The saved profile plus the mic and latest session results Me shows side by side. */
export const getVoiceProfiles = async (): Promise<VoiceProfiles> => {
  const r = (await getVoiceApiMyVoiceGet()).data;
  return { profile: r.profile, mic: r.mic ?? null, latestSession: r.latest_session ?? null };
};

/** Replaces the profile. `p` is sent as-is: decide forbids any key outside its `VoiceProfilePutIn` (`VoiceProfileIn` before decide v0.28). */
export const putVoiceProfile = async (p: VoiceProfilePutIn): Promise<VoiceProfileOut> =>
  (await putVoiceApiMyVoicePut({ body: p })).data;

/** Removes the profile (204). */
export const deleteVoiceProfile = async (): Promise<void> => {
  await deleteVoiceApiMyVoiceDelete();
};

/**
 * A song's vocal range (public). `range` is null when decide has none for it. 503 `warming_up` while the
 * catalog loads (see `isWarmingUp`). The generated client encodes the key.
 */
export const getSongVocalRange = async (songKey: string) =>
  (await getSongVocalRangeApiCatalogSongsSongKeyVocalRangeGet({ path: { song_key: songKey } })).data;
