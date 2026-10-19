// Port of the rapidfuzz 3.x functions decide's matcher calls: fuzz.ratio,
// fuzz.partial_ratio, fuzz.token_set_ratio, fuzz.WRatio (with the token_sort_ratio,
// token_ratio and partial_token_ratio it uses) and Levenshtein.distance. Ported from
// rapidfuzz's pure-Python reference (fuzz_py.py, Indel_py.py), which gives the same
// floats as its C++ build; processor = None (rapidfuzz 3's default). Strings are
// compared by code point, as in Python. fuzz.golden.json pins the outputs.
import { codePoints, pyCompare, pySplit } from './pyCompat';

type Seq = number[];

/** Bit-parallel LCS pattern of `s1` (rapidfuzz's "block"): 32-bit words of match masks. */
class Pattern {
  readonly len: number;
  readonly words: number;
  private readonly masks = new Map<number, Uint32Array>();

  constructor(readonly seq: Seq) {
    this.len = seq.length;
    this.words = Math.ceil(seq.length / 32);
    seq.forEach((ch, i) => {
      let m = this.masks.get(ch);
      if (!m) {
        m = new Uint32Array(this.words);
        this.masks.set(ch, m);
      }
      m[i >>> 5] = (m[i >>> 5]! | (1 << (i & 31))) >>> 0;
    });
  }

  has(ch: number): boolean {
    return this.masks.has(ch);
  }

  /** LCS length of this pattern and `s2[start:end]` (Hyyrö's bit-parallel algorithm). */
  lcs(s2: Seq, start = 0, end = s2.length): number {
    if (this.len === 0 || start >= end) return 0;
    const S = new Uint32Array(this.words).fill(0xffffffff);
    for (let k = start; k < end; k++) {
      const M = this.masks.get(s2[k]!);
      if (!M) continue;
      let carry = 0;
      for (let w = 0; w < this.words; w++) {
        const x = S[w]!;
        const u = (x & M[w]!) >>> 0;
        const sum = x + u + carry;
        carry = sum > 0xffffffff ? 1 : 0;
        S[w] = ((sum >>> 0) | (x - u)) >>> 0;
      }
    }
    let matches = 0;
    for (let i = 0; i < this.len; i++) {
      if (((S[i >>> 5]! >>> (i & 31)) & 1) === 0) matches++;
    }
    return matches;
  }
}

/** Indel distance (insertions + deletions). */
function indelDistance(s1: Seq, s2: Seq): number {
  return s1.length + s2.length - 2 * new Pattern(s1).lcs(s2);
}

/** rapidfuzz Indel.normalized_similarity. */
function indelNormalizedSimilarity(s1: Seq, s2: Seq, scoreCutoff?: number): number {
  const maximum = s1.length + s2.length;
  const dist = indelDistance(s1, s2);
  const normDist = maximum ? dist / maximum : 0;
  const normSim = 1.0 - normDist;
  return scoreCutoff === undefined || normSim >= scoreCutoff ? normSim : 0;
}

/** rapidfuzz Indel._block_normalized_similarity over `s2[start:end]`. */
function blockNormalizedSimilarity(pat: Pattern, s2: Seq, start: number, end: number, scoreCutoff: number): number {
  const maximum = pat.len + (end - start);
  const dist = maximum - 2 * pat.lcs(s2, start, end);
  const normDist = maximum ? dist / maximum : 0;
  const normSim = 1.0 - normDist;
  return normSim >= scoreCutoff ? normSim : 0;
}

function normDistance(dist: number, lensum: number, scoreCutoff: number): number {
  const score = lensum ? 100 - (100 * dist) / lensum : 100;
  return score >= scoreCutoff ? score : 0;
}

function ratioSeq(s1: Seq, s2: Seq, scoreCutoff?: number): number {
  return indelNormalizedSimilarity(s1, s2, scoreCutoff === undefined ? undefined : scoreCutoff / 100) * 100;
}

/** fuzz.ratio. */
export function ratio(s1: string, s2: string, scoreCutoff?: number): number {
  return ratioSeq(codePoints(s1), codePoints(s2), scoreCutoff);
}

