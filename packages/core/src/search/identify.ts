// Port of decide's karaoke_decide/song_search/identify.py (SongIdentifier.identify,
// vendored from kjbox kj-controller/song_identify.py): "which real song does the
// singer mean?" over a song_id.db-schema index (the phone's offline.db). Every step,
// constant, tie-break and float operation mirrors the Python; the parity test runs
// both over the same fixture index. See the Python module docstring for the design.
//
// Pipeline:
//   1. normalize the query, drop noise words ("song by", "karaoke", …)
//   2. expand each word to plausible spellings via the vocab table
//   3. retrieve candidates: FTS5 AND of the expansions (+ leave-one-out), title phrase
//      runs, and artist-first (a run of words that fuzzily names an artist)
//   4. rescore every candidate (_score)
//   5. decide: confident / candidates / none
import { LevenshteinPattern, levenshteinSeq, partialRatio, ratio, tokenSetRatio, wRatio } from './fuzz';
import { LruCache } from './lru';
import { songKey, songNorm } from './normalize';
import { codePoints, pyCompare, PY_I, PY_SPACE, pyLen, pyRound, pySlice, pySplit, pyStrip, WB_AFTER, WB_BEFORE } from './pyCompat';
import type { IdentifyResult, MatchDetail, SongRef, SqlReader } from './types';

/** The offline matcher's raise of the confident margin (decide offline.OFFLINE_MARGIN_BONUS). */
export const OFFLINE_MARGIN_BONUS = 0.03;

/** Longest query considered. */
export const MAX_QUERY_CHARS = 200;

const NOISE_WORDS = new Set(['karaoke', 'lyrics', 'instrumental', 'official']);
const FEAT_WORD = `${WB_BEFORE}(?:featur${PY_I}ng|feat|ft)${WB_AFTER}\\.?`;
const QUERY_FEAT_RE = new RegExp(FEAT_WORD, 'giu');
const QUERY_FEAT_CLAUSE_RE = new RegExp(`${FEAT_WORD}[${PY_SPACE}]+([^)\\]]*)`, 'giu');
const FEAT_WORD_WEIGHT = 0.1;
const NOISE_PHRASE_RE = new RegExp(`${WB_BEFORE}song by${WB_AFTER}|${WB_BEFORE}karaoke version${WB_AFTER}`, 'gu');
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'to', 'and', 'i', 'me', 'my', 'you', 'is', 'it', 'for', 'be']);

const CANDIDATE_LIMIT = 150;
const CANDIDATE_LOO_MAX = 6;
const DEDUPE_TOP = 30;
const NEAR_DUP_TITLE_RATIO = 92;
const LOO_SKIP_IF = 40;
const PHRASE_LIMIT = 100;
const MAX_VARIANTS = 8;
const ARTIST_SPAN_MAX = 4;
const ARTIST_MIN_SIM = 0.8;
const ARTISTS_PER_SPAN = 3;
const ARTIST_LOOKUP_LIMIT = 60;
const ARTIST_SONG_LIMIT = 1500;
const PRESCORE_KEEP = 200;

const CONFIDENT_SCORE = 0.8;
const CONFIDENT_MARGIN = 0.06;
const CANDIDATE_SCORE = 0.62;
const CONFIDENT_MIN_QCOV = 0.8;
const CANDIDATE_MIN_QCOV = 0.7;
const CONFIDENT_MIN_TITLE_COV = 0.8;
const LEAD_WORD_SIM = 0.75;
const MANGLED_TITLE_SIM = 0.7;

// Python `\s*[\(\[].*$|\s+-\s+.*$` ("." excludes only \n; "$" also matches before a final \n).
const VERSION_SUFFIX_RE = new RegExp(
  `[${PY_SPACE}]*[(\\[][^\\n]*(?=\\n?$)|[${PY_SPACE}]+-[${PY_SPACE}]+[^\\n]*(?=\\n?$)`,
  'gu',
);
const SAME_TITLE_POP_LEAD = 12;
const GENERIC_TITLE_ARTISTS = 3;
const GENERIC_TITLE_POP_LEAD = 25;

