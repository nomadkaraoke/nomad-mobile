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

const SOCIAL_SIGN_IN = { google: googleSignInApiUsersAuthGooglePost, apple: appleSignInApiUsersAuthApplePost };

// Social sign-in responses are still zod-checked: a malformed body surfaces as ApiError invalid_response.
async function exchangeIdToken(provider: keyof typeof SOCIAL_SIGN_IN, idToken: string, locale: string): Promise<GenSession> {
  const { data } = await SOCIAL_SIGN_IN[provider]({ body: { id_token: idToken, locale } });
  return toSession(parseResponse(VerifySchema, data));
}

export const exchangeGoogleToken = (idToken: string, locale: string) => exchangeIdToken('google', idToken, locale);

export const exchangeAppleToken = (idToken: string, locale: string) => exchangeIdToken('apple', idToken, locale);

// gen's top-level `app_user_id` (opaque UUID4) is newer than the generated snapshot: read it leniently, so an
// older backend (or a malformed value) just reads as absent instead of failing the session check.
const AppUserIdSchema = z.object({ app_user_id: z.string().min(1).nullish().catch(undefined) });

/** gen v0.284.0's per-type push switches (all default on). Absent on an older backend or when malformed. */
export type PushPrefs = { ready: boolean; review: boolean; problems: boolean };
const PushPrefsSchema = z.object({
  push_prefs: z
    .object({ ready: z.boolean(), review: z.boolean(), problems: z.boolean() })
    .nullish()
    .catch(undefined),
});

/** gen's top-level `capabilities` (v0.284.0): features this backend has switched on for the user. */
export type Capabilities = { accountDeletion: boolean };
const CapabilitiesSchema = z.object({
  capabilities: z
    .object({ account_deletion: z.boolean().nullish().catch(undefined) })
    .nullish()
    .catch(undefined),
});

/**
 * `credits` is gen's raw balance, which a store refund can take below 0 (display it with `Math.max(0, …)`).
 * `referralDiscountPercent` is set only while the user has an active referral discount (it applies on the web).
 */
export type Me = {
  email: string;
  credits: number;
  appUserId?: string;
  referralDiscountPercent?: number;
  pushPrefs?: PushPrefs;
  /** Absent on an older backend (treat every capability as off). */
  capabilities?: Capabilities;
};

export async function getMe(): Promise<Me> {
  const { data } = await getCurrentUserApiUsersMeGet();
  const appUserId = AppUserIdSchema.safeParse(data).data?.app_user_id ?? undefined;
  const pushPrefs = PushPrefsSchema.safeParse(data).data?.push_prefs ?? undefined;
  const caps = CapabilitiesSchema.safeParse(data).data?.capabilities ?? undefined;
  const { has_active_referral_discount: hasDiscount, referral_discount_percent: percent } = data.user;
  const referralDiscountPercent = hasDiscount && typeof percent === 'number' && percent > 0 ? percent : undefined;
  return {
    email: data.user.email,
    credits: data.user.credits,
    ...(appUserId ? { appUserId } : {}),
    ...(pushPrefs ? { pushPrefs } : {}),
    ...(caps ? { capabilities: { accountDeletion: caps.account_deletion === true } } : {}),
    ...(referralDiscountPercent ? { referralDiscountPercent } : {}),
  };
}

const HandoffSchema = z.object({ url: z.string(), expires_in_seconds: z.number() });

/** Single-use, 2-minute signed-in web link to the job's lyrics review. */
export async function createHandoffUrl(jobId: string, locale: string): Promise<string> {
  const { data } = await createHandoffTokenApiUsersAuthHandoffTokenPost({
    body: { target: 'job_review', job_id: jobId, locale },
  });
  return parseResponse(HandoffSchema, data).url;
}
