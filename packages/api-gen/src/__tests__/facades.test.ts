import jobsSummaryFixture from './fixtures/jobs-summary.json';
import {
  ApiError,
  cancelJob,
  communityCheck,
  configureClient,
  confirmDuration,
  createAppCheckout,
  createHandoffUrl,
  createJobFromSearch,
  createJobFromUrl,
  exchangeAppleToken,
  exchangeGoogleToken,
  getJob,
  getMe,
  isApiError,
  JobSummarySchema,
  listCreditPackages,
  listMyJobs,
  matchJudge,
  retryJob,
  searchAudio,
  sendCode,
  validateUrl,
  verifyCode,
} from '../index';

const fetchMock = jest.fn();
const onUnauthorized = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  onUnauthorized.mockReset();
  global.fetch = fetchMock as never;
  configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'de', onUnauthorized });
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];
const lastBody = async () => JSON.parse(await lastRequest().clone().text()) as unknown;
const expectRequest = (method: string, path: string) => {
  const req = lastRequest();
  expect(req.method).toBe(method);
  expect(req.url).toBe(`https://gen.test${path}`);
  expect(req.headers.get('authorization')).toBe('Bearer tok');
};

const USER = { email: 'a@b.co', role: 'user', credits: 3 };
const VERIFY = {
  status: 'success',
  session_token: 'sess-1',
  user: USER,
  message: 'Signed in',
  credits_granted: 2,
  credit_status: 'granted',
};
const SESSION = { token: 'sess-1', email: 'a@b.co', credits: 3, creditsGranted: 2 };

describe('auth', () => {
  it('sendCode posts email + locale', async () => {
    fetchMock.mockResolvedValue(json({ status: 'sent' }, 202));
    await expect(sendCode('a@b.co', 'fr')).resolves.toBeUndefined();
    expectRequest('POST', '/api/users/auth/send-code');
    expect(await lastBody()).toEqual({ email: 'a@b.co', locale: 'fr' });
  });

  it('a wrong code (401 from /api/users/auth/*) does not sign out', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'invalid_code' }, 401));
    await expect(verifyCode('a@b.co', '000000')).rejects.toMatchObject({ status: 401, detail: 'invalid_code' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('verifyCode maps the verify response to a GenSession', async () => {
    fetchMock.mockResolvedValue(json(VERIFY));
    await expect(verifyCode('a@b.co', '123456')).resolves.toEqual(SESSION);
    expectRequest('POST', '/api/users/auth/verify-code');
    expect(await lastBody()).toEqual({ email: 'a@b.co', code: '123456' });
  });

  it.each([
    ['google', exchangeGoogleToken],
    ['apple', exchangeAppleToken],
  ])('exchange %s token posts id_token + locale and maps the session', async (provider, exchange) => {
    fetchMock.mockResolvedValue(json(VERIFY));
    await expect(exchange('id-tok', 'ja')).resolves.toEqual(SESSION);
    expectRequest('POST', `/api/users/auth/${provider}`);
    expect(await lastBody()).toEqual({ id_token: 'id-tok', locale: 'ja' });
  });

  it('defaults creditsGranted to 0 when absent', async () => {
    const { credits_granted: _omit, ...rest } = VERIFY;
    fetchMock.mockResolvedValue(json(rest));
    await expect(exchangeGoogleToken('id-tok', 'en')).resolves.toMatchObject({ creditsGranted: 0 });
  });

  it('a social sign-in error surfaces as ApiError through the shared interceptor', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'invalid_token' }, 401));
    const err = await exchangeAppleToken('bad', 'en').catch((e: unknown) => e);
    expect(isApiError(err, 401, 'invalid_token')).toBe(true);
    // a failed sign-in attempt is not a dead session
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a malformed response throws ApiError invalid_response', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success' }));
    const err = await exchangeGoogleToken('id-tok', 'en').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, detail: 'invalid_response' });
  });

  it('getMe returns email and credits', async () => {
    fetchMock.mockResolvedValue(json({ user: USER, has_session: true }));
    await expect(getMe()).resolves.toEqual({ email: 'a@b.co', credits: 3 });
    expectRequest('GET', '/api/users/me');
  });

  it('a 401 from handoff-token (session expired) still signs out', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'invalid_session' }, 401));
    await expect(createHandoffUrl('job-1', 'en')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('createHandoffUrl posts job_review target and returns the url', async () => {
    fetchMock.mockResolvedValue(json({ url: 'https://gen.web/en/auth/verify?token=x&handoff=1', expires_in_seconds: 120 }));
    await expect(createHandoffUrl('job-1', 'es')).resolves.toBe('https://gen.web/en/auth/verify?token=x&handoff=1');
    expectRequest('POST', '/api/users/auth/handoff-token');
    expect(await lastBody()).toEqual({ target: 'job_review', job_id: 'job-1', locale: 'es' });
  });
});

