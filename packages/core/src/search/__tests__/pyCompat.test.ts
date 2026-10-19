import { codePoints, pyCompare, pyLen, pyRound, pySlice, pySplit, pyStrip } from '../pyCompat';

describe('Python string semantics', () => {
  it('lengths and slices count code points', () => {
    expect(pyLen('🎤🎤')).toBe(2);
    expect(pyLen('a\ud800')).toBe(2); // a lone surrogate is one code point
    expect(codePoints('a🎤')).toEqual([0x61, 0x1f3a4]);
    expect(pySlice('🎤ab🎤', 1, 3)).toBe('ab');
    expect(pySlice('歌🎤x', 0, 2)).toBe('歌🎤');
  });

  it('split and strip use Python whitespace (\\x1c-\\x1f, \\x85; not U+FEFF)', () => {
    expect(pySplit(' a b\x1cc\x85d﻿e ')).toEqual(['a', 'b', 'c', 'd﻿e']);
    expect(pyStrip('\x1f　 x y \n')).toBe('x y');
    expect(pyStrip('﻿x')).toBe('﻿x');
  });

  it('orders strings by code point', () => {
    const sorted = ['🎤', '￿', 'a', ''].sort(pyCompare);
    expect(sorted).toEqual(['a', '', '￿', '🎤']);
    expect(pyCompare('ab', 'a')).toBeGreaterThan(0);
    expect(pyCompare('a', 'a')).toBe(0);
  });

  it.each([
    [0.0625, 3, 0.062],
    [0.1875, 3, 0.188],
    [0.125, 2, 0.12],
    [0.375, 2, 0.38],
    [2.675, 2, 2.67],
    [1.0005, 3, 1.0],
    [0.8449999999999999, 3, 0.845],
    [0.845, 2, 0.84],
    [-0.125, 2, -0.12],
    [0.5, 0, 0],
    [1.5, 0, 2],
    [0.9999, 3, 1.0],
  ])('round(%p, %p) = %p (Python, half to even)', (x, n, want) => {
    expect(pyRound(x, n)).toBe(want);
  });

  it('round passes non-finite values through', () => {
    expect(pyRound(Infinity, 2)).toBe(Infinity);
  });
});
