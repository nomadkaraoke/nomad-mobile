// Anonymous install id for the search service (X-Device-Id). In-memory for now: stable for the app session.
// TODO(C9): persist (expo-secure-store / MMKV) so it survives restarts; API clients never touch storage.
let id: string | null = null;

export function getDeviceId(): string {
  if (!id) id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return id;
}
