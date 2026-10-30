import { z } from 'zod';

import { client } from '../client/client.gen';
import { parseResponse } from '../overrides/parse';

const PrefsSchema = z.object({ ready: z.boolean(), review: z.boolean(), problems: z.boolean() });

// gen v0.284.0's Expo push token endpoints. The committed OpenAPI snapshot predates them (prod was still on
// v0.283.x when this was written), so these call the shared client directly: same base URL, auth, locale and
// ApiError mapping as every generated call. Refresh the snapshot (`pnpm gen:api`) once prod serves them.

export type PushPlatform = 'ios' | 'android';

/**
 * Registers this device's Expo push token with the signed-in gen account (204). gen moves the token off any other
 * account that held it, so a device signed into a new account stops getting the previous account's notifications.
 */
export async function registerExpoToken(token: string, platform: PushPlatform, deviceId: string): Promise<void> {
  await client.post({
    url: '/api/push/expo-token',
    body: { token, platform, device_id: deviceId },
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Removes one of the signed-in account's Expo tokens (204). Needs the session: call it before signing out. `bearer`
 * sends another session's token instead (retrying an unregister that failed after that session signed out here).
 */
export async function deleteExpoToken(token: string, bearer?: string): Promise<void> {
  await client.delete({
    url: '/api/push/expo-token',
    body: { token },
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
  });
}

export type PushPrefsPatch = Partial<{ ready: boolean; review: boolean; problems: boolean }>;

/** Sets some of the signed-in account's push switches (PATCH, partial); resolves the full prefs gen now holds. */
export async function updatePushPrefs(
  patch: PushPrefsPatch,
): Promise<{ ready: boolean; review: boolean; problems: boolean }> {
  const { data } = await client.patch({
    url: '/api/users/me/push-prefs',
    body: patch,
    headers: { 'Content-Type': 'application/json' },
  });
  return parseResponse(PrefsSchema, data);
}
