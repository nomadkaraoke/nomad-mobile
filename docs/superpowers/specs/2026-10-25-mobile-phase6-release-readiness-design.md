# Mobile Phase 6: release readiness (design)

Delivers VISION.md roadmap **Phase 6 "Release readiness"** (backlog 4.6). Brainstormed with Andrew 2026-10-24/25.

## 1. Intent

Get the app to the point where it *could* be published: payments in the stores, push notifications, account deletion, crash reporting and analytics, real signing, store listings and test tracks. **Nothing is published.** Publishing waits until every phase is built and Andrew has done his own full manual pass (VISION release bar; memory `project_nomad_mobile_app` testing plan). Phase 6 builds everything up to that point, so that publishing afterwards is "press submit".

Why it matters (VISION "Why an app"): store visibility brings new customers, and in-app purchase is how the Make use case turns them into paying gen customers. Store rules also require deletion, privacy disclosures and a reviewable demo account.

**Anti-goals:** submitting a build for public release; any account or spend Andrew hasn't approved below; breaking the web (gen web, sing.nomadkaraoke.com) or live kjbox nights; storing new PII where an opaque id does.

## 2. Andrew's decisions (2026-10-25)

| Topic | Decision |
|---|---|
| Account owner | All new accounts owned by the company admin mailbox (Google SSO where offered; private workspace `docs/MOBILE-RELEASE-ACCOUNTS.md`). Agent drives sign-ups in Andrew's signed-in browser (playwright-chrome-3) and stops for anything needing him (card, identity checks, 2FA, D-U-N-S). |
| Expo / EAS | **Free plan.** Cloud builds are capped and low priority; local builds (`eas build --local`, Xcode, Gradle) are the fallback. |
| Google Play | **Organization** account for **Nomad Karaoke LLC** ($25 one-off), which needs a D-U-N-S number (free). Avoids the 12-tester / 14-day closed-test gate for personal accounts. |
| Apple | **Convert the Individual account (team 55B76HN73D) to Nomad Karaoke LLC** (same D-U-N-S). Work continues on the current team while Apple processes it. Create the App Store Connect app record and enrol in the **Small Business Program** (15%). |
| Sentry, PostHog | Both, **free tiers**. |
| In-app purchase | **RevenueCat free tier.** |
| IAP prices | **Same as the web, absorb the store cut:** 1 / 3 / 5 / 10 credits at $9.99 / $23.99 / $34.99 / $59.99 (web: $10 / $24 / $35 / $60). |
| Account deletion | **Unused credits are forfeited** (the confirm screen says how many). Personal details anonymised, sessions revoked, all decide / kjbox / voice data deleted, job and payment records kept for accounting, **published YouTube videos stay**. |
| Push types | **Video ready, needs review, job failed / needs attention** (gen), and **"you're up next"** and **"your turn"** at Nomad nights (kjbox). Each can be turned off. |
| Referrals | **A referrer earns on IAP purchases, at their percentage of what we actually receive** (net of the store's cut). A referred user with an active discount sees a note in the app saying the discount applies on the web (in the US, together with the web link). |
| Deletion: files | **Delete personal data and inputs only; never published output files** (Andrew, 2026-10-25: "don't delete published output files ever for user account deletion - just personal data / inputs"). Deleted: uploaded source audio and other user inputs, and names and emails inside job data; the customer's Dropbox share link is revoked. Kept: every output (stems, renders, MP4s, the Dropbox catalog folder, YouTube) and the anonymised job and payment records. |
| Apple Paid Apps agreement | **Wait for the LLC conversion.** Payouts go to the LLC from day one. Real sandbox purchases (a manual-pass item) wait for D-U-N-S plus the conversion. Phase 6's code is finished on the fake IAP and Maestro. |
| Android US web link | **Research first, then decide.** During the build, check Google's current US external-payment terms and fees and bring Andrew the numbers. Until he decides, the web link is per platform and off on Android. |

## 3. Accounts and external setup

Order matters because of dependencies. Every step and every id/key produced is recorded in a new `docs/RELEASE.md` (nomad-mobile), the single runbook for builds, credentials and store state. Secrets never go in git.

1. **D-U-N-S for Nomad Karaoke LLC.** Check whether one exists (Apple's D-U-N-S lookup tool); if not, request it (Andrew submits; takes days). Blocks the Play organization account and the Apple conversion, not the rest.
2. **Expo account** (organization `nomadkaraoke`), `eas init` → EAS project id in `app.config.ts`. Unblocks push, EAS Update, EAS credentials.
3. **Sentry** (org `nomad-karaoke`, project `mobile`, React Native) and **PostHog** (US cloud, project "Nomad Karaoke app").
4. **RevenueCat** project "Nomad Karaoke" with an App Store app and a Play app.
5. **App Store Connect** app record for `com.nomadkaraoke.mobile`; Small Business Program enrolment; **Paid Apps agreement + banking + tax** (Andrew: needs his details, and **waits for the LLC conversion**, so payouts go to the LLC); APNs key (EAS can create it); a Sign in with Apple key (§6.4); in-app purchase products (§4.2); TestFlight internal group with Andrew.
6. **Google Play Console** organization account (Andrew pays $25 and verifies identity) → app, Play App Signing, payments profile (merchant), in-app products, internal testing track with Andrew.
7. **Firebase project** for FCM (Expo push on Android needs FCM v1 credentials uploaded to EAS). It lives in GCP project `nomadkaraoke`, where the agent is read-only, so Andrew creates it (or runs the agent's `scripts/gcp-admin` commands after typing `/gcp-admin`).
8. **Secrets** that gen needs go in Secret Manager, which also needs Andrew (agent ADC is read-only): `revenuecat-webhook-auth`, `revenuecat-secret-api-key`, `apple-siwa-key` (+ key id), `app-review-demo-code`. EAS secrets (`SENTRY_AUTH_TOKEN`) and GitHub secrets the agent can set itself.

Whatever is blocked on Andrew (D-U-N-S, Play fee, Apple conversion, banking/tax, GCP writes) doesn't block the code: every backend and app piece is built and tested against the local stacks with fakes, and switches on when its credential exists.

## 4. Payments

### 4.1 Model
- RevenueCat `app_user_id` = a new opaque **`app_user_id`** on the gen user (UUID4, minted on first `GET /api/users/me` that lacks it, returned in `/me`). Not the email: RevenueCat and its dashboards then hold no PII, and deletion only needs to forget the mapping. (Phase 0 §4.4 said "the gen user id"; gen's document id is the email, so this replaces it. Builder's note: Sentry's user id uses the same value, §7.)
- Products are **consumables**, one per web package: `nomad_credits_1`, `nomad_credits_3`, `nomad_credits_5`, `nomad_credits_10` (same ids on both stores), priced at the store tier for $9.99 / $23.99 / $34.99 / $59.99 in the US, with the stores' automatic equivalents elsewhere.
- **Server-driven mapping:** gen's credit packages response gains a `store_product_id` per package, plus a top-level `web_link` block `{show_for: {ios: ["USA"], android: []}, copy_key}`. That lets the US web link's copy and its per-platform rollout change without an app release (Phase 0 §4.4). Android starts empty, pending the Google research (§2). There's no "save X%" claim while the prices match.
- **Referrals:** for a referred user, the webhook calls `referral_service.record_earning` with the **net** amount, the price after the store's commission (the store's proceeds where RevenueCat reports them, else price × 0.85). The key is the store transaction id rather than a Stripe session. `record_earning` gains a source-neutral key; the builder checks the Stripe Connect payout path accepts it. When `/me` shows an active referral discount, the credits screen shows "Your N% referral discount applies when you buy on the web", plus the web link where `web_link` allows it.

### 4.2 App
- `react-native-purchases` (RevenueCat SDK; `npx expo install`), configured after sign-in with `Purchases.logIn(app_user_id)` and `logOut` on sign-out / deletion. API keys are public SDK keys (`EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `…_ANDROID_KEY`); unset = IAP off and the credits screen keeps today's web checkout (so dev builds and the local stack keep working).
- Credits screen (`src/app/credits.tsx`): packages from gen as today, with the price shown from the store product (localised currency, replacing the hard-coded `'USD'`). Buy = `Purchases.purchaseStoreProduct`; then poll `/me` for the new balance as `useCheckout` does today (the webhook is the source of truth, not the client). Restore isn't needed for consumables; a "Missing credits? Contact support" link covers edge cases.
- **US web link:** when `Purchases.getStorefront()` country is in `show_for_storefronts`, show a secondary "Buy on the web" button that runs today's `useCheckout` (Stripe via `openAuthSessionAsync`). Elsewhere the web checkout is not offered in the app.
- **Local stack / E2E:** `EXPO_PUBLIC_FAKE_IAP=1` (honoured only against a local gen host, like `FAKE_SOCIAL_SIGNIN`) swaps in a fake purchases adapter that calls gen's test API to post a signed fake RevenueCat webhook. All purchase code goes through one adapter interface so the fake is a drop-in.

### 4.3 gen webhook
- `POST /api/users/webhooks/revenuecat`, authenticated by the shared `Authorization` header (Secret Manager `revenuecat-webhook-auth`, compared with `hmac.compare_digest`).
- Events: `NON_RENEWING_PURCHASE` → grant the package's credits to the user whose `app_user_id` matches; `REFUND` (and `CANCELLATION` with a refund reason) → debit the same amount. Others → 200 and log at INFO. Unknown `app_user_id` (e.g. a deleted account) → 200, WARNING, no grant, recorded for support.
- **Idempotency:** `processed_revenuecat_transactions/{store}:{transaction_id}` created inside the same Firestore transaction that writes the credit change and the `credit_transactions` entry (the `KjboxPartnerService.grant_show_credit` pattern, not the Stripe path's non-transactional read-modify-write). A replayed event is a no-op 200. A refund keys on `{store}:{transaction_id}:refund`.
- A debit may take the balance negative; the app shows 0 and a negative balance blocks making until topped up. (Builder's call on display; never silently drop a refund.)
- Records: `credit_transactions.reason = "iap_purchase" | "iap_refund"`, plus a `store_payments` doc (store, product, price, currency, country, transaction id) for accounting, beside `stripe_payments`. Admin dashboard revenue views include it where they already sum `stripe_payments` (builder: find those).
- Tests: unit tests for every branch (auth fail, grant, replay, refund, refund replay, unknown user, unknown product), plus an emulator test for the transaction.

## 5. Push notifications

### 5.1 Tokens
- App: `expo-notifications` `getExpoPushTokenAsync({projectId})` after sign-in once notification permission is granted. Permission is asked **in context**, not at launch: after starting a make ("Get a notification when your video is ready?") and after joining a Nomad night. Android creates the channels first (gotcha in CLAUDE.md).
- gen: `POST /api/push/expo-token {token, platform, device_id}` and `DELETE /api/push/expo-token {token}` (auth required), storing `gen_users.expo_push_tokens[] {token, platform, device_id, created_at, last_used_at}`; one entry per device_id (replace on change). Tests for both.
- kjbox: the app registers the same token with the box's existing `POST /push-token` when it joins a night (survey: kjbox already stores app subscriptions and sends via Expo). Add `DELETE /push-token` to kjbox for opting out and sign-out.

### 5.2 Sending
- gen: `JobManager._trigger_state_notifications` already fans out to Web Push. Add an Expo sender beside it (batch up to 100 per request to `https://exp.host/--/api/v2/push/send`, drop tokens on `DeviceNotRegistered`, receipts not polled in v1). Types:
  - **ready**: `COMPLETE` → "Your karaoke video is ready", url `/job/<id>`.
  - **review**: `AWAITING_REVIEW`, `AWAITING_INSTRUMENTAL_SELECTION`, `AWAITING_AUDIO_EDIT`, `AWAITING_DURATION_CONFIRM` → "<title> needs your review", url to the matching app screen.
  - **failed / needs attention** (new trigger, also sent to Web Push): `FAILED`, and the stalled-download "Keep trying" state → url `/job/<id>`.
- kjbox: app subscriptions get only `up_next` ("You're up next") and `now_singing` ("It's your turn") in v1; web subscriptions keep every step as today. url `/tonight`.
- Payload `data.url` routes taps through the **existing** `useReminderTapRouting` (one tap-routing hook app-wide, as agreed with 3d). Add `setNotificationHandler` so a push that arrives with the app open shows as a banner, except a Tonight push while the Tonight tab is focused (the screen already shows the status tile).
- **Enhanced push security** (Expo access token) stays off in v1, since kjbox sends without a token today. Follow-up: turn it on with tokens in gen and on the box.

### 5.3 Preferences
- Me → **Notifications** screen: toggles for Video ready, Needs review, Job problems, Nomad night alerts. gen types are stored on the user (`push_prefs`), set with `PATCH /api/users/me/push-prefs`, and checked before sending Expo **and** Web Push for that type (one preference per type across devices). Nomad night alerts: off = the app doesn't register (or unregisters) its token with the box.
- If OS permission is denied, the screen says so and links to Settings.

### 5.4 Native config
- Remove `withoutPushEntitlement` for team-signed builds; keep stripping `aps-environment` when `EXPO_PUBLIC_PUSH=0` (unsigned simulator/E2E builds). `appConfig.test.ts` guards both.
- Local stack: gen and kjbox send Expo pushes to a **fake sink** when fake workers are on (gen `/api/test/push-outbox`, kjbox `/sing/api/test/push-outbox`), so Maestro flows assert what was sent without real devices.

## 6. Account deletion

Required by App Review 5.1.1(v) and Google Play's account deletion policy (which also needs a **web** way to request deletion).

### 6.1 Flow
- App: Me → Account → **Delete account**. One screen: what gets deleted, what is kept (job and payment records for accounting; published YouTube videos), "**N credits will be lost**" when N > 0, and a confirm button (testID'd). On iOS, an Apple-linked account re-runs Sign in with Apple first (§6.4).
- Web: gen web `/account/delete` (signed in; same copy and confirm), linked from the store listings and the privacy policy. Gen web's existing account page links to it.
- `DELETE /api/users/me` (auth required). Steps run in this order, and **any failure returns 503 so the client retries** (the 3d contract); each step is idempotent:
  1. **decide** (§6.2), synchronously.
  2. **RevenueCat**: delete the subscriber for `app_user_id` (REST API, secret key). Skipped when no key is configured.
  3. **Apple**: revoke the Sign in with Apple token if one was supplied (§6.4).
  4. **kjbox**: enqueue (§6.3). Doesn't block.
  5. **gen inputs and personal data**: for each of the user's jobs, delete the user's **inputs** in GCS (`uploads/` objects and `jobs/{id}/input/**`) and the personal fields inside job documents (names, emails and notification addresses in `state_data`; `user_email` becomes `deleted:{uuid}`), and revoke the customer's Dropbox share link. **Output files are never deleted** (stems, renders, MP4s, the Dropbox catalog folder, YouTube). Log a per-job count. A failure here returns 503.
  6. **gen records**: revoke all sessions, delete magic links, Web Push subscriptions, Expo tokens and the user's own `kjbox_signups` / login codes. Move the user to `deleted_users/{uuid}`, keeping `credit_transactions`, totals, `created_at` and `deleted_at` but **no email or name**. Store only `sha256(email)` there, so a re-signup with the same email doesn't get a second welcome credit. Then delete the `gen_users` doc. Jobs keep their records, but `user_email` is replaced by `deleted:{uuid}`. `stripe_payments` and `store_payments` are kept for accounting.
  7. Return 200 with a summary (counts per store) for logs.
- **Refusals and preconditions** (my call): before step 1, gen checks for accounts that carry money or work. It refuses with 409 and a reason code, and the app and web show "Contact support to close this account" plus the support email, for:
  - an admin;
  - an account with unpaid referral earnings or a Stripe Connect account;
  - an account with KJ partner show credits (`kjbox_show_credits`, `kjbox_show_credit_users`, which are partner accounting records and are never deleted by self-serve);
  - an account with a made-for-you or Fiverr order in progress.

  The user's own jobs that are still running or waiting for review are **cancelled** as part of deletion, and the confirm screen says so ("2 videos in progress will be cancelled").
- **Rollout flag** (my call): `ACCOUNT_DELETION_ENABLED` gates the endpoint, the app's menu item (from `/me` capabilities) and gen web's page. It's on in the local stack and **off in prod until Andrew's manual pass**, then turned on before submission. Push preferences ship live, since they only reduce what gets sent.
- App, on 200: the local wipe runs every sign-out cleanup (Discover, import queue, Tonight log, outbox, night store) plus `recordingQueue.clearAll()` (via 3d's local part of `deleteMyRecordings()`), unregisters push, calls `Purchases.logOut()` and `posthog.reset()`, clears all MMKV, and lands signed out with a "Your account was deleted" notice.

### 6.2 decide
- One function, `delete_all_user_data(user)`, lives in one module (path settled in the plan and sent to Phase 4 and 3d). It iterates a **registry** `USER_DATA_STORES`, and every per-user collection must be listed there. A test fails if a collection in `backend/` isn't in the registry or an explicit "not user data" allowlist. That guard is what keeps future phases honest.
- Covers (survey 2026-10-25): `decide_users`, `user_songs`, `user_artists`, `user_hidden_songs`, `user_imports`, `user_import_artists`, `user_karaoke_unresolved`, `karaoke_log`, `music_services`, `lastfm_users`, `quiz_progress`, `screenshot_imports`, `spotify_playlist_imports`, `youtube_music_imports`, `playlists` (Phase 4's, plus any new ones Phase 4 adds), sessions and magic links that belong to the user, any import payloads in GCS, and the 3d contract in full: `VoiceRecordingService.delete_all_for_user`, `voice_sessions`, `voice_attempts`, `voice_labels`, `voice_recording_purges/{user_id}`, plus the `user_songs` source stripping.
- Partner endpoint: `DELETE /api/partner/gen/users` with body `{email}`, authenticated by `X-Partner-Secret` = the existing `DECIDE_GEN_PARTNER_SECRET` (today decide sends it to gen, and now gen sends it to decide too). It resolves the decide user(s) for that gen identity and is idempotent.
- Tests: every registry entry is seeded and gone after the call, the 3d template behaviour holds, auth fails without the secret, and a second call is a no-op.

### 6.3 kjbox
- The box is a home PC that can be offline, so it **pulls**. gen keeps `account_deletions/{id} {email_hash, created_at, targets: {kjbox: pending|done}}`. The box polls `GET /api/kjbox/account-deletions?since=` with `X-Kjbox-Secret` (it already calls gen with that secret) every 10 minutes and on start. For each entry it deletes `singer_accounts`, `sing_gen_accounts`, the push subscriptions for those devices, and the phone numbers, aliases, friend requests and consent rows for those devices. It drops pending outbox rows, then acks with `POST /api/kjbox/account-deletions/{id}/ack`.
- Matching uses the email hash: the box hashes the `gen_email` values it stores, so gen never sends the email. The append-only `photo_consent_events` log keeps its rows but has the device link removed (builder's call if it's a legal record). Past rotation history for a night (title, name as called) stays, since it's the night's record and isn't tied to the account once the links are gone.
- Tests on both sides. The box picks up the code through auto-deploy; the live box is not reconfigured.

### 6.4 Sign in with Apple revocation
Apple requires apps that offer Sign in with Apple to revoke the user's tokens when the account is deleted. On iOS, the delete flow asks the user to confirm with Apple, which gives a fresh `authorizationCode`. gen exchanges it with Apple (client secret signed with the SIWA key, from Secret Manager `apple-siwa-key`) and calls `/auth/revoke`. gen stores no Apple refresh tokens. The web delete page and Android can't produce a code, so for those gen deletes without revoking and logs a WARNING. Andrew is told this in the review notes.

## 7. Sentry and PostHog

- **Sentry:** `@sentry/react-native` Expo config plugin (org/project), `Sentry.wrap` on the root layout, release = app version + build number, environment = EAS channel. Source maps and dSYMs are uploaded by EAS builds (`SENTRY_AUTH_TOKEN` EAS secret) and by the local release build scripts. The user context is `app_user_id` only, with no email; `sendDefaultPii: false`. Errors only: no session replay, and performance tracing at a low sample rate (0.1). The DSN is public (`EXPO_PUBLIC_SENTRY_DSN`).
- **PostHog:** **anonymous** product analytics. No `identify` and no email, so there's nothing to delete server-side; `reset()` runs on sign-out and on deletion. A short fixed event list in `observability.ts` (`app_opened`, `signed_in`, `make_started`, `purchase_started`, `purchase_completed`, `review_submitted`, `night_joined`, `song_requested`, `recs_viewed`, `voice_test_completed`), with no free text and no song titles. Session replay and autocapture are off. (My call, to keep the privacy labels simple: "Usage data, not linked to identity".)
- Both stay inert when their env var is unset, as now.

## 8. Builds, signing and updates

- **EAS project + profiles:** keep `development`, `e2e-test`, `preview` (internal distribution, prod backends), `production` (store). Each profile sets its env: prod URLs, `EXPO_PUBLIC_ASSOCIATED_DOMAINS=1` and push on for preview/production, and the RevenueCat/Sentry/PostHog keys. The dormant `.eas/workflows` stay dormant (Maestro there needs a paid plan). Store builds are run manually in v1 (`eas build`, falling back to `--local`), and `docs/RELEASE.md` has the commands.
- **Android signing:** EAS-managed **upload key**, with **Play App Signing** holding the app signing key. Two certificates matter:
  - The **Play app signing key** signs Play-installed builds.
  - The **upload key** signs sideloaded APKs from local release builds. The keystore comes from `eas credentials` and is kept outside git, with its location in `docs/RELEASE.md`.
- Each certificate's fingerprints go into the following places. Debug-key entries stay for dev builds.
  - **Google OAuth.** Android OAuth clients take one SHA-1 each, so add one Android client per key in GCP `nomadkaraoke`. Andrew does this, or the agent does it via his signed-in console. The app picks no client id on Android; Google matches on package plus SHA-1.
  - **assetlinks.** Add the SHA-256 to the kjbox box config `app_android_sha256_fingerprints`. That's a hand-edit on NomadPC: ask first, back it up, restart outside a live night. Also add it to the kjbox.cc Worker's fingerprints (gen `infrastructure/cloudflare/well_known.py`, Pulumi `nomad-cloudflare`, a targeted `pulumi up` from main with a preview showing zero deletions).
- **Strip READ_MEDIA_\*:** add `blockedPermissions` for `READ_MEDIA_VIDEO`, `READ_MEDIA_IMAGES`, `READ_MEDIA_AUDIO` and `READ_EXTERNAL_STORAGE`. Saving the MP4 to the gallery still works through MediaStore without them; verify on the emulator. `appConfig.test.ts` guards it, and the check runs against `npx expo prebuild --clean -p android` output (introspect reads the old manifest).
- **iOS associated domains:** on for preview and production (`EXPO_PUBLIC_ASSOCIATED_DOMAINS=1`). Verify on Andrew's iPad with a team-signed Release build: opening `https://kjbox.cc/2121` and `https://sing.nomadkaraoke.com/?t=2121` should open the app. Use the iPad lock `mkdir /tmp/nomad-ipad.lock` with an owner file. AASA is already served by the box. Check the kjbox.cc Worker serves it too, since the survey wasn't sure the 302 rule excludes `/.well-known`.
- **EAS Update:** add `expo-updates`, with `runtimeVersion: {policy: "fingerprint"}`, `updates.url` from the EAS project, and channels per profile. Changing language to or from RTL now calls `Updates.reloadAsync()`, which closes the "RTL applies on next launch" gap. Dev builds and the local stack keep working with updates disabled. OTA policy: JS-only fixes go to the `preview` channel first; production gets updates only after Andrew's go-ahead per update.

## 9. Store readiness (prepared, not submitted)

Everything lives in `docs/store/` (nomad-mobile), reviewed by Andrew in his manual pass:

- **Listings:** app name "Nomad Karaoke", subtitle / short description, full description, keywords, category (Music), support URL, marketing URL (nomadkaraoke.com), privacy policy URL, and the account deletion URL (gen web `/account/delete`). English first. Translations to the other 32 locales use the i18n pipeline once Andrew approves the English copy (follow-up item, not blocking).
- **Done for Phase 6:** everything above built, tested (unit, emulator, Maestro on both platforms) and merged. Accounts are created as far as Andrew's steps allow. Builds are on TestFlight and the Play internal track where the accounts exist. Real sandbox purchases, and anything else blocked on D-U-N-S or the LLC conversion, go on Andrew's manual-pass list and don't block closing the phase.
- **Privacy policy:** check whether nomadkaraoke.com's policy covers the app's data (recordings, listening data, location, analytics, crash data). If it doesn't, draft additions for Andrew and the public-website repo.
- **Privacy labels (Apple) and data safety (Google):** a data inventory table (data type, purpose, linked to identity?, optional?, deletion) for:
  - Email and name.
  - Purchases.
  - Listening history and imported music data.
  - Voice recordings (3d) and pitch data.
  - Karaoke log, survey answers and notes.
  - Phone number (Nomad night texts).
  - Photos and screenshots (screenshot import is processed and not kept; builder confirms).
  - **Location:** the survey found no location use; the builder confirms (expo-localization region isn't location).
  - Crash data (Sentry, linked to the opaque id).
  - Usage data (PostHog, not linked).

  No tracking, so no ATT prompt.
- **Age rating questionnaires:** free-text notes and names exist but aren't shared publicly; the builder fills them in and records the answers.
- **Screenshots:** Maestro `--screen` tours on store device sizes (iPhone 6.9", iPad 13", Android phone), against a seeded local stack with fixture songs, in English. Framing and captions are left to the builder.
- **App Review demo account:** gen accepts a fixed code for one configured review email (`APP_REVIEW_DEMO_EMAIL`, code from Secret Manager `app-review-demo-code`), scoped to verify-code only, with a rate limit and a log line on every use. It is **inert until both values are set**, which Andrew does at submission, so no sign-in bypass exists in prod before then. The account holds credits for test makes. The review notes cover sign-in, where to buy credits (sandbox), that Nomad night features need a live event (with a screen recording to attach), and the account deletion path.
- **Test tracks:** TestFlight internal testing (Andrew) and Play **internal testing** (Andrew), each with a production-profile build uploaded with `eas submit`. Nothing goes to external testing, production or review.
- **Store fees:** confirm per platform and region (VISION use case 2). Apple SBP 15%, Google 15% on the first $1M/yr, and the US external-link rules as they stand. Record them in `docs/RELEASE.md`.

## 10. Repos, coordination, merge order

- **Worktrees:** nomad-mobile (this branch), karaoke-gen, karaoke-decide, kjbox. One PR per repo per coherent slice. Backend PRs merge before the app PR that needs them, and the app keeps working against older backends (new calls fail soft).
- **Shared files:** before editing any of these, message the active sessions (Phase 4 `nomadkaraoke-36`; 3d `nomadkaraoke-72` while it's active): `app.config.ts`/`app.json`, `_layout`, `(tabs)/me`, `AppProviders`, `packages/i18n` messages, `package.json`/lock, CI, and decide/gen models. Milestones go to the orchestrator `nomadkaraoke-12`: spec approved, each PR opened and merged.
- **Pulumi:** run only from main, targeted. gen has a known `divebar_mirror` drift (BACKLOG inbox), so never run an untargeted gen `pulumi up`.
- **Tests:** every new backend endpoint gets unit tests, plus emulator tests for the Firestore transactions and deletion. The app gets jest tests for the adapters, stores and screens, and Maestro flows on **iOS and Android**:
  - `purchase-1` (fake IAP, credits arrive)
  - `purchase-2` (US storefront shows the web link)
  - `account-1` (delete account: confirm copy with credits, signed out, can't sign back into the old data)
  - `notify-1` (settings toggles, and a gen push lands in the fake sink with the right `data.url`)
  - `notify-2` (Nomad night "up next" via the kjbox sink)
- **Reviews:** `/coderabbit` before each PR, and a final whole-branch review on the most capable model.

## 11. Andrew's manual-pass list (added to memory `project_nomad_mobile_app`)

Real sandbox purchase on iOS (TestFlight) and Android (internal track); US web link on a US storefront; real push on a device for each type (ready, review, failed, up next, your turn) and taps opening the right screen; delete a real test account (and Apple revocation on iOS); associated domains and App Links from a real QR scan on the release builds; Sentry receives a symbolicated test crash; PostHog shows events; store listing copy, screenshots and privacy answers; sign in on TestFlight and Play internal builds with Google and Apple (the new OAuth SHA-1 clients).

## 12. Left to the builder

Exact file layout, the purchase adapter shape, copy wording (en.json, translated), how negative balances display, which job state is "needs attention" beyond `FAILED`, the order of the plan's tasks, and the screenshot framing. Anything marked "my call" above was Claude's choice during the brainstorm, not Andrew's, and can change if it fights the code.

## 13. Future: alternate emails and account merge (not in Phase 6)

Andrew (BACKLOG PRODUCT, "Accounts: alternate emails + merge duplicate accounts") wants a future phase spec for merging two accounts (e.g. Google sign-in gave a different email from his primary). Phase 6 doesn't build it. The decide `USER_DATA_STORES` registry (§6.2) records how each store is keyed (`match` mode and field) precisely so that the same registry can later drive a re-key/merge as well as delete-all; the gen deletion service likewise lists every per-user gen store in one place.
