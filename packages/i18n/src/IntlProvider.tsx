import type { ReactNode } from 'react';
import { IntlProvider as UseIntlProvider, type AbstractIntlMessages } from 'use-intl';

import en from '../messages/en.json';
import type { Locale } from './locales';

// Static requires so Metro bundles every locale (33 small JSON files).
const LOADERS: Record<Exclude<Locale, 'en'>, () => AbstractIntlMessages> = {
  es: () => require('../messages/es.json'),
  de: () => require('../messages/de.json'),
  pt: () => require('../messages/pt.json'),
  fr: () => require('../messages/fr.json'),
  ja: () => require('../messages/ja.json'),
  ko: () => require('../messages/ko.json'),
  zh: () => require('../messages/zh.json'),
  it: () => require('../messages/it.json'),
  nl: () => require('../messages/nl.json'),
  pl: () => require('../messages/pl.json'),
  tr: () => require('../messages/tr.json'),
  ru: () => require('../messages/ru.json'),
  th: () => require('../messages/th.json'),
  id: () => require('../messages/id.json'),
  vi: () => require('../messages/vi.json'),
  tl: () => require('../messages/tl.json'),
  hi: () => require('../messages/hi.json'),
  ar: () => require('../messages/ar.json'),
  sv: () => require('../messages/sv.json'),
  nb: () => require('../messages/nb.json'),
  da: () => require('../messages/da.json'),
  fi: () => require('../messages/fi.json'),
  cs: () => require('../messages/cs.json'),
  ro: () => require('../messages/ro.json'),
  hu: () => require('../messages/hu.json'),
  el: () => require('../messages/el.json'),
  he: () => require('../messages/he.json'),
  ms: () => require('../messages/ms.json'),
  uk: () => require('../messages/uk.json'),
  hr: () => require('../messages/hr.json'),
  sk: () => require('../messages/sk.json'),
  ca: () => require('../messages/ca.json'),
};

function deepMerge(base: AbstractIntlMessages, over: AbstractIntlMessages): AbstractIntlMessages {
  const out: AbstractIntlMessages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] =
      typeof v === 'object' && v !== null && typeof b === 'object' && b !== null
        ? deepMerge(b, v)
        : v;
  }
  return out;
}

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** use-intl provider; any key missing from a locale falls back to the English string. */
export function IntlProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const messages = locale === 'en' ? en : deepMerge(en, LOADERS[locale]());
  return (
    <UseIntlProvider locale={locale} messages={messages} timeZone={TIME_ZONE}>
      {children}
    </UseIntlProvider>
  );
}