/** rapidfuzz fuzz_py._partial_ratio_impl: best window of `s2` against the shorter `s1` (0..100). */
function partialRatioImpl(s1: Seq, s2: Seq, scoreCutoff: number): number {
  const len1 = s1.length;
  const len2 = s2.length;
  const pat = new Pattern(s1);
  let best = 0;
  for (let i = 1; i < len1; i++) {
    if (!pat.has(s2[i - 1]!)) continue;
    const r = blockNormalizedSimilarity(pat, s2, 0, i, scoreCutoff);
    if (r > best) {
      best = scoreCutoff = r;
      if (best === 1) return 100;
    }
  }
  for (let i = 0; i < len2 - len1; i++) {
    if (!pat.has(s2[i + len1 - 1]!)) continue;
    const r = blockNormalizedSimilarity(pat, s2, i, i + len1, scoreCutoff);
    if (r > best) {
      best = scoreCutoff = r;
      if (best === 1) return 100;
    }
  }
  for (let i = Math.max(0, len2 - len1); i < len2; i++) {
    if (!pat.has(s2[i]!)) continue;
    const r = blockNormalizedSimilarity(pat, s2, i, len2, scoreCutoff);
    if (r > best) {
      best = scoreCutoff = r;
      if (best === 1) return 100;
    }
  }
  return best * 100;
}

function partialRatioSeq(s1: Seq, s2: Seq, scoreCutoff = 0): number {
  if (s1.length === 0 && s2.length === 0) return 100;
  const len1 = s1.length;
  const len2 = s2.length;
  const [shorter, longer] = len1 <= len2 ? [s1, s2] : [s2, s1];
  let score = partialRatioImpl(shorter, longer, scoreCutoff / 100);
  if (score !== 100 && len1 === len2) {
    scoreCutoff = Math.max(scoreCutoff, score);
    const score2 = partialRatioImpl(longer, shorter, scoreCutoff / 100);
    if (score2 > score) score = score2;
  }
  return score < scoreCutoff ? 0 : score;
}

/** fuzz.partial_ratio. */
export function partialRatio(s1: string, s2: string, scoreCutoff?: number): number {
  return partialRatioSeq(codePoints(s1), codePoints(s2), scoreCutoff);
}

const join = (tokens: string[]) => codePoints(tokens.join(' '));
const sorted = (tokens: Iterable<string>) => [...tokens].sort(pyCompare);

/** fuzz.token_sort_ratio. */
export function tokenSortRatio(s1: string, s2: string, scoreCutoff?: number): number {
  return ratioSeq(join(sorted(pySplit(s1))), join(sorted(pySplit(s2))), scoreCutoff);
}

