#!/usr/bin/env node
// Markdown summary of an E2E run's JUnit reports (CI job summary; scripts/e2e-ci.sh prints it too).
//   node scripts/ci/e2e-report.mjs DIR   # DIR holds e2e-<platform>-<shard>/junit-<run>.xml (download-artifact layout)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.log('No E2E reports (no shard ran, or every shard failed before Maestro).');
  process.exit(0);
}

const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** { platform, shard, flow, ok, seconds, message } per <testcase> in a Maestro JUnit file. */
export function parseJunit(xml, platform, shard) {
  const out = [];
  // Guard against a report from the other platform (a stale file on a self-hosted runner): iOS runs on a simulator
  // UDID, Android on an emulator / AVD name, never a UDID.
  const device = /device="([^"]*)"/.exec(xml)?.[1] ?? '';
  const udid = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i.test(device);
  if (device && (platform === 'ios') !== udid) return out;
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = m[3] ?? '';
    const failure = /<(failure|error)\b([^>]*)>?([\s\S]*?)(<\/\1>|$)/.exec(body);
    out.push({
      platform,
      shard,
      flow: unescape(attr(m[1], 'name')),
      ok: !failure,
      seconds: Number(attr(m[1], 'time')) || 0,
      message: failure ? unescape(attr(failure[2], 'message') || failure[3] || '').trim().split('\n')[0].slice(0, 200) : '',
    });
  }
  return out;
}

const rows = [];
const shardsSeen = [];
for (const d of readdirSync(dir).sort()) {
  const m = /^e2e-(ios|android)-(\d+)$/.exec(d);
  if (!m) continue;
  shardsSeen.push(d);
  const files = readdirSync(join(dir, d));
  const first = files.filter((x) => /^junit-\d+\.xml$/.test(x)).flatMap((f) => parseJunit(readFileSync(join(dir, d, f), 'utf8'), m[1], Number(m[2])));
  // run-shard.sh retries failed flows once (junit-retry-<n>.xml): passed on retry = flaky.
  const retried = new Map(files.filter((x) => /^junit-retry-\d+\.xml$/.test(x))
    .flatMap((f) => parseJunit(readFileSync(join(dir, d, f), 'utf8'), m[1], Number(m[2]))).map((r) => [r.flow, r]));
  for (const r of first) {
    const again = retried.get(r.flow);
    rows.push(!r.ok && again?.ok ? { ...r, ok: true, flaky: true, message: r.message } : r);
  }
}

for (const platform of ['ios', 'android']) {
  const mine = rows.filter((r) => r.platform === platform);
  const shards = shardsSeen.filter((s) => s.startsWith(`e2e-${platform}-`));
  if (!shards.length) continue;
  const failed = mine.filter((r) => !r.ok);
  const mins = Math.round(mine.reduce((s, r) => s + r.seconds, 0) / 60);
  console.log(`### ${platform}: ${mine.length - failed.length}/${mine.length} passed (${shards.length} shards, ${mins} min of flow time)`);
  for (const r of failed) console.log(`- ❌ \`${r.flow}\` (shard ${r.shard}): ${r.message || 'failed'}`);
  for (const r of mine.filter((x) => x.flaky)) console.log(`- ⚠️ flaky \`${r.flow}\` (shard ${r.shard}): passed on retry; first run: ${r.message || 'failed'}`);
  if (!mine.length) console.log('- no JUnit report: the shard failed before Maestro ran (see its log)');
  console.log('');
}
