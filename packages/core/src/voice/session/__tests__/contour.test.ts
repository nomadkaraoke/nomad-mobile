import { findHeldNotes } from '../../heldNotes';
import { framesFor } from '../../testSignals';
import { chestSummary, contourFrom, createContourBuilder, summarizeSongPitch, type LabelledNote } from '../index';

/** Consecutive held notes `from..to`, `dur` seconds each (10 ms hop). */
const line = (from: number, to: number, dur: number) =>
  framesFor(Array.from({ length: to - from + 1 }, (_, i) => ({ midi: from + i, dur })));

const label = (tStart: number, tEnd: number, midi: number, l: LabelledNote['label']): LabelledNote => ({
  tStart,
  tEnd,
  midi,
  label: l,
  source: 'quiz',
});

describe('contourFrom', () => {
  it('10 Hz medians of the voiced frames, null where nothing was voiced', () => {
    const frames = [
      ...framesFor([{ midi: 50, dur: 0.3 }]),
      ...framesFor([{ midi: 55, dur: 0.2 }]).map((f) => ({ ...f, t: f.t + 0.5 })),
    ];
    const c = contourFrom(frames);
    expect(c.t0).toBe(0);
    expect(c.dt).toBeCloseTo(0.1);
    expect(c.midi).toEqual([50, 50, 50, null, null, 55, 55]);
    expect(c.n).toEqual([10, 10, 10, 0, 0, 10, 10]);
    expect(c.hop).toBeCloseTo(0.01);
  });

  it('empty without frames', () => {
    expect(contourFrom([])).toEqual({ t0: 0, dt: 0.1, midi: [], n: [], hop: 0 });
  });

  it('the builder gives the same contour frame by frame', () => {
    const frames = line(50, 55, 1.3);
    const b = createContourBuilder();
    for (const f of frames) b.push(f);
    expect(b.contour()).toEqual(contourFrom(frames));
  });
});

