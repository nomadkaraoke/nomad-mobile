import type { MeResult, Song, SongItemRequest } from '@nomad/api-kjbox';

/** Stable key for a Your-songs row (testIDs, React keys): the request id, or the rotation entry for host/partner rows. */
export const songKey = (s: Song): string =>
  s.request.id != null ? `r${s.request.id}` : `e${s.entry_id ?? s.request.linked_entry_id ?? 'x'}`;

/** The rotation entry behind a row, once it has one. */
export const entryIdOf = (s: Song): number | null => s.request.linked_entry_id ?? s.entry_id ?? null;

/** Still headed for the stage: not taken off by the host, not cancelled or rejected. */
export const isLive = (s: Song): boolean =>
  !s.removed && s.request.status !== 'cancelled' && s.request.status !== 'rejected';

/** The account's own request (or one it made for a friend): only these carry a request id for cancel/change. */
export const isOwnRequest = (s: Song): boolean => (s.owner === 'me' || s.owner === 'friend') && s.request.id != null;

export const isOnStage = (s: Song): boolean => Boolean(s.estimate?.now_singing);

/** "Title" and "Artist" as the row shows them. Host/partner rows carry one "Title - Artist" string in song_title. */
export const songParts = (r: Pick<SongItemRequest, 'song_title' | 'song_artist'>) => ({
  title: r.song_title.trim(),
  artist: r.song_artist.trim(),
});

/** The singer's next song: the one `next` points at, else their first live song (never a friend's, A.13). */
export function nextSong(me: MeResult): Song | null {
  if (me.next) {
    const hit = me.songs.find((s) => entryIdOf(s) === me.next!.entry_id);
    if (hit) return hit;
  }
  return me.songs.find((s) => s.owner !== 'friend' && isLive(s)) ?? null;
}

export type TurnSummary =
  | { kind: 'onStage' }
  | { kind: 'next' }
  | { kind: 'afterThis' }
  | { kind: 'almost' }
  | { kind: 'position'; position: number; etaS: number }
  | { kind: 'making' }
  | { kind: 'pending' }
  | { kind: 'queued' };

/** How many places from the mic counts as "nearly up" (green tile, A.47). */
export const URGENT_POSITION = 3;

/**
 * The status tile's summary line and urgency, ported from the web's `_mySongsPillSummary` / `_youTile`: on stage,
 * then queue position (1 = next, 2 = after this song or almost), then making / pending / queued. Urgent (green) when
 * on stage or 3 or fewer from the mic.
 */
export function turnSummary(me: MeResult, someoneOnStage: boolean): { summary: TurnSummary; urgent: boolean } {
  const live = me.songs.filter((s) => s.owner !== 'friend' && isLive(s));
  if (live.some(isOnStage)) return { summary: { kind: 'onStage' }, urgent: true };
  const next = me.next;
  if (next) {
    const urgent = next.position <= URGENT_POSITION;
    if (next.position <= 1) return { summary: { kind: 'next' }, urgent };
    if (next.position === 2) return { summary: { kind: someoneOnStage ? 'afterThis' : 'almost' }, urgent };
    return { summary: { kind: 'position', position: next.position, etaS: next.eta_s }, urgent };
  }
  if (live.some((s) => s.make)) return { summary: { kind: 'making' }, urgent: false };
  if (live.some((s) => s.request.status === 'pending')) return { summary: { kind: 'pending' }, urgent: false };
  return { summary: { kind: 'queued' }, urgent: false };
}

/** Whole hours and the remaining minutes (rounded) of a wait, for "1h 28m" / "25 min". */
export function splitWait(seconds: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(seconds / 60));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
