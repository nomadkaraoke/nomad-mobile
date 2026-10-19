// Port of decide's karaoke_decide/song_search/identify_kind.py (kjbox sing._identify_kind).
// Drives the banner: nothing for `same`, "Tidied to …" for `cosmetic`, the filled-in
// song for `completed`, "Corrected to … — you typed …" for `content`. Clients ignore
// it unless identify's status is "confident".
import { songNorm } from './normalize';
import { pySplit, pyStrip } from './pyCompat';
import type { IdentifyKind } from './types';

const compact = (s: string) => songNorm(s).replace(/ /g, '');

/** How the identified song (artist, title) relates to what was typed. */
export function identifyKind(query: string, artist: string, title: string): IdentifyKind {
  const typed = compact(query);
  const full = new Set([compact(`${artist} ${title}`), compact(`${title} ${artist}`)]);
  const q = pyStrip(query);
  if ([`${artist} ${title}`, `${title} ${artist}`, `${artist} - ${title}`, `${title} - ${artist}`].includes(q)) {
    return 'same';
  }
  if (full.has(typed)) return 'cosmetic';
  const words = new Set(pySplit(songNorm(query)));
  const songWords = new Set(pySplit(songNorm(`${artist} ${title}`)));
  if (words.size && [...words].every((w) => songWords.has(w))) return 'completed';
  return 'content';
}