/** fuzz.token_set_ratio. */
export function tokenSetRatio(s1: string, s2: string, scoreCutoff = 0): number {
  if (scoreCutoff > 100) return 0;
  const tokensA = new Set(pySplit(s1));
  const tokensB = new Set(pySplit(s2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  const intersect = [...tokensA].filter((t) => tokensB.has(t));
  const diffAB = [...tokensA].filter((t) => !tokensB.has(t));
  const diffBA = [...tokensB].filter((t) => !tokensA.has(t));
  if (intersect.length && (!diffAB.length || !diffBA.length)) return 100;

  const diffABJoined = join(sorted(diffAB));
  const diffBAJoined = join(sorted(diffBA));
  const abLen = diffABJoined.length;
  const baLen = diffBAJoined.length;
  const sectLen = join(intersect).length;
  const sep = sectLen !== 0 ? 1 : 0;
  const sectABLen = sectLen + sep + abLen;
  const sectBALen = sectLen + sep + baLen;

  let result = 0.0;
  const cutoffDistance = Math.ceil((sectABLen + sectBALen) * (1 - scoreCutoff / 100));
  const dist = indelDistance(diffABJoined, diffBAJoined);
  if (dist <= cutoffDistance) result = normDistance(dist, sectABLen + sectBALen, scoreCutoff);
  if (!sectLen) return result;

  const sectABRatio = normDistance(sep + abLen, sectLen + sectABLen, scoreCutoff);
  const sectBARatio = normDistance(sep + baLen, sectLen + sectBALen, scoreCutoff);
  return Math.max(result, sectABRatio, sectBARatio);
}

function tokenRatio(s1: string, s2: string, scoreCutoff: number): number {
  return Math.max(tokenSetRatio(s1, s2, scoreCutoff), tokenSortRatio(s1, s2, scoreCutoff));
}

function partialTokenRatio(s1: string, s2: string, scoreCutoff = 0): number {
  if (scoreCutoff > 100) return 0;
  const splitA = pySplit(s1);
  const splitB = pySplit(s2);
  const tokensA = new Set(splitA);
  const tokensB = new Set(splitB);
  for (const t of tokensA) if (tokensB.has(t)) return 100;
  const diffAB = [...tokensA].filter((t) => !tokensB.has(t));
  const diffBA = [...tokensB].filter((t) => !tokensA.has(t));
  const result = partialRatioSeq(join(sorted(splitA)), join(sorted(splitB)), scoreCutoff);
  if (splitA.length === diffAB.length && splitB.length === diffBA.length) return result;
  scoreCutoff = Math.max(scoreCutoff, result);
  return Math.max(result, partialRatioSeq(join(sorted(diffAB)), join(sorted(diffBA)), scoreCutoff));
}

/** fuzz.WRatio. */
export function wRatio(s1: string, s2: string, scoreCutoff = 0): number {
  const UNBASE_SCALE = 0.95;
  if (!s1 || !s2) return 0;
  if (scoreCutoff > 100) return 0;
  const c1 = codePoints(s1);
  const c2 = codePoints(s2);
  const len1 = c1.length;
  const len2 = c2.length;
  const lenRatio = len1 > len2 ? len1 / len2 : len2 / len1;
  let endRatio = ratioSeq(c1, c2, scoreCutoff);
  if (lenRatio < 1.5) {
    scoreCutoff = Math.max(scoreCutoff, endRatio) / UNBASE_SCALE;
    return Math.max(endRatio, tokenRatio(s1, s2, scoreCutoff) * UNBASE_SCALE);
  }
  const PARTIAL_SCALE = lenRatio <= 8.0 ? 0.9 : 0.6;
  scoreCutoff = Math.max(scoreCutoff, endRatio) / PARTIAL_SCALE;
  endRatio = Math.max(endRatio, partialRatioSeq(c1, c2, scoreCutoff) * PARTIAL_SCALE);
  scoreCutoff = Math.max(scoreCutoff, endRatio) / UNBASE_SCALE;
  return Math.max(endRatio, partialTokenRatio(s1, s2, scoreCutoff) * UNBASE_SCALE * PARTIAL_SCALE);
}

/**
 * Levenshtein distance from a fixed pattern of ≤ 32 code points to many sequences
 * (Myers/Hyyrö bit-parallel: one pass over the other sequence). The matcher compares
 * each typed word with thousands of vocab words, so this is the hot path.
 */
export class LevenshteinPattern {
  private readonly peq = new Map<number, number>();
  private readonly len: number;

  constructor(pattern: Seq) {
    if (pattern.length > 32) throw new RangeError('LevenshteinPattern holds at most 32 code points');
    this.len = pattern.length;
    pattern.forEach((ch, i) => this.peq.set(ch, ((this.peq.get(ch) ?? 0) | (1 << i)) >>> 0));
  }

  distance(text: Seq): number {
    const m = this.len;
    if (m === 0) return text.length;
    const mask = m === 32 ? 0xffffffff : (1 << m) - 1;
    const high = (1 << (m - 1)) >>> 0;
    let pv = mask;
    let mv = 0;
    let score = m;
    for (let k = 0; k < text.length; k++) {
      const eq = this.peq.get(text[k]!) ?? 0;
      const xv = (eq | mv) >>> 0;
      const xh = ((((eq & pv) >>> 0) + pv) ^ pv | eq) >>> 0;
      let ph = (mv | ~(xh | pv)) >>> 0;
      let mh = (pv & xh) >>> 0;
      if ((ph & high) >>> 0) score++;
      else if ((mh & high) >>> 0) score--;
      ph = ((ph << 1) | 1) >>> 0;
      mh = (mh << 1) >>> 0;
      pv = ((mh | ~(xv | ph)) & mask) >>> 0;
      mv = (ph & xv & mask) >>> 0;
    }
    return score;
  }
}

/** Levenshtein distance (unit weights) of two code-point sequences. */
export function levenshteinSeq(a: Seq, b: Seq): number {
  if (a.length < b.length) [a, b] = [b, a];
  if (b.length === 0) return a.length;
  if (b.length <= 32) return new LevenshteinPattern(b).distance(a);
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1]! + (ca === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j]! + 1, cur[j - 1]! + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/** Levenshtein.distance. */
export function levenshtein(a: string, b: string): number {
  return levenshteinSeq(codePoints(a), codePoints(b));
}
