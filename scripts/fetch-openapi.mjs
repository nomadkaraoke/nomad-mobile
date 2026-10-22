// Refresh the committed OpenAPI snapshots from prod. Run via `pnpm gen:api`.
// kjbox is read from a file (KJBOX_OPENAPI_PATH), not a URL.
// Pass names to refresh only some (`node scripts/fetch-openapi.mjs gen`).
// GEN_OPENAPI_URL points gen at another stack, e.g. the local one:
//   GEN_OPENAPI_URL=http://127.0.0.1:8010/openapi.json node scripts/fetch-openapi.mjs gen
// DECIDE_OPENAPI_URL points decide (main API) at another stack, e.g. a local uvicorn of an unreleased branch:
//   DECIDE_OPENAPI_URL=http://127.0.0.1:8030/openapi.json node scripts/fetch-openapi.mjs decide
// DECIDE_SEARCH_OPENAPI_URL points decide-search at another stack. UNTIL THE SEARCH SERVICE IS DEPLOYED the
// default URL below does not answer yet: pass the decide search local stack (scripts/search-local-stack.sh up in
// karaoke-decide), identical code to prod:
//   DECIDE_SEARCH_OPENAPI_URL=http://127.0.0.1:8020/api/search/openapi.json node scripts/fetch-openapi.mjs decide-search
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

// kjbox's contract is a committed file in the kjbox repo, not served by a URL. KJBOX_OPENAPI_PATH overrides;
// otherwise prefer the singer-app-api worktree while that branch is unmerged, else the main clone.
const KJBOX_REL = 'kj-controller/docs/api/singer-v1.openapi.json';
const KJBOX_PATH =
  process.env.KJBOX_OPENAPI_PATH ||
  [`../kjbox-singer-app-api/${KJBOX_REL}`, `../kjbox/${KJBOX_REL}`].find((p) => existsSync(p)) ||
  `../kjbox/${KJBOX_REL}`;

const SOURCES = {
  kjbox: KJBOX_PATH,
  gen: process.env.GEN_OPENAPI_URL || 'https://api.nomadkaraoke.com/openapi.json',
  // decide.nomadkaraoke.com only routes /api/* to Cloud Run, so fetch the spec from Cloud Run directly.
  decide: process.env.DECIDE_OPENAPI_URL || 'https://karaoke-decide-718638054799.us-central1.run.app/openapi.json',
  // Search service (karaoke-decide backend/search), a separate Cloud Run service served publicly under
  // decide.nomadkaraoke.com/api/search*; its spec lives under that prefix too, so the Worker routes it.
  'decide-search': process.env.DECIDE_SEARCH_OPENAPI_URL || 'https://decide.nomadkaraoke.com/api/search/openapi.json',
};

const only = process.argv.slice(2);
for (const name of only) if (!(name in SOURCES)) throw new Error(`unknown snapshot "${name}" (have: ${Object.keys(SOURCES).join(', ')})`);

async function fetchJson(url) {
  if (!/^https?:/.test(url)) return JSON.parse(await readFile(url, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 2) throw new Error(`${url}: ${err.message}`);
      console.warn(`${url}: ${err.message}, retrying (Cloud Run cold start?)`);
    }
  }
}

for (const [name, url] of Object.entries(SOURCES)) {
  if (only.length && !only.includes(name)) continue;
  const json = await fetchJson(url);
  await writeFile(`openapi/${name}.json`, JSON.stringify(json, null, 2) + '\n');
  console.log(`${name}: ${Object.keys(json.paths).length} paths (${url})`);
}
