#!/usr/bin/env node
// Plans a Maestro run: which flows to run and how to shard them (CI: .github/workflows/e2e.yml).
//
//   node scripts/e2e-plan.mjs --shards 4                      # every flow, 4 shards
//   node scripts/e2e-plan.mjs --shards 4 --base origin/main   # only the flows the diff from the merge base affects
//   node scripts/e2e-plan.mjs --shards 4 --filter tonight --skip tonight-9
//
// Prints JSON: { "flows": [...], "prefixes": [...], "shards": [{ "index", "flows", "seconds" }], "seconds" }.
// --base: changed paths come from `git diff --name-only <base>...HEAD` (see scripts/e2e-plan-lib.mjs for the
// path → flow rules; an unmapped app/package path runs everything). --filter / --skip match flow file names like
// scripts/e2e-local.sh does. Shards are balanced with maestro/durations.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, affectedPrefixes, parseTags, selectFlows, shard, units } from './e2e-plan-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const flowsDir = join(root, 'maestro/flows');
let flows = readdirSync(flowsDir).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5));
const tags = Object.fromEntries(flows.map((f) => [f, parseTags(readFileSync(join(flowsDir, `${f}.yaml`), 'utf8'))]));

let prefixes = [ALL];
const base = opt('base');
if (base) {
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  prefixes = affectedPrefixes(changed);
}
flows = selectFlows(flows, prefixes);
const filter = opt('filter', '');
const skip = opt('skip', '');
if (filter) flows = flows.filter((f) => f.includes(filter));
if (skip) flows = flows.filter((f) => !f.includes(skip));

const { seconds } = JSON.parse(readFileSync(join(root, 'maestro/durations.json'), 'utf8'));
const shards = flows.length ? shard(units(flows, tags), Number(opt('shards', '1')), seconds) : [];
const total = shards.reduce((s, x) => s + x.seconds, 0);
process.stdout.write(`${JSON.stringify({ flows, prefixes, shards, seconds: total })}\n`);
