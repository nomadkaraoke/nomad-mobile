import { appStorage } from '../storage';

export function readCache<T>(key: string | null, ok: (v: unknown) => v is T): T | undefined {
  if (!key) return undefined;
  try {
    const raw = appStorage.getString(key);
    const v: unknown = raw ? JSON.parse(raw) : undefined;
    return ok(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    appStorage.set(key, JSON.stringify(value));
  } catch {
    // best effort: a full store just means a cold start next time
  }
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
