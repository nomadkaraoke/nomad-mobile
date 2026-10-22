// Maps decide's reason types / section title keys to mobile i18n keys (packages/i18n discover.*).
const REASON_TYPES = new Set([
  'known_song',
  'known_artist',
  'similar_artist',
  'genre_match',
  'decade_match',
  'crowd_pleaser',
  'make_it',
]);

export function reasonKey(reasonType: string): string {
  return `discover.reason.${REASON_TYPES.has(reasonType) ? reasonType : 'crowd_pleaser'}`;
}

export interface SectionTitleSource {
  title_key: string;
  title_params?: Record<string, string>;
}

/** `recs.section.<x>.title` -> `discover.section.<x>`; unknown shapes fall back to crowd_pleasers. */
export function sectionTitle(section: SectionTitleSource & { id?: string }): {
  key: string;
  params: Record<string, string>;
} {
  const m = /^recs\.section\.([a-z0-9_]+)\.title$/.exec(section.title_key);
  return { key: `discover.section.${m ? m[1] : 'crowd_pleasers'}`, params: { ...(section.title_params ?? {}) } };
}