describe('credits', () => {
  it('listCreditPackages maps to camelCase packages', async () => {
    fetchMock.mockResolvedValue(
      json({ packages: [{ id: '5', credits: 5, price_cents: 3500, name: '5 credits', description: 'Save 30%' }] }),
    );
    await expect(listCreditPackages()).resolves.toEqual([{ id: '5', credits: 5, priceCents: 3500, name: '5 credits' }]);
    expect(lastRequest().url).toBe('https://gen.test/api/users/credits/packages');
  });

  it('createAppCheckout asks for an app return and returns the checkout url', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', checkout_url: 'https://checkout.stripe.com/c/x', message: 'ok' }));
    await expect(createAppCheckout('5', 'a@b.co')).resolves.toBe('https://checkout.stripe.com/c/x');
    expectRequest('POST', '/api/users/credits/checkout');
    expect(await lastBody()).toEqual({ package_id: '5', email: 'a@b.co', return_to: 'app' });
  });
});

describe('make', () => {
  const RESULT = {
    index: 0,
    title: 'Pink Pony Club',
    artist: 'Chappell Roan',
    provider: 'Spotify',
    is_lossless: false,
    seeders: null,
    year: 2020,
    quality_data: { format: 'OGG', bitrate: 320, bit_depth: null },
    match_score: 0.98,
  };

  it('searchAudio posts artist/title and returns the session and parsed results', async () => {
    fetchMock.mockResolvedValue(json({ search_session_id: 'ss-1', results: [RESULT], results_count: 1 }));
    const res = await searchAudio('Chappell Roan', 'Pink Pony Club');
    expectRequest('POST', '/api/audio-search/search-standalone');
    expect(await lastBody()).toEqual({ artist: 'Chappell Roan', title: 'Pink Pony Club' });
    expect(res.sessionId).toBe('ss-1');
    expect(res.results).toHaveLength(1);
    // nulls inside quality_data are dropped so results fit core's AudioResultLike.
    expect(res.results[0]?.quality_data).toEqual({ format: 'OGG', bitrate: 320 });
    expect(res.results[0]).toMatchObject({ index: 0, provider: 'Spotify', match_score: 0.98 });
  });

  it('searchAudio exposes a 402 credit detail on ApiError', async () => {
    fetchMock.mockResolvedValue(json({ detail: { credits_available: 0, credits_required: 1 } }, 402));
    const err = await searchAudio('a', 'b').catch((e: unknown) => e);
    expect(isApiError(err, 402)).toBe(true);
    expect((err as ApiError).detail).toEqual({ credits_available: 0, credits_required: 1 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('createJobFromSearch sends the selection with auto review, public', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', job_id: 'job-9', message: 'ok' }));
    await expect(createJobFromSearch({ sessionId: 'ss-1', index: 2, artist: 'A', title: 'T' })).resolves.toBe('job-9');
    expectRequest('POST', '/api/jobs/create-from-search');
    expect(await lastBody()).toEqual({
      search_session_id: 'ss-1',
      selection_index: 2,
      artist: 'A',
      title: 'T',
      review_mode: 'auto',
      is_private: false,
    });
  });

  it('createJobFromUrl sends the url with auto review, public', async () => {
    fetchMock.mockResolvedValue(
      json({ status: 'success', job_id: 'job-u', message: 'ok', detected_artist: null, detected_title: null, server_version: '1' }),
    );
    await expect(createJobFromUrl({ url: 'https://youtu.be/x', artist: 'A', title: 'T' })).resolves.toBe('job-u');
    expectRequest('POST', '/api/jobs/create-from-url');
    expect(await lastBody()).toEqual({
      url: 'https://youtu.be/x',
      artist: 'A',
      title: 'T',
      review_mode: 'auto',
      is_private: false,
    });
  });
});

describe('catalog checks', () => {
  const VERDICT = {
    kind: 'cosmetic',
    confident: true,
    canonical_artist: 'Queen',
    canonical_title: 'Bohemian Rhapsody',
    alternatives: [],
    engine: 'catalog',
    reason: 'case',
    needs_ai: false,
  };

  it('matchJudge posts the stage and tier and returns the verdict', async () => {
    fetchMock.mockResolvedValue(json(VERDICT));
    const v = await matchJudge({ artist: 'queen', title: 'bohemian rhapsody', stage: 'full', audio_confidence_tier: 3 });
    expectRequest('POST', '/api/catalog/match-judge');
    expect(await lastBody()).toEqual({ artist: 'queen', title: 'bohemian rhapsody', stage: 'full', audio_confidence_tier: 3 });
    expect(v).toEqual(VERDICT);
  });

  it('matchJudge fills defaults and treats an unknown kind as none', async () => {
    const { alternatives: _a, reason: _r, needs_ai: _n, ...bare } = VERDICT;
    fetchMock.mockResolvedValue(json({ ...bare, kind: 'something_new' }));
    const v = await matchJudge({ artist: 'a', title: 'b', stage: 'fast' });
    expect(v).toMatchObject({ kind: 'none', alternatives: [], reason: '', needs_ai: false });
  });

  it('communityCheck posts artist/title', async () => {
    const body = {
      has_community: true,
      songs: [{ artist: 'A', title: 'T', community_tracks: [{ brand_name: 'Nomad', brand_code: 'NOMAD', youtube_url: 'https://youtu.be/c', is_community: true }] }],
      best_youtube_url: 'https://youtu.be/c',
    };
    fetchMock.mockResolvedValue(json(body));
    await expect(communityCheck({ artist: 'A', title: 'T' })).resolves.toEqual(body);
    expectRequest('POST', '/api/catalog/community-check');
    expect(await lastBody()).toEqual({ artist: 'A', title: 'T' });
  });

  it('validateUrl returns supported, with the detail only when gen gives one', async () => {
    fetchMock.mockResolvedValue(json({ supported: true, detail: null }));
    await expect(validateUrl('https://vimeo.com/1')).resolves.toEqual({ supported: true });
    expectRequest('POST', '/api/jobs/validate-url');
    expect(await lastBody()).toEqual({ url: 'https://vimeo.com/1' });
    fetchMock.mockResolvedValue(json({ supported: false, detail: 'DRM' }));
    await expect(validateUrl('https://netflix.com/x')).resolves.toEqual({ supported: false, detail: 'DRM' });
  });
});

describe('jobs', () => {
  it('the job summary schema accepts gen list_jobs payloads', () => {
    for (const job of jobsSummaryFixture) expect(JobSummarySchema.safeParse(job).success).toBe(true);
  });

  it('listMyJobs requests the summary projection and parses every job', async () => {
    // Fixture: GET /api/jobs?fields=summary captured from the gen local stack (v0.278.0, fake workers).
    fetchMock.mockResolvedValue(json(jobsSummaryFixture));
    const jobs = await listMyJobs('Fixture-1792228616@Example.com');
    expectRequest('GET', '/api/jobs?fields=summary');
    expect(jobs.map((j) => [j.job_id, j.status])).toEqual([
      ['fd5e6f81', 'awaiting_review'],
      ['15108d56', 'failed'],
      ['12999be4', 'awaiting_duration_confirm'],
      ['1760c524', 'complete'],
    ]);
    expect(jobs[1]).toMatchObject({ credit_refunded: true, error_message: 'lyrics failed: Fake lyrics worker failed (fail_at=lyrics)' });
    // unknown fields pass through for later screens (e.g. error_details for retry states)
    expect(jobs[1]).toMatchObject({ error_details: { stage: 'lyrics' } });
    expect(jobs[2]?.state_data).toMatchObject({ pending_additional_credits: 1, duration_actual_seconds: 660 });
    expect(jobs[3]?.state_data).toMatchObject({ youtube_url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(jobs[3]?.file_urls).toHaveProperty('finals');
  });

  it('listMyJobs drops other users\' jobs (gen returns everyone\'s to an admin session)', async () => {
    const other = { ...jobsSummaryFixture[0], job_id: 'not-mine', user_email: 'someone@else.com' };
    const noEmail = { ...jobsSummaryFixture[1], job_id: 'no-email', user_email: undefined };
    fetchMock.mockResolvedValue(json([other, jobsSummaryFixture[0], noEmail]));
    const jobs = await listMyJobs('fixture-1792228616@example.com');
    expect(jobs.map((j) => j.job_id)).toEqual(['fd5e6f81']);
  });

  it('listMyJobs drops a malformed job with a warning instead of failing the list', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = { job_id: 'legacy', user_email: 'fixture-1792228616@example.com' }; // no status
    const noCreatedAt = { ...jobsSummaryFixture[3], created_at: null };
    fetchMock.mockResolvedValue(json([legacy, noCreatedAt]));
    const jobs = await listMyJobs('fixture-1792228616@example.com');
    expect(jobs.map((j) => j.job_id)).toEqual(['1760c524']);
    expect(warn).toHaveBeenCalledWith('listMyJobs: dropping malformed job', 'legacy');
    warn.mockRestore();
  });

  it('listMyJobs still rejects a non-list body', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'nope' }));
    await expect(listMyJobs('singer@example.com')).rejects.toMatchObject({ status: 0, detail: 'invalid_response' });
  });

  it('getJob returns the detail with download urls', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...jobsSummaryFixture[3],
        download_urls: { finals: { lossy_720p_mp4: '/api/jobs/1760c524/download/finals/lossy_720p_mp4' } },
        timeline: [],
      }),
    );
    const job = await getJob('1760c524');
    expectRequest('GET', '/api/jobs/1760c524');
    expect(job.download_urls).toEqual({ finals: { lossy_720p_mp4: '/api/jobs/1760c524/download/finals/lossy_720p_mp4' } });
    expect(job.title).toBe('Fake Song');
  });

  it('confirmDuration posts acknowledged credits', async () => {
    fetchMock.mockResolvedValue(json({ job_id: 'j', status: 'downloading_audio' }));
    await expect(confirmDuration('j', 3)).resolves.toBeUndefined();
    expectRequest('POST', '/api/jobs/j/confirm-duration');
    expect(await lastBody()).toEqual({ acknowledged_credits: 3 });
  });

  it('cancelJob posts to cancel', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', message: 'Cancelled' }));
    await expect(cancelJob('j')).resolves.toBeUndefined();
    expectRequest('POST', '/api/jobs/j/cancel');
  });

  it('retryJob posts keep_trying false like the web Retry', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', job_id: 'j', message: 'Retrying' }));
    await expect(retryJob('j')).resolves.toBeUndefined();
    expectRequest('POST', '/api/jobs/j/retry');
    expect(await lastBody()).toEqual({ keep_trying: false });
  });

  it('retryJob with keepTrying asks gen to wait up to an hour for a stalled download', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', job_id: 'j', message: 'Retrying' }));
    await retryJob('j', { keepTrying: true });
    expectRequest('POST', '/api/jobs/j/retry');
    expect(await lastBody()).toEqual({ keep_trying: true });
  });
});

describe('isApiError', () => {
  const e = new ApiError(409, 'not_in_review');
  it('matches status and optional string detail', () => {
    expect(isApiError(e, 409)).toBe(true);
    expect(isApiError(e, 409, 'not_in_review')).toBe(true);
    expect(isApiError(e, 409, 'other')).toBe(false);
    expect(isApiError(e, 402)).toBe(false);
    expect(isApiError(new Error('x'), 409)).toBe(false);
  });
});
