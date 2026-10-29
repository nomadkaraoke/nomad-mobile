import {
  configureClient,
  createSetlist,
  deleteSetlist,
  dismissGetMade,
  getGetMade,
  getLibrary,
  getSongCrowd,
  listSetlists,
  listSongHistory,
  putSetlistItems,
  renameSetlist,
  undismissGetMade,
} from '../index';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];
const pl = (id: string) => ({ id, name: id, description: null, song_ids: [], song_count: 0, created_at: 't', updated_at: 't', items: [], rev: 1 });

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({
    baseUrl: 'https://decide.test',
    getToken: () => 'gen-tok',
    getLocale: () => 'en',
    getDeviceId: () => 'dev',
    onUnauthorized: jest.fn(),
  });
});

describe('getLibrary', () => {
  it('sends If-None-Match and returns items + etag on 200', async () => {
    fetchMock.mockResolvedValue(json({ items: [{ key: 'u:a|b', artist: 'A' }], etag: '"v2"' }, 200, { etag: '"v2"' }));
    const res = await getLibrary('"abc"');
    expect(lastRequest().headers.get('if-none-match')).toBe('"abc"');
    expect(new URL(lastRequest().url).pathname).toBe('/api/my/library');
    expect(res).toEqual({ status: 'ok', etag: '"v2"', items: [{ key: 'u:a|b', artist: 'A' }] });
  });

  it('omits If-None-Match without an etag, and falls back to the body etag', async () => {
    fetchMock.mockResolvedValue(json({ items: [], etag: '"body"' }));
    const res = await getLibrary();
    expect(lastRequest().headers.has('if-none-match')).toBe(false);
    expect(res).toEqual({ status: 'ok', etag: '"body"', items: [] });
  });

  it('maps a 304 to not-modified', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
    await expect(getLibrary('"abc"')).resolves.toEqual({ status: 'not-modified' });
  });

  it('still throws other errors', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'nope' }, 500));
    await expect(getLibrary()).rejects.toMatchObject({ status: 500 });
  });
});

describe('setlists', () => {
  it('listSetlists concatenates pages until total is reached', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ playlists: [pl('pl_1'), pl('pl_2')], total: 3 }))
      .mockResolvedValueOnce(json({ playlists: [pl('pl_3')], total: 3 }));
    const all = await listSetlists();
    expect(all.map((p) => p.id)).toEqual(['pl_1', 'pl_2', 'pl_3']);
    const u0 = new URL(fetchMock.mock.calls[0][0].url);
    const u1 = new URL(fetchMock.mock.calls[1][0].url);
    expect(u0.searchParams.get('limit')).toBe('100');
    expect(u0.searchParams.get('offset')).toBe('0');
    expect(u1.searchParams.get('offset')).toBe('2');
  });

  it('listSetlists stops on an empty page', async () => {
    fetchMock.mockResolvedValueOnce(json({ playlists: [], total: 5 }));
    await expect(listSetlists()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('createSetlist POSTs id, name and items', async () => {
    fetchMock.mockResolvedValue(json(pl('pl_abcdefgh'), 201));
    const items = [{ song_key: 'a|b', artist: 'A', title: 'B' }];
    await createSetlist({ id: 'pl_abcdefgh', name: 'Fri', items });
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(await req.json()).toEqual({ id: 'pl_abcdefgh', name: 'Fri', items });
  });

  it('putSetlistItems PUTs {items, base_rev}', async () => {
    fetchMock.mockImplementation(async () => json(pl('pl_abcdefgh')));
    const items = [{ item_id: 'i1', song_key: 'a|b/c', artist: 'A', title: 'B' }];
    await putSetlistItems('pl_abcdefgh', items, 4);
    expect(lastRequest().method).toBe('PUT');
    expect(new URL(lastRequest().url).pathname).toBe('/api/playlists/pl_abcdefgh/items');
    expect(await lastRequest().json()).toEqual({ items, base_rev: 4 });
    await putSetlistItems('pl_abcdefgh', items, null);
    expect(await lastRequest().json()).toEqual({ items, base_rev: null });
  });

  it('renameSetlist PUTs the name', async () => {
    fetchMock.mockResolvedValue(json(pl('pl_abcdefgh')));
    await renameSetlist('pl_abcdefgh', 'New');
    expect(lastRequest().method).toBe('PUT');
    expect(new URL(lastRequest().url).pathname).toBe('/api/playlists/pl_abcdefgh');
    expect(await lastRequest().json()).toEqual({ name: 'New' });
  });

  it('deleteSetlist DELETEs and resolves void on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteSetlist('pl_abcdefgh')).resolves.toBeUndefined();
    expect(lastRequest().method).toBe('DELETE');
    expect(new URL(lastRequest().url).pathname).toBe('/api/playlists/pl_abcdefgh');
  });
});

