// Voice session facades (decide /api/voice/*, Phase 3d): flags, the session, attempts, the result, private recordings,
// the personal pool ("Analyse my music") and the admin views. Errors are ApiError with `detail` = decide's code (see `voiceErrorCode`).
import { client } from './client/client.gen';
import {
  addAttemptApiVoiceSessionsSessionIdAttemptsPost,
  adoptSessionApiVoiceSessionsSessionIdAdoptPost,
  countRecordingsApiVoiceRecordingsCountGet,
  createSessionApiVoiceSessionsPost,
  deleteRecordingApiVoiceRecordingsRecordingIdDelete,
  deleteRecordingsApiVoiceRecordingsDelete,
  flagsApiVoiceFlagsGet,
  getSessionApiVoiceSessionsSessionIdGet,
  historyApiVoiceHistoryGet,
  nextSongApiVoiceSessionsSessionIdNextGet,
  patchAttemptApiVoiceAttemptsAttemptIdPatch,
  patchSessionApiVoiceSessionsSessionIdPatch,
  personalPoolApiVoicePersonalPoolGet,
  requestPersonalPoolApiVoicePersonalPoolPost,
  sessionResultApiVoiceSessionsSessionIdResultGet,
  skipSongApiVoiceSessionsSessionIdSkipsPost,
  uploadRecordingApiVoiceRecordingsPost,
  userSongsApiAdminVoiceUsersEmailSongsGet,
  type AttemptIn,
  type AttemptOut,
  type AttemptPatchIn,
  type AttemptPatchOut,
  type BodyUploadRecordingApiVoiceRecordingsPost,
  type NextDoneOut,
  type NextSongOut,
  type PersonalBatchCreated,
  type PersonalPoolOut,
  type RecordingCreated,
  type RecordingsDeleted,
  type ResultOut,
  type SessionCreated,
  type SessionOut,
  type SessionPatch,
  type SessionSetup,
  type SkipIn,
  type UserSongOut,
  type VoiceFlagsOut,
  type VoiceHistoryOut,
  type VoiceProfileOut,
} from './client';
import { ApiError } from './configure';

/** `GET .../next`: the next song or the end of the session, `kind` always set. */
export type NextVoiceSong = (NextSongOut & { kind: 'song' }) | (NextDoneOut & { kind: 'done' });

export const getVoiceFlags = async (): Promise<VoiceFlagsOut> => (await flagsApiVoiceFlagsGet()).data;

/** Starts a session (abandons the user's other active one). */
export const createVoiceSession = async (setup: SessionSetup): Promise<SessionCreated> =>
  (await createSessionApiVoiceSessionsPost({ body: setup })).data;

/** The session as it stands, to resume it (read-only). */
export const getVoiceSession = async (id: string): Promise<SessionOut> =>
  (await getSessionApiVoiceSessionsSessionIdGet({ path: { session_id: id } })).data;

/** Any subset of the setup (the mid-session context chip). 204. */
export const patchVoiceSession = async (id: string, patch: SessionPatch): Promise<void> => {
  await patchSessionApiVoiceSessionsSessionIdPatch({ path: { session_id: id }, body: patch });
};

export const nextVoiceSong = async (id: string): Promise<NextVoiceSong> => {
  const r = (await nextSongApiVoiceSessionsSessionIdNextGet({ path: { session_id: id } })).data;
  // decide always sends `kind` (a defaulted field, so the schema marks it optional); fall back on the shape.
  return 'song_key' in r ? { ...r, kind: 'song' } : { ...r, kind: 'done' };
};

/** 204. `not_embeddable` (with `video_id`) marks that version unplayable for everyone. */
export const skipVoiceSong = async (id: string, body: SkipIn): Promise<void> => {
  await skipSongApiVoiceSessionsSessionIdSkipsPost({ path: { session_id: id }, body });
};

export const postVoiceAttempt = async (id: string, body: AttemptIn): Promise<AttemptOut> =>
  (await addAttemptApiVoiceSessionsSessionIdAttemptsPost({ path: { session_id: id }, body })).data;

/** The result; on an active session this also ends it and saves the `session` profile when confident enough. */
export const getVoiceResult = async (id: string): Promise<ResultOut> =>
  (await sessionResultApiVoiceSessionsSessionIdResultGet({ path: { session_id: id } })).data;

/**
 * Makes this session's result the user's voice profile, even at low confidence (session flag on). 409 `no_evidence`
 * when the session has nothing to save. The generated client encodes the id.
 */
export const adoptVoiceSession = async (id: string): Promise<VoiceProfileOut> =>
  (await adoptSessionApiVoiceSessionsSessionIdAdoptPost({ path: { session_id: id } })).data;

