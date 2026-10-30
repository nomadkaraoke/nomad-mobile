import { ALPHA2_TO_ALPHA3, toAlpha3 } from '../countryCodes';

it('maps every ISO 3166-1 alpha-2 code to a distinct alpha-3', () => {
  expect(ALPHA2_TO_ALPHA3.size).toBe(249);
  expect(new Set(ALPHA2_TO_ALPHA3.values()).size).toBe(249);
});

it.each([
  ['US', 'USA'],
  ['us', 'USA'],
  ['GB', 'GBR'],
  ['DE', 'DEU'],
  ['JP', 'JPN'],
  ['KR', 'KOR'],
  ['BR', 'BRA'],
  ['USA', 'USA'],
  ['XK', 'XK'],
])('%s → %s', (input, expected) => expect(toAlpha3(input)).toBe(expected));