describe('listSongHistory', () => {
  it('passes the library key as `song` (encoded) and follows cursors', async () => {
    const e = (id: string) => ({ id, source: 'app', state: 'sung', artist: 'A', title: 'T' });
    fetchMock
      .mockResolvedValueOnce(json({ entries: [e('app_1')], next_cursor: 'c2' }))
      .mockResolvedValueOnce(json({ entries: [e('app_2')], next_cursor: null }));
    const all = await listSongHistory('u:a|b/c');
    expect(all.map((x) => x.id)).toEqual(['app_1', 'app_2']);
    const u0 = new URL(fetchMock.mock.calls[0][0].url);
    const u1 = new URL(fetchMock.mock.calls[1][0].url);
    expect(u0.searchParams.get('song')).toBe('u:a|b/c');
    expect(u0.searchParams.get('cursor')).toBeNull();
    expect(u1.searchParams.get('song')).toBe('u:a|b/c');
    expect(u1.searchParams.get('cursor')).toBe('c2');
  });
});

describe('get this made', () => {
  const item = { key: 'u:a|b', song_key: null, artist: 'A', title: 'B', why: 'sung', weight: 0.8 };

  it('getGetMade GETs /api/my/get-made and returns the items', async () => {
    fetchMock.mockResolvedValue(json({ items: [item] }));
    await expect(getGetMade()).resolves.toEqual([item]);
    expect(lastRequest().method).toBe('GET');
    expect(new URL(lastRequest().url).pathname).toBe('/api/my/get-made');
  });

  it('getGetMade throws on a 503 warming_up', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'warming_up' }, 503));
    await expect(getGetMade()).rejects.toMatchObject({ status: 503 });
  });

  it('dismissGetMade POSTs and undismissGetMade DELETEs the encoded key', async () => {
    const key = 'u:ac/dc|back in black #1';
    const enc = encodeURIComponent(key);
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(dismissGetMade(key)).resolves.toBeUndefined();
    expect(lastRequest().method).toBe('POST');
    expect(lastRequest().url).toBe(`https://decide.test/api/my/get-made/${enc}/dismiss`);
    await expect(undismissGetMade(key)).resolves.toBeUndefined();
    expect(lastRequest().method).toBe('DELETE');
    expect(lastRequest().url).toBe(`https://decide.test/api/my/get-made/${enc}/dismiss`);
  });
});

describe('getSongCrowd', () => {
  it('encodes a key containing | and / and returns the figure', async () => {
    const crowd = {
      singers: 6,
      comfortable_share: 0.8333,
      too_high_share: 0.1667,
      too_low_share: 0,
      bucket: 'baritone',
      bucket_singers: 5,
      bucket_comfortable_share: 1,
      crowd_pleaser_share: null,
    };
    fetchMock.mockResolvedValue(json(crowd));
    await expect(getSongCrowd('ac/dc|back in black')).resolves.toEqual(crowd);
    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().url).toBe('https://decide.test/api/songs/ac%2Fdc%7Cback%20in%20black/crowd');
  });
});
