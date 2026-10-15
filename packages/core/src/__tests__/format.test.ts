import { formatCredits, formatPrice } from '../format';

it('formats prices by locale', () => {
  expect(formatPrice(2400, 'USD', 'en')).toBe('$24.00');
  expect(formatPrice(2400, 'USD', 'de')).toMatch(/24,00/);
});
it('formats credit counts', () => expect(formatCredits(1234, 'en')).toBe('1,234'));
