#!/usr/bin/env node
// CI (.github/workflows/e2e.yml, dispatch input `screens`): shards for maestro/screens/* tours, as the workflow's
// matrix JSON. Each shard's `flows` is "screen:<tour>:<locale>,..." and scripts/ci/run-shard.sh runs them one by one.
//
//   node scripts/ci/tour-plan.mjs --screens discover-tour,me-tour --locales en,ar --shards 3
import { pathToFileURL } from 'node:url';

// Rough minutes per tour, only to balance the shards (they are slower on a loaded lane).
const MINUTES = {
  'review-tour': 25,
  'tonight-tour': 20,
  'me-tour': 15,
  'voice-session-tour': 12,
  'store-tour': 8,
};
const DEFAULT_MINUTES = 6;

const list = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function planTours({ screens, locales, shards }) {
  const items = list(screens)
    .flatMap((screen) => (list(locales).length ? list(locales) : ['en']).map((locale) => ({ screen, locale })))
    .map((t) => ({ ...t, minutes: MINUTES[t.screen] ?? DEFAULT_MINUTES }))
    .sort((a, b) => b.minutes - a.minutes);
  const bins = Array.from({ length: Math.max(1, shards) }, () => ({ minutes: 0, items: [] }));
  for (const item of items) {
    const bin = bins.reduce((min, b) => (b.minutes < min.minutes ? b : min));
    bin.items.push(item);
    bin.minutes += item.minutes;
  }
  return bins
    .filter((b) => b.items.length)
    .map((b, i) => ({
      index: i + 1,
      flows: b.items.map((t) => `screen:${t.screen}:${t.locale}`).join(','),
      minutes: b.minutes,
      web: '',
    }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  console.log(
    JSON.stringify(planTours({ screens: arg('screens'), locales: arg('locales'), shards: Number(arg('shards') ?? 1) })),
  );
}
