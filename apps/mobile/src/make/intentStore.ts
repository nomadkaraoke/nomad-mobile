import { create } from 'zustand';

import { appStorage } from '../storage';

/** The song someone tapped "Make it" on. Survives sign-in, checkout and an app kill (spec §7). */
export type MakeIntent = { artist: string; title: string; decideSongId?: number; createdAt: number };

const KEY = 'make.intent.v1';
/** Older than this, the person has moved on: don't drop them back into a make flow. */
export const INTENT_TTL_MS = 30 * 60 * 1000;

export const isFreshIntent = (i: MakeIntent | null, now = Date.now()): i is MakeIntent =>
  i !== null && now - i.createdAt <= INTENT_TTL_MS;

function load(): MakeIntent | null {
  try {
    const raw = appStorage.getString(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MakeIntent> | null;
    if (v && typeof v.artist === 'string' && typeof v.title === 'string' && typeof v.createdAt === 'number') {
      return {
        artist: v.artist,
        title: v.title,
        createdAt: v.createdAt,
        ...(typeof v.decideSongId === 'number' ? { decideSongId: v.decideSongId } : {}),
      };
    }
  } catch {
    // Corrupt: treated as no intent.
  }
  appStorage.remove(KEY);
  return null;
}

type IntentStore = {
  /** Raw stored intent (may be stale); read through get() or isFreshIntent(). */
  intent: MakeIntent | null;
  set(i: MakeIntent): void;
  clear(): void;
  /**
   * The intent, or null once it's older than 30 minutes. Clears an expired intent (a state update), so call it
   * from handlers/effects, not during render; render code reads `intent` through isFreshIntent().
   */
  get(): MakeIntent | null;
};

export const useMakeIntent = create<IntentStore>((setState, getState) => ({
  intent: load(),

  set(intent) {
    appStorage.set(KEY, JSON.stringify(intent));
    setState({ intent });
  },

  clear() {
    appStorage.remove(KEY);
    setState({ intent: null });
  },

  get() {
    const { intent } = getState();
    if (intent === null) return null;
    if (isFreshIntent(intent)) return intent;
    getState().clear();
    return null;
  },
}));
