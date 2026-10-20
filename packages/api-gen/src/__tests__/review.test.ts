import {
  completeReview,
  configureClient,
  encoderHeartbeat,
  getCorrectionData,
  getInstrumentalUrls,
  getPreviewStatus,
  getVocalsPeaks,
  getWaveformData,
  previewVideoPath,
  reportClientEvent,
  requestPreview,
  saveCorrections,
  saveReviewSession,
  startReview,
  warmupEncoder,
} from '../index';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'de', onUnauthorized: jest.fn() });
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];
const lastBody = async () => JSON.parse(await lastRequest().clone().text()) as Record<string, any>;
const expectRequest = (method: string, path: string) => {
  const req = lastRequest();
  expect(req.method).toBe(method);
  expect(req.url).toBe(`https://gen.test${path}`);
  expect(req.headers.get('authorization')).toBe('Bearer tok');
};

const SEGMENT = { id: 's1', text: 'hi', start_time: 1, end_time: 2, words: [{ id: 'w1', text: 'hi', start_time: 1, end_time: 2 }] };
const DOC = {
  corrected_segments: [SEGMENT],
  original_segments: [],
  metadata: { audio_hash: 'abc', total_words: 1 },
  corrections: [],
  replay: { future: true },
} as never;

describe('review facades', () => {
  it('startReview posts an empty body', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', job_status: 'in_review' }));
    await expect(startReview('j1')).resolves.toBeUndefined();
    expectRequest('POST', '/api/jobs/j1/start-review');
    expect(await lastBody()).toEqual({});
  });

  it('getCorrectionData keeps unknown keys', async () => {
    fetchMock.mockResolvedValue(json({ ...(DOC as object), brand_new_key: { a: 1 } }));
    const doc = await getCorrectionData('j1');
    expectRequest('GET', '/api/review/j1/correction-data');
    expect(doc.corrected_segments).toHaveLength(1);
    expect(doc.brand_new_key).toEqual({ a: 1 });
    expect(doc.replay).toEqual({ future: true });
  });

  it('getCorrectionData rejects a body with no corrected_segments', async () => {
    fetchMock.mockResolvedValue(json({ metadata: {} }));
    await expect(getCorrectionData('j1')).rejects.toMatchObject({ status: 0, detail: 'invalid_response' });
  });

  it('getInstrumentalUrls maps the poll response', async () => {
    fetchMock.mockResolvedValue(
      json({
        instrumental_options: [{ id: 'clean', label: 'Clean', audio_url: '/api/review/j1/instrumental-audio/clean' }],
        audio_complete: true,
        job_status: 'in_review',
        backing_vocals_analysis: { has_audible_content: false, recommended_selection: 'clean' },
        auto_approval: { backing: { confident: true, resolved_selection: 'clean' } },
      }),
    );
    const out = await getInstrumentalUrls('j1');
    expectRequest('GET', '/api/review/j1/instrumental-urls');
    expect(out.options).toEqual([{ id: 'clean', label: 'Clean', audio_url: '/api/review/j1/instrumental-audio/clean' }]);
    expect(out.audioComplete).toBe(true);
    expect(out.backingAnalysis).toMatchObject({ recommended_selection: 'clean' });
    expect(out.autoApproval?.backing?.confident).toBe(true);
  });

  it('getInstrumentalUrls tolerates stems not ready (null audio_url, no analysis)', async () => {
    fetchMock.mockResolvedValue(json({ instrumental_options: [{ id: 'clean', label: 'Clean', audio_url: null }], audio_complete: false }));
    const out = await getInstrumentalUrls('j1');
    expect(out.options[0]?.audio_url).toBeNull();
    expect(out.audioComplete).toBe(false);
    expect(out.backingAnalysis).toBeUndefined();
  });

  describe('getVocalsPeaks', () => {
    it('maps 200 to ready', async () => {
      fetchMock.mockResolvedValue(json({ peaks_b64: 'AAEC', encoding: 'u8', peaks_per_second: 400, duration_seconds: 200 }));
      await expect(getVocalsPeaks('j1')).resolves.toEqual({ status: 'ready', peaks: 'AAEC', rate: 400 });
      expectRequest('GET', '/api/review/j1/vocals-peaks');
    });

    it('maps a 202 with Retry-After: 15 to pending', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { 'Retry-After': '15' } }));
      await expect(getVocalsPeaks('j1')).resolves.toEqual({ status: 'pending', retryAfter: 15 });
    });

    it('defaults retryAfter to 15 when the header is missing', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
      await expect(getVocalsPeaks('j1')).resolves.toEqual({ status: 'pending', retryAfter: 15 });
    });
  });

  it('getWaveformData asks for num_points and maps duration_seconds', async () => {
    fetchMock.mockResolvedValue(json({ amplitudes: [0, 0.5, 1], duration_seconds: 12.5, duration: 12.5, sample_rate: 800 }));
    await expect(getWaveformData('j1')).resolves.toEqual({ amplitudes: [0, 0.5, 1], duration: 12.5 });
    expect(lastRequest().url).toBe('https://gen.test/api/review/j1/waveform-data?num_points=800');
  });

  it('saveCorrections posts lines (= corrected_segments) and is_duet', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success' }));
    await saveCorrections('j1', DOC, true);
    expectRequest('POST', '/api/jobs/j1/corrections');
    const body = await lastBody();
    expect(body.is_duet).toBe(true);
    expect(body.corrections.lines).toEqual(body.corrections.corrected_segments);
    expect(body.corrections.replay).toEqual({ future: true });
  });

  it('completeReview posts the doc with instrumental_selection and is_duet', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', instrumental_selection: 'clean' }));
    await expect(completeReview('j1', DOC, 'auto', false)).resolves.toEqual({ status: 'success' });
    expectRequest('POST', '/api/review/j1/complete');
    const body = await lastBody();
    expect(body).toMatchObject({ instrumental_selection: 'auto', is_duet: false });
    expect(body.corrected_segments).toHaveLength(1);
  });

  it('requestPreview returns the hash for a cache hit and for a background encode', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success', preview_hash: 'h1' }));
    await expect(requestPreview('j1', DOC)).resolves.toEqual({ status: 'success', previewHash: 'h1' });
    expectRequest('POST', '/api/review/j1/preview-video');
    fetchMock.mockResolvedValue(json({ status: 'generating', preview_hash: 'h2' }));
    await expect(requestPreview('j1', DOC)).resolves.toEqual({ status: 'generating', previewHash: 'h2' });
  });

  it('requestPreview rejects a body without a hash', async () => {
    fetchMock.mockResolvedValue(json({ status: 'success' }));
    await expect(requestPreview('j1', DOC)).rejects.toMatchObject({ detail: 'invalid_response' });
  });

  it.each(['ready', 'generating', 'error'] as const)('getPreviewStatus maps %s', async (status) => {
    fetchMock.mockResolvedValue(json({ status, preview_hash: 'h1', message: 'x' }));
    await expect(getPreviewStatus('j1', 'h1')).resolves.toBe(status);
    expectRequest('GET', '/api/review/j1/preview-video/h1/status');
  });

  it('previewVideoPath is the relative API path', () => {
    expect(previewVideoPath('j1', 'h1')).toBe('/api/review/j1/preview-video/h1');
  });

  it('saveReviewSession posts a manual snapshot with a summary', async () => {
    fetchMock.mockResolvedValue(json({ status: 'saved', session_id: 's' }));
    await saveReviewSession('j1', DOC, 4);
    expectRequest('POST', '/api/review/j1/sessions');
    const body = await lastBody();
    expect(body).toMatchObject({
      edit_count: 4,
      trigger: 'manual',
      summary: { total_segments: 1, total_words: 1, corrections_made: 4, changed_words: [] },
    });
    expect(body.correction_data.replay).toEqual({ future: true });
  });

  describe('best-effort calls never throw', () => {
    it('warmupEncoder swallows a 500', async () => {
      fetchMock.mockResolvedValue(json({ detail: 'boom' }, 500));
      await expect(warmupEncoder('j1')).resolves.toBeUndefined();
      expectRequest('POST', '/api/internal/encoding-worker/warmup/j1');
    });

    it('encoderHeartbeat swallows a network error', async () => {
      fetchMock.mockRejectedValue(new TypeError('Network request failed'));
      await expect(encoderHeartbeat('j1')).resolves.toBeUndefined();
      expectRequest('POST', '/api/internal/encoding-worker/heartbeat/j1');
    });

    it('reportClientEvent posts the event and swallows failures', async () => {
      fetchMock.mockResolvedValue(json({ status: 'ok' }));
      await reportClientEvent('waveform_slow', { ms: 4000 });
      expectRequest('POST', '/api/client-events');
      expect(await lastBody()).toMatchObject({ type: 'waveform_slow', detail: { ms: 4000 } });
      fetchMock.mockResolvedValue(json({ detail: 'rate limited' }, 429));
      await expect(reportClientEvent('lyrics_load_failed', {})).resolves.toBeUndefined();
    });
  });

  it('a failing getCorrectionData surfaces ApiError(404)', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'nope' }, 404));
    await expect(getCorrectionData('j1')).rejects.toMatchObject({ status: 404 });
  });
});
