import {
  adminRecordingUrl,
  adminVoiceSongs,
  adoptVoiceSession,
  ApiError,
  configureClient,
  createVoiceSession,
  deleteVoiceRecording,
  deleteVoiceRecordings,
  getVoiceFlags,
  getVoiceHistory,
  getVoiceResult,
  getVoiceSession,
  getPersonalPool,
  isTerminalUploadError,
  isWarmingUp,
  nextVoiceSong,
  patchVoiceAttempt,
  patchVoiceSession,
  personalPoolRefusal,
  postVoiceAttempt,
  requestPersonalPool,
  skipVoiceSong,
  uploadVoiceRecording,
  voiceErrorCode,
  voiceRecordingAudioUrl,
  voiceRecordingCount,
  voiceRecordingForm,
} from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });
const last = (): Request => fetchMock.mock.calls.at(-1)[0];
const path = () => new URL(last().url).pathname;

const SETUP = { posture: 'standing', warmth: 'warm', record: true, headphones: true, device: 'Pixel 9' } as const;
const VERSION = { video_id: 'FIXTURE11', brand_code: 'SING', brand_name: 'Sing Brand', embeddable: true };
const SONG = {
  kind: 'song',
  song_key: 'artist|title',
  artist: 'Artist',
  title: 'Title',
  duration_s: 215,
  reason_type: 'explore',
  version: VERSION,
  alternatives: [],
  song_range: { low: 48, high: 70, p10: 52, p50: 59, p90: 66 },
  attempt_n: 3,
  max_attempts: 12,
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({
    baseUrl: 'https://decide.test',
    getToken: () => 'tok',
    getLocale: () => 'en',
    getDeviceId: () => 'dev-1',
    onUnauthorized: jest.fn(),
  });
});

describe('session facades', () => {
  it('getVoiceFlags', async () => {
    const flags = { session_enabled: true, is_admin: false, voice_data: true, active_session_id: 's1' };
    fetchMock.mockResolvedValue(json(flags));
    await expect(getVoiceFlags()).resolves.toEqual(flags);
    expect(path()).toBe('/api/voice/flags');
    expect(last().headers.get('authorization')).toBe('Bearer tok');
  });

  it('createVoiceSession POSTs the setup', async () => {
    fetchMock.mockResolvedValue(json({ session_id: 's1', state: 'active' }));
    await expect(createVoiceSession(SETUP)).resolves.toEqual({ session_id: 's1', state: 'active' });
    expect(last().method).toBe('POST');
    expect(path()).toBe('/api/voice/sessions');
    expect(await last().json()).toEqual(SETUP);
  });

  it('getVoiceSession reads one session (encoded id)', async () => {
    const s = { session_id: 'a/b', state: 'active', setup: SETUP, attempts: 2, top_p: 0.4, done_reason: null, last_offer: SONG, profile_saved: false };
    fetchMock.mockResolvedValue(json(s));
    await expect(getVoiceSession('a/b')).resolves.toEqual(s);
    expect(last().method).toBe('GET');
    expect(last().url).toBe('https://decide.test/api/voice/sessions/a%2Fb');
  });

  it('patchVoiceSession PATCHes a subset and resolves on 204', async () => {
    fetchMock.mockResolvedValue(noContent());
    await expect(patchVoiceSession('s1', { warmth: 'bit_warm' })).resolves.toBeUndefined();
    expect(last().method).toBe('PATCH');
    expect(path()).toBe('/api/voice/sessions/s1');
    expect(await last().json()).toEqual({ warmth: 'bit_warm' });
  });

  it('nextVoiceSong returns a song', async () => {
    fetchMock.mockResolvedValue(json(SONG));
    const r = await nextVoiceSong('s1');
    expect(path()).toBe('/api/voice/sessions/s1/next');
    expect(r.kind).toBe('song');
    if (r.kind === 'song') expect(r.version.video_id).toBe('FIXTURE11');
  });

  it('nextVoiceSong returns done', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'done', reason: 'confident' }));
    await expect(nextVoiceSong('s1')).resolves.toEqual({ kind: 'done', reason: 'confident' });
  });

  it('nextVoiceSong fills a missing kind from the shape', async () => {
    const { kind: _k, ...noKind } = SONG;
    fetchMock.mockResolvedValueOnce(json(noKind)).mockResolvedValueOnce(json({ reason: 'tired' }));
    expect((await nextVoiceSong('s1')).kind).toBe('song');
    expect((await nextVoiceSong('s1')).kind).toBe('done');
  });

  it('nextVoiceSong 503 warming_up -> isWarmingUp', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'warming_up' }, 503));
    const err = await nextVoiceSong('s1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isWarmingUp(err)).toBe(true);
    expect(voiceErrorCode(err)).toBe('warming_up');
  });

  it('skipVoiceSong POSTs the skip', async () => {
    fetchMock.mockResolvedValue(noContent());
    const body = { song_key: 'artist|title', reason: 'not_embeddable', video_id: 'FIXTURE11' } as const;
    await expect(skipVoiceSong('s1', body)).resolves.toBeUndefined();
    expect(path()).toBe('/api/voice/sessions/s1/skips');
    expect(await last().json()).toEqual(body);
  });

  it('postVoiceAttempt POSTs the attempt', async () => {
    const out = { attempt_id: 's1:1', n: 1, done: false, done_reason: null, top_p: 0.4 };
    fetchMock.mockResolvedValue(json(out));
    const body = {
      song_key: 'artist|title',
      video_id: 'FIXTURE11',
      started_at: '2026-10-22T19:00:00Z',
      ended_at: '2026-10-22T19:03:00Z',
      stopped_early: false,
      quiz: { feel: 'loved', position: 'comfortable' },
      pitch: { voiced_s: 40, held_count: 6, held_low: 48, held_high: 63, p10: 50, p50: 55, p90: 61 },
    } as const;
    await expect(postVoiceAttempt('s1', body)).resolves.toEqual(out);
    expect(path()).toBe('/api/voice/sessions/s1/attempts');
    expect(await last().json()).toEqual(body);
  });

  it('getVoiceResult', async () => {
    const res = { voice_type: 'tenor', between: null, confidence_label: 'low', top_p: 0.5, low: 45, high: 69, comfort_low: 50, comfort_high: 65, attempts: 3, partial: false, improve_hint: null, done_reason: 'confident', profile_saved: true, suited: [], loved: [] };
    fetchMock.mockResolvedValue(json(res));
    await expect(getVoiceResult('s1')).resolves.toEqual(res);
    expect(path()).toBe('/api/voice/sessions/s1/result');
  });
});

