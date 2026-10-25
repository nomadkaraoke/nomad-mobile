import { ApiError } from './configure';
import {
  createPlaylistApiPlaylistsPost,
  deletePlaylistApiPlaylistsPlaylistIdDelete,
  getLibraryApiMyLibraryGet,
  listKaraokeLogApiMyKaraokeLogGet,
  listPlaylistsApiPlaylistsGet,
  replacePlaylistItemsApiPlaylistsPlaylistIdItemsPut,
  updatePlaylistApiPlaylistsPlaylistIdPut,
} from './client';
import type { KaraokeLogEntry, LibraryItem, PlaylistItemIn, PlaylistResponse } from './client';

// Me tab: the singer's library (catalogued songs + facets), setlists (decide playlists with ordered items) and per-song history.
export type Setlist = PlaylistResponse;
export type SetlistItemIn = PlaylistItemIn;
// `LibraryItem` and `SongFacets` come from the generated client (re-exported by index.ts).

export type LibraryResult = { status: 'not-modified' } | { status: 'ok'; etag: string; items: LibraryItem[] };

/** The user's library. Pass the last `etag` to revalidate: a 304 → `not-modified` (keep the cached items). */
export const getLibrary = async (etag?: string): Promise<LibraryResult> => {
  try {
    const res = await getLibraryApiMyLibraryGet({ headers: etag ? { 'if-none-match': etag } : undefined });
    if (res.response?.status === 304) return { status: 'not-modified' };
    const body = res.data;
    return { status: 'ok', etag: res.response?.headers.get('etag') ?? body.etag, items: body.items };
  } catch (e) {
    if (e instanceof ApiError && e.status === 304) return { status: 'not-modified' };
    throw e;
  }
};

const PAGE = 100;

/** Every setlist, oldest pages first (decide pages with limit/offset; `total` ends the loop). */
export const listSetlists = async (): Promise<Setlist[]> => {
  const all: Setlist[] = [];
  for (;;) {
    const page = (await listPlaylistsApiPlaylistsGet({ query: { limit: PAGE, offset: all.length } })).data;
    all.push(...page.playlists);
    if (page.playlists.length === 0 || all.length >= page.total) return all;
  }
};

/** Idempotent on the client id (`pl_…`). */
export const createSetlist = async (input: { id: string; name: string; items: SetlistItemIn[] }): Promise<Setlist> =>
  (await createPlaylistApiPlaylistsPost({ body: input })).data;

/** Replace the whole ordered list. `baseRev` is the rev this edit started from (null = unknown); last writer wins. */
export const putSetlistItems = async (id: string, items: SetlistItemIn[], baseRev: number | null): Promise<Setlist> =>
  (
    await replacePlaylistItemsApiPlaylistsPlaylistIdItemsPut({
      path: { playlist_id: id },
      body: { items, base_rev: baseRev },
    })
  ).data;

export const renameSetlist = async (id: string, name: string): Promise<Setlist> =>
  (await updatePlaylistApiPlaylistsPlaylistIdPut({ path: { playlist_id: id }, body: { name } })).data;

export const deleteSetlist = async (id: string): Promise<void> => {
  await deletePlaylistApiPlaylistsPlaylistIdDelete({ path: { playlist_id: id } });
};

/** Every karaoke-log entry for one library key (all pages, newest first). */
export const listSongHistory = async (libraryKey: string): Promise<KaraokeLogEntry[]> => {
  const all: KaraokeLogEntry[] = [];
  let cursor: string | undefined;
  do {
    // (Not `listKaraokeLog` from ./index: that import would make a cycle with index's `export * from './me'`.)
    const page = (await listKaraokeLogApiMyKaraokeLogGet({ query: { song: libraryKey, cursor } })).data;
    all.push(...page.entries);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
};