// --- Your voice data (Me: sessions, songs, recordings; open even when the session flag is off) ---

/** The user's sessions (newest first, at most 20) with their songs, results and recordings. */
export const getVoiceHistory = async (): Promise<VoiceHistoryOut> => (await historyApiVoiceHistoryGet()).data;

/**
 * "Don't count this one" (`excluded: true`) or count it again. decide rebuilds the session's result and says what
 * happened to the saved profile (`profile`). Attempt ids look like `<session>:<n>`; the generated client encodes them.
 */
export const patchVoiceAttempt = async (attemptId: string, body: AttemptPatchIn): Promise<AttemptPatchOut> =>
  (await patchAttemptApiVoiceAttemptsAttemptIdPatch({ path: { attempt_id: attemptId }, body })).data;

// --- Recordings (private, consent-gated) ---

export type VoiceRecordingContentType = 'audio/mp4' | 'audio/wav';

export type VoiceRecordingUpload = {
  sessionId: string;
  /** 1-based attempt number (1..12). */
  attemptN: number;
  durationS: number;
  device?: string | null;
  /** The take's bytes (on the phone: the expo-file-system `File` of the local recording). */
  file: RecordingBytes;
  contentType: VoiceRecordingContentType;
};

/** Anything that reads a file's bytes, e.g. an expo-file-system `File`. */
export type RecordingBytes = { bytes(): Promise<Uint8Array> };

/**
 * The multipart file part: a name, the exact content type decide accepts and a `bytes()` reader. Expo SDK 57's global
 * fetch (expo/fetch) sends any part with `bytes()` and takes its `name` / `type` for the part's headers; React Native's
 * `{ uri, name, type }` parts fail there with "Unsupported FormDataPart implementation" before anything is sent. The
 * type is set here rather than taken from a `File` (whose type comes from the extension, e.g. `audio/x-wav`).
 */
export type RecordingFilePart = { readonly name: string; readonly type: VoiceRecordingContentType; bytes(): Promise<Uint8Array> };

const EXT: Record<VoiceRecordingContentType, string> = { 'audio/mp4': 'm4a', 'audio/wav': 'wav' };

/** The multipart body (the generated serializer would JSON-encode the file part, hence this builder). */
export function voiceRecordingForm(u: VoiceRecordingUpload): FormData {
  const form = new FormData();
  const file: RecordingFilePart = {
    name: `${u.attemptN}.${EXT[u.contentType]}`,
    type: u.contentType,
    bytes: () => u.file.bytes(),
  };
  form.append('file', file as unknown as Blob);
  form.append('session_id', u.sessionId);
  form.append('attempt_n', String(u.attemptN));
  form.append('duration_s', String(u.durationS));
  if (u.device) form.append('device', u.device);
  return form;
}

/** Uploads one attempt's recording. 201 `{recording_id}`. See `isTerminalUploadError` for what a queue drops. */
export const uploadVoiceRecording = async (u: VoiceRecordingUpload): Promise<RecordingCreated> =>
  (
    await uploadRecordingApiVoiceRecordingsPost({
      // The body only feeds the serializer below; the generated type wants a Blob for `file`.
      body: u as unknown as BodyUploadRecordingApiVoiceRecordingsPost,
      bodySerializer: (body) => voiceRecordingForm(body as unknown as VoiceRecordingUpload),
    })
  ).data;

/** Erases every recording of the user and withdraws recording consent. Clear the upload queue first. */
export const deleteVoiceRecordings = async (): Promise<RecordingsDeleted> =>
  (await deleteRecordingsApiVoiceRecordingsDelete()).data;

/** Deletes one recording (object, doc and the attempt's link). 204, idempotent; not the user's: 404. */
export const deleteVoiceRecording = async (id: string): Promise<void> => {
  await deleteRecordingApiVoiceRecordingsRecordingIdDelete({ path: { recording_id: id } });
};

/**
 * The user's own recording's audio URL on the configured decide base (no Range: download it with the bearer token,
 * then play the file).
 */
export const voiceRecordingAudioUrl = (id: string): string =>
  `${client.getConfig().baseUrl ?? ''}/api/voice/recordings/${encodeURIComponent(id)}/audio`;

export const voiceRecordingCount = async (): Promise<number> =>
  (await countRecordingsApiVoiceRecordingsCountGet()).data.count;

// --- Personal pool ("Analyse my music", Part F) ---

/** Eligibility, the 30-day cap (`used` of `cap`, `next_allowed_at` once used up) and the batches, newest first. */
export const getPersonalPool = async (): Promise<PersonalPoolOut> => (await personalPoolApiVoicePersonalPoolGet()).data;

