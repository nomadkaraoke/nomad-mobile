// Voice profile + per-song vocal range facades (decide /api/my/voice, /api/catalog/songs/{key}/vocal-range).
import {
  deleteVoiceApiMyVoiceDelete,
  getSongVocalRangeApiCatalogSongsSongKeyVocalRangeGet,
  getVoiceApiMyVoiceGet,
  putVoiceApiMyVoicePut,
  type VoiceProfilePutIn,
  type VoiceProfileOut,
} from './client';

/** The saved profile, or null when the user has none. */
export const getVoiceProfile = async (): Promise<VoiceProfileOut | null> =>
  (await getVoiceApiMyVoiceGet()).data.profile;

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