describe('chestSummary', () => {
  it('contour summary within 0.5 st of frame summary', () => {
    const frames = framesFor([
      { midi: 48, dur: 6, vibratoCents: 30 },
      { midi: 52, dur: 5, vibratoCents: 30 },
      { midi: 55, dur: 7, vibratoCents: 30 },
      { midi: 60, dur: 6, vibratoCents: 30 },
    ]);
    const held = findHeldNotes(frames);
    const a = summarizeSongPitch(frames, held)!;
    const b = chestSummary(contourFrom(frames), held, [])!;
    expect(b.heldLow).toBe(a.heldLow);
    expect(b.heldHigh).toBe(a.heldHigh);
    expect(b.heldCount).toBe(a.heldCount);
    expect(Math.abs(b.voicedS - a.voicedS)).toBeLessThan(0.5);
    for (const k of ['p10', 'p50', 'p90'] as const) expect(Math.abs(b[k] - a[k])).toBeLessThanOrEqual(0.5);
  });

  it('chestSummary removes falsetto span from percentiles and held_high', () => {
    // 24 s of chest 50..57, then 6 s at A4 (69) labelled falsetto.
    const frames = framesFor([...Array.from({ length: 8 }, (_, i) => ({ midi: 50 + i, dur: 3 })), { midi: 69, dur: 6 }]);
    const held = findHeldNotes(frames);
    const contour = contourFrom(frames);
    const all = chestSummary(contour, held, [])!;
    expect(all.heldHigh).toBe(69);
    expect(all.p90).toBe(69);
    const chest = chestSummary(contour, held, [label(24, 29.99, 69, 'falsetto')])!;
    expect(chest.heldHigh).toBe(57);
    expect(chest.heldCount).toBe(8);
    expect(chest.p90).toBeLessThanOrEqual(57);
    expect(chest.voicedS).toBeCloseTo(24, 0);
  });

  it('unsure kept in percentiles, not in bounds', () => {
    const frames = framesFor([...Array.from({ length: 8 }, (_, i) => ({ midi: 50 + i, dur: 3 })), { midi: 69, dur: 6 }]);
    const held = findHeldNotes(frames);
    const s = chestSummary(contourFrom(frames), held, [label(24, 29.99, 69, 'unsure')])!;
    expect(s.heldHigh).toBe(57);
    expect(s.heldCount).toBe(9);
    expect(s.p90).toBe(69);
  });

  it("a 'full' label changes nothing", () => {
    const frames = framesFor([...Array.from({ length: 8 }, (_, i) => ({ midi: 50 + i, dur: 3 })), { midi: 69, dur: 6 }]);
    const held = findHeldNotes(frames);
    const c = contourFrom(frames);
    expect(chestSummary(c, held, [label(24, 29.99, 69, 'full')])).toEqual(chestSummary(c, held, []));
  });

  it('null under 10 s voiced or with fewer than 2 held notes left', () => {
    const short = line(50, 53, 2);
    expect(chestSummary(contourFrom(short), findHeldNotes(short), [])).toBeNull();
    const frames = framesFor([
      { midi: 50, dur: 12 },
      { midi: 69, dur: 6 },
    ]);
    const held = findHeldNotes(frames);
    expect(chestSummary(contourFrom(frames), held, [])).not.toBeNull();
    expect(chestSummary(contourFrom(frames), held, [label(12, 17.99, 69, 'falsetto')])).toBeNull();
  });

  it('sparse singing (one voiced frame per 0.1 s): chest voiced_s ≤ the whole song and ≈ frames × hop', () => {
    // 12 s of dense singing (10 ms frames), then 20 s with one voiced frame per 0.1 s slot.
    const dense = framesFor([{ midi: 50, dur: 6 }, { midi: 52, dur: 6 }]);
    const sparse = Array.from({ length: 200 }, (_, i) => ({ t: 12 + i * 0.1, midi: 55 + (i % 3) }));
    const frames = [...dense, ...sparse];
    const held = findHeldNotes(frames);
    const whole = summarizeSongPitch(frames, held)!;
    const chest = chestSummary(contourFrom(frames), held, [])!;
    // Frame counting: 1400 frames × 10 ms = 14 s (slot counting would have claimed 120 + 200 slots = 32 s).
    expect(whole.voicedS).toBeCloseTo(14, 6);
    expect(chest.voicedS).toBeLessThanOrEqual(whole.voicedS + 1e-9);
    expect(chest.voicedS).toBeCloseTo(frames.length * 0.01, 6);
  });

  it('one voiced frame per slot only: voiced time = frames × hop, matching summarizeSongPitch', () => {
    const frames = Array.from({ length: 150 }, (_, i) => ({ t: i * 0.1, midi: i < 75 ? 50 : 55 }));
    const held = [
      { start: 0, end: 7.4, midi: 50, note: 50 },
      { start: 7.5, end: 14.9, midi: 55, note: 55 },
    ];
    const whole = summarizeSongPitch(frames, held)!;
    const chest = chestSummary(contourFrom(frames), held, [])!;
    expect(chest.voicedS).toBeCloseTo(whole.voicedS, 6);
    expect(chest.voicedS).toBeCloseTo(15, 6);
  });

  it('a contour stored without counts scales the whole song by the kept share of voiced slots', () => {
    const frames = framesFor([...Array.from({ length: 8 }, (_, i) => ({ midi: 50 + i, dur: 3 })), { midi: 69, dur: 6 }]);
    const held = findHeldNotes(frames);
    const { n: _n, hop: _hop, ...old } = contourFrom(frames);
    const s = chestSummary(old, held, [label(24, 29.99, 69, 'falsetto')], 30)!;
    const voiced = old.midi.filter((m) => m !== null).length;
    const kept = voiced - old.midi.filter((m, i) => m !== null && 0 + i * 0.1 + 0.1 > 23.8 && i * 0.1 < 30.19).length;
    expect(s.voicedS).toBeCloseTo((30 * kept) / voiced, 6);
    // No whole-song figure either: slots × dt.
    expect(chestSummary(old, held, [])!.voicedS).toBeCloseTo(voiced * 0.1, 6);
  });

  it('null when every remaining held note is unsure', () => {
    const frames = line(50, 55, 2);
    const held = findHeldNotes(frames);
    const labels = held.map((h) => label(h.start, h.end, h.note, 'unsure'));
    expect(chestSummary(contourFrom(frames), held, labels)).toBeNull();
  });
});
