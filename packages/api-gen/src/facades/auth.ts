import { z } from 'zod';

import { client } from '../client/client.gen';
import { getCurrentUserApiUsersMeGet, sendLoginCodeApiUsersAuthSendCodePost, verifyLoginCodeApiUsersAuthVerifyCodePost } from '../client';
import { parseResponse } from '../overrides/parse';

/** A signed-in gen session: what every sign-in method returns. */
export type GenSession = { token: string; email: string; credits: number; creditsGranted: number };

const VerifySchema = z.object({
  session_token: z.string(),
  user: z.object({ email: z.string(), credits: z.number() }),
  credits_granted: z.number().nullish(),
});

const toSession = (r: z.output<typeof VerifySchema>): GenSession => ({
  token: r.session_token,
  email: r.user.email,
  credits: r.user.credits,
  creditsGranted: r.credits_granted ?? 0,
});

/** Email a 6-digit sign-in code (gen answers 202 even for throttled/blocked addresses). */
export async function sendCode(email: string, locale: string): Promise<void> {
  await sendLoginCodeApiUsersAuthSendCodePost({ body: { email, locale } });
}

export async function verifyCode(email: string, code: string): Promise<GenSession> {
  const { data } = await verifyLoginCodeApiUsersAuthVerifyCodePost({ body: { email, code } });
  return toSession(data);
}

async function exchangeIdToken(provider: 'google' | 'apple', idToken: string, locale: string): Promise<GenSession> {
  const { data } = await client.post({ url: `/api/users/auth/${provider}`, body: { id_token: idToken, locale } });
  return toSession(parseResponse(VerifySchema, data));
}

// Untyped until openapi/gen.json is refreshed after gen v0.278.0 ships.
export const exchangeGoogleToken = (idToken: string, locale: string) => exchangeIdToken('google', idToken, locale);

// Untyped until openapi/gen.json is refreshed after gen v0.278.0 ships.
export const exchangeAppleToken = (idToken: string, locale: string) => exchangeIdToken('apple', idToken, locale);

export async function getMe(): Promise<{ email: string; credits: number }> {
  const { data } = await getCurrentUserApiUsersMeGet();
  return { email: data.user.email, credits: data.user.credits };
}

const HandoffSchema = z.object({ url: z.string(), expires_in_seconds: z.number() });

// Untyped until openapi/gen.json is refreshed after gen v0.278.0 ships.
/** Single-use, 2-minute signed-in web link to the job's lyrics review. */
export async function createHandoffUrl(jobId: string, locale: string): Promise<string> {
  const { data } = await client.post({
    url: '/api/users/auth/handoff-token',
    body: { target: 'job_review', job_id: jobId, locale },
  });
  return parseResponse(HandoffSchema, data).url;
}
