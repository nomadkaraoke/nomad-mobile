import type { RangeSummary } from './range';

export type VoiceType = 'bass' | 'baritone' | 'tenor' | 'alto' | 'mezzo' | 'soprano';

export const VOICE_TYPES: readonly { type: VoiceType; lo: number; hi: number }[] = [
  { type: 'bass', lo: 40, hi: 64 },
  { type: 'baritone', lo: 45, hi: 69 },
  { type: 'tenor', lo: 48, hi: 72 },
  { type: 'alto', lo: 53, hi: 77 },
  { type: 'mezzo', lo: 57, hi: 81 },
  { type: 'soprano', lo: 60, hi: 84 },
];

export type Classification = {
  type: VoiceType;
  between: VoiceType | null;
  margin: number;
  confidence: 'low' | 'medium' | 'high';
  scores: Record<VoiceType, number>;
};

export function classifyVoice(r: RangeSummary): Classification {
  const cc = (r.comfortLow + r.comfortHigh) / 2;
  const scored = VOICE_TYPES.map((v, index) => {
    const tc = (v.lo + v.hi) / 2;
    const outside = Math.max(0, v.lo - r.low) + Math.max(0, r.high - v.hi);
    return { type: v.type, index, score: 1 - (0.65 * (Math.abs(cc - tc) / 6) + 0.35 * (outside / 12)) };
  });
  const scores = Object.fromEntries(scored.map((s) => [s.type, s.score])) as Record<VoiceType, number>;
  // Stable sort: ties keep VOICE_TYPES order.
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0]!;
  const runner = ranked[1]!;
  const margin = best.score - runner.score;
  const between = Math.abs(best.index - runner.index) === 1 && margin < 0.08 ? runner.type : null;

  const span = r.high - r.low;
  let confidence: Classification['confidence'] = 'medium';
  if (r.heldCount >= 6 && span >= 12 && r.freeVoicedS >= 5 && margin >= 0.1) confidence = 'high';
  else if (r.heldCount < 3 || span < 7) confidence = 'low';

  return { type: best.type, between, margin, confidence, scores };
}
