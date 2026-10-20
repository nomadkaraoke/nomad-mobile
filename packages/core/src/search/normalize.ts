// Port of decide's karaoke_decide/song_search/text_normalize.py (vendored from kjbox
// kj-controller/text_normalize.py; started from kjbox's static/text_normalize.js twin),
// plus identify.py's song_norm. Keep in step: normalize.golden.json holds the Python
// output over tricky inputs, and the parity test runs the whole matcher.
//
// Unlike kjbox's JS twin this matches Python on non-Latin text too: `\w`, `\s` and
// `\b` follow Python's Unicode rules (see pyCompat.ts).
//
// Pipeline (order matters):
//   1. Unicode NFD + strip combining marks + Latin special-char fold
//   2. lowercase
//   3. feat./ft./featuring: drop the word (search) / the whole clause (identity)
//   4. expand symbol conjunctions  &  +  -> " and "
//   5. drop apostrophes; replace remaining punctuation with space
//   6. token-level word abbreviations (pt->part, vs->versus, ...)
//   7. number canonicalization: words/roman -> digits, with tens+ones adjacency
import { PY_I, PY_SPACE, PY_WORD, pySplit, WB_AFTER, WB_BEFORE } from './pyCompat';

/** decide/kjbox NORMALIZER_VERSION: bumps whenever the pipeline or a map changes. */
export const NORMALIZER_VERSION = 3;
/** Version of the indexed search text (NORMALIZER_VERSION + index-only revision). */
export const SEARCH_INDEX_VERSION = `${NORMALIZER_VERSION}.1`;

const LATIN_SPECIAL_MAP = new Map<string, string>([
  ['ø', 'o'],
  ['Ø', 'o'],
  ['æ', 'ae'],
  ['Æ', 'ae'],
  ['ß', 'ss'],
  ['ð', 'd'],
  ['Ð', 'd'],
  ['ł', 'l'],
  ['Ł', 'l'],
  ['ı', 'i'],
  ['đ', 'd'],
  ['Đ', 'd'],
  ['þ', 'th'],
  ['Þ', 'th'],
]);
const LATIN_SPECIAL_RE = new RegExp(`[${[...LATIN_SPECIAL_MAP.keys()].join('')}]`, 'gu');
const COMBINING_RE = /[̀-ͯ]/g;

const FEAT_WORDS = `(?:feat\\.?|ft\\.?|featur${PY_I}ng)`;
// Identity: the feat clause runs to a closing bracket or end of string.
const FEAT_CLAUSE_RE = new RegExp(`[${PY_SPACE}]*[\\[(]?[${PY_SPACE}]*${WB_BEFORE}${FEAT_WORDS}[${PY_SPACE}]+[^\\])]+[\\])]?`, 'giu');
// Search: just the feat word (followed by whitespace), names kept.
const FEAT_WORD_RE = new RegExp(`${WB_BEFORE}${FEAT_WORDS}(?=[${PY_SPACE}])`, 'giu');
const SYMBOL_AND_RE = new RegExp(`[${PY_SPACE}]*[&+][${PY_SPACE}]*`, 'gu');
const APOS_RE = /[‘’ʼ`']+/gu;
const PUNCT_RE = new RegExp(`[^${PY_WORD}${PY_SPACE}]`, 'gu');

const ABBREV_MAP = new Map([
  ['pt', 'part'],
  ['pts', 'parts'],
  ['vs', 'versus'],
]);
const NUMBER_WORDS = new Map<string, number>([
  ['zero', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
]);
// Excludes ambiguous standalone i/v/x/l/c/d/m.
const ROMAN_NUMERALS = new Map<string, number>([
  ['ii', 2],
  ['iii', 3],
  ['iv', 4],
  ['vi', 6],
  ['vii', 7],
  ['viii', 8],
  ['ix', 9],
]);
const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

function stripAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_RE, '')
    .replace(LATIN_SPECIAL_RE, (m) => LATIN_SPECIAL_MAP.get(m)!);
}

function canonicalizeNumbers(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    let val = NUMBER_WORDS.get(t) ?? ROMAN_NUMERALS.get(t);
    if (val === undefined) {
      out.push(t);
      continue;
    }
    // tens + ones adjacency: "twenty one" -> 21
    if (TENS.has(val) && i + 1 < toks.length) {
      const ones = NUMBER_WORDS.get(toks[i + 1]!);
      if (ones !== undefined && ones >= 1 && ones <= 9) {
        val += ones;
        i++;
      }
    }
    out.push(String(val));
  }
  return out;
}

function normalizeWith(text: string | null | undefined, featRe: RegExp): string {
  if (!text) return '';
  let s = stripAccents(text).toLowerCase();
  s = s.replace(featRe, ' ');
  s = s.replace(SYMBOL_AND_RE, ' and ');
  s = s.replace(APOS_RE, '');
  s = s.replace(PUNCT_RE, ' ');
  const toks = pySplit(s).map((t) => ABBREV_MAP.get(t) ?? t);
  return canonicalizeNumbers(toks).join(' ');
}

/** Canonical SEARCH text (featured artists kept). */
export function normalize(text: string | null | undefined): string {
  return normalizeWith(text, FEAT_WORD_RE);
}

/** Canonical SONG-IDENTITY text (the whole feat clause stripped). */
export function identityNormalize(text: string | null | undefined): string {
  return normalizeWith(text, FEAT_CLAUSE_RE);
}

/** The canonical token list of `text`. */
export function tokens(text: string | null | undefined): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** Adjacent token pairs of normalized text joined into one word ("over thinking" → "overthinking"). */
export function joinedForms(normText: string | null | undefined): string[] {
  const toks = normText ? normText.split(' ') : [];
  const seen = new Set(toks);
  const out: string[] = [];
  for (let i = 0; i + 1 < toks.length; i++) {
    const j = toks[i]! + toks[i + 1]!;
    if (!seen.has(j)) {
      seen.add(j);
      out.push(j);
    }
  }
  return out;
}

/**
 * Indexed-side search text: `normalize(text)` plus its joined forms. With `title`,
 * each field is indexed separately and the two are concatenated (decide extension).
 */
export function indexText(text: string | null | undefined, title?: string | null): string {
  if (title !== undefined && title !== null) {
    return [indexText(text), indexText(title)].filter(Boolean).join(' ');
  }
  const n = normalize(text);
  const extra = joinedForms(n);
  return extra.length ? `${n} ${extra.join(' ')}` : n;
}

/** FTS5-safe MATCH string: each canonical token quoted, the last prefix-matched. */
export function ftsMatchQuery(text: string | null | undefined): string {
  const toks = tokens(text);
  if (!toks.length) return '';
  return [...toks.slice(0, -1).map((t) => `"${t}"`), `"${toks[toks.length - 1]}"*`].join(' ');
}

/** Song identity across decide/mobile: identity-normalized artist and title joined by "|". */
export function songKey(artist: string | null | undefined, title: string | null | undefined): string {
  return `${identityNormalize(artist)}|${identityNormalize(title)}`;
}

const INITIALS_RE = new RegExp(`${WB_BEFORE}(?:[a-z0-9] )+[a-z0-9]${WB_AFTER}`, 'gu');

/**
 * The matcher's text (identify.py song_norm): identity-normalized, with runs of single
 * letters joined ("party in the u s a" → "party in the usa").
 */
export function songNorm(text: string | null | undefined): string {
  return identityNormalize(text || '').replace(INITIALS_RE, (m) => m.replace(/ /g, ''));
}
