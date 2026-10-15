/* eslint-disable @typescript-eslint/no-require-imports */
// Hermes (RN 0.86 / SDK 57) has no Intl.PluralRules, which use-intl needs for ICU plurals.
// The typeof check is cheap; FormatJS's shouldPolyfill() is slow on Android Hermes, so skip it.
// Static requires so Metro bundles plural data for all 33 supported locales.
export function installIntlPolyfills(): void {
  if (typeof Intl.PluralRules === 'function') return;
  require('@formatjs/intl-pluralrules/polyfill-force.js');
  require('@formatjs/intl-pluralrules/locale-data/en.js');
  require('@formatjs/intl-pluralrules/locale-data/es.js');
  require('@formatjs/intl-pluralrules/locale-data/de.js');
  require('@formatjs/intl-pluralrules/locale-data/pt.js');
  require('@formatjs/intl-pluralrules/locale-data/fr.js');
  require('@formatjs/intl-pluralrules/locale-data/ja.js');
  require('@formatjs/intl-pluralrules/locale-data/ko.js');
  require('@formatjs/intl-pluralrules/locale-data/zh.js');
  require('@formatjs/intl-pluralrules/locale-data/it.js');
  require('@formatjs/intl-pluralrules/locale-data/nl.js');
  require('@formatjs/intl-pluralrules/locale-data/pl.js');
  require('@formatjs/intl-pluralrules/locale-data/tr.js');
  require('@formatjs/intl-pluralrules/locale-data/ru.js');
  require('@formatjs/intl-pluralrules/locale-data/th.js');
  require('@formatjs/intl-pluralrules/locale-data/id.js');
  require('@formatjs/intl-pluralrules/locale-data/vi.js');
  require('@formatjs/intl-pluralrules/locale-data/tl.js');
  require('@formatjs/intl-pluralrules/locale-data/fil.js'); // tl canonicalizes to fil
  require('@formatjs/intl-pluralrules/locale-data/hi.js');
  require('@formatjs/intl-pluralrules/locale-data/ar.js');
  require('@formatjs/intl-pluralrules/locale-data/sv.js');
  require('@formatjs/intl-pluralrules/locale-data/nb.js');
  require('@formatjs/intl-pluralrules/locale-data/da.js');
  require('@formatjs/intl-pluralrules/locale-data/fi.js');
  require('@formatjs/intl-pluralrules/locale-data/cs.js');
  require('@formatjs/intl-pluralrules/locale-data/ro.js');
  require('@formatjs/intl-pluralrules/locale-data/hu.js');
  require('@formatjs/intl-pluralrules/locale-data/el.js');
  require('@formatjs/intl-pluralrules/locale-data/he.js');
  require('@formatjs/intl-pluralrules/locale-data/ms.js');
  require('@formatjs/intl-pluralrules/locale-data/uk.js');
  require('@formatjs/intl-pluralrules/locale-data/hr.js');
  require('@formatjs/intl-pluralrules/locale-data/sk.js');
  require('@formatjs/intl-pluralrules/locale-data/ca.js');
}
