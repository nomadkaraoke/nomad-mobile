// Port of kjbox kj-controller/static-sing/sing.js sameSong / _songKey / _credits @ 19c0482.
// A loose "is this the same song?" check used to avoid repeating what the karaoke
// results already show: same title (ignoring "(feat …)" / " - Remastered"), and a
// credited artist in common. Deliberately kjbox's JS behaviour (ASCII-only keys), not
// the matcher's credit-variant dedupe (identify.ts).

type SongLike = { artist?: string | null; title?: string | null };

/** Title key: lowercase, accents folded, version suffix dropped, only [a-z0-9] kept. */
export function songTitleKey(text: string | null | undefined): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*$|\s+-\s+.*$/, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** The credited artists of an artist string ("Wisin & Yandel" → {wisin, yandel}). */
export function credits(artist: string | null | undefined): Set<string> {
  return new Set(
    String(artist || '')
      .toLowerCase()
      .split(/\s*(?:,|&|\+|\/|\bfeaturing\b|\bfeat\.?|\bft\.?|\band\b|\bwith\b)\s*/)
      .map(songTitleKey)
      .filter(Boolean),
  );
}

/** Same title and at least one credited artist in common. */
export function sameSong(a: SongLike | null | undefined, b: SongLike | null | undefined): boolean {
  if (!a || !b || songTitleKey(a.title) !== songTitleKey(b.title)) return false;
  const ca = credits(a.artist);
  for (const c of credits(b.artist)) if (ca.has(c)) return true;
  return false;
}
