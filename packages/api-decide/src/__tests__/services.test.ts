import { APPLE_MUSIC, configureClient, disconnectMusicService, listMusicServices, startAppleMusicLink } from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const last = (): Request => fetchMock.mock.calls.at(-1)[0];

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({
    baseUrl: 'https://decide.test',
    getToken: () => 'tok',
    getLocale: () => 'de',
    getDeviceId: () => 'dev-1',
    onUnauthorized: jest.fn(),
  });
});

describe('music services', () => {
  it('lists connected services', async () => {
    const svc = {
      service_type: APPLE_MUSIC,
      service_username: 'Apple Music',
      last_sync_at: null,
      sync_status: 'syncing',
      sync_error: null,
      tracks_synced: 0,
      songs_synced: 0,
    };
    fetchMock.mockResolvedValueOnce(json([svc]));

    expect(await listMusicServices()).toEqual([svc]);
    expect(last().url).toBe('https://decide.test/api/services');
    expect(last().headers.get('Authorization')).toBe('Bearer tok');
  });

  it('starts the Apple Music link with the app language', async () => {
    const link = { connect_url: 'https://decide.test/de/connect/apple-music?state=s&return=app', expires_in: 600 };
    fetchMock.mockResolvedValueOnce(json(link));

    expect(await startAppleMusicLink()).toEqual(link);
    expect(last().method).toBe('POST');
    expect(last().url).toBe('https://decide.test/api/services/apple-music/link');
    expect(last().headers.get('Accept-Language')).toBe('de');
  });

  it('disconnects a service', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'ok' }));

    await disconnectMusicService(APPLE_MUSIC);
    expect(last().method).toBe('DELETE');
    expect(last().url).toBe('https://decide.test/api/services/apple_music');
  });
});
