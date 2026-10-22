import type { AudioPlayer } from 'expo-audio';

import { ensurePlaybackAudioMode } from '../../audio/playbackMode';

/** UI-facing error codes (the screen maps them to i18n copy; raw native strings never leave the hooks). */
export type AudioErrorCode = 'load_failed' | 'play_failed';

/** A cancelled play/seek (another command superseded it) is not a failure. */
export function isBenignAbort(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  return err?.name === 'AbortError' || /abort|cancel/i.test(err?.message ?? '');
}

/** play() can throw synchronously or reject (iOS session activation). Failures become an error code. */
export function safePlay(player: Pick<AudioPlayer, 'play'>, onError: (code: AudioErrorCode) => void): void {
  // Ruling E10-R7: explicit playback plays with the ringer off. Normally already set when the players were created.
  void ensurePlaybackAudioMode();
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

export const REPLACE_LOAD_TIMEOUT_MS = 15_000;

/**
 * Swaps the player's source and resolves once the NEW item reports `isLoaded`. Rejects when a status carries
 * an `error` or nothing loads within REPLACE_LOAD_TIMEOUT_MS; the listener and timer are always released.
 * replace() returns before the item is ready and iOS auto-resumes on ready if it was playing, so pause
 * first; the caller seeks and resumes.
 */
export function replaceAndWait(player: AudioPlayer, source: { uri: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.error) settle(() => reject(new Error(s.error ?? 'load failed')));
      else if (s.isLoaded) settle(resolve);
    });
    const settle = (done: () => void) => {
      clearTimeout(timer);
      sub.remove();
      done();
    };
    timer = setTimeout(() => settle(() => reject(new Error('load timeout'))), REPLACE_LOAD_TIMEOUT_MS);
    player.pause();
    player.replace(source);
  });
}
