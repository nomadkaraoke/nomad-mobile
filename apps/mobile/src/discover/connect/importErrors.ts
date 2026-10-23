import { NotAnExportError } from './readExport';

export type ImportRoute = 'screenshot' | 'playlist' | 'export' | 'listenbrainz' | 'lastfm';
export type ImportErrorName =
  | 'badUrl'
  | 'notFound'
  | 'private'
  | 'likedPrivate'
  | 'unparseable'
  | 'rateLimited'
  | 'unavailable'
  | 'tooLarge'
  | 'notAnExport'
  | 'generic';
/** A full message key (use with a root `useTranslations()`). */
export type ImportErrorKey = `connect.errors.${ImportErrorName}`;

/** An `ApiError`, or anything shaped like one (the upload queue stores `{ status, detail }` as its lastError). */
function statusOf(e: unknown): { status: number; detail: string } | null {
  if (!e || typeof e !== 'object' || typeof (e as { status?: unknown }).status !== 'number') return null;
  const { status, detail } = e as { status: number; detail?: unknown };
  return { status, detail: typeof detail === 'string' ? detail : '' };
}

function name(e: unknown, route: ImportRoute): ImportErrorName {
  if (e instanceof NotAnExportError) return 'notAnExport';
  const s = statusOf(e);
  if (!s) return 'generic';
  const { status, detail } = s;
  if (status === 0 || status >= 500) return 'unavailable'; // no connection, or decide / the provider is down
  if (status === 429) return 'rateLimited';
  if (status === 413) return 'tooLarge';
  switch (route) {
    case 'playlist':
      if (status === 400) return 'badUrl';
      if (status === 404) return 'private'; // "Playlist not found or private"
      // 422: YouTube Music's Liked Music is always private; a Spotify embed we couldn't read.
      if (status === 422) return /liked/i.test(detail) ? 'likedPrivate' : 'unparseable';
      return 'generic';
    case 'lastfm':
    case 'listenbrainz':
      if (status === 404 || status === 422) return 'notFound'; // decide answers an unknown username with 422
      if (route === 'listenbrainz' && status === 400 && detail === 'not_a_zip') return 'notAnExport';
      return 'generic';
    case 'export':
      return status === 400 ? 'notAnExport' : 'generic'; // 400 bad_chunk: decide rejected what we parsed
    case 'screenshot':
      return 'generic';
  }
}

/** Maps an import failure (decide's status + detail, or a local parse error) to a `connect.errors.*` message key. */
export function importErrorKey(e: unknown, route: ImportRoute): ImportErrorKey {
  return `connect.errors.${name(e, route)}`;
}
