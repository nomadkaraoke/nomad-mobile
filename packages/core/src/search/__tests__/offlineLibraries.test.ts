// Library tags over the fixture offline.db (song_libraries; no schema bump).
import Database from 'better-sqlite3';
import path from 'node:path';

import { matchesLibrary } from '../../library';
import { offlineGroups, offlineSongGroup, offlineSongLibraries, popularOffline, searchAvailabilityOffline } from '../offline';
import type { IdentifyResult, SqlReader } from '../types';

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

describe('offlineSongLibraries errors', () => {
  it('swallows only a missing song_libraries table, with a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const old: SqlReader = {
      all: () => {
        throw new Error('no such table: song_libraries');
      },
    };
    expect(offlineSongLibraries(old, ['a|b']).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('re-throws any other error', () => {
    const bad: SqlReader = {
      all: () => {
        throw new Error('database disk image is malformed');
      },
    };
    expect(() => offlineSongLibraries(bad, ['a|b'])).toThrow('malformed');
  });
});

describe('groups carry libraries', () => {
  it('offlineGroups (identify path) fills libraries via offlineSongGroup', () => {
    const g = offlineGroups(db, {
      status: 'confident',
      best: { artist: 'Muse', title: 'Starlight', detail: {} },
      candidates: [],
    } as unknown as IdentifyResult);
    expect(g[0]!.libraries).toContain('KV');
  });
  it('offlineSongGroup fills libraries', () => {
    expect(offlineSongGroup(db, 'muse|starlight')!.libraries).toContain('KV');
  });
  it('popularOffline groups carry libraries and filter with matchesLibrary', () => {
    const groups = popularOffline(db, 30);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(Array.isArray(g.libraries)).toBe(true);
    expect(groups.some((g) => g.libraries.length > 0)).toBe(true);
    const starlight = offlineSongGroup(db, 'muse|starlight')!;
    const tagged = {
      libraries: starlight.libraries,
      versions: starlight.versions.map((v) => ({ kind: v.kind, brand_code: v.brandCode })),
    };
    expect(matchesLibrary(tagged, 'karafun')).toBe(true);
    expect(matchesLibrary(tagged, 'community')).toBe(true);
  });
  it('searchAvailabilityOffline groups carry libraries', () => {
    expect(searchAvailabilityOffline(db, 'starlight')[0]!.libraries).toBeDefined();
  });
});