const CREDIT_SPLIT_RE = new RegExp(
  `[${PY_SPACE}]*(?:,|&|\\+|/|${WB_BEFORE}featur${PY_I}ng${WB_AFTER}|${WB_BEFORE}feat\\.?|${WB_BEFORE}ft\\.?|` +
    `${WB_BEFORE}x${WB_AFTER}|${WB_BEFORE}and${WB_AFTER}|${WB_BEFORE}w${PY_I}th${WB_AFTER})[${PY_SPACE}]*`,
  'iu',
);
const NON_DIGIT_RE = /\P{Nd}/gu;

/** A candidate row of the index's `songs` table. */
type Row = { artist: string; title: string; na: string; nt: string; pop: number | null; karaoke: number };

type Match = {
  artist: string;
  title: string;
  score: number;
  pop: number | null;
  karaoke: boolean;
  detail: MatchDetail | null;
};

const COLS = 's.artist AS artist, s.title AS title, s.na AS na, s.nt AS nt, s.pop AS pop, s.karaoke AS karaoke';

function none(): IdentifyResult {
  return { status: 'none', best: null, candidates: [] };
}

/** A word long enough to be selective as an FTS prefix ("me*" expands to thousands). */
function prefixOk(word: string): boolean {
  return pyLen(word) >= 4 && !STOP_WORDS.has(word);
}

function compact(text: string | null | undefined): string {
  return songNorm(text).replace(/ /g, '');
}

function stripVersionSuffix(title: string): string {
  return title.replace(VERSION_SUFFIX_RE, '');
}

/** Space-less title with version suffixes ("(Live)", "- Remastered 2006") dropped. */
export function baseTitle(title: string): string {
  return compact(stripVersionSuffix(title));
}

function credits(artist: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (artist || '').split(CREDIT_SPLIT_RE)) {
    const c = compact(part);
    if (c) out.add(c);
  }
  return out;
}

/** Python _same_song: one song's credit variants / MusicBrainz misspellings. */
function sameMatch(a: Match, b: Match): boolean {
  const cb = credits(b.artist);
  let shared = false;
  for (const c of credits(a.artist)) if (cb.has(c)) shared = true;
  if (!shared) return false;
  const ta = compact(stripVersionSuffix(a.title));
  const tb = compact(stripVersionSuffix(b.title));
  if (ta === tb) return true;
  if (ta.replace(NON_DIGIT_RE, '') !== tb.replace(NON_DIGIT_RE, '')) return false; // a sequel, not a misspelling
  return Math.min(pyLen(ta), pyLen(tb)) >= 6 && ratio(ta, tb) >= NEAR_DUP_TITLE_RATIO;
}

function editBudget(n: number): number {
  if (n <= 3) return 1;
  if (n <= 5) return 2;
  return n >= 9 ? 3 : 2;
}

/** Similarity of a typed word to an index word, 0..1 (prefix typing counts high). */
export function wordSim(q: string, w: string): number {
  if (q === w) return 1.0;
  const qc = codePoints(q);
  const wc = codePoints(w);
  const lq = qc.length;
  const lw = wc.length;
  if (Math.min(lq, lw) >= 5 && ((q.endsWith('ing') && q.slice(0, -1) === w) || (w.endsWith('ing') && w.slice(0, -1) === q))) {
    return 0.95; // dropped g: "breaking" = "breakin'"
  }
  if (lq >= 3 && w.startsWith(q)) return 0.9;
  if (lq >= 4 && lw > lq && levenshteinSeq(qc, wc.slice(0, lq)) <= 1) return 0.75; // mistyped start
  const d = levenshteinSeq(qc, wc);
  const sim = d > editBudget(lq) ? 0.0 : Math.max(0.0, 1.0 - d / Math.max(lq, lw)) * 0.95;
  if (
    lq >= 5 &&
    lw > lq + 1 &&
    Math.min(...[lq - 1, lq, lq + 1].map((n) => levenshteinSeq(qc, wc.slice(0, n)))) <= 2
  ) {
    return Math.max(sim, 0.6); // a badly mistyped start: weaker evidence
  }
  return sim;
}

type Bucket = [word: string, freq: number, cps: number[]][];
// Vocab buckets per reader (one reader = one index file; open a new reader for a new file).
const bucketCache = new WeakMap<SqlReader, Map<string, Bucket>>();

