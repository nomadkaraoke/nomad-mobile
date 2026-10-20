// The fixture index is too small to fill the candidate pool past PRESCORE_KEEP (200),
// so this builds a song_id.db-schema index where one artist has 260 songs and checks
// the WRatio pre-filter path. Expected values: decide's Python SongIdentifier over the
// same file (margin_bonus 0.03).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { identify, OFFLINE_MARGIN_BONUS } from '../identify';
import type { SqlReader } from '../types';

const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function buildPrescoreIndex(file: string): void {
  fs.rmSync(file, { force: true });
  const db = new Database(file);
  db.exec(`
    CREATE TABLE songs(rowid INTEGER PRIMARY KEY, artist TEXT, title TEXT, na TEXT, nt TEXT, pop INTEGER, karaoke INTEGER);
    CREATE VIRTUAL TABLE songs_fts USING fts5(na, nt, content='songs', content_rowid='rowid', tokenize='unicode61');
    CREATE TABLE artists(rowid INTEGER PRIMARY KEY, na TEXT UNIQUE, artist TEXT, pop INTEGER, songs INTEGER);
    CREATE VIRTUAL TABLE artists_fts USING fts5(na, content='artists', content_rowid='rowid', tokenize='unicode61');
    CREATE TABLE vocab(word TEXT PRIMARY KEY, freq INTEGER, first TEXT, len INTEGER) WITHOUT ROWID;
    CREATE INDEX vocab_first_len ON vocab(first, len);
    CREATE INDEX songs_na ON songs(na);
  `);
  const songs: [string, string, string, string, number | null, number][] = [];
  for (let i = 0; i < 260; i++) {
    const a = NUMBERS[i % 10]!;
    const b = NUMBERS[Math.floor(i / 10) % 10]!;
    const title = `Midnight ${a} ${b} ${i}`;
    songs.push(['Lovely Band', title, 'lovely band', title.toLowerCase(), i % 7 === 0 ? null : (i * 37) % 100, i % 2]);
  }
  songs.push(['Other Act', 'Midnight Train', 'other act', 'midnight train', 90, 1]);
  const insert = db.prepare('INSERT INTO songs(artist, title, na, nt, pop, karaoke) VALUES (?,?,?,?,?,?)');
  for (const s of songs) insert.run(...s);
  db.exec("INSERT INTO songs_fts(songs_fts) VALUES ('rebuild')");
  db.exec(
    "INSERT INTO artists(na, artist, pop, songs) VALUES ('lovely band', 'Lovely Band', 60, 260), ('other act', 'Other Act', 90, 1)",
  );
  db.exec("INSERT INTO artists_fts(artists_fts) VALUES ('rebuild')");
  const freq = new Map<string, number>();
  for (const s of songs) for (const w of new Set(`${s[2]} ${s[3]}`.split(' '))) freq.set(w, (freq.get(w) ?? 0) + 1);
  const vocab = db.prepare('INSERT INTO vocab VALUES (?,?,?,?)');
  for (const [w, f] of freq) vocab.run(w, f, w[0], w.length);
  db.close();
}

let raw: Database.Database;
let db: SqlReader;
beforeAll(() => {
  const file = path.join(os.tmpdir(), `prescore-${process.pid}.db`);
  buildPrescoreIndex(file);
  raw = new Database(file, { readonly: true });
  db = { all: <T,>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params) as T[] };
});
afterAll(() => {
  raw.close();
  fs.rmSync(raw.name, { force: true });
});

it('pre-filters a pool over 200 rows the way rapidfuzz process.extract does', () => {
  const r = identify(db, 'lovely band midnite seven three 37', { marginBonus: OFFLINE_MARGIN_BONUS });
  expect({
    status: r.status,
    candidates: r.candidates.map((c) => [c.artist, c.title, c.score, c.popularity, c.karaoke]),
  }).toEqual(EXPECTED);
});

// decide SongIdentifier(margin_bonus=0.03).identify over the same index (pool: 260 rows).
const EXPECTED = {
  status: 'candidates',
  candidates: [
    ['Lovely Band', 'Midnight eight four 37', 0.862, 69, true],
    ['Lovely Band', 'Midnight eight four 137', 0.85, 69, true],
    ['Lovely Band', 'Midnight eight four 237', 0.85, 69, true],
    ['Lovely Band', 'Midnight ten four 39', 0.821, 43, true],
    ['Lovely Band', 'Midnight eight one 7', 0.808, null, true],
  ],
};
