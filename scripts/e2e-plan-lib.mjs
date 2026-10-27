// Pure logic behind scripts/e2e-plan.mjs (tested by scripts/__tests__/e2e-plan.test.mjs with `node --test`):
// which Maestro flows a change affects, and how to split them into shards of about equal run time.

/** Flow-name prefixes (file name without .yaml starts with one) run for a changed path. `ALL` runs every flow. */
export const ALL = '*';

// First match wins. Paths are repo-relative. Anything under apps/ or packages/ that no rule names runs every flow
// (a shared module can break any screen); docs and other non-app files run none.
const RULES = [
  // Changes that need no device run.
  [/^docs\//, []],
  [/\.md$/, []],
  [/^\.github\/workflows\/(?!e2e\.yml$)/, []],
  [/(^|\/)__tests__\//, []],
  [/\.test\.tsx?$/, []],
  [/^apps\/mobile\/locales\//, []],
  // The suite itself.
  [/^maestro\/flows\/([^/]+)\.yaml$/, (m) => [m[1]]],
  [/^maestro\/screens\//, []],
  [/^maestro\/durations\.json$/, []],
  [/^maestro\//, [ALL]],
  [/^scripts\/(e2e-|ci\/|stack-control\.py|make-import-fixtures)/, [ALL]],
  [/^\.github\/workflows\/e2e\.yml$/, [ALL]],
  // Feature areas (route folders under src/app and their logic folders under src).
  [/^apps\/mobile\/src\/app\/discover\/connect\//, ['connect-']],
  [/^apps\/mobile\/src\/app\/discover\/voice-session/, ['voice-session-']],
  [/^apps\/mobile\/src\/app\/discover\/voice/, ['voice-']],
  [/^apps\/mobile\/src\/(app\/discover|discover|find)\//, ['discover-', 'search-', 'smoke-', 'voice-3', 'make-10']],
  [/^apps\/mobile\/src\/app\/song\//, ['search-', 'discover-', 'make-8', 'make-10']],
  [/^apps\/mobile\/src\/(app\/(make|job|credits)|make|jobs|credits)(\/|\.tsx?$)/, ['make-', 'search-2', 'tonight-7', 'purchase-']],
  [/^apps\/mobile\/src\/(app\/review|review)\//, ['review-', 'make-5']],
  [/^packages\/review-core\//, ['review-', 'make-5']],
  [/^apps\/mobile\/src\/(app\/tonight|tonight)\//, ['tonight-']],
  [/^packages\/api-kjbox\//, ['tonight-']],
  [/^apps\/mobile\/src\/voiceSession\//, ['voice-session-']],
  [/^apps\/mobile\/src\/voice\//, ['voice-', 'discover-5']],
  [/^apps\/mobile\/src\/offline\//, ['search-4', 'discover-6', 'me-6']],
  [/^apps\/mobile\/src\/app\/me\//, ['me-', 'discover-5', 'connect-', 'account-', 'notify-']],
  [/^apps\/mobile\/src\/app\/sign-in\//, ['make-1', 'make-2', 'make-7', 'discover-1', 'tonight-2']],
  [/^apps\/mobile\/src\/audio\//, ['review-', 'voice-']],
  [/^apps\/mobile\/src\/media\//, ['make-1', 'voice-session-']],
  [/^packages\/api-decide\//, ['discover-', 'search-', 'connect-', 'voice-', 'me-']],
  [/^packages\/api-gen\//, ['make-', 'review-', 'purchase-', 'account-']],
  [/^packages\/core\/src\/search\//, ['search-', 'make-10', 'discover-6']],
  [/^packages\/i18n\//, ['smoke-', 'review-9']],
  [/^(apps|packages)\//, [ALL]],
  [/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json)$/, [ALL]],
];

/** The flow-name prefixes a change touches: [ALL], or a (possibly empty) list. */
export function affectedPrefixes(changedPaths) {
  const out = new Set();
  for (const path of changedPaths) {
    for (const [re, target] of RULES) {
      const m = re.exec(path);
      if (!m) continue;
      for (const p of typeof target === 'function' ? target(m) : target) out.add(p);
      break;
    }
    if (out.has(ALL)) return [ALL];
  }
  return [...out].sort();
}

/** Flow names (no .yaml) selected by the prefixes; `smoke-discover` always runs when anything does. */
export function selectFlows(allFlows, prefixes) {
  if (prefixes.includes(ALL)) return [...allFlows].sort();
  const picked = allFlows.filter((f) => prefixes.some((p) => f === p || f.startsWith(p)));
  if (picked.length && allFlows.includes('smoke-discover') && !picked.includes('smoke-discover')) picked.push('smoke-discover');
  return picked.sort();
}

/**
 * Groups that must share a run (one e2e-local.sh invocation): the offline warm-up (discover-6a) leaves the picks the
 * force-offline discover-6b reads, and both force-offline flows need the Metro restart e2e-local.sh does once per run.
 * `tags` maps a flow to its Maestro tags.
 */
export function units(flows, tags) {
  const offline = flows.filter((f) => (tags[f] ?? []).some((t) => t === 'force-offline' || t === 'offline-warmup'));
  const rest = flows.filter((f) => !offline.includes(f)).map((f) => [f]);
  return offline.length ? [offline, ...rest] : rest;
}

/** Greedy longest-first split of the units into at most `n` shards of about equal estimated seconds. */
export function shard(unitList, n, seconds, fallback = 75) {
  const cost = (u) => u.reduce((s, f) => s + (seconds[f] ?? fallback), 0);
  const shards = Array.from({ length: Math.max(1, Math.min(n, unitList.length)) }, () => ({ flows: [], seconds: 0 }));
  for (const u of [...unitList].sort((a, b) => cost(b) - cost(a) || a[0].localeCompare(b[0]))) {
    const target = shards.reduce((best, s) => (s.seconds < best.seconds ? s : best));
    target.flows.push(...u);
    target.seconds += cost(u);
  }
  return shards.filter((s) => s.flows.length).map((s, index) => ({ index, ...s, flows: s.flows.sort() }));
}

/** Maestro tags of a flow file's YAML header (the `tags:` list before the `---`). */
export function parseTags(yaml) {
  const header = yaml.split(/^---$/m)[0];
  const m = /^tags:\s*\n((?:\s+-\s*.+\n?)+)/m.exec(header);
  return m ? [...m[1].matchAll(/-\s*(\S+)/g)].map((x) => x[1]) : [];
}