function vocabBucket(db: SqlReader, first: string, length: number): Bucket {
  let cache = bucketCache.get(db);
  if (!cache) {
    cache = new Map();
    bucketCache.set(db, cache);
  }
  const key = `${length}:${first}`;
  let bucket = cache.get(key);
  if (!bucket) {
    bucket = db
      .all<{ word: string; freq: number }>('SELECT word, freq FROM vocab WHERE first = ? AND len = ?', [first, length])
      .map((r) => [r.word, r.freq, codePoints(r.word)]);
    cache.set(key, bucket);
  }
  return bucket;
}

// Typo variants per reader, LRU-bounded: typing re-identifies on every keystroke, and every word but the
// last is unchanged, so its variants (a fuzzy scan over the vocab bucket) are reused. Read-only once built.
const VARIANT_CACHE_SIZE = 512;
const variantCache = new WeakMap<SqlReader, LruCache<string, ReadonlyMap<string, number>>>();

function variants(db: SqlReader, word: string): ReadonlyMap<string, number> {
  let cache = variantCache.get(db);
  if (!cache) {
    cache = new LruCache(VARIANT_CACHE_SIZE);
    variantCache.set(db, cache);
  }
  let v = cache.get(word);
  if (!v) {
    v = computeVariants(db, word);
    cache.set(word, v);
  }
  return v;
}

/** Index words the typed `word` might be a typo of → {word: similarity}, the word itself first. */
function computeVariants(db: SqlReader, word: string): Map<string, number> {
  const out = new Map<string, number>([[word, 1.0]]);
  const wc = codePoints(word);
  if (wc.length < 3) return out; // short words: exact only
  const budget = editBudget(wc.length);
  const freq = new Map<string, number>();
  const choices: [string, number[]][] = [];
  const first = String.fromCodePoint(wc[0]!);
  for (let n = wc.length - budget; n <= wc.length + budget; n++) {
    for (const [w, f, cps] of vocabBucket(db, first, n)) {
      freq.set(w, f);
      choices.push([w, cps]);
    }
  }
  // rapidfuzz process.extract(scorer=Levenshtein.distance, score_cutoff=budget, limit=32):
  // ascending distance, ties in choice order.
  const pattern = wc.length <= 32 ? new LevenshteinPattern(wc) : null;
  const near: [string, number][] = [];
  for (const [w, cps] of choices) {
    const d = pattern ? pattern.distance(cps) : levenshteinSeq(wc, cps);
    if (d <= budget) near.push([w, d]);
  }
  near.sort((a, b) => a[1] - b[1]);
  const scored = near
    .slice(0, MAX_VARIANTS * 4)
    .filter(([w]) => w !== word)
    .map(([w]) => [wordSim(word, w), freq.get(w)!, w] as const)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [s, , w] of scored.slice(0, MAX_VARIANTS)) {
    if (s > 0) out.set(w, s);
  }
  return out;
}

const quoted = (w: string) => `"${w.replace(/"/g, '')}"`;

/** Runs of 2+ consecutive words as a title phrase (last word may be partial). */
function phraseCandidates(db: SqlReader, words: string[]): Row[] {
  const out: Row[] = [];
  const n = words.length;
  for (let i = 0; i < n; i++) {
    for (let j = n; j > i + 1; j--) {
      const phrase = words
        .slice(i, j)
        .map((w) => w.replace(/"/g, ''))
        .join(' ');
      const q = `nt : "${phrase}"` + (j === n && prefixOk(words[n - 1]!) ? ' *' : '');
      const rows = db.all<Row>(
        `SELECT ${COLS} FROM songs_fts f JOIN songs s ON s.rowid = f.rowid ` +
          'WHERE songs_fts MATCH ? ORDER BY s.pop DESC LIMIT ?',
        [q, PHRASE_LIMIT],
      );
      out.push(...rows);
      if (rows.length || j !== n || j - i < 3) break; // longest run starting at i is enough
    }
  }
  return out;
}

/** Any run of words that fuzzily names an artist → that artist's songs. */
function artistCandidates(db: SqlReader, words: string[], vars: Map<string, ReadonlyMap<string, number>>): Row[] {
  const hits = new Map<string, true>();
  const n = words.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j <= Math.min(n, i + ARTIST_SPAN_MAX); j++) {
      const spanWords = words.slice(i, j);
      const span = spanWords.join(' ');
      if (pyLen(span.replace(/ /g, '')) < 4 || spanWords.every((w) => STOP_WORDS.has(w))) continue;
      const clauses = spanWords.map((w) => {
        const alts = [...vars.get(w)!.keys()].map(quoted);
        if (pyLen(w) >= 3 && !STOP_WORDS.has(w)) alts.push(`${quoted(w)}*`);
        return `(${alts.join(' OR ')})`;
      });
      const rows = db.all<{ na: string; pop: number | null }>(
        'SELECT a.na AS na, a.pop AS pop FROM artists_fts f JOIN artists a ON a.rowid = f.rowid ' +
          'WHERE artists_fts MATCH ? ORDER BY a.pop DESC LIMIT ?',
        [clauses.join(' AND '), ARTIST_LOOKUP_LIMIT],
      );
      const scored: [number, string][] = [];
      for (const { na, pop } of rows) {
        const sim = Math.max(ratio(span, na), pyLen(span) >= 5 ? partialRatio(span, na) : 0) / 100;
        if (sim >= ARTIST_MIN_SIM) scored.push([sim + (pop || 0) / 400, na]);
      }
      scored.sort((a, b) => b[0] - a[0] || pyCompare(b[1], a[1]));
      for (const [, na] of scored.slice(0, ARTISTS_PER_SPAN)) hits.set(na, true);
    }
  }
  const out: Row[] = [];
  for (const na of hits.keys()) {
    out.push(
      ...db.all<Row>(`SELECT ${COLS} FROM songs s WHERE s.na = ? ORDER BY s.pop DESC LIMIT ?`, [na, ARTIST_SONG_LIMIT]),
    );
  }
  return out;
}

