import { isFresh, RECS_SNAPSHOT_MAX_AGE_MS } from '../index';

describe('isFresh', () => {
  const now = 1_800_000_000_000;
  it('is 7 days', () => expect(RECS_SNAPSHOT_MAX_AGE_MS).toBe(604_800_000));
  it('boundary: exactly 7 days old is fresh, 1ms older is not', () => {
    expect(isFresh(now - RECS_SNAPSHOT_MAX_AGE_MS, now)).toBe(true);
    expect(isFresh(now - RECS_SNAPSHOT_MAX_AGE_MS - 1, now)).toBe(false);
  });
  it('recent and just-saved are fresh', () => {
    expect(isFresh(now, now)).toBe(true);
    expect(isFresh(now - 1000, now)).toBe(true);
  });
  it('rejects future timestamps and NaN', () => {
    expect(isFresh(now + 1, now)).toBe(false);
    expect(isFresh(NaN, now)).toBe(false);
  });
});
