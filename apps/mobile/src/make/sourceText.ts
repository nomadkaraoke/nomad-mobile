import type { AudioResult } from '@nomad/api-gen';
import { categorizeResult, checkFilenameMismatch, formatCount, getDisplayName, type SearchConfidence } from '@nomad/core';

/** `useTranslations('make')`. */
type MakeT = (key: string, values?: Record<string, string | number>) => string;

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase();
const isYoutube = (r: AudioResult) => lower(r.provider) === 'youtube';
const isSpotify = (r: AudioResult) => lower(r.provider) === 'spotify';

/** gen's ranking category → its plain-language group heading key (same groups as gen and kjbox). */
export const CATEGORY_KEYS = {
  'BEST CHOICE': 'best',
  'HI-RES 24-BIT': 'hiRes',
  'STUDIO ALBUMS': 'studio',
  SINGLES: 'singles',
  'LIVE VERSIONS': 'live',
  COMPILATIONS: 'compilations',
  'VINYL RIPS': 'vinyl',
  SPOTIFY: 'spotify',
  YOUTUBE: 'youtube',
  OTHER: 'other',
} as const;

export const categoryKey = (category: string) =>
  CATEGORY_KEYS[category as keyof typeof CATEGORY_KEYS] ?? CATEGORY_KEYS.OTHER;

/** What kind of release this is, in words a singer knows ("Studio album", "Single", "YouTube"). */
function kindKey(r: AudioResult) {
  if (isYoutube(r)) return 'youtube';
  if (isSpotify(r)) return 'spotify';
  const category = categorizeResult(r);
  if (category === 'VINYL RIPS') return 'vinyl';
  if (category === 'HI-RES 24-BIT') return 'hiRes';
  const type = lower(r.release_type);
  if (type === 'single' || type === 'ep') return 'single';
  if (type.includes('live') || type === 'bootleg') return 'live';
  if (type === 'compilation' || type === 'soundtrack' || type === 'anthology') return 'compilation';
  if (type === 'album' || type === '') return 'studioAlbum';
  return 'other';
}

/** Quality, availability and length, without provider or tracker names. */
function details(r: AudioResult, t: MakeT): string[] {
  const out: string[] = [];
  if (r.year) out.push(String(r.year));
  if (r.is_lossless) out.push(t(r.quality_data?.bit_depth === 24 ? 'reason.hiResLossless' : 'reason.lossless'));
  else if (!isYoutube(r) && !isSpotify(r)) out.push(t('reason.lossy'));
  if (r.seeders != null) {
    out.push(t(r.seeders >= 50 ? 'reason.reliable' : r.seeders >= 10 ? 'reason.slower' : 'reason.lowAvailability'));
  } else if (r.view_count != null) {
    out.push(t('reason.views', { views: formatCount(r.view_count) }));
  }
  if (r.formatted_duration) out.push(r.formatted_duration);
  return out;
}

/** The pick card's reason line, e.g. "Studio album · Black Holes and Revelations · 2006 · lossless · reliable download". */
export function pickReason(r: AudioResult, t: MakeT): string {
  // A torrent's or Spotify result's title is the release (album) name; a YouTube title is the video itself.
  const release = !isYoutube(r) && r.title ? [r.title] : [];
  return [t(`reason.${kindKey(r)}`), ...release, ...details(r, t)].join(' · ');
}

/**
 * A source row: its title, then who and how good. A Spotify result's `title` is the album and its
 * `target_file` the track (spec A108), so the row leads with the track and names the album after the artist.
 */
export function sourceRowText(r: AudioResult, t: MakeT): { title: string; detail: string } {
  if (isSpotify(r) && r.target_file) {
    return { title: r.target_file, detail: [r.artist, r.title, ...details(r, t)].filter(Boolean).join(' · ') };
  }
  return { title: r.title, detail: [getDisplayName(r), ...details(r, t)].filter(Boolean).join(' · ') };
}

export type Availability = 'high' | 'medium' | 'low';

/** gen's availability badge: High ≥ 50 seeders, Medium ≥ 10, else Low; none without a seeder count. */
export function availability(seeders: number | null | undefined): Availability | null {
  if (seeders == null) return null;
  return seeders >= 50 ? 'high' : seeders >= 10 ? 'medium' : 'low';
}

/** The "Title match" / "Wrong track?" badge for a row, or none (gen ResultRow + MismatchBadge). */
export function titleBadge(r: AudioResult, searchTitle: string, showMatch: boolean): 'match' | 'wrong' | null {
  const mm = checkFilenameMismatch(searchTitle, r);
  if (mm.isMismatch) return 'wrong';
  // "Title match" only when a filename was actually compared.
  return showMatch && mm.filename !== '' ? 'match' : null;
}

/**
 * gen ResultCategories: when a category mixes right and wrong tracks, the matching files go first and both
 * badges show; at tier 3 (`always`) a category with any match shows them too.
 */
export function sortByTitleMatch<R extends AudioResult>(
  rows: R[],
  searchTitle: string,
  always = false,
): { rows: R[]; showMatch: boolean } {
  const wrong = rows.map((r) => checkFilenameMismatch(searchTitle, r).isMismatch);
  const anyMatch = wrong.some((w) => !w);
  const mixed = anyMatch && wrong.some((w) => w);
  const sorted = mixed
    ? rows.map((r, i) => [r, wrong[i]] as const).sort((a, b) => Number(a[1]) - Number(b[1])).map(([r]) => r)
    : rows;
  return { rows: sorted, showMatch: mixed || (always && anyMatch) };
}

/**
 * The pick card's warnings: gen's `confidence.warnings` in the person's language, plus gen's separate
 * lossy-source warning when the best is YouTube and no lossless warning already says so.
 */
export function pickWarnings(confidence: SearchConfidence, t: MakeT): string[] {
  const out = confidence.warnings.map((w) => {
    if (w.startsWith('Filename suggests different track: ')) {
      return t('warn.fileLooksLike', { file: w.slice('Filename suggests different track: '.length) });
    }
    if (w.startsWith('Filename may not match')) return t('warn.fileMayNotMatch');
    if (w.startsWith('No lossless sources')) return t('warn.noLossless');
    if (w.startsWith('Low availability')) return t('warn.lowAvailability');
    return w;
  });
  if (confidence.bestCategory === 'YOUTUBE' && !confidence.warnings.some((w) => w.includes('lossless'))) {
    out.push(t('warn.lossy'));
  }
  return out;
}