/** Songs containing every typed word (any spelling; last may be partial), plus leave-one-out. */
function candidates(db: SqlReader, allWords: string[], vars: Map<string, ReadonlyMap<string, number>>): Row[] {
  const distinctive = allWords.filter((w) => !STOP_WORDS.has(w));
  const words = distinctive.length >= 2 ? distinctive : allWords;
  const groups = words.map((w, i) => {
    const alts = [...vars.get(w)!.keys()].map(quoted);
    if (i === words.length - 1 && prefixOk(w)) alts.push(`${quoted(w)}*`);
    return `(${[...new Set(alts)].join(' OR ')})`;
  });
  const queries = [groups];
  if (groups.length > 1) {
    groups.forEach((_g, i) => {
      if (!(STOP_WORDS.has(words[i]!) && groups.length > 2)) queries.push([...groups.slice(0, i), ...groups.slice(i + 1)]);
    });
  }
  const out: Row[] = [];
  for (const [k, g] of queries.slice(0, 1 + CANDIDATE_LOO_MAX).entries()) {
    if (k && out.length >= LOO_SKIP_IF) break; // every word matched plenty already
    out.push(
      ...db.all<Row>(
        `SELECT ${COLS} FROM songs_fts f JOIN songs s ON s.rowid = f.rowid ` +
          'WHERE songs_fts MATCH ? ORDER BY rank LIMIT ?',
        [g.join(' AND '), CANDIDATE_LIMIT],
      ),
    );
  }
  return out;
}

