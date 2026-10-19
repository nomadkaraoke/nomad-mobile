// The TS matcher must give decide's Python answers over the same offline index.
// Fixtures: decide's scripts/emit_search_parity_fixtures.py, copied by
// scripts/sync-search-fixtures.mjs (schema documented at the top of that script).
import Database from 'better-sqlite3';
import path from 'node:path';

import { identify, OFFLINE_MARGIN_BONUS } from '../identify';
import { identifyKind } from '../kind';
import { offlineGroups } from '../offline';
import type { IdentifyResult, OfflineGroup, SongRef, SqlReader } from '../types';
import parity from '../__fixtures__/parity.json';

type PyRef = {
  artist: string;
  title: string;
  score: number;
  popularity: number | null;
  karaoke: boolean;
  song_key: string;
  detail?: Record<string, number>;
};
type PyGroup = {
  song_key: string;
  artist: string;
  title: string;
  karaoke: boolean;
  version_count: number;
  versions: { brand_code: string; brand_name: string; kind: string; youtube_url: string | null; rank: number }[];
};
type Case = {
  q: string;
  identify: { status: string; best: PyRef | null; candidates: PyRef[] };
  kind: string | null;
  groups: PyGroup[];
};

const CASES = parity as Case[];
const REVIEW_FOCUS_1 = ['', ' ', 'karaoke', 'x', '🎤🎤', 'a'.repeat(250), 'שיר', '歌'];

/** better-sqlite3 → SqlReader (the app wraps expo-sqlite's getAllSync the same way). */
function betterSqliteReader(db: Database.Database): SqlReader {
  return { all: <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[] };
}

let raw: Database.Database;
let db: SqlReader;
beforeAll(() => {
  raw = new Database(path.join(__dirname, '..', '__fixtures__', 'offline_fixture.db'), { readonly: true });
  db = betterSqliteReader(raw);
});
afterAll(() => raw.close());

function ref(r: SongRef) {
  return { artist: r.artist, title: r.title, songKey: r.songKey, popularity: r.popularity, karaoke: r.karaoke };
}
function pyRef(r: PyRef) {
  return { artist: r.artist, title: r.title, songKey: r.song_key, popularity: r.popularity, karaoke: r.karaoke };
}
function pyGroup(g: PyGroup): OfflineGroup {
  return {
    songKey: g.song_key,
    artist: g.artist,
    title: g.title,
    karaoke: true,
    versionCount: g.version_count,
    versions: g.versions.map((v) => ({
      brandCode: v.brand_code,
      brandName: v.brand_name,
      kind: v.kind as 'community' | 'commercial',
      youtubeUrl: v.youtube_url,
      rank: v.rank,
    })),
  };
}

describe('parity fixture', () => {
  it('covers every status and the Review Focus 1 inputs', () => {
    const statuses = new Set(CASES.map((c) => c.identify.status));
    expect(statuses).toEqual(new Set(['confident', 'candidates', 'none']));
    for (const q of REVIEW_FOCUS_1) expect(CASES.some((c) => c.q === q)).toBe(true);
  });
});

describe.each(CASES.map((c, i) => [i, JSON.stringify(c.q).slice(0, 60), c] as const))(
  'parity #%i %s',
  (_i, _label, c) => {
    let got: IdentifyResult;
    beforeAll(() => {
      got = identify(db, c.q, { marginBonus: OFFLINE_MARGIN_BONUS });
    });

    it('identify matches Python', () => {
      expect(got.status).toBe(c.identify.status);
      const want = c.identify;
      if (want.best === null) {
        expect(got.best).toBeNull();
      } else {
        expect(got.best).not.toBeNull();
        expect(ref(got.best!)).toEqual(pyRef(want.best));
        expect(Math.abs(got.best!.score - want.best.score)).toBeLessThan(1e-6);
        const detail = want.best.detail!;
        for (const [k, v] of Object.entries(detail)) {
          expect(Math.abs((got.best!.detail as Record<string, number>)[k]! - v)).toBeLessThan(1e-6);
        }
      }
      expect(got.candidates.map(ref)).toEqual(want.candidates.map(pyRef));
      got.candidates.forEach((cand, k) => {
        expect(Math.abs(cand.score - want.candidates[k]!.score)).toBeLessThan(1e-6);
      });
    });

    it('identifyKind matches Python', () => {
      const kind = got.best ? identifyKind(c.q, got.best.artist, got.best.title) : null;
      expect(kind).toBe(c.kind);
    });

    it('offlineGroups matches Python', () => {
      expect(offlineGroups(db, got)).toEqual(c.groups.map(pyGroup));
    });
  },
);

describe('Review Focus 1: queries the matcher has never seen', () => {
  it.each(REVIEW_FOCUS_1)('%j → none, no groups, no throw', (q) => {
    const r = identify(db, q, { marginBonus: OFFLINE_MARGIN_BONUS });
    expect(r.status).toBe('none');
    expect(offlineGroups(db, r)).toEqual([]);
  });
});

describe('identify options', () => {
  it('limit caps the candidates list', () => {
    const r = identify(db, 'toto africa', { limit: 2 });
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]!.songKey).toBe(r.best!.songKey);
  });

  it('marginBonus downgrades a close confident answer (Python gives the same over this index)', () => {
    const cloud = identify(db, 'Life Is');
    expect(cloud.status).toBe('confident');
    expect([cloud.best!.artist, cloud.best!.title]).toEqual(['Bon Jovi', "It's My Life"]);
    expect(identify(db, 'Life Is', { marginBonus: OFFLINE_MARGIN_BONUS }).status).toBe('candidates');
  });

  it('marginBonus keeps the same-title popularity verdict (one margin bar, ruling R7)', () => {
    const r = identify(db, 'die young', { marginBonus: OFFLINE_MARGIN_BONUS });
    expect([r.status, r.best!.artist]).toEqual(['confident', 'Kesha']);
  });

  it('marginBonus 0 is kjbox exactly: never less confident than offline', () => {
    for (const c of CASES) {
      if (c.identify.status !== 'confident') continue;
      expect(identify(db, c.q).status).toBe('confident');
    }
  });
});
