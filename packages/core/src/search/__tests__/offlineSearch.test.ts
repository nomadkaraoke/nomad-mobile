// Typed-word search and popular list over the fixture offline.db (the phone's stand-in for decide's
// availability.search / availability.popular).
import Database from 'better-sqlite3';
import path from 'node:path';

import { popularOffline, searchAvailabilityOffline } from '../offline';
import type { SqlReader } from '../types';

let raw: Database.Database;
let db: SqlReader;
beforeAll(() => {
  raw = new Database(path.join(__dirname, '..', '__fixtures__', 'offline_fixture.db'), { readonly: true });
  db = { all: <T,>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[] };
});
afterAll(() => raw.close());

describe('searchAvailabilityOffline', () => {
  it('finds karaoke songs containing every typed word, the last one as a prefix', () => {
    const groups = searchAvailabilityOffline(db, 'blinding lig');
    expect(groups[0]).toMatchObject({ songKey: 'the weeknd|blinding lights', title: 'Blinding Lights', karaoke: true });
    expect(groups[0]!.versionCount).toBe(groups[0]!.versions.length);
    expect(groups[0]!.versions[0]!.youtubeUrl).not.toBeNull(); // playable first
  });

  it('matches the index spelling of joined single letters ("good 4 u" → "good 4u")', () => {
    expect(searchAvailabilityOffline(db, 'good 4 u').map((g) => g.songKey)).toContain('olivia rodrigo|good 4 u');
  });

  it('puts a title equal to the query before titles that only contain the words', () => {
    const titles = searchAvailabilityOffline(db, 'yellow').map((g) => g.title.toLowerCase());
    expect(titles[0]).toBe('yellow');
  });

  it('never returns a rival (karaoke = 0) and respects the limit', () => {
    const rivals = db.all<{ artist: string; title: string }>('SELECT artist, title FROM songs WHERE karaoke = 0 LIMIT 5');
    for (const r of rivals) {
      const keys = searchAvailabilityOffline(db, `${r.artist} ${r.title}`).map((g) => g.karaoke);
      expect(keys.every(Boolean)).toBe(true);
    }
    expect(searchAvailabilityOffline(db, 'the', 3).length).toBeLessThanOrEqual(3);
  });

  it.each(['', ' ', 'karaoke', '🎤🎤', '"', 'a'.repeat(250), 'שיר', '歌', 'zzzzqqq'])(
    'returns [] (never throws) for %j with no karaoke match',
    (q) => {
      expect(searchAvailabilityOffline(db, q)).toEqual([]);
    },
  );

  it('returns [] when the database errors', () => {
    const broken: SqlReader = {
      all: () => {
        throw new Error('SQLITE_CORRUPT');
      },
    };
    expect(searchAvailabilityOffline(broken, 'hello')).toEqual([]);
  });
});

describe('popularOffline', () => {
  it('lists karaoke songs by popularity with their versions', () => {
    const groups = popularOffline(db, 3);
    expect(groups.map((g) => g.title)).toEqual(['BIRDS OF A FEATHER', 'Espresso', expect.any(String)]);
    expect(groups.every((g) => g.versions.length > 0 && g.versionCount === g.versions.length)).toBe(true);
  });
});
