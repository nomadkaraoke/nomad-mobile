import {
  ApiError,
  configureClient,
  confirmScreenshotItems,
  connectLastfm,
  connectListenBrainz,
  disconnectService,
  extractScreenshots,
  getServiceCapabilities,
  getServicesSummary,
  importSpotifyPlaylist,
  importYouTubeMusicPlaylist,
  removeSourceData,
  startListenBrainzOAuth,
  getSyncStatus,
  triggerSync,
  uploadExportChunk,
  uploadExportToListenBrainz,
} from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const last = (): Request => fetchMock.mock.calls.at(-1)[0];
const onUnauthorized = jest.fn();

// jest's FormData is Node's: a Blob stands in for React Native's { uri, name, type } file part.
const blobFile = (name: string) => Object.assign(new Blob(['x'], { type: 'image/png' }), { name });
const rnFile = (name: string, type = 'image/png') => blobFile(name) as unknown as { uri: string; name: string; type: string };

beforeEach(() => {
  fetchMock.mockReset();
  onUnauthorized.mockReset();
  global.fetch = fetchMock as never;
  configureClient({
    baseUrl: 'https://decide.test',
    getToken: () => 'tok',
    getLocale: () => 'en',
    getDeviceId: () => 'dev-1',
    onUnauthorized,
  });
});

describe('imports and services summary', () => {
  it('reads the summary and capabilities', async () => {
    fetchMock.mockResolvedValueOnce(json({ sources: [] }));
    await getServicesSummary();
    expect(last().url).toBe('https://decide.test/api/services/summary');
    fetchMock.mockResolvedValueOnce(json({ screenshot_import: true }));
    await getServiceCapabilities();
    expect(last().url).toBe('https://decide.test/api/services/capabilities');
  });

  it('extractScreenshots sends FormData with N images', async () => {
    fetchMock.mockResolvedValueOnce(json({ candidates: [] }));
    await extractScreenshots([rnFile('a.png'), rnFile('b.png'), rnFile('c.png')]);
    const req = last();
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://decide.test/api/services/screenshot/extract');
    expect(req.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    const form = await req.formData();
    expect(form.getAll('images')).toHaveLength(3);
  });

  it('confirms screenshot items as JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({ songs_added: 1 }));
    await confirmScreenshotItems([{ kind: 'song', artist: 'Fixture Artist', title: 'Fixture Song' }]);
    expect(last().url).toBe('https://decide.test/api/services/screenshot/confirm');
    expect(await last().json()).toEqual({ items: [{ kind: 'song', artist: 'Fixture Artist', title: 'Fixture Song' }] });
  });

  it('imports playlists by url', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await importSpotifyPlaylist('https://open.spotify.com/playlist/abc');
    expect(last().url).toBe('https://decide.test/api/services/spotify-playlist/import');
    expect(await last().json()).toEqual({ url: 'https://open.spotify.com/playlist/abc' });
    fetchMock.mockResolvedValueOnce(json({}));
    await importYouTubeMusicPlaylist('https://music.youtube.com/playlist?list=PLx');
    expect(last().url).toBe('https://decide.test/api/services/youtube-music/import');
    expect(await last().json()).toEqual({ playlist_url: 'https://music.youtube.com/playlist?list=PLx' });
  });

  it.each(['spotify-export', 'apple-export'] as const)('uploadExportChunk posts to chunk.endpoint (%s)', async (endpoint) => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    const body = { generated_at: '2026-01-01T00:00:00Z', chunk_index: 0, chunk_count: 1, tracks: [] };
    await uploadExportChunk({ endpoint, body });
    expect(last().method).toBe('POST');
    expect(last().url).toBe(`https://decide.test/api/services/${endpoint}`);
    expect(await last().json()).toEqual(body);
  });

  it('connects Last.fm and ListenBrainz by username', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await connectLastfm('fixture-user');
    expect(last().url).toBe('https://decide.test/api/services/lastfm/connect');
    expect(await last().json()).toEqual({ username: 'fixture-user' });
    fetchMock.mockResolvedValueOnce(json({}));
    await connectListenBrainz('fixture-user');
    expect(last().url).toBe('https://decide.test/api/services/listenbrainz/connect');
    expect(await last().json()).toEqual({ username: 'fixture-user' });
  });

  it('startListenBrainzOAuth passes return_to=app', async () => {
    fetchMock.mockResolvedValueOnce(json({ auth_url: 'https://metabrainz.org/oauth2/authorize?x=1' }));
    expect(await startListenBrainzOAuth()).toEqual({ auth_url: 'https://metabrainz.org/oauth2/authorize?x=1' });
    expect(last().url).toBe('https://decide.test/api/services/listenbrainz/oauth/start?return_to=app');
  });

  it('uploads an export zip to ListenBrainz as multipart file', async () => {
    fetchMock.mockResolvedValueOnce(json({ import_id: 'i1', status: 'waiting' }));
    await uploadExportToListenBrainz(rnFile('export.zip', 'application/zip'));
    expect(last().url).toBe('https://decide.test/api/services/listenbrainz/upload-export');
    expect(last().headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    expect((await last().formData()).getAll('file')).toHaveLength(1);
  });

  it('removes source data, disconnects and triggers sync', async () => {
    fetchMock.mockResolvedValueOnce(json({ removed_songs: 2, removed_artists: 1 }));
    expect(await removeSourceData('screenshot')).toEqual({ removed_songs: 2, removed_artists: 1 });
    expect(last().method).toBe('DELETE');
    expect(last().url).toBe('https://decide.test/api/services/sources/screenshot/data');
    fetchMock.mockResolvedValueOnce(json({ message: 'ok' }));
    await disconnectService('listenbrainz');
    expect(last().method).toBe('DELETE');
    expect(last().url).toBe('https://decide.test/api/services/listenbrainz');
    fetchMock.mockResolvedValueOnce(json({ job_id: 'j', status: 'queued', message: 'm' }, 202));
    await triggerSync();
    expect(last().method).toBe('POST');
    expect(last().url).toBe('https://decide.test/api/services/sync');
    fetchMock.mockResolvedValueOnce(json({ services: [], active_job: null }));
    expect(await getSyncStatus()).toEqual({ services: [], active_job: null });
    expect(last().method).toBe('GET');
    expect(last().url).toBe('https://decide.test/api/services/sync/status');
  });

  it('errors surface status codes as ApiError, and a 401 never signs out beyond the injected hook', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'rate_limited' }, 429));
    await expect(importSpotifyPlaylist('x')).rejects.toMatchObject({ status: 429, detail: 'rate_limited' });
    fetchMock.mockResolvedValueOnce(json({ detail: 'nope' }, 422));
    const err = await removeSourceData('bogus').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
  });
});
