import { LOCALES, type Locale } from './locales';

// Legacy / alternate language subtags that devices still report.
const ALIASES: Record<string, Locale> = { no: 'nb', nn: 'nb', iw: 'he', in: 'id', fil: 'tl' };

/** First supported locale among the device's preferred BCP-47 tags, else 'en'. */
export function resolveLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
    const candidate = ALIASES[base] ?? base;
    if ((LOCALES as readonly string[]).includes(candidate)) return candidate as Locale;
  }
  return 'en';
}