/** → [score, detail]; 0 when nothing of the title was typed. */
function score(
  words: string[],
  qnorm: string,
  na: string,
  nt: string,
  pop: number | null,
  karaoke: number,
  optional: Set<string>,
): [number, MatchDetail | null] {
  const aToks = pySplit(na);
  const tToks = pySplit(nt);
  const hay = [...aToks, ...tToks];
  const compactHay = na.replace(/ /g, '') + nt.replace(/ /g, '');
  const used = new Set<number>();
  const haySim = new Map<number, number>();
  let explained = 0.0;
  let weight = 0.0;
  for (const w of words) {
    let wt = STOP_WORDS.has(w) ? 0.4 : Math.min(1.0, 0.4 + 0.15 * pyLen(w));
    if (optional.has(w)) wt = FEAT_WORD_WEIGHT;
    weight += wt;
    let best = 0.0;
    let bestI: number | null = null;
    for (let i = 0; i < hay.length; i++) {
      let s = wordSim(w, hay[i]!);
      if (used.has(i)) s *= 0.5; // each title/artist word explains one typed word
      if (s > best) {
        best = s;
        bestI = i;
      }
    }
    if (best < 0.5 && pyLen(w) >= 3 && compactHay.includes(w)) best = 0.8;
    if (bestI !== null) {
      used.add(bestI);
      haySim.set(bestI, Math.max(haySim.get(bestI) ?? 0.0, best));
    }
    explained += wt * best;
  }
  let qCov = weight ? explained / weight : 0.0;

  const covered = (toks: string[], offset: number): number => {
    let sig = toks.flatMap((t, i) => (STOP_WORDS.has(t) ? [] : [i]));
    if (!sig.length) sig = toks.map((_t, i) => i);
    return sig.length ? sig.filter((i) => used.has(i + offset)).length / sig.length : 0.0;
  };
  let titleCov = covered(tToks, aToks.length);
  const artistCov = covered(aToks, 0);
  // What's left after the artist words: how close is it to the title as a string?
  const artistHit = [...used].filter((i) => i < aToks.length);
  const leftover =
    words.filter((w) => !artistHit.some((i) => wordSim(w, aToks[i]!) >= 0.5)).join(' ') || qnorm;
  const titleSim = Math.max(ratio(leftover, nt), ratio(leftover.replace(/ /g, ''), nt.replace(/ /g, ''))) / 100;
  if (titleCov === 0 && titleSim < 0.6) return [0.0, null];
  const leftoverWords = pySplit(leftover).length;
  if (titleSim >= 0.6 && artistCov > 0) {
    // the leftover words ARE the title, just mangled — count them as explained
    qCov = Math.max(
      qCov,
      (artistCov * artistHit.length + titleSim * leftoverWords) / Math.max(1, artistHit.length + leftoverWords),
    );
    titleCov = Math.max(titleCov, titleSim);
  }
  // How many of the title's leading words were typed (stop words may be skipped)?
  let titleLead = 0;
  for (let k = 0; k < tToks.length; k++) {
    if ((haySim.get(aToks.length + k) ?? 0.0) >= LEAD_WORD_SIM) titleLead += 1;
    else if (!STOP_WORDS.has(tToks[k]!)) break;
  }
  const joined = `${na} ${nt}`;
  const sim = Math.max(tokenSetRatio(qnorm, joined), wRatio(qnorm, joined)) / 100;
  const text = 0.45 * qCov + 0.2 * titleCov + 0.08 * artistCov + 0.12 * sim + 0.15 * titleSim;
  const prior = (pop !== null ? pop : 30) / 100;
  let s = text + 0.1 * prior + (karaoke ? 0.05 : 0.0);
  if (leftover.replace(/ /g, '') === nt.replace(/ /g, '')) s += 0.06; // typed the exact title
  return [
    s,
    {
      q_cov: pyRound(qCov, 2),
      title_cov: pyRound(titleCov, 2),
      artist_cov: pyRound(artistCov, 2),
      sim: pyRound(sim, 2),
      title_sim: pyRound(titleSim, 2),
      title_lead: titleLead,
    },
  ];
}

function toRef(m: Match): SongRef {
  return {
    artist: m.artist,
    title: m.title,
    songKey: songKey(m.artist, m.title),
    score: pyRound(m.score, 3),
    popularity: m.pop,
    karaoke: m.karaoke,
  };
}

export type IdentifyOptions = {
  /** Most candidates returned (default 5). */
  limit?: number;
  /** Added to the 0.06 confident margin: OFFLINE_MARGIN_BONUS offline, 0 = kjbox. */
  marginBonus?: number;
};

/**
 * Which song does `query` mean? → {status: confident | candidates | none, best, candidates}.
 * Synchronous; runs a few dozen small SQLite queries.
 */
