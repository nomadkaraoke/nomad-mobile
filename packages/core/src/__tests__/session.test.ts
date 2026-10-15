import { normalizeCode, normalizeEmail } from '../session';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail('  Andrew@Example.COM ')).toBe('andrew@example.com'));
  it('rejects junk', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('no-at-sign')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
  });
});

describe('normalizeCode', () => {
  it('accepts 6 digits', () => expect(normalizeCode('123456')).toBe('123456'));
  it('strips spaces and dashes from pasted codes', () => {
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
  });
  it('rejects wrong length or letters', () => {
    expect(normalizeCode('12345')).toBeNull();
    expect(normalizeCode('1234567')).toBeNull();
    expect(normalizeCode('12a456')).toBeNull();
  });
});
