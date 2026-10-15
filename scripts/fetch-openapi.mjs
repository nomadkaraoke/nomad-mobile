// Refresh the committed OpenAPI snapshots from prod. Run via `pnpm gen:api`.
import { writeFile } from 'node:fs/promises';

const SOURCES = {
  gen: 'https://api.nomadkaraoke.com/openapi.json',
  // decide.nomadkaraoke.com only routes /api/* to Cloud Run, so fetch the spec from Cloud Run directly.
  decide: 'https://karaoke-decide-718638054799.us-central1.run.app/openapi.json',
};

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
  const json = await fetchJson(url);
  await writeFile(`openapi/${name}.json`, JSON.stringify(json, null, 2) + '\n');
  console.log(`${name}: ${Object.keys(json.paths).length} paths`);
}
