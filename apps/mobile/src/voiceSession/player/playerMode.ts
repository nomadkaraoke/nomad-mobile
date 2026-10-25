/**
 * How the voice session plays a song's community karaoke video (Phase 3d spike D1, docs/superpowers/specs/
 * 2026-10-22-mobile-phase3d-spike-results.md):
 * - `embed-hosted`: our own YouTube IFrame Player API page in a WebView (`YouTubeEmbed`), driven by injected JS.
 * - `linkout`: a card that opens the video in the YouTube app or browser (`LinkOutPlayer`).
 * Every embed error makes the song unplayable; the session then moves on (skip with `not_embeddable`).
 */
export type PlayerMode = 'embed-hosted' | 'linkout';

export const PLAYER_MODES: readonly PlayerMode[] = ['embed-hosted', 'linkout'];

/** The spike's verdict: plays inline on iOS and Android with deterministic play/pause. */
export const DEFAULT_PLAYER_MODE: PlayerMode = 'embed-hosted';

/** A known mode, else the default. */
export function parsePlayerMode(raw: string | undefined): PlayerMode {
  return PLAYER_MODES.find((m) => m === raw) ?? DEFAULT_PLAYER_MODE;
}
