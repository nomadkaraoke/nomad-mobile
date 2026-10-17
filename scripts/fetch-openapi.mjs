// Refresh the committed OpenAPI snapshots from prod. Run via `pnpm gen:api`.
// Pass names to refresh only some (`node scripts/fetch-openapi.mjs gen`).
// GEN_OPENAPI_URL points gen at another stack, e.g. the local one:
//   GEN_OPENAPI_URL=http://127.0.0.1:8010/openapi.json node scripts/fetch-openapi.mjs gen
import { writeFile } from 'node:fs/promises';

const SOURCES = {
  gen: process.env.GEN_OPENAPI_URL || 'https://api.nomadkaraoke.com/openapi.json',
  // decide.nomadkaraoke.com only routes /api/* to Cloud Run, so fetch the spec from Cloud Run directly.
  decide: 'https://karaoke-decide-718638054799.us-central1.run.app/openapi.json',
};

const only = process.argv.slice(2);
for (const name of only) if (!(name in SOURCES)) throw new Error(`unknown snapshot "${name}" (have: ${Object.keys(SOURCES).join(', ')})`);

async function fetchJson(url) {
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