/** Queues up to `cap` of the user's most-played songs for analysis (no body). 201. Refusals: `personalPoolRefusal`. */
export const requestPersonalPool = async (): Promise<PersonalBatchCreated> =>
  (await requestPersonalPoolApiVoicePersonalPoolPost()).data;

export const PERSONAL_POOL_REFUSALS = [
  'not_eligible',
  'cap',
  'nothing_to_add',
  'concurrent_request',
  'budget_paused',
  'warming_up',
  'voice_session_disabled',
] as const;
export type PersonalPoolRefusalReason = (typeof PERSONAL_POOL_REFUSALS)[number];
export type PersonalPoolRefusal = { reason: PersonalPoolRefusalReason; nextAllowedAt: string | null };

const REFUSALS: ReadonlySet<string> = new Set(PERSONAL_POOL_REFUSALS);

/**
 * Why decide refused a personal-pool request, or null (not an ApiError, a 5xx without a code...). The pool's own
 * refusals are objects (`{reason, next_allowed_at?}`: 403 not_eligible, 429 cap, 409 nothing_to_add /
 * concurrent_request, 503 budget_paused); the session gate's are strings (403 voice_session_disabled, 503 warming_up).
 */
export function personalPoolRefusal(e: unknown): PersonalPoolRefusal | null {
  if (!(e instanceof ApiError)) return null;
  const d = e.detail;
  if (typeof d === 'string') return REFUSALS.has(d) ? { reason: d as PersonalPoolRefusalReason, nextAllowedAt: null } : null;
  if (!d || typeof d !== 'object' || !('reason' in d)) return null;
  const { reason, next_allowed_at: next } = d as { reason: unknown; next_allowed_at?: unknown };
  if (typeof reason !== 'string' || !REFUSALS.has(reason)) return null;
  return { reason: reason as PersonalPoolRefusalReason, nextAllowedAt: typeof next === 'string' ? next : null };
}

// --- Admin ---

/** Every song the user labelled or attempted (admin session). */
export const adminVoiceSongs = async (email: string): Promise<UserSongOut[]> =>
  (await userSongsApiAdminVoiceUsersEmailSongsGet({ path: { email } })).data;

/**
 * The private recording's audio URL on the configured decide base. It needs the admin's bearer token: pass it as a
 * header to the player (expo-audio's `{uri, headers}` source).
 */
export const adminRecordingUrl = (id: string): string =>
  `${client.getConfig().baseUrl ?? ''}/api/admin/voice/recordings/${encodeURIComponent(id)}/audio`;

// --- Errors ---

export const VOICE_ERROR_CODES = [
  'voice_session_disabled',
  'recording_not_consented',
  'session_forbidden',
  'session_not_found',
  'attempt_not_found',
  'recording_not_found',
  'session_not_active',
  'max_attempts',
  'recordings_deleted',
  'recording_deleted',
  'no_evidence',
  'recording_too_large',
  'unsupported_media_type',
  'empty_recording',
  'unknown_song',
  'unknown_version',
  'warming_up',
] as const;
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[number];

const CODES: ReadonlySet<string> = new Set(VOICE_ERROR_CODES);

/**
 * decide's voice error code for `e`, or null (not an ApiError, a 5xx, a 422 validation list...). A 413 / 415 without
 * a code (from a proxy) still maps.
 */
export function voiceErrorCode(e: unknown): VoiceErrorCode | null {
  if (!(e instanceof ApiError)) return null;
  if (typeof e.detail === 'string' && CODES.has(e.detail)) return e.detail as VoiceErrorCode;
  if (e.status === 413) return 'recording_too_large';
  if (e.status === 415) return 'unsupported_media_type';
  return null;
}

/**
 * True when a queued recording upload must be dropped: the server will never take it (decide API.md "App upload
 * queue rules": 403 recording_not_consented, 409 recordings_deleted, 409 recording_deleted (this take was deleted
 * on Me), 404; plus 403 session_forbidden and the
 * 413 / 415 / 422 refusals of the file itself, which a retry cannot fix). Everything else (network errors, 5xx,
 * 401, 429, 403 voice_session_disabled) keeps it for a later retry.
 */
export function isTerminalUploadError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.status === 404 || e.status === 413 || e.status === 415 || e.status === 422) return true;
  const code = voiceErrorCode(e);
  return (
    code === 'recording_not_consented' ||
    code === 'session_forbidden' ||
    code === 'recordings_deleted' ||
    code === 'recording_deleted'
  );
}
