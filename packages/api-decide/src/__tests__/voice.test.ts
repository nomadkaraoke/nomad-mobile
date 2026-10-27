import {
  ApiError,
  configureClient,
  deleteVoiceProfile,
  getRecommendationsV2,
  getSongVocalRange,
  getVoiceProfile,
  getVoiceProfiles,
  isWarmingUp,
  putVoiceProfile,
  type RecommendationsV2Response,
} from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const last = (): Request => fetchMock.mock.calls.at(-1)[0];

const IN = {
  low_midi: 45,
  high_midi: 64,
  comfort_low: 50,
  comfort_high: 59,
  voice_type: 'baritone',
  voice_type_between: null,
  register: null,
  confidence: 'medium',
  method: 'mic',
  measured_at: '2026-10-22T18:00:00.000Z',
} as const;
const OUT = { ...IN, updated_at: '2026-10-22T18:00:01Z' };

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

describe('voice profile', () => {
  it('getVoiceProfile unwraps {profile}', async () => {
    fetchMock.mockResolvedValue(json({ profile: OUT }));
    await expect(getVoiceProfile()).resolves.toEqual(OUT);
    expect(new URL(last().url).pathname).toBe('/api/my/voice');
    expect(last().method).toBe('GET');
    expect(last().headers.get('authorization')).toBe('Bearer tok');
  });

  it('getVoiceProfiles keeps the profile, the mic result and the latest session', async () => {
    const latest = { session_id: 's1', voice_type: 'tenor', between: null, confidence_label: 'low', top_p: 0.4, low: 48, high: 70, comfort_low: 52, comfort_high: 63, attempts: 3, evidence_attempts: 3, profile_saved: false, computed_at: '2026-10-25T18:00:00Z' };
    fetchMock.mockResolvedValue(json({ profile: OUT, mic: OUT, latest_session: latest }));
    await expect(getVoiceProfiles()).resolves.toEqual({ profile: OUT, mic: OUT, latestSession: latest });
    expect(new URL(last().url).pathname).toBe('/api/my/voice');
  });

  it('getVoiceProfiles: an older decide without mic / latest_session gives nulls', async () => {
    fetchMock.mockResolvedValue(json({ profile: null }));
    await expect(getVoiceProfiles()).resolves.toEqual({ profile: null, mic: null, latestSession: null });
  });

  it('getVoiceProfile is null when there is none', async () => {
    fetchMock.mockResolvedValue(json({ profile: null }));
    await expect(getVoiceProfile()).resolves.toBeNull();
  });

  it('putVoiceProfile PUTs exactly the profile fields', async () => {
    fetchMock.mockResolvedValue(json(OUT));
    await expect(putVoiceProfile(IN)).resolves.toEqual(OUT);
    expect(last().method).toBe('PUT');
    expect(new URL(last().url).pathname).toBe('/api/my/voice');
    expect(await last().json()).toEqual(IN);
  });

  it('putVoiceProfile surfaces a 503 as ApiError', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'warming_up' }, 503));
    const err = await putVoiceProfile(IN).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isWarmingUp(err)).toBe(true);
  });

  it('deleteVoiceProfile DELETEs and resolves on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteVoiceProfile()).resolves.toBeUndefined();
    expect(last().method).toBe('DELETE');
    expect(new URL(last().url).pathname).toBe('/api/my/voice');
  });
});

describe('getSongVocalRange', () => {
  it('encodes the key once and returns the body', async () => {
    const body = {
      song_key: 'a b|c',
      range: { low: 45, high: 62, p10: 47, p50: 55, p90: 60, tier: 'measured', octave_confidence: 0.9, is_duet: false },
    };
    fetchMock.mockResolvedValue(json(body));
    await expect(getSongVocalRange('a b|c')).resolves.toEqual(body);
    expect(last().url).toBe('https://decide.test/api/catalog/songs/a%20b%7Cc/vocal-range');
  });

  it('range can be null', async () => {
    fetchMock.mockResolvedValue(json({ song_key: 'k', range: null }));
    await expect(getSongVocalRange('k')).resolves.toEqual({ song_key: 'k', range: null });
  });
});

describe('recommendations v2 fit', () => {
  it('sends singable and sort=fit; types carry fit and voice', async () => {
    const res: RecommendationsV2Response = {
      sections: [
        {
          id: 'all',
          title: 'All',
          songs: [{ song_key: 'k', artist: 'A', title: 'T', fit: { bucket: 'comfortable', transpose: 0, octave: 0, tier: 'measured' } } as never],
        } as never,
      ],
      has_profile: true,
      voice: { has_profile: true, method: 'mic' },
    } as never;
    fetchMock.mockResolvedValue(json(res));
    const out = await getRecommendationsV2({ singable: 'true', sort: 'fit' });
    const url = new URL(last().url);
    expect(url.searchParams.get('singable')).toBe('true');
    expect(url.searchParams.get('sort')).toBe('fit');
    expect(out.voice).toEqual({ has_profile: true, method: 'mic' });
    expect(out.sections[0]?.songs[0]?.fit).toEqual({ bucket: 'comfortable', transpose: 0, octave: 0, tier: 'measured' });
  });
});
