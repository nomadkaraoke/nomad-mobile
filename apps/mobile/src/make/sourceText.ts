import type { AudioResult } from '@nomad/api-gen';
import { categorizeResult, formatCount, getDisplayName } from '@nomad/core';

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
  // A torrent's title is the release (album) name; YouTube and Spotify titles are the track itself.
  const release = !isYoutube(r) && !isSpotify(r) && r.title ? [r.title] : [];
  return [t(`reason.${kindKey(r)}`), ...release, ...details(r, t)].join(' · ');
}

/** A source row: its title, then who and how good. */
export function sourceRowText(r: AudioResult, t: MakeT): { title: string; detail: string } {
  return { title: r.title, detail: [getDisplayName(r), ...details(r, t)].filter(Boolean).join(' · ') };
}
