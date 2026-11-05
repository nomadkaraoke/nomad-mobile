// node --test 'scripts/__tests__/*.test.mjs'  (CI: .github/workflows/ci.yml)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planTours } from '../ci/tour-plan.mjs';

test('crosses every tour with every locale', () => {
  const shards = planTours({ screens: 'discover-tour,me-tour', locales: 'en,ar', shards: 1 });
  assert.equal(shards.length, 1);
  assert.deepEqual(shards[0].flows.split(',').sort(), [
    'screen:discover-tour:ar',
    'screen:discover-tour:en',
    'screen:me-tour:ar',
    'screen:me-tour:en',
  ]);
});

test('balances the shards by estimated minutes', () => {
  const shards = planTours({
    screens: 'review-tour,tonight-tour,me-tour,voice-tour,fit-tour,discover-tour',
    locales: 'en',
    shards: 3,
  });
  assert.deepEqual(shards.map((s) => s.index), [1, 2, 3]);
  const minutes = shards.map((s) => s.minutes);
  assert.ok(Math.max(...minutes) - Math.min(...minutes) <= 10);
});

test('drops empty shards and defaults the locale to en', () => {
  const shards = planTours({ screens: 'voice-tour', locales: '', shards: 3 });
  assert.deepEqual(shards, [{ index: 1, flows: 'screen:voice-tour:en', minutes: 6, web: '' }]);
});
