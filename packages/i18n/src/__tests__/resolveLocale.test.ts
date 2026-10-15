import { LOCALES, resolveLocale, RTL_LOCALES } from '../index';

it('has 33 locales incl. en', () => {
  expect(LOCALES).toHaveLength(33);
  expect(LOCALES).toContain('en');
});

it.each([
  [['pt-BR'], 'pt'],
  [['zh-Hant-TW'], 'zh'],
  [['nb-NO'], 'nb'],
  [['no-NO'], 'nb'],
  [['he-IL'], 'he'],
  [['iw'], 'he'],
  [['fil-PH'], 'tl'],
  [['xx-YY'], 'en'],
  [[], 'en'],
  [['xx-YY', 'fr-CA'], 'fr'],
  [['ES'], 'es'],
  [['es_MX'], 'es'],
])('%j → %s', (tags, expected) => expect(resolveLocale(tags)).toBe(expected));

it('marks ar and he RTL', () => {
  expect(RTL_LOCALES.has('ar')).toBe(true);
  expect(RTL_LOCALES.has('he')).toBe(true);
  expect(RTL_LOCALES.has('en')).toBe(false);
});
