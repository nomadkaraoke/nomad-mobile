import { LOCALE_NAMES, LOCALES } from '../index';

// Hermes lacks Intl.DisplayNames, so language names are a static endonym table.
it('names every locale in its own language', () => {
  for (const l of LOCALES) expect(LOCALE_NAMES[l]).toEqual(expect.any(String));
  expect(LOCALE_NAMES.en).toBe('English');
  expect(LOCALE_NAMES.es).toBe('Español');
  expect(LOCALE_NAMES.ja).toBe('日本語');
});
