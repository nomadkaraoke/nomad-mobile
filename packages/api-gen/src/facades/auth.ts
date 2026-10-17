import { z } from 'zod';

import {
  appleSignInApiUsersAuthApplePost,
  createHandoffTokenApiUsersAuthHandoffTokenPost,
  getCurrentUserApiUsersMeGet,
  googleSignInApiUsersAuthGooglePost,
  sendLoginCodeApiUsersAuthSendCodePost,
  verifyLoginCodeApiUsersAuthVerifyCodePost,
} from '../client';
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

// Social sign-in responses are still zod-checked: a malformed body surfaces as ApiError invalid_response.
export async function exchangeGoogleToken(idToken: string, locale: string): Promise<GenSession> {
  const { data } = await googleSignInApiUsersAuthGooglePost({ body: { id_token: idToken, locale } });
  return toSession(parseResponse(VerifySchema, data));
}

export async function exchangeAppleToken(idToken: string, locale: string): Promise<GenSession> {
  const { data } = await appleSignInApiUsersAuthApplePost({ body: { id_token: idToken, locale } });
  return toSession(parseResponse(VerifySchema, data));
}

export async function getMe(): Promise<{ email: string; credits: number }> {
  const { data } = await getCurrentUserApiUsersMeGet();
  return { email: data.user.email, credits: data.user.credits };
}

const HandoffSchema = z.object({ url: z.string(), expires_in_seconds: z.number() });

/** Single-use, 2-minute signed-in web link to the job's lyrics review. */
export async function createHandoffUrl(jobId: string, locale: string): Promise<string> {
  const { data } = await createHandoffTokenApiUsersAuthHandoffTokenPost({
    body: { target: 'job_review', job_id: jobId, locale },
  });
  return parseResponse(HandoffSchema, data).url;
}
