import type { RecommendationsV2Response } from '@nomad/api-decide';
import { isFresh } from '@nomad/core';

import { appStorage } from '../storage';

const KEY = 'discover.recs.v1';

export type RecsSnapshot = { key: string; savedAt: number; data: RecommendationsV2Response };

/**
 * Remembers the first page of the last recommendations fetched, for offline Discover (spec §8.4). Only one
 * snapshot is kept (the last filter key). `key` is opaque to this module; the caller puts the user in it.
 */
export function saveRecsSnapshot(key: string, data: RecommendationsV2Response, now = Date.now()): void {
  try {
    appStorage.set(KEY, JSON.stringify({ key, savedAt: now, data } satisfies RecsSnapshot));
  } catch {
    // best effort: a full or unavailable store just means no offline picks
  }
}

/** The snapshot key: the owner first, so one user's picks are never read back as another's. */
export const recsSnapshotKey = (email: string, filters: string): string => `${email.toLowerCase()}\n${filters}`;
export const ownsRecsSnapshot = (snap: RecsSnapshot, email: string): boolean =>
  snap.key.startsWith(`${email.toLowerCase()}\n`);

export function clearRecsSnapshot(): void {
  try {
    appStorage.remove(KEY);
  } catch {
    // nothing to clear
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The saved snapshot if it is at most 7 days old and has the shape we wrote; otherwise null. */
export function loadRecsSnapshot(now = Date.now()): RecsSnapshot | null {
  try {
    const raw = appStorage.getString(KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v) || typeof v.key !== 'string' || typeof v.savedAt !== 'number' || !isRecord(v.data)) return null;
    const { sections, has_profile: hasProfile } = v.data;
    if (!Array.isArray(sections) || typeof hasProfile !== 'boolean') return null;
    const ok = sections.every((s) => isRecord(s) && typeof s.id === 'string' && Array.isArray(s.songs));
    if (!ok || !isFresh(v.savedAt, now)) return null;
    return v as unknown as RecsSnapshot;
  } catch {
    return null;
  }
}
