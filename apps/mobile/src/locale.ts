import { resolveLocale, type Locale } from '@nomad/i18n';
import { getLocales } from 'expo-localization';

let override: Locale | null = null;

export const setLocaleOverride = (locale: Locale | null) => {
  override = locale;
};

/** App locale: explicit override, else the device's first supported language, else en. */
export const currentLocale = (): Locale => override ?? resolveLocale(getLocales().map((l) => l.languageTag));