describe('recordings', () => {
  const BYTES = new Uint8Array([82, 73, 70, 70]);
  const file = { bytes: jest.fn(async () => BYTES) };
  const ARGS = { sessionId: 's1', attemptN: 3, durationS: 12.5, device: 'Pixel 9', file, contentType: 'audio/mp4' } as const;

  it('voiceRecordingForm: a bytes() file part (what expo/fetch sends) plus the four fields', async () => {
    const append = jest.spyOn(FormData.prototype, 'append');
    try {
      voiceRecordingForm(ARGS);
      expect(append.mock.calls.map((c) => c[0])).toEqual(['file', 'session_id', 'attempt_n', 'duration_s', 'device']);
      expect(append.mock.calls.slice(1)).toEqual([
        ['session_id', 's1'],
        ['attempt_n', '3'],
        ['duration_s', '12.5'],
        ['device', 'Pixel 9'],
      ]);
      const part = append.mock.calls[0]![1] as unknown as { name: string; type: string; bytes(): Promise<Uint8Array> };
      // Never React Native's { uri } part: expo/fetch refuses it ("Unsupported FormDataPart implementation").
      expect(part).not.toHaveProperty('uri');
      expect(part.name).toBe('3.m4a');
      expect(part.type).toBe('audio/mp4');
      await expect(part.bytes()).resolves.toBe(BYTES);
    } finally {
      append.mockRestore();
    }
  });

  it('voiceRecordingForm: a wav file keeps decide\'s exact type, no device', () => {
    const append = jest.spyOn(FormData.prototype, 'append');
    try {
      voiceRecordingForm({ ...ARGS, device: null, contentType: 'audio/wav' });
      expect(append.mock.calls[0]![1]).toMatchObject({ name: '3.wav', type: 'audio/wav' });
      expect(append.mock.calls.map((c) => c[0])).toEqual(['file', 'session_id', 'attempt_n', 'duration_s']);
    } finally {
      append.mockRestore();
    }
  });

  it('uploadVoiceRecording sends multipart (no JSON content type) with the bearer', async () => {
    fetchMock.mockResolvedValue(json({ recording_id: 'r1' }, 201));
    await expect(uploadVoiceRecording(ARGS)).resolves.toEqual({ recording_id: 'r1' });
    const req = last();
    expect(req.method).toBe('POST');
    expect(path()).toBe('/api/voice/recordings');
    expect(req.headers.get('authorization')).toBe('Bearer tok');
    expect(req.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    const form = await req.formData();
    expect(form.get('session_id')).toBe('s1');
    expect(form.get('attempt_n')).toBe('3');
    expect(form.get('duration_s')).toBe('12.5');
    expect(form.get('device')).toBe('Pixel 9');
    expect(form.has('file')).toBe(true);
  });

  it('deleteVoiceRecordings', async () => {
    fetchMock.mockResolvedValue(json({ deleted: 2 }));
    await expect(deleteVoiceRecordings()).resolves.toEqual({ deleted: 2 });
    expect(last().method).toBe('DELETE');
    expect(path()).toBe('/api/voice/recordings');
  });

  it('voiceRecordingCount unwraps the count', async () => {
    fetchMock.mockResolvedValue(json({ count: 4 }));
    await expect(voiceRecordingCount()).resolves.toBe(4);
    expect(path()).toBe('/api/voice/recordings/count');
  });
});

const SUMMARY = {
  session_id: 's1',
  voice_type: 'baritone',
  between: null,
  confidence_label: 'low',
  top_p: 0.5,
  low: 45,
  high: 69,
  comfort_low: 50,
  comfort_high: 60,
  attempts: 3,
  evidence_attempts: 2,
  profile_saved: false,
  computed_at: '2026-10-25T18:00:00Z',
} as const;

describe('your voice data', () => {
  it('getVoiceHistory', async () => {
    const h = {
      sessions: [
        {
          session_id: 's1',
          created_at: '2026-10-25T17:00:00Z',
          state: 'done',
          result: SUMMARY,
          attempts: [
            { attempt_id: 's1:1', n: 1, song_key: 'a|t', artist: 'A', title: 'T', sung_at: null, feel: 'loved', position: 'comfortable', excluded: false, recording: { recording_id: 'r1', duration_s: 30, content_type: 'audio/mp4', bytes: 1000 }, falsetto_notes: 0 },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValue(json(h));
    await expect(getVoiceHistory()).resolves.toEqual(h);
    expect(last().method).toBe('GET');
    expect(path()).toBe('/api/voice/history');
    expect(last().headers.get('authorization')).toBe('Bearer tok');
  });

  it('voiceRecordingAudioUrl builds the owner audio URL (encoded id)', () => {
    expect(voiceRecordingAudioUrl('s1:2')).toBe('https://decide.test/api/voice/recordings/s1%3A2/audio');
  });

  it('deleteVoiceRecording DELETEs one recording (encoded id), 204', async () => {
    fetchMock.mockResolvedValue(noContent());
    await expect(deleteVoiceRecording('s1:2')).resolves.toBeUndefined();
    expect(last().method).toBe('DELETE');
    expect(last().url).toBe('https://decide.test/api/voice/recordings/s1%3A2');
  });

  it('patchVoiceAttempt PATCHes {excluded} on the encoded attempt id', async () => {
    const out = { attempt_id: 's1:2', excluded: true, result: SUMMARY, profile: 'reverted_to_mic' };
    fetchMock.mockResolvedValue(json(out));
    await expect(patchVoiceAttempt('s1:2', { excluded: true })).resolves.toEqual(out);
    expect(last().method).toBe('PATCH');
    expect(last().url).toBe('https://decide.test/api/voice/attempts/s1%3A2');
    expect(await last().json()).toEqual({ excluded: true });
  });

  it('adoptVoiceSession POSTs adopt and returns the profile', async () => {
    const prof = { low_midi: 45, high_midi: 69, comfort_low: 50, comfort_high: 60, voice_type: 'baritone', voice_type_between: null, register: null, confidence: 'low', method: 'session', measured_at: '2026-10-25T18:00:00Z', updated_at: '2026-10-25T18:00:01Z' };
    fetchMock.mockResolvedValue(json(prof));
    await expect(adoptVoiceSession('a/b')).resolves.toEqual(prof);
    expect(last().method).toBe('POST');
    expect(last().url).toBe('https://decide.test/api/voice/sessions/a%2Fb/adopt');
  });

  it('adoptVoiceSession 409 no_evidence maps', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'no_evidence' }, 409));
    const err = await adoptVoiceSession('s1').catch((e) => e);
    expect(voiceErrorCode(err)).toBe('no_evidence');
  });
});

describe('personal pool', () => {
  const POOL = {
    eligible: true,
    reason: 'history',
    listens: 1320,
    songs_with_plays: 8,
    next_allowed_at: null,
    cap: 20,
    used: 0,
    batches: [],
  };

  it('getPersonalPool reads the pool', async () => {
    fetchMock.mockResolvedValue(json(POOL));
    await expect(getPersonalPool()).resolves.toEqual(POOL);
    expect(last().method).toBe('GET');
    expect(path()).toBe('/api/voice/personal-pool');
  });

  it('requestPersonalPool POSTs with no body', async () => {
    const out = { batch_id: 'b1', songs: ['artist|title'], est_cost_usd: 0.027 };
    fetchMock.mockResolvedValue(json(out, 201));
    await expect(requestPersonalPool()).resolves.toEqual(out);
    expect(last().method).toBe('POST');
    expect(path()).toBe('/api/voice/personal-pool');
  });

  it('a 429 cap refusal carries next_allowed_at', async () => {
    const next = '2026-11-20T19:04:11.123456+00:00';
    fetchMock.mockResolvedValue(json({ detail: { reason: 'cap', next_allowed_at: next } }, 429));
    const err = await requestPersonalPool().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(personalPoolRefusal(err)).toEqual({ reason: 'cap', nextAllowedAt: next });
  });

  it.each([
    [403, { reason: 'not_eligible' }, 'not_eligible'],
    [409, { reason: 'nothing_to_add' }, 'nothing_to_add'],
    [409, { reason: 'concurrent_request' }, 'concurrent_request'],
    [503, { reason: 'budget_paused' }, 'budget_paused'],
    [503, 'warming_up', 'warming_up'],
    [403, 'voice_session_disabled', 'voice_session_disabled'],
  ] as const)('%i %j', (status, detail, reason) => {
    expect(personalPoolRefusal(new ApiError(status, detail))).toEqual({ reason, nextAllowedAt: null });
  });

  it.each([
    ['not an ApiError', new Error('boom')],
    ['a 5xx without a code', new ApiError(500, 'Internal Server Error')],
    ['an unknown reason', new ApiError(409, { reason: 'something_else' })],
    ['a 422 list', new ApiError(422, [{ msg: 'bad' }])],
  ])('null for %s', (_, e) => {
    expect(personalPoolRefusal(e)).toBeNull();
  });
});

describe('admin', () => {
  it('adminVoiceSongs encodes the email', async () => {
    fetchMock.mockResolvedValue(json([]));
    await expect(adminVoiceSongs('a+b@example.com')).resolves.toEqual([]);
    expect(last().url).toBe('https://decide.test/api/admin/voice/users/a%2Bb%40example.com/songs');
  });

  it('adminRecordingUrl builds the audio URL on the configured base', () => {
    expect(adminRecordingUrl('r/1')).toBe('https://decide.test/api/admin/voice/recordings/r%2F1/audio');
  });
});

describe('error codes', () => {
  it.each([
    [403, 'voice_session_disabled'],
    [403, 'recording_not_consented'],
    [403, 'session_forbidden'],
    [404, 'session_not_found'],
    [404, 'attempt_not_found'],
    [409, 'session_not_active'],
    [409, 'max_attempts'],
    [409, 'recordings_deleted'],
    [409, 'recording_deleted'],
    [409, 'no_evidence'],
    [413, 'recording_too_large'],
    [415, 'unsupported_media_type'],
    [422, 'empty_recording'],
    [503, 'warming_up'],
  ] as const)('%i %s', (status, code) => {
    expect(voiceErrorCode(new ApiError(status, code))).toBe(code);
  });

  it('a bare 413 / 415 (no code from a proxy) still maps', () => {
    expect(voiceErrorCode(new ApiError(413, 'Request Entity Too Large'))).toBe('recording_too_large');
    expect(voiceErrorCode(new ApiError(415, null))).toBe('unsupported_media_type');
  });

  it('anything else is null', () => {
    expect(voiceErrorCode(new ApiError(500, 'boom'))).toBeNull();
    expect(voiceErrorCode(new ApiError(422, [{ loc: ['body'], msg: 'x' }]))).toBeNull();
    expect(voiceErrorCode(new Error('max_attempts'))).toBeNull();
    expect(voiceErrorCode(undefined)).toBeNull();
  });
});

describe('isTerminalUploadError', () => {
  it.each([
    ['403 recording_not_consented', new ApiError(403, 'recording_not_consented')],
    ['403 session_forbidden', new ApiError(403, 'session_forbidden')],
    ['409 recordings_deleted', new ApiError(409, 'recordings_deleted')],
    ['409 recording_deleted (this take was deleted on Me)', new ApiError(409, 'recording_deleted')],
    ['404 attempt_not_found', new ApiError(404, 'attempt_not_found')],
    ['404 any', new ApiError(404, 'Not Found')],
    ['413', new ApiError(413, 'recording_too_large')],
    ['415', new ApiError(415, 'unsupported_media_type')],
    ['422 empty_recording', new ApiError(422, 'empty_recording')],
    ['422 validation', new ApiError(422, [{ msg: 'x' }])],
  ])('drops on %s', (_n, e) => {
    expect(isTerminalUploadError(e)).toBe(true);
  });

  it.each([
    ['500', new ApiError(500, 'boom')],
    ['503 warming_up', new ApiError(503, 'warming_up')],
    ['network (status 0)', new ApiError(0, new TypeError('Network request failed'))],
    ['a plain network TypeError', new TypeError('Network request failed')],
    ['401', new ApiError(401, 'unauthorized')],
    ['403 voice_session_disabled (the flag may come back)', new ApiError(403, 'voice_session_disabled')],
    ['429', new ApiError(429, 'slow down')],
  ])('keeps on %s', (_n, e) => {
    expect(isTerminalUploadError(e)).toBe(false);
  });
});
