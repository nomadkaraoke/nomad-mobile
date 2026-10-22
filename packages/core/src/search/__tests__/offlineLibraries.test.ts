// Library tags over the fixture offline.db (song_libraries; no schema bump).
import Database from 'better-sqlite3';
import path from 'node:path';

import { matchesLibrary } from '../../library';
import { offlineSongGroup, offlineSongLibraries, popularOffline, searchAvailabilityOffline } from '../offline';
import type { SqlReader } from '../types';

let raw: Database.Database;
let db: SqlReader;
beforeAll(() => {
  raw = new Database(path.join(__dirname, '..', '__fixtures__', 'offline_fixture.db'), { readonly: true });
  db = { all: <T,>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[] };
});
afterAll(() => raw.close());

describe('offlineSongLibraries', () => {
  it('returns the library codes for a song key', () => {
    const m = offlineSongLibraries(db, ['muse|starlight']);
    expect([...(m.get('muse|starlight') ?? [])].sort()).toEqual(['CC', 'KV', 'NOMAD', 'SC', 'SF']);
  });
  it('omits unknown keys, and handles empty input without querying', () => {
    expect(offlineSongLibraries(db, ['nobody|nothing']).size).toBe(0);
    expect(offlineSongLibraries(db, []).size).toBe(0);
  });
  it('chunks large key lists by 500', () => {
    const keys = Array.from({ length: 1200 }, (_, i) => `k${i}|x`);
    keys.push('muse|starlight');
    expect(offlineSongLibraries(db, keys).has('muse|starlight')).toBe(true);
  });
});

describe('groups carry libraries', () => {
  it('offlineSongGroup fills libraries', () => {
    expect(offlineSongGroup(db, 'muse|starlight')!.libraries).toContain('KV');
  });
  it('popularOffline groups carry libraries and filter with matchesLibrary', () => {
    const groups = popularOffline(db, 30);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(Array.isArray(g.libraries)).toBe(true);
    expect(groups.some((g) => g.libraries.length > 0)).toBe(true);
    const kf = groups.filter((g) => matchesLibrary({ libraries: g.libraries, versions: g.versions.map((v) => ({ kind: v.kind, brand_code: v.brandCode })) }, 'karafun'));
    for (const g of kf) expect(g.libraries.includes('KV') || g.versions.some((v) => v.brandCode === 'KV')).toBe(true);
  });
  it('searchAvailabilityOffline groups carry libraries', () => {
    expect(searchAvailabilityOffline(db, 'starlight')[0]!.libraries).toBeDefined();
  });
});
