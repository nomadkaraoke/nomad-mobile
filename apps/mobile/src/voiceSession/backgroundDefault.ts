// The singer's last "About your singing" answers (Phase 3d batch 1, M9): the setup screen pre-fills them next time.
// Personal, so cleared on sign-out next to the record default (useClearDiscoverOnSignOut).
import { appStorage } from '../storage';
import { EXPERIENCES, USES_FALSETTO, type Experience, type UsesFalsetto } from './setupOptions';

export const BACKGROUND_KEY = 'voiceSession.background.v1';

export type SingingBackground = { experience: Experience | null; usesFalsetto: UsesFalsetto | null };
export const NO_BACKGROUND: SingingBackground = { experience: null, usesFalsetto: null };

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** The stored answers (each null when never given or unreadable). */
export function readBackground(): SingingBackground {
  try {
    const raw = appStorage.getString(BACKGROUND_KEY);
    if (raw === undefined) return NO_BACKGROUND;
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    return { experience: oneOf(v?.experience, EXPERIENCES), usesFalsetto: oneOf(v?.usesFalsetto, USES_FALSETTO) };
  } catch {
    return NO_BACKGROUND;
  }
}

/** Remembers the answers; nothing answered forgets them. */
export function writeBackground(b: SingingBackground): void {
  if (b.experience === null && b.usesFalsetto === null) appStorage.remove(BACKGROUND_KEY);
  else appStorage.set(BACKGROUND_KEY, JSON.stringify(b));
}
