import { prefillPosition, type PitchSummary } from '../index';

// Singer: held 48..63, centre 55.
const singer = (patch: Partial<PitchSummary> = {}): PitchSummary => ({
  voicedS: 40,
  heldCount: 8,
  heldLow: 48,
  heldHigh: 63,
  p10: 50,
  p50: 55,
  p90: 61,
  ...patch,
});
// The song sits an octave above the singer: p10 62 / p50 67 / p90 74 -> at o = -12: 50 / 55 / 62.
const song = { low: 60, high: 76, p10: 62, p50: 67, p90: 74 };

describe('prefillPosition', () => {
  it('a song an octave above the singer is compared an octave down (o = -12): comfortable', () => {
    expect(prefillPosition(singer(), song)).toEqual({ highest: 63, lowest: 48, suggested: 'comfortable' });
  });

  it('missing the top of the song (held high < p90 + o - 1): no suggestion', () => {
    expect(prefillPosition(singer({ heldHigh: 60 }), song)).toEqual({ highest: 60, lowest: 48, suggested: null });
  });

  it('missing the bottom of the song (held low > p10 + o + 1): no suggestion', () => {
    expect(prefillPosition(singer({ heldLow: 52 }), song)).toEqual({ highest: 63, lowest: 52, suggested: null });
  });

  it('the bounds are inclusive: held high = p90 + o - 1 and held low = p10 + o + 1 still count', () => {
    expect(prefillPosition(singer({ heldHigh: 61, heldLow: 51 }), song)?.suggested).toBe('comfortable');
  });

  it('same octave (o = 0)', () => {
    const same = { low: 48, high: 64, p10: 50, p50: 56, p90: 62 };
    expect(prefillPosition(singer(), same)?.suggested).toBe('comfortable');
    // Had it shifted an octave, nothing would have fitted.
    expect(prefillPosition(singer({ heldHigh: 60 }), same)?.suggested).toBeNull();
  });

  it('a song an octave below the singer (o = +12)', () => {
    const low = { low: 36, high: 52, p10: 38, p50: 43, p90: 50 };
    expect(prefillPosition(singer(), low)?.suggested).toBe('comfortable');
  });

  it('a tie between two octaves keeps the song where it is (o = 0)', () => {
    // singer p50 55 is 6 keys from both 61 (o = 0) and 49 (o = -12).
    const tie = { low: 54, high: 68, p10: 56, p50: 61, p90: 64 };
    // At o = 0: needs held high >= 63 and held low <= 57; at o = -12 held high would only need 51.
    expect(prefillPosition(singer(), tie)?.suggested).toBe('comfortable');
    expect(prefillPosition(singer({ heldHigh: 62 }), tie)?.suggested).toBeNull();
  });

  it('no song range: the held notes, no suggestion', () => {
    expect(prefillPosition(singer(), null)).toEqual({ highest: 63, lowest: 48, suggested: null });
  });

  it('no pitch summary: null', () => {
    expect(prefillPosition(null, song)).toBeNull();
    expect(prefillPosition(null, null)).toBeNull();
  });
});
