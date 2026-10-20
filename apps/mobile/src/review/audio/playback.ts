import type { AudioPlayer } from 'expo-audio';

/** UI-facing error codes (the screen maps them to i18n copy; raw native strings never leave the hooks). */
export type AudioErrorCode = 'load_failed' | 'play_failed';

/** A cancelled play/seek (another command superseded it) is not a failure. */
export function isBenignAbort(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  return err?.name === 'AbortError' || /abort|cancel/i.test(err?.message ?? '');
}

/** play() can throw synchronously or reject (iOS session activation). Failures become an error code. */
export function safePlay(player: Pick<AudioPlayer, 'play'>, onError: (code: AudioErrorCode) => void): void {
  const fail = (e: unknown) => {
    if (!isBenignAbort(e)) onError('play_failed');
  };
  try {
    const r = player.play() as unknown;
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(fail);
  } catch (e) {
    fail(e);
  }
}

/**
 * Swaps the player's source and resolves once the NEW item reports `isLoaded`. replace() returns before the
 * item is ready and iOS auto-resumes on ready if it was playing, so pause first; the caller seeks and resumes.
 */
export function replaceAndWait(player: AudioPlayer, source: { uri: string }): Promise<void> {
  return new Promise((resolve) => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (!s.isLoaded) return;
      sub.remove();
      resolve();
    });
    player.pause();
    player.replace(source);
  });
}
