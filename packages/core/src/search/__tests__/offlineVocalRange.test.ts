// offlineVocalRange over offline.db (Phase 3c, schema stays 1): the song's own vr_* columns, else its artist's row
// in artist_vocal_range as a rough guess, else null; null on any SQLite error (an older list without the columns).
import Database from 'better-sqlite3';
import path from 'node:path';

import { offlineVocalRange } from '../offline';
import type { SqlReader } from '../types';

const reader = (raw: Database.Database): SqlReader => ({
  all: <T,>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[],
});

describe('offlineVocalRange (built db)', () => {
  let raw: Database.Database;
  let db: SqlReader;
  beforeAll(() => {
    raw = new Database(':memory:');
    raw.exec(`
      CREATE TABLE songs(song_key TEXT, artist TEXT, title TEXT, karaoke INTEGER,
        vr_low REAL, vr_high REAL, vr_p10 REAL, vr_p50 REAL, vr_p90 REAL, vr_tier INTEGER, vr_octave_conf REAL);
      CREATE TABLE artist_vocal_range(artist_key TEXT PRIMARY KEY, low REAL, high REAL, p10 REAL, p50 REAL, p90 REAL);
      INSERT INTO songs VALUES ('band|notes', 'Band', 'Notes', 1, 48, 70, 52, 59, 66, 3, 0.92);
      INSERT INTO songs VALUES ('band|est', 'Band', 'Est', 1, 50, 72, 54, 60, 68, 2, NULL);
      INSERT INTO songs VALUES ('beyoncé feat. jay-z|crazy', 'Beyoncé feat. Jay-Z', 'Crazy', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      INSERT INTO songs VALUES ('nobody|nothing', 'Nobody', 'Nothing', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      INSERT INTO artist_vocal_range VALUES ('beyonce', 55, 77, 58, 65, 72);
    `);
    db = reader(raw);
  });
  afterAll(() => raw.close());

  it('tier 3 song row → notes with its octave confidence', () => {
    expect(offlineVocalRange(db, 'band|notes')).toEqual({
      low: 48, high: 70, p10: 52, p50: 59, p90: 66, tier: 'notes', octaveConfidence: 0.92,
    });
  });
  it('tier 2 with a NULL octave confidence', () => {
    expect(offlineVocalRange(db, 'band|est')).toMatchObject({ tier: 'estimated', octaveConfidence: null, p50: 60 });
  });
  it('NULL song columns → the artist row (identity-normalized, feat stripped) as rough, no octave confidence', () => {
    expect(offlineVocalRange(db, 'beyoncé feat. jay-z|crazy')).toEqual({
      low: 55, high: 77, p10: 58, p50: 65, p90: 72, tier: 'rough', octaveConfidence: null,
    });
  });
  it('NULL song columns and no artist row → null; unknown key → null', () => {
    expect(offlineVocalRange(db, 'nobody|nothing')).toBeNull();
    expect(offlineVocalRange(db, 'missing|song')).toBeNull();
  });
  it('an unknown tier code (1 is never stored per song) → falls back to the artist, else null', () => {
    raw.exec(`INSERT INTO songs VALUES ('nobody|odd', 'Nobody', 'Odd', 1, 40, 60, 45, 50, 55, 1, NULL)`);
    expect(offlineVocalRange(db, 'nobody|odd')).toBeNull();
  });
});

describe('offlineVocalRange (errors)', () => {
  it('an older list without the vr_* columns or the artist table → null', () => {
    const raw = new Database(':memory:');
    raw.exec(`CREATE TABLE songs(song_key TEXT, artist TEXT, title TEXT, karaoke INTEGER)`);
    raw.exec(`INSERT INTO songs VALUES ('a|b', 'A', 'B', 1)`);
    expect(offlineVocalRange(reader(raw), 'a|b')).toBeNull();
    raw.close();
  });
  it('any reader error → null', () => {
    const bad: SqlReader = {
      all: () => {
        throw new Error('database disk image is malformed');
      },
    };
    expect(offlineVocalRange(bad, 'a|b')).toBeNull();
  });
});

describe('offlineVocalRange (decide parity fixture)', () => {
  let raw: Database.Database;
  let db: SqlReader;
  beforeAll(() => {
    raw = new Database(path.join(__dirname, '..', '__fixtures__', 'offline_fixture.db'), { readonly: true });
    db = reader(raw);
  });
  afterAll(() => raw.close());

  it('reads the fixture: Uprising (notes), Hello (estimated), Hysteria (Muse artist fallback), Shallow (none)', () => {
    expect(offlineVocalRange(db, 'muse|uprising')).toMatchObject({ tier: 'notes', p10: 52, octaveConfidence: 0.92 });
    expect(offlineVocalRange(db, 'muse|starlight')?.tier).toBe('measured');
    expect(offlineVocalRange(db, 'adele|hello')).toMatchObject({ tier: 'estimated', octaveConfidence: null });
    expect(offlineVocalRange(db, 'muse|hysteria')).toEqual({
      low: 47.6, high: 68, p10: 51.5, p50: 58.1, p90: 64.5, tier: 'rough', octaveConfidence: null,
    });
    expect(offlineVocalRange(db, 'lady gaga|shallow')).toBeNull();
  });
});
