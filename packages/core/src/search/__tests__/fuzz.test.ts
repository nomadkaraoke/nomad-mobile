import { LevenshteinPattern, levenshtein, partialRatio, ratio, tokenSetRatio, tokenSortRatio, wRatio } from '../fuzz';
// rapidfuzz 3.x output over seeded random pairs (scripts/emit-search-golden.py).
import golden from './fuzz.golden.json';

type Row = {
  a: string;
  b: string;
  ratio: number;
  partial_ratio: number;
  token_set_ratio: number;
  token_sort_ratio: number;
  WRatio: number;
  lev: number;
};

describe('rapidfuzz port', () => {
  it('matches rapidfuzz exactly over the golden pairs', () => {
    const mismatches: string[] = [];
    for (const r of golden as Row[]) {
      const got = {
        ratio: ratio(r.a, r.b),
        partial_ratio: partialRatio(r.a, r.b),
        token_set_ratio: tokenSetRatio(r.a, r.b),
        token_sort_ratio: tokenSortRatio(r.a, r.b),
        WRatio: wRatio(r.a, r.b),
        lev: levenshtein(r.a, r.b),
      };
      for (const [k, v] of Object.entries(got)) {
        const want = r[k as keyof Row] as number;
        if (v !== want) mismatches.push(`${k}(${JSON.stringify(r.a)}, ${JSON.stringify(r.b)}) = ${v}, want ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect((golden as Row[]).length).toBeGreaterThan(500);
  });

  it('known values', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(ratio('', '')).toBe(100);
    expect(wRatio('', 'a')).toBe(0);
    expect(tokenSetRatio('', 'a')).toBe(0);
    expect(partialRatio('', '')).toBe(100);
    expect(wRatio('simon and garfunkel', 'simon & garfunkel')).toBeGreaterThan(80);
  });
});

/** Textbook Levenshtein DP, the reference for the bit-parallel version. */
function referenceLevenshtein(a: number[], b: number[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1), d[i - 1]![j]! + 1, d[i]![j - 1]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

describe('LevenshteinPattern', () => {
  it('equals the textbook DP for patterns up to 32 code points', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const mismatches: string[] = [];
    for (let t = 0; t < 5000; t++) {
      const a = Array.from({ length: t < 50 ? 32 : rnd(33) }, () => rnd(4));
      const b = Array.from({ length: rnd(80) }, () => rnd(4));
      const got = new LevenshteinPattern(a).distance(b);
      const want = referenceLevenshtein(a, b);
      if (got !== want) mismatches.push(`${a.join('')} / ${b.join('')}: ${got} != ${want}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('long strings use the DP; patterns over 32 are refused', () => {
    const a = 'a'.repeat(40) + 'b';
    const b = 'a'.repeat(41) + 'c';
    expect(levenshtein(a, b)).toBe(2);
    expect(() => new LevenshteinPattern(new Array(33).fill(1))).toThrow(RangeError);
    expect(new LevenshteinPattern([]).distance([1, 2])).toBe(2);
  });
});
