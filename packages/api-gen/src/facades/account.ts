import { z } from 'zod';

import { client } from '../client/client.gen';
import { parseResponse } from '../overrides/parse';

// gen v0.284.0's account deletion (behind ACCOUNT_DELETION_ENABLED; 404 while it is off). The committed OpenAPI
// snapshot predates these endpoints, so they call the shared client directly, like facades/push.ts.

/** Why gen won't delete the account from the app (it asks the person to contact support). Unknown codes may come. */
export type DeletionBlock = 'admin' | 'referral_balance' | 'connect_account' | 'order_in_progress' | (string & {});

/** What deleting the account would cost: credits lost, videos in progress cancelled, or why it is blocked. */
export type DeletionPreview = { credits: number; jobsInProgress: number; blocked: DeletionBlock | null };

const PreviewSchema = z.object({
  credits: z.number(),
  jobs_in_progress: z.number(),
  blocked: z.string().nullish(),
});

/** `GET /api/users/me/deletion-preview`. Throws ApiError (404 when account deletion is off on gen). */
export async function getDeletionPreview(): Promise<DeletionPreview> {
  const { data } = await client.get({ url: '/api/users/me/deletion-preview' });
  const p = parseResponse(PreviewSchema, data);
  return { credits: p.credits, jobsInProgress: p.jobs_in_progress, blocked: p.blocked ?? null };
}

/**
 * `DELETE /api/users/me`: deletes the signed-in account (200). `appleAuthorizationCode` (from a fresh Sign in with
 * Apple) lets gen revoke the Apple link. Throws ApiError: 409 blocked (`detail.code`), 503 failed part-way
 * (`detail.step`, retrying resumes), 404 deletion off, 401 the session is gone, 0 no connection or aborted.
 * Any 2xx counts as deleted: the summary is informational only.
 */
export async function deleteMyAccount(opts: { appleAuthorizationCode?: string; signal?: AbortSignal } = {}): Promise<void> {
  await client.delete({
    url: '/api/users/me',
    body: opts.appleAuthorizationCode ? { apple_authorization_code: opts.appleAuthorizationCode } : {},
    headers: { 'Content-Type': 'application/json' },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}
