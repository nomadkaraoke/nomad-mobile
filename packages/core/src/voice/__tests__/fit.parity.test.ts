import { fitSong, isSingable, tierFromCode, TIER_CODE } from '../fit';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cases: any[] = require('../__fixtures__/fit_cases.json');

test.each(cases.map((c): [string, any] => [c.name, c]))('%s matches decide', (_n, c) => {
  const r = fitSong(
    {
      low: c.user.low,
      high: c.user.high,
      comfortLow: c.user.comfort_low,
      comfortHigh: c.user.comfort_high,
    },
    { ...c.song, octaveConfidence: c.song.octave_confidence ?? null },
  );
  expect([r.bucket, r.transpose, r.octave]).toEqual([
    c.expect.bucket,
    c.expect.transpose,
    c.expect.octave,
  ]);
  expect(r.cost).toBeCloseTo(c.expect.cost, 6);
  expect(r.score).toBeCloseTo(c.expect.score, 6);
});

test('isSingable: fits and fitsIn only', () => {
  const f = (bucket: any) => ({ bucket, transpose: 0, octave: 0 as const, cost: 0, score: 0 });
  expect(isSingable(f('fits'))).toBe(true);
  expect(isSingable(f('fitsIn'))).toBe(true);
  expect(isSingable(f('stretch'))).toBe(false);
  expect(isSingable(f('outside'))).toBe(false);
});

test('tier codes round-trip; unknown codes are null', () => {
  expect(TIER_CODE).toEqual({ measured: 4, notes: 3, estimated: 2, rough: 1 });
  for (const [tier, code] of Object.entries(TIER_CODE)) expect(tierFromCode(code)).toBe(tier);
  expect(tierFromCode(0)).toBeNull();
  expect(tierFromCode(5)).toBeNull();
  expect(tierFromCode(2.5)).toBeNull();
});