export function identify(db: SqlReader, query: string, opts: IdentifyOptions = {}): IdentifyResult {
  const limit = opts.limit ?? 5;
  const marginBonus = opts.marginBonus ?? 0.0;
  query = pySlice(pyStrip(query || ''), 0, MAX_QUERY_CHARS);
  const optional = new Set<string>();
  for (const m of query.matchAll(QUERY_FEAT_CLAUSE_RE)) {
    for (const w of pySplit(songNorm(m[1]))) optional.add(w);
  }
  let qnorm = songNorm(query.replace(QUERY_FEAT_RE, ' ')).replace(NOISE_PHRASE_RE, ' ');
  const words: string[] = [];
  for (const w of pySplit(qnorm)) {
    if (NOISE_WORDS.has(w)) continue;
    // A stray space splitting a word ("mi e" → "mie"): glue a lone letter (not a/i) on.
    if (pyLen(w) === 1 && w !== 'a' && w !== 'i' && words.length && pyLen(words[words.length - 1]!) >= 2) {
      words[words.length - 1] += w;
      continue;
    }
    words.push(w);
  }
  if (!words.length || pyLen(words.join('')) < 3) return none();
  qnorm = words.join(' ');

  const vars = new Map<string, ReadonlyMap<string, number>>();
  for (const w of words) if (!vars.has(w)) vars.set(w, variants(db, w));
  let pool = [...candidates(db, words, vars), ...phraseCandidates(db, words), ...artistCandidates(db, words, vars)];
  const unique = new Map<string, Row>();
  for (const r of pool) unique.set(`${r.na}\u0000${r.nt}`, r);
  pool = [...unique.values()];
  if (pool.length > PRESCORE_KEEP) {
    // rapidfuzz process.extract(scorer=WRatio, limit=200): best first, ties in pool order.
    pool = pool
      .map((r, i) => [r, wRatio(qnorm, `${r.na} ${r.nt}`), i] as const)
      .sort((a, b) => b[1] - a[1] || a[2] - b[2])
      .slice(0, PRESCORE_KEEP)
      .map(([r]) => r);
  }

  const seen = new Map<string, Match>();
  for (const { artist, title, na, nt, pop, karaoke } of pool) {
    const [s, detail] = score(words, qnorm, na, nt, pop, karaoke, optional);
    if (s <= 0) continue;
    // One entry per artist + base title ("Feliz Navidad" / "… - Remastered 2006").
    const key = `${na}\u0000${baseTitle(title) || nt}`;
    const prev = seen.get(key);
    if (!prev || s > prev.score) seen.set(key, { artist, title, score: s, pop, karaoke: Boolean(karaoke), detail });
  }
  // Exact score ties: popularity desc, artist, title (decide's deterministic order).
  let ranked = [...seen.values()].sort(
    (a, b) =>
      b.score - a.score || (b.pop || 0) - (a.pop || 0) || pyCompare(a.artist, b.artist) || pyCompare(a.title, b.title),
  );
  if (!ranked.length) return none();
  // Credit variants of one song are one answer.
  const deduped: Match[] = [];
  for (const m of ranked.slice(0, DEDUPE_TOP)) {
    if (!deduped.some((k) => sameMatch(m, k))) deduped.push(m);
  }
  ranked = deduped;
  const best = ranked[0]!;
  const runner = ranked.length > 1 ? ranked[1]! : null;
  let margin = best.score - (runner ? runner.score : 0.0);
  // One margin bar for the final check and the same-title popularity pin (ruling R7).
  const marginBar = CONFIDENT_MARGIN + marginBonus;
  const d = best.detail!;
  if (runner && compact(runner.title) === compact(best.title)) {
    // Same title, other artist: popularity decides ("Die Young" → Kesha)…
    const lead = (best.pop || 30) - (runner.pop || 30) + (best.karaoke && !runner.karaoke ? 10 : 0);
    let need = SAME_TITLE_POP_LEAD;
    // …but a bare generic title shared by several artists is a real question.
    const bestTitle = compact(best.title);
    const sameTitle = ranked.filter((m) => compact(m.title) === bestTitle).length;
    if (d.artist_cov === 0 && sameTitle >= GENERIC_TITLE_ARTISTS) need = GENERIC_TITLE_POP_LEAD;
    margin = lead >= need ? Math.max(margin, marginBar) : Math.min(margin, marginBar - 0.01);
  }
  const top = ranked.slice(0, limit).map(toRef);
  const titleOk =
    d.title_cov >= CONFIDENT_MIN_TITLE_COV ||
    (d.artist_cov > 0 && d.title_lead >= 1) ||
    (d.artist_cov >= 0.99 && d.title_sim >= MANGLED_TITLE_SIM);
  let status: IdentifyResult['status'];
  if (best.score >= CONFIDENT_SCORE && margin >= marginBar && d.q_cov >= CONFIDENT_MIN_QCOV && titleOk) {
    status = 'confident';
  } else if (best.score >= CANDIDATE_SCORE && d.q_cov >= CANDIDATE_MIN_QCOV) {
    status = 'candidates';
  } else {
    status = 'none';
  }
  return { status, best: { ...toRef(best), detail: d }, candidates: top };
}
