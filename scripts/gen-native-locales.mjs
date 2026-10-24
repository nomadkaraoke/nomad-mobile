#!/usr/bin/env node
// Generates apps/mobile/locales/<code>.json (Expo app config `locales`) from @nomad/i18n messages:
//   { "ios": { "NSMicrophoneUsageDescription": <permissions.microphone> } }
// One file per locale in packages/i18n/src/locales.ts. `--check` writes nothing and exits 1 on drift (CI).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const messagesDir = join(root, 'packages/i18n/messages');
const outDir = join(root, 'apps/mobile/locales');
const check = process.argv.includes('--check');

const localesSrc = readFileSync(join(root, 'packages/i18n/src/locales.ts'), 'utf8');
const list = /LOCALES\s*=\s*\[([^\]]*)\]/.exec(localesSrc)?.[1];
const locales = [...(list ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (locales.length === 0) {
  console.error('Could not parse LOCALES from packages/i18n/src/locales.ts');
  process.exit(2);
}

const expected = new Map();
for (const code of locales) {
  const messages = JSON.parse(readFileSync(join(messagesDir, `${code}.json`), 'utf8'));
  const text = messages.permissions?.microphone;
  if (typeof text !== 'string' || !text) {
    console.error(`messages/${code}.json is missing permissions.microphone`);
    process.exit(2);
  }
  expected.set(`${code}.json`, `${JSON.stringify({ ios: { NSMicrophoneUsageDescription: text } }, null, 2)}\n`);
}

if (check) {
  const problems = [];
  const present = existsSync(outDir) ? readdirSync(outDir) : [];
  for (const [file, content] of expected) {
    const actual = present.includes(file) ? readFileSync(join(outDir, file), 'utf8') : null;
    if (actual !== content) problems.push(`${file}: ${actual === null ? 'missing' : 'out of date'}`);
  }
  for (const file of present) if (!expected.has(file)) problems.push(`${file}: unexpected`);
  if (problems.length) {
    console.error(`apps/mobile/locales is stale; run: node scripts/gen-native-locales.mjs\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`native locales OK (${expected.size} files)`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [file, content] of expected) writeFileSync(join(outDir, file), content);
  console.log(`wrote ${expected.size} files to apps/mobile/locales`);
}
