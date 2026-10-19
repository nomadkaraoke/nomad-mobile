// Python string semantics the matcher port depends on. decide's matcher is Python:
// lengths and slices count code points (JS strings are UTF-16), `\s`/`str.split()`
// use Python's whitespace set, `\w`/`\b` are Unicode-aware (JS `\w`/`\b` are ASCII),
// `str` ordering is by code point, and `round()` rounds half to even.

/** Python `str.isspace()` / re `\s` characters, as a regex character-class body. */
export const PY_SPACE = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
/** Python re `\w` for str patterns (alphanumeric or underscore), as a class body. */
export const PY_WORD = '\\p{L}\\p{N}_';
/** Python `\b` before a word character: no word character precedes. */
export const WB_BEFORE = `(?<![${PY_WORD}])`;
/** Python `\b` after a word character: no word character follows. */
export const WB_AFTER = `(?![${PY_WORD}])`;
/** Python IGNORECASE also matches dotless ı and dotted İ for `i` (JS /iu does not). */
export const PY_I = '[iıİ]';

const SPLIT_RE = new RegExp(`[${PY_SPACE}]+`, 'u');
const STRIP_RE = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'gu');

/** Code points of `s` (Python's view of a string). */
export function codePoints(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i)!;
    out.push(c);
    if (c > 0xffff) i++;
  }
  return out;
}

/** Python `len(s)`. */
export function pyLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** Python `s[start:end]` for non-negative bounds. */
export function pySlice(s: string, start: number, end?: number): string {
  return String.fromCodePoint(...codePoints(s).slice(start, end));
}

/** Python `s.split()` (no argument). */
export function pySplit(s: string): string[] {
  return s.split(SPLIT_RE).filter((t) => t.length > 0);
}

/** Python `s.strip()` (no argument). */
export function pyStrip(s: string): string {
  return s.replace(STRIP_RE, '');
}

/** Python `str` ordering (code point order; JS `<` compares UTF-16 code units). */
export function pyCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca === cb) continue;
    const sa = ca >= 0xd800 && ca <= 0xdfff;
    const sb = cb >= 0xd800 && cb <= 0xdfff;
    if (sa !== sb) return sa ? 1 : -1; // a surrogate pair is a code point above every BMP one
    return ca - cb;
  }
  return a.length - b.length;
}

/** Python `round(x, ndigits)`: correctly rounded, exact ties to even. */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x)) return x;
  // An exact decimal tie at `ndigits` places is a binary fraction j / 2^(ndigits+1), j odd.
  const twice = x * 2 ** (ndigits + 1);
  if (Number.isInteger(twice) && Math.abs(twice) % 2 === 1) {
    const scaled = x * 10 ** ndigits; // exact: a dyadic number with few significant bits
    const lo = Math.floor(scaled);
    const rounded = lo % 2 === 0 ? lo : lo + 1;
    return rounded / 10 ** ndigits;
  }
  return Number(x.toFixed(ndigits));
}
