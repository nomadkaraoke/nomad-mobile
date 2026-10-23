// ExportSummary → decide upload bodies (POST /api/services/spotify-export | apple-export).
// The limits mirror decide's request models (backend/api/routes/imports_export.py).
import { songIdentity } from './tally';
import type { ExportRef, ExportSummary, ListenAggregate } from './types';

export interface ExportUploadChunk {
  endpoint: 'spotify-export' | 'apple-export';
  /** snake_case, as decide's API takes it. */
  body: Record<string, unknown>;
}

const MAX_TRACKS = 20_000;
const MAX_CHUNKS = 50;
const MAX_LIKED = 20_000;
const MAX_PLAYLISTS = 500;
const MAX_PLAYLIST_TRACKS = 10_000;
const MAX_PLAYLIST_REFS = 20_000;
const MAX_TEXT = 300;
const MAX_NAME = 200;

/** Trimmed and cut to `max` UTF-16 units without splitting a surrogate pair. */
function clip(s: string, max: number): string {
  let t = s.trim();
  if (t.length > max) t = t.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t;
}

function cleanRef(r: ExportRef): ExportRef | null {
  const artist = clip(r.artist, MAX_TEXT);
  const title = clip(r.title, MAX_TEXT);
  return artist && title ? { artist, title } : null;
}

/**
 * Liked songs (≤ 20,000) and playlists within decide's caps. Playlist rule: export order;
 * a song already sent (liked, or in an earlier playlist) is dropped, since decide only uses
 * distinct songs; each playlist keeps ≤ 10,000 songs; the playlist that crosses the
 * 20,000-song request budget is truncated and later ones are dropped; ≤ 500 playlists;
 * playlists left empty are dropped.
 */
function libraryParts(s: ExportSummary): { liked: ExportRef[]; playlists: { name: string; tracks: ExportRef[] }[] } {
  const seen = new Set<string>();
  const liked: ExportRef[] = [];
  for (const r of s.liked) {
    const ref = cleanRef(r);
    if (!ref || liked.length >= MAX_LIKED) continue;
    const key = songIdentity(ref.artist, ref.title);
    if (seen.has(key)) continue;
    seen.add(key);
    liked.push(ref);
  }
  const playlists: { name: string; tracks: ExportRef[] }[] = [];
  let budget = MAX_PLAYLIST_REFS;
  for (const p of s.playlists) {
    if (budget <= 0 || playlists.length >= MAX_PLAYLISTS) break;
    const tracks: ExportRef[] = [];
    const cap = Math.min(MAX_PLAYLIST_TRACKS, budget);
    for (const r of p.tracks) {
      if (tracks.length >= cap) break;
      const ref = cleanRef(r);
      if (!ref) continue;
      const key = songIdentity(ref.artist, ref.title);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(ref);
    }
    if (!tracks.length) continue;
    budget -= tracks.length;
    playlists.push({ name: clip(p.name, MAX_NAME), tracks });
  }
  return { liked, playlists };
}

/**
 * Upload chunks for an export: tracks sorted by plays (then listening time) descending,
 * `maxTracks` (1–20,000) per chunk, each song in exactly one chunk, at most 50 chunks (the
 * least-played songs beyond 1,000,000 are dropped). Liked songs and playlists ride in chunk 0
 * only; Apple bodies have no `kind`, `liked` or `playlists`. Nothing to send → [].
 */
export function toUploadChunks(s: ExportSummary, maxTracks = MAX_TRACKS): ExportUploadChunk[] {
  const per = Math.min(MAX_TRACKS, Math.max(1, Math.floor(maxTracks) || 1));
  const tracks: ListenAggregate[] = [];
  for (const t of s.tracks) {
    const ref = cleanRef(t);
    if (ref) tracks.push({ ...t, ...ref });
  }
  tracks.sort((a, b) => b.plays - a.plays || b.ms_played - a.ms_played);
  tracks.length = Math.min(tracks.length, per * MAX_CHUNKS);

  const apple = s.kind === 'apple';
  const lib = apple ? { liked: [], playlists: [] } : libraryParts(s);
  if (!tracks.length && !lib.liked.length && !lib.playlists.length) return [];

  const count = Math.max(1, Math.ceil(tracks.length / per));
  const chunks: ExportUploadChunk[] = [];
  for (let i = 0; i < count; i++) {
    const body: Record<string, unknown> = {
      generated_at: s.generatedAt,
      chunk_index: i,
      chunk_count: count,
      tracks: tracks.slice(i * per, (i + 1) * per),
    };
    if (apple) {
      chunks.push({ endpoint: 'apple-export', body });
    } else {
      chunks.push({
        endpoint: 'spotify-export',
        body: {
          kind: s.kind === 'spotify-extended' ? 'extended' : 'account',
          ...body,
          liked: i === 0 ? lib.liked : [],
          playlists: i === 0 ? lib.playlists : [],
        },
      });
    }
  }
  return chunks;
}
