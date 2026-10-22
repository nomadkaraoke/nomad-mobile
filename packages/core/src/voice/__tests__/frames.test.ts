import { gateFrames, noiseFloor, percentile } from '../frames';

describe('noiseFloor', () => {
  it('is 3×P90 of the first second, at least 0.003', () => {
    const quiet = Array.from({ length: 150 }, (_, i) => ({ t: i / 100, hz: null, clarity: 0, rms: i < 100 ? 0.002 : 0.5 }));
    expect(noiseFloor(quiet)).toBeCloseTo(0.006, 6);
    expect(noiseFloor(quiet.map((f) => ({ ...f, rms: 0 })))).toBe(0.003);
    expect(noiseFloor([])).toBe(0.003);
  });
});

describe('percentile', () => {
  it('is nearest-rank', () => {
    const v = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(v, 0.9)).toBe(9);
    expect(percentile(v, 0.1)).toBe(1);
    expect(percentile(v, 1)).toBe(10);
  });
});

describe('gateFrames', () => {
  it('drops low clarity, quiet and out-of-band frames', () => {
    const ok = { t: 0, hz: 220, clarity: 0.95, rms: 0.1 };
    const frames = [
      ok,
      { ...ok, t: 1, clarity: 0.89 },
      { ...ok, t: 2, rms: 0.005 },
      { ...ok, t: 3, hz: 55 },
      { ...ok, t: 4, hz: 1300 },
      { ...ok, t: 5, hz: null },
    ];
    const out = gateFrames(frames, 0.01);
    expect(out).toHaveLength(1);
    expect(out[0]!.t).toBe(0);
    expect(out[0]!.midi).toBeCloseTo(57, 6);
  });
});
