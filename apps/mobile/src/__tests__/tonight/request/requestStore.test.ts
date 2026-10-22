import type { SearchSong, SearchVersion } from '@nomad/api-kjbox';

import { defaultChoice, sourceFor, useRequestStore } from '../../../tonight/request/requestStore';

const kn = (i: number): SearchVersion => ({ source: 'kn', kn: { brand_code: `B${i}`, youtube_url: `https://youtu.be/${i}` } });
const song = (versions: SearchVersion[]): SearchSong => ({ key: 'k', artist: 'Muse', title: 'Starlight', version_count: versions.length, versions });

beforeEach(() => useRequestStore.getState().clear());

describe('kj_pick sends every version (ruling E5-R2, A.24)', () => {
  it('a 60-version song submits all 60; the box trims to 50', () => {
    const versions = Array.from({ length: 60 }, (_, i) => kn(i));
    const body = sourceFor(song(versions), 'auto');
    expect(body.source_type).toBe('kj_pick');
    expect(body.source_ref).toBeNull();
    expect((body.source_meta as { versions: unknown[] }).versions).toHaveLength(60);
  });

  it('"Request this song" auto-selects for several versions and binds the only one otherwise', () => {
    expect(defaultChoice(song([kn(1), kn(2)]))).toBe('auto');
    const only = kn(1);
    expect(defaultChoice(song([only]))).toBe(only);
  });
});

describe('sourceFor binds a concrete version like the web', () => {
  it('local → path', () => {
    const v: SearchVersion = { source: 'local', local: { path: '/lib/a.mp4', artist: 'Muse', title: 'Starlight' } };
    expect(sourceFor(song([v]), v)).toMatchObject({ source_type: 'local', source_ref: '/lib/a.mp4' });
  });
  it('kn with a divebar mirror → divebar file id', () => {
    const v: SearchVersion = { source: 'kn', kn: { brand_code: 'SC', divebar: { file_id: 'f1', format: 'mp4', drive_path: 'x' } } };
    expect(sourceFor(song([v]), v)).toMatchObject({ source_type: 'divebar', source_ref: 'f1' });
  });
  it('kn without a mirror → its YouTube url', () => {
    expect(sourceFor(song([kn(3)]), kn(3))).toMatchObject({ source_type: 'kn', source_ref: 'https://youtu.be/3' });
  });
});

describe('requestStore', () => {
  it('mints a fresh client_request_id per pick (one per confirm)', () => {
    const a = useRequestStore.getState().pick(song([kn(1)]), 'auto', 'starl');
    const b = useRequestStore.getState().pick(song([kn(1)]), 'auto', 'starl');
    expect(a.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.clientRequestId).not.toBe(b.clientRequestId);
    expect(useRequestStore.getState().pending?.clientRequestId).toBe(b.clientRequestId);
  });

  it('change mode rides along on the pick; clear() forgets it', () => {
    useRequestStore.getState().startChange({ id: 7, title: 'Old Song' });
    const p = useRequestStore.getState().pick(song([kn(1)]), 'auto');
    expect(p).toMatchObject({ mode: 'change', replaces: { id: 7, title: 'Old Song' } });
    useRequestStore.getState().clear();
    expect(useRequestStore.getState()).toMatchObject({ mode: 'new', pending: null, replaces: undefined });
  });
});
