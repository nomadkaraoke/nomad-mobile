// node --test 'scripts/__tests__/*.test.mjs'  (CI: .github/workflows/ci.yml)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALL, affectedPrefixes, parseTags, selectFlows, shard, units } from '../e2e-plan-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FLOWS = ['discover-6a-offline-warmup', 'discover-6b-offline', 'make-1-happy-path', 'review-1-approve',
  'search-4-offline', 'smoke-discover', 'tonight-1-join-link'];

test('docs-only changes run nothing', () => {
  assert.deepEqual(affectedPrefixes(['docs/TESTING.md', 'README.md', 'apps/mobile/src/review/__tests__/x.test.ts']), []);
});

test('a feature folder maps to its flows', () => {
  assert.deepEqual(affectedPrefixes(['apps/mobile/src/tonight/nightStore.ts']), ['tonight-']);
  assert.deepEqual(affectedPrefixes(['packages/review-core/src/doc.ts']), ['make-5', 'review-']);
  assert.deepEqual(affectedPrefixes(['apps/mobile/src/app/discover/voice-session/index.tsx']), ['voice-session-']);
});

test('a changed flow file runs that flow', () => {
  assert.deepEqual(affectedPrefixes(['maestro/flows/make-4-failed-job.yaml']), ['make-4-failed-job']);
});

test('shared code, deps and the harness run everything', () => {
  for (const p of ['apps/mobile/src/providers/AppProviders.tsx', 'pnpm-lock.yaml', 'maestro/common/launch.yaml',
    'scripts/e2e-local.sh', 'packages/ui/src/Button.tsx', 'apps/mobile/app.config.ts']) {
    assert.deepEqual(affectedPrefixes([p]), [ALL], p);
  }
});

test('selectFlows adds the smoke flow and keeps ALL', () => {
  assert.deepEqual(selectFlows(FLOWS, ['tonight-']), ['smoke-discover', 'tonight-1-join-link']);
  assert.deepEqual(selectFlows(FLOWS, []), []);
  assert.deepEqual(selectFlows(FLOWS, [ALL]), [...FLOWS].sort());
});

test('offline flows stay in one shard; shards balance by duration', () => {
  const tags = { 'discover-6a-offline-warmup': ['offline-warmup'], 'discover-6b-offline': ['force-offline'],
    'search-4-offline': ['force-offline'] };
  const u = units(FLOWS, tags);
  assert.deepEqual(u[0], ['discover-6a-offline-warmup', 'discover-6b-offline', 'search-4-offline']);
  const secs = { 'make-1-happy-path': 300, 'review-1-approve': 300, 'tonight-1-join-link': 300, 'smoke-discover': 10 };
  const s = shard(u, 3, secs);
  assert.equal(s.length, 3);
  assert.ok(s.some((x) => x.flows.includes('discover-6a-offline-warmup') && x.flows.includes('search-4-offline')));
  assert.equal(s.flatMap((x) => x.flows).length, FLOWS.length);
  assert.ok(Math.max(...s.map((x) => x.seconds)) - Math.min(...s.map((x) => x.seconds)) <= 300);
});

test('never more shards than units', () => {
  assert.equal(shard([['a']], 4, {}).length, 1);
});

test('parseTags reads every real flow header', () => {
  const dir = join(root, 'maestro/flows');
  const all = Object.fromEntries(readdirSync(dir).map((f) => [f, parseTags(readFileSync(join(dir, f), 'utf8'))]));
  assert.deepEqual(all['search-4-offline.yaml'], ['force-offline']);
  assert.ok(all['tonight-1-join-link.yaml'].includes('tonight'));
  assert.deepEqual(parseTags('appId: x\n---\n- launchApp\n'), []);
});
