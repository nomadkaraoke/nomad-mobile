#!/usr/bin/env node
// Copy decide's song-search parity fixtures into packages/core (commit the copies).
//
// decide's scripts/emit_search_parity_fixtures.py writes offline_fixture.db (the
// offline index over its fixture songs) and parity.json (what the Python matcher
// answers over it). The jest parity test (packages/core/src/search/__tests__/
// parity.test.ts) runs the TS port over the same .db and compares.
//
// Usage: DECIDE_DIR=../karaoke-decide-search-parity node scripts/sync-search-fixtures.mjs
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const decideDir = resolve(repo, process.env.DECIDE_DIR || '../karaoke-decide-search-parity');
const src = join(decideDir, 'tests', 'fixtures', 'song_search');
const dst = join(repo, 'packages', 'core', 'src', 'search', '__fixtures__');
const FILES = ['offline_fixture.db', 'parity.json'];

for (const f of FILES) {
  if (!existsSync(join(src, f))) {
    console.error(`missing ${join(src, f)}: run decide's scripts/emit_search_parity_fixtures.py (or set DECIDE_DIR)`);
    process.exit(1);
  }
}
mkdirSync(dst, { recursive: true });
for (const f of FILES) {
  copyFileSync(join(src, f), join(dst, f));
  console.log(`${f} (${statSync(join(dst, f)).size} bytes) <- ${src}`);
}
