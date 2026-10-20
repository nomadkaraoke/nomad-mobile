import { formatClock, formatCredits, formatMegabytes, formatPrice } from '../format';

it('formats prices by locale', () => {
  expect(formatPrice(2400, 'USD', 'en')).toBe('$24.00');
  expect(formatPrice(2400, 'USD', 'de')).toMatch(/24,00/);
});
it('formats credit counts', () => expect(formatCredits(1234, 'en')).toBe('1,234'));
it('formats a track length as m:ss, or h:mm:ss from an hour', () => {
  expect(formatClock(872)).toBe('14:32');
  expect(formatClock(65.7)).toBe('1:05');
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(3725)).toBe('1:02:05');
  expect(formatClock(-3)).toBe('0:00');
});
it('formats a byte count as megabytes: whole from 10 MB, one decimal below, never 0', () => {
  expect(formatMegabytes(48_300_000, 'en')).toBe('48');
  expect(formatMegabytes(131_500_000, 'en')).toBe('132');
  expect(formatMegabytes(1_234_000_000, 'en')).toBe('1,234');
  expect(formatMegabytes(2_340_000, 'en')).toBe('2.3');
  expect(formatMegabytes(2_340_000, 'de')).toBe('2,3');
  expect(formatMegabytes(9_000_000, 'en')).toBe('9');
  expect(formatMegabytes(20_000, 'en')).toBe('0.1');
  expect(formatMegabytes(0, 'en')).toBe('0.1');
});
