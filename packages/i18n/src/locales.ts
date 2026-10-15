// Same list and order as karaoke-gen/frontend/i18n/routing.ts.
export const LOCALES = [
  'en', 'es', 'de', 'pt', 'fr', 'ja', 'ko', 'zh', 'it', 'nl',
  'pl', 'tr', 'ru', 'th', 'id', 'vi', 'tl', 'hi', 'ar', 'sv',
  'nb', 'da', 'fi', 'cs', 'ro', 'hu', 'el', 'he', 'ms', 'uk',
  'hr', 'sk', 'ca',
] as const;

export type Locale = (typeof LOCALES)[number];

export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar', 'he']);
