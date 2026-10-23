// Writes the synthetic privacy export the Maestro connect flows pick (connect-3):
//   maestro/fixtures/generated/spotify-extended.zip   a Spotify Extended streaming history (gitignored)
// Songs come from decide's fixture catalog (no real exports, no lyrics). Runs with plain node (type stripping):
//   node scripts/make-import-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildZip, extendedHistory, SONGS } from '../packages/core/src/imports/__fixtures__/buildExport.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'maestro/fixtures/generated');
mkdirSync(out, { recursive: true });

// Starlight played often (it must reach "Songs you know"), Rocket Man a few times, one podcast episode and one
// skip (< 30 s) that the phone leaves out.
const plays = [
  ...Array.from({ length: 12 }, (_, i) => ({ song: SONGS.starlight, ts: `2024-03-${String(i + 1).padStart(2, '0')}T20:00:00Z`, ms: 240_000 })),
  ...Array.from({ length: 4 }, (_, i) => ({ song: SONGS.rocket, ts: `2024-04-${String(i + 1).padStart(2, '0')}T21:00:00Z`, ms: 280_000 })),
  { song: SONGS.hello, ts: '2024-04-10T09:00:00Z', ms: 5_000 },
  { song: null, ts: '2024-04-11T08:00:00Z', ms: 1_200_000 },
];

const zip = buildZip({
  'Spotify Extended Streaming History/Streaming_History_Audio_2024.json': extendedHistory(plays),
  'Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46]),
});
const file = join(out, 'spotify-extended.zip');
writeFileSync(file, zip);
console.log(`wrote ${file} (${zip.length} bytes)`);
