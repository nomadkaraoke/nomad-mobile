import { LOCALES } from '../locales';

// Hermes (RN 0.86) ships no Intl.PluralRules, so ICU plurals threw FORMATTING_ERROR on device
// while passing under Node. Simulate Hermes by removing it before loading the polyfill.
describe('installIntlPolyfills on an engine without Intl.PluralRules', () => {
  const original = Intl.PluralRules;
  afterEach(() => {
    (Intl as { PluralRules: unknown }).PluralRules = original;
  });

  it('provides plural rules for every supported locale', () => {
    delete (Intl as { PluralRules?: unknown }).PluralRules;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../polyfills').installIntlPolyfills();
    });
    expect(typeof Intl.PluralRules).toBe('function');
    for (const locale of LOCALES) {
      expect(new Intl.PluralRules(locale).resolvedOptions().locale).toBe(locale === 'tl' ? 'fil' : locale);
    }
    expect(new Intl.PluralRules('ar').select(2)).toBe('two');
    expect(new Intl.PluralRules('en').select(1)).toBe('one');
  });
});
