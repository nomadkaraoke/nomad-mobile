import { formatClock, formatCredits, formatPrice } from '../format';

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
