// Maps decide's reason types / section title keys to mobile i18n keys (packages/i18n discover.*).
const REASON_TYPES = new Set([
  'known_song',
  'known_artist',
  'similar_artist',
  'genre_match',
  'decade_match',
  'crowd_pleaser',
  'make_it',
  'sung_before',
]);

export function reasonKey(reasonType: string): string {
  return `discover.reason.${REASON_TYPES.has(reasonType) ? reasonType : 'crowd_pleaser'}`;
}

export interface SectionTitleSource {
  title_key: string;
  title_params?: Record<string, string>;
}

/** The sections the app has copy for (packages/i18n `discover.section.*`). */
const SECTIONS = new Set(['go_tos', 'songs_you_know', 'artists_you_love', 'because', 'crowd_pleasers', 'make_it', 'all']);

/**
 * `recs.section.<x>.title` -> `discover.section.<x>` for a known section; anything else (an unknown shape, or a
 * section decide added that the app has no copy for yet) falls back to crowd_pleasers.
 */
export function sectionTitle(section: SectionTitleSource & { id?: string }): {
  key: string;
  params: Record<string, string>;
} {
  const m = /^recs\.section\.([a-z0-9_]+)\.title$/.exec(section.title_key);
  const name = m?.[1] && SECTIONS.has(m[1]) ? m[1] : 'crowd_pleasers';
  return { key: `discover.section.${name}`, params: { ...(section.title_params ?? {}) } };
}
