// Song-fit scoring: can this user sing this song, and in which key / octave?
// Line-for-line port of decide's karaoke_decide/vocal_range/fit.py; both are tested
// against fit_cases.json. Do not change without regenerating the fixtures.

export type VocalTier = 'measured' | 'notes' | 'estimated' | 'rough';
export type FitBucket = 'fits' | 'fitsIn' | 'stretch' | 'outside';

export type SongVocalRange = {
  low: number;
  high: number;
  p10: number;
  p50: number;
  p90: number;
  tier: VocalTier;
  octaveConfidence: number | null;
};

export type UserVoiceRange = {
  low: number;
  high: number;
  comfortLow: number;
  comfortHigh: number;
};

export type FitResult = {
  bucket: FitBucket;
  transpose: number;
  octave: -12 | 0 | 12;
  cost: number;
  score: number;
};

export const OCTAVE_PENALTY = 0.75;
export const KEY_PENALTY = 0.05;
export const STRETCH_MAX = 2.0;
export const TIER_TOLERANCE: Record<VocalTier, number> = {
  measured: 0,
  notes: 0,
  estimated: 1,
  rough: 2,
};

/** Numeric tier codes as stored in the song-search index. */
export const TIER_CODE: Record<VocalTier, 1 | 2 | 3 | 4> = {
  measured: 4,
  notes: 3,
  estimated: 2,
  rough: 1,
};

export function tierFromCode(n: number): VocalTier | null {
  for (const tier of Object.keys(TIER_CODE) as VocalTier[]) {
    if (TIER_CODE[tier] === n) return tier;
  }
  return null;
}

const OCTAVES: readonly (0 | -12 | 12)[] = [0, -12, 12]; // ties prefer no shift, then down
const TRANSPOSES = [0, -1, 1, -2, 2, -3, 3, -4, 4]; // ties prefer smaller |t|, then down

function outside(a: number, b: number, lo: number, hi: number): number {
  return Math.max(0, lo - a) + Math.max(0, b - hi);
}

// Half rounds up, matching decide's floor(x * 1000 + 0.5) / 1000.
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function fitSong(user: UserVoiceRange, song: SongVocalRange): FitResult {
  const tol = TIER_TOLERANCE[song.tier];
  const confidence = song.octaveConfidence == null ? 1.0 : song.octaveConfidence;
  const octaveFree = song.tier === 'notes' && confidence < 0.5;

  let best: { score: number; cost: number; t: number; o: 0 | -12 | 12 } | null = null;
  for (const o of OCTAVES) {
    for (const t of TRANSPOSES) {
      const s = t + o;
      const cost =
        outside(song.p10 + s, song.p90 + s, user.comfortLow - tol, user.comfortHigh + tol) +
        0.5 * outside(song.low + s, song.high + s, user.low - tol, user.high + tol);
      const score = cost + (o === 0 || octaveFree ? 0.0 : OCTAVE_PENALTY) + KEY_PENALTY * Math.abs(t);
      if (best === null || score < best.score) best = { score, cost, t, o };
    }
  }

  const { score, cost, t, o } = best as NonNullable<typeof best>;
  let bucket: FitBucket;
  if (cost === 0 && t === 0 && (o === 0 || octaveFree)) bucket = 'fits';
  else if (cost === 0) bucket = 'fitsIn';
  else if (cost <= STRETCH_MAX) bucket = 'stretch';
  else bucket = 'outside';
  return { bucket, transpose: t, octave: o, cost: round3(cost), score: round3(score) };
}

/** Singable = bucket fits or fitsIn (a stretch is not). */
export function isSingable(f: FitResult): boolean {
  return f.bucket === 'fits' || f.bucket === 'fitsIn';
}
