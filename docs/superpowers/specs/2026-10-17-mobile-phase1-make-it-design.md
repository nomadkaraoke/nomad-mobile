# Nomad Karaoke mobile app: Phase 1 "Make it" design

*2026-10-17. This delivers **Phase 1, "Make it" (use case 2)** of [docs/VISION.md](../../VISION.md), which is backlog Frog 4.1. It stays inside that phase. The other use cases come in later phases. Read VISION.md first: it is the guiding document for every decision here.*

## 1. Intent

**The person:** someone at a karaoke night that plays videos from YouTube. They want to sing a song that has no karaoke version. They open the app, search for the song, tap **Make it**, sign in (the first point the app asks for an account), pay with credits if they're short, and watch the job progress. Then they get a finished video and a YouTube link to hand the KJ, all on the same night.

**Why it matters:** use case 2 should drive credit sales. VISION's release bar says the app isn't published until all four use cases work, so this phase is judged on Andrew's laptop (simulator and emulator, local stack and prod) and on his own Android phone (a prod-pointed APK sideloaded with `adb`). It is not judged on a store build.

**What success looks like:**
- On both the iOS simulator and the Android emulator, against the gen local stack, a new user can go from search to a finished video with a YouTube link with no dead ends.
- **The same build, pointed at production, works for real** (Andrew, 2026-10-17: "this should absolutely work against prod too"). That means real Google sign-in and real Stripe checkout returning to the app, and an Android APK Andrew can sideload and use at a real bar. The local stack is there to make testing faster and to allow more meaningful tests. It doesn't replace prod.
- Each failure case lands somewhere sensible and recoverable.
- Maestro flows prove the happy path and the failure cases.
- Every screen has passed a screenshot UX review.

**Andrew's priorities (in his words or close to them):**
- Sign-in should be as frictionless as possible: Google and Apple are "one tap", and nobody should have to switch to their email app unless they choose email.
- When gen isn't sure which audio to use, show the person the options the way the kjbox singer flow does, adapted for phones.
- KJs are unlikely to scan a QR code. Show the YouTube video's title, thumbnail and URL clearly, and make it easy to open in the YouTube app. Offer an MP4 download to the phone.
- Spend very little effort on the web review bridge. Phase 2, the next session, replaces it with native review.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Real sign-in replaces the Phase 0 mock: **Continue with Google**, **Continue with Apple** and **Continue with email** (a 6-digit code).
2. Navigation is Discover / Tonight / Make / Me. Discover (search → song page) and Make work fully.
3. Song → Make it → audio picked automatically (ranking ported from gen/kjbox) → confirm → job created.
4. Paying with credits goes through gen's web checkout link, opened in an in-app browser. That's gen's fake checkout on the local stack. In-app purchase is Phase 6.
5. A Make tab with job progress (polled), "needs you" actions (review via the web bridge, duration confirm), failures with a clear explanation, and a ready screen with the YouTube link and an MP4 download.
6. Gen backend work lands first as gen PRs, each with local-stack support so the app's tests can drive it (§6).
7. Tests: a component test for every screen, plus Maestro flows on iOS **and** Android against the local stack (§8). Then a screenshot UX review of every screen on both platforms.

**Non-goals (later phases, per VISION)**
- Native lyrics and instrumental review (Phase 2). Recommendations, music services, filters and vocal range (Phase 3). History, playlists and "get this made" (Phase 4). Nomad nights and the kjbox flow (Phase 5).
- In-app purchases and RevenueCat, push notifications, account deletion, Sentry and PostHog accounts, store builds (Phase 6).
- The other song-page actions (add to setlist, request tonight, mark as sung). Hidden in this phase.
- Google and Apple sign-in on the gen **web** frontend. These are backend endpoints for the app only. The web can adopt them later.

**Anti-goals: these would make Phase 1 a failure even if it technically works**
- Someone loses their place: after sign-in or checkout they land somewhere other than the song they were making.
- Money confusion: a cancelled checkout looks like a failure, a credit is charged twice, or a failed job doesn't say the credit came back.
- The app calls endpoints the web doesn't use, or invents its own version of a gen rule, when gen already has one. "Same endpoints as the web" is a VISION principle.
- Any long-lived session token in a URL.
- Any Apple, Google, EAS, RevenueCat, Sentry or PostHog account created, or money spent, without Andrew's go-ahead.
- Polishing the review bridge.

## 3. Constraints

- Everything in [CLAUDE.md](../../../CLAUDE.md): Expo SDK 57, typed Expo Router, TanStack Query, Zustand plus SecureStore, generated clients, no hardcoded strings (33 locales, `pnpm i18n:translate`), a `testID` on every interactive element, FlashList and Skia only through `@nomad/ui`, API clients never touch storage, and zod overrides for untyped gen endpoints.
- The VISION principles: all native except a temporary web bridge, one account (the gen user), singers only, the same endpoints as the web, and no accounts or spend without asking.
- **The app targets prod and the local stack from the same code.** `EXPO_PUBLIC_GEN_API_URL` / `EXPO_PUBLIC_GEN_WEB_URL` choose the backend: prod `https://api.nomadkaraoke.com` / `https://gen.nomadkaraoke.com`, or the local stack. Release builds default to prod.
- Tests run against gen's **local stack** (`karaoke-gen/scripts/local-stack.sh up`; API on :8010, `FAKE_WORKERS=1`; docs in karaoke-gen `docs/TESTING.md` § Local stack). The iOS simulator reaches it at `http://127.0.0.1:8010`. The Android emulator reaches it at `http://10.0.2.2:8010`, so set `LOCAL_STACK_API_URL` (and the web URL) to match before `up`. Decide search runs against live decide for now; a decide local stack is Phase 3.
- Repo workflow: worktrees and PRs for both repos, `/coderabbit` before `/pr`, and translations for every new `en.json` key.

## 4. The screens (agreed UX)

The mockup that was reviewed is at `.superpowers/brainstorm/*/content/make-flow-v1.html`. It's gitignored and kept only for reference. The tokens come from `@nomad/ui` (a dark theme with a pink `#ff7acc` primary).

### 4.1 Tabs
- **Discover:** the existing search screen moves here (`find` → `discover`).
- **Tonight:** a "coming soon" placeholder with one line about what it will do.
- **Make:** the user's jobs (§4.6).
- **Me:** credit balance, buy credits (the same credits screen as §4.5), language, signed-in email, sign out. Nothing else this phase.

The Phase 0 tabs (`find`, `videos`, `account`) are renamed or replaced.

### 4.2 Song page (from Discover)
- Shows the title, artist, year, duration and artwork, if decide has them.
- Badge: "No karaoke version found" when decide's `brand_count == 0`. Otherwise "Karaoke versions exist", and Make it is still offered.
- One primary button: **Make it · 1 credit**. No other song actions.
- The Phase 0 spec's "Can't find it? Make any song" row (free-text artist and title) stays at the bottom of search results. It leads to the same make flow.

### 4.3 Sign-in (the first time "Make it" is tapped)
- A **bottom sheet over the song page**, titled "Sign in to make *Starlight*". It explains: same account as nomadkaraoke.com, and a new user's first video is free (gen's welcome credit).
- Buttons, in order:
  1. **Continue with Google:** native one-tap.
     - Android uses the Credential Manager account sheet.
     - iOS uses the Google sign-in SDK.
  2. **Continue with Apple:** native on iOS only (`expo-apple-authentication`). Android hides it in Phase 1: Apple's Android flow needs a Services ID plus a server callback, and App Store rules only require Apple sign-in on iOS.
  3. **Continue with email:**
     - The email screen, then a code screen with 6 boxes. It supports paste and iOS/Android one-time-code autofill.
- After sign-in, the person goes **straight back into the make flow for that song** (§4.4). They never return to search.
- Code errors:
  - A wrong code shows "That code isn't right" with the number of tries left.
  - `too_many_attempts` (429), or `expired` after a lockout, shows "Too many tries. We've sent… / Send a new code" with a resend button. Resends are rate-limited.
  - `too_many_codes` (429 on send) shows "Too many codes requested, try again in a bit".
  - A disposable email (422) gets a clear message.
- Terms and Privacy links in the sheet footer. Existing gen web URLs are fine.

### 4.4 Audio pick → confirm
- Call `POST /api/audio-search/search-standalone {artist, title}`. It can take up to about 45s, so show an honest "Finding the best audio…" state.
- Rank the results with **gen's own ranking**, ported into `packages/core`. Port `getBestResult`, `getSearchConfidence` and the categories from `karaoke-gen/frontend/lib/audio-search-utils.ts`. kjbox's `static-sing/audio_rank.js` is a 1:1 port of it and so is a second reference. Keep the port's unit tests in step with gen's.
- **Tier 1 (perfect match) and tier 2 (recommended):** one card shows the pick with a plain-language reason ("Studio album · lossless"). A badge says "Perfect match" (green) or "Recommended" (pink). Below it:
  - a collapsed "See other sources (N)" link
  - a cost block: "Cost 1 credit · You have N"
  - **Make it**
- **Tier 3 (not sure):** no pick card. All sources are listed in plain-language groups (the same categories as kjbox and gen), tap to choose, then the same cost block and Make it. Below the list goes **"Paste a YouTube link instead"**, as in kjbox's fallback, which calls `POST /api/jobs/create-from-url` (`backend/api/routes/file_upload.py`). kjbox's port lives at `kjbox/kj-controller/static-sing/audio_rank.js`.
- **No results:** "We couldn't find audio for this song" plus the YouTube-link fallback.
- **Make it** calls `POST /api/jobs/create-from-search` with:
  - `search_session_id`
  - `selection_index`
  - `artist` and `title`
  - `review_mode: "auto"`
  - `is_private: false`, matching the web (public, so a YouTube link is produced)

  The confirm block mentions it: "Posted publicly on YouTube so you can share it". `create-from-search` has no `enable_youtube_upload` field: the server always applies `settings.default_enable_youtube_upload`, and the web only sends `is_private`.

  On success, go to the Make tab with the new job at the top.
- **402 at search or create** (out of credits): go to §4.5, then return here. Keep the search session if it's still valid, or search again. Note that `search-standalone` returns 402 *before* searching, so a user with 0 credits reaches checkout before seeing any audio. That's expected.

### 4.5 Credits (only when short, or from Me)
- The package list from `GET /api/users/credits/packages`: 1 credit $10, 3 credits $24 (badged "Popular"), 5 credits $35, 10 credits $60 (badged "$6 each"). Take labels and prices from the API; the badges are client-side.
- One line of explanation: "1 credit = 1 karaoke video. Works on the website too."
- **Continue to secure checkout** calls `POST /api/users/credits/checkout` with the new return URL (§6.1), then opens `checkout_url` in an **in-app browser**. On the local stack that's the fake checkout page with Pay and Cancel buttons.
- **Paid:** the browser closes on the return link. The app re-reads `/api/users/me`, waiting or re-polling briefly if the webhook credit hasn't landed yet, shows "Credits added", and takes the person straight back to §4.4 with Make it ready.
- **Cancelled, or the browser was dismissed:** back on the credits screen with a neutral "No payment made" message. No error styling.

### 4.6 Make tab
- A list of the user's jobs, newest first, from `GET /api/jobs?fields=summary`. While any job is unfinished it is polled through TanStack Query with the `packages/core` backoff (start at about 10s like the web, and stop when everything is finished or the app is in the background).
- **"Needs you" cards float to the top** with a gold "Needs you" badge:
  - **Review** (`awaiting_review` / `in_review`): "Check the lyrics before it's finished", with **Review lyrics** opening the web bridge (§4.8).
  - **Duration confirm** (`awaiting_duration_confirm`): **Confirm cost** opens a native sheet. It says "This track is 14:32 long, so it costs 2 credits in total (1 more)." The buttons are **Confirm** (`POST /api/jobs/{id}/confirm-duration` with `acknowledged_credits = credits_charged + pending_additional_credits`), with a 402 going to §4.5 and then back, and **Cancel this video** (`POST /api/jobs/{id}/cancel`). The confirm copy says the refund happens automatically.
  - Any other needs-user status (for example audio edit, which this flow never sets): "Finish this on the website" with a web-bridge link. No native handling.
- **In-progress card:** a progress bar, a rough time remaining if one can be derived (else omitted), and **five plain steps** mapped from gen statuses: Got the audio → Separated the vocals → Syncing lyrics → Making the video → Posting to YouTube. Keep the status-to-step mapping in `packages/core`, using the web's 10-step mapping in `frontend/lib/job-status.ts` as the reference. `download_pending_retry` and `render_pending_capacity` show as "Still working, this one's taking a little longer". Not an error.
- **Failed:** "Something went wrong making this one." Show gen's `error_message` in a collapsed details row.
  - Say the credit was refunded **only when the job has `credit_refunded`**. That field isn't in the summary projection today, so PR A adds it to `SUMMARY_FIELD_PATHS` (plus `_SUMMARY_STATE_DATA_KEYS` if needed). Alternatively, the card reads `GET /api/jobs/{id}`.
  - **Try again** calls `POST /api/jobs/{id}/retry`, the same as the web's Retry in `JobActions.tsx`. It resumes the same job from its checkpoint. Mirror the web's states for automatic retries and stalled downloads ("Keep trying").
- **Cancelled:** a muted "Cancelled" card.
- **Complete:** tap to go to §4.7.
- Empty state: "Nothing made yet". Explain in one line what Make does, with a button to Discover.
- The new-job transition (§4.4) and returning from the bridge or checkout both refetch at once instead of waiting for the next poll.

### 4.7 Ready screen
- **The YouTube block is the hero:**
  - the video thumbnail (from the YouTube video ID; the standard `img.youtube.com` thumbnail URL is fine)
  - a title: gen doesn't store the YouTube video's title, so build it from the brand code, artist and title as gen titles videos, or fetch it from YouTube oEmbed (builder's call)
  - the link, large and readable (`youtu.be/<id>`)
  - tapping the thumbnail or title opens the **YouTube app** (falling back to the browser)
- Buttons: **Copy link** and **Share** (the native share sheet).
- **Download MP4:** saves the 720p MP4 to the phone's Photos/Gallery. The download endpoints need the Bearer token, so download with the auth header (or use the signed 2-hour URLs `GET /api/jobs/{id}` returns for complete jobs; the builder picks) and save through the media library. Ask for permission at tap time. Show progress, and say "Saved to Photos" when done.
- **No YouTube link** (private, upload failed, or not yet uploaded): play the MP4 in the app (expo-video) instead of the YouTube block, and still offer Download.
- **No QR code.** Andrew: KJs are unlikely to scan one.

### 4.8 Review bridge (minimal; Phase 2 deletes it)
- **Review lyrics** calls `POST /api/users/auth/handoff-token` (§6.1), then opens the returned URL in the **in-app browser** (`expo-web-browser`, Safari View Controller or Chrome Custom Tab). The URL lands on the job's web review page, already signed in.
- When the browser is dismissed, refetch the job. No auto-close, no completion detection, no polish.

## 5. Sign-in mechanics

- **Email code:** gen's existing `POST /api/users/auth/send-code` and `verify-code` (merged in gen v0.275.0). The response is `VerifyMagicLinkResponse` (`session_token`, `user`, `credits_granted`, …). Lockout: 5 wrong tries each return 401 `invalid_code`; the 6th returns 429 `too_many_attempts` and destroys the code, and after that the response is `expired`.
- **Google and Apple:** the new gen endpoints in §6.2 return the **same** `VerifyMagicLinkResponse`. The app gets an ID token from the native SDK and exchanges it for a gen session.
- **Session:** the gen session token in SecureStore, as in Phase 0. `GET /api/users/me` on launch and on foreground. A 401 clears the session. Spec §4.1 of Phase 0 still applies.
- `EXPO_PUBLIC_AUTH_MOCK` and `mockAuthApi` are removed. Tests use the local stack instead.
- **Test switch for Google and Apple:** the native Google and Apple sheets can't be driven by Maestro. In builds pointed at the local stack, an env flag (for example `EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1`) makes the Google and Apple buttons skip the native SDK and send a fake ID token. The local stack accepts fake tokens in fake mode (§6.2). The builder designs the exact shape. It must be impossible to enable against a non-local API.

## 6. gen backend work (gen PRs, merged before the app depends on them)

### 6.1 Gen PR A: handoff, checkout return, fake YouTube link

1. **`POST /api/users/auth/handoff-token`** (authenticated with Bearer):
   - Body `{ path }`, where path is restricted to an allowlist. Phase 1 needs the job review page; the builder decides the allowlist format.
   - Returns `{ url }`: a gen web URL that signs the user in with a **single-use, short-lived** token (about 60s, per Phase 0 spec §4.3) and then lands on the path.
   - `build_review_login_url` tokens last 72 hours and aren't single-use, so the handoff gets its own short-lived, single-use purpose. Build on the existing purpose-token mechanism: `create_admin_login_token` with `purpose="job_review:<id>"`, and kjbox's `_mint_review_link` in `backend/api/routes/kjbox.py`. Check ownership of the job.
   - The web `/auth/verify` page currently asks for an extra "Complete Sign-In" tap (an email-scanner guard). Handoff links don't come from email, so they should skip it. One way is a distinct token purpose or a `handoff` parameter the page recognises. Long-lived tokens never go in URLs.
2. **Checkout return URL:**
   - `POST /api/users/credits/checkout` accepts optional `success_url` / `cancel_url`, which `stripe_service` already supports, so only the route forwards them.
   - **Live Stripe expects `https` return URLs**, so the app can't hand Stripe `nomadkaraoke://` directly. Add a tiny bounce endpoint: `GET /api/users/credits/app-return?status=success|cancelled` replies with a 302 to `nomadkaraoke://checkout?status=…`.
   - The checkout route accepts `return_to: "app"`. Gen then sets `success_url` / `cancel_url` to its own bounce URLs on `api.nomadkaraoke.com`, so there's no open-redirect surface. The fake checkout uses the same URLs.
   - The app opens checkout with `WebBrowser.openAuthSessionAsync(checkout_url, "nomadkaraoke://checkout")`, which closes when the bounce lands.
3. **Fake search shaping:** fake search returns at most 3 fixed results (a lossless torrent, Spotify, YouTube), and `search_result_count` only goes from 0 to 3. Add a fake-config knob that shapes results into tier 1, 2 or 3 (for example, mismatched titles and low seeders for tier 3), so the "not sure" flow can be tested.
4. **Summary field:** add `credit_refunded` to the job summary projection (§4.6).
5. **Fake worker sets a YouTube link:** in fake mode the video step sets `state_data.youtube_url` (a fixed, real-looking `https://youtu.be/<id>`) for public jobs, so the ready screen can be tested. Add a fake-config knob to turn it off, so the "no YouTube link" path can be tested too.
6. **Local-stack scenario:** extend `/api/test/scenario` (or the docs) so a test can get a handoff URL for an `awaiting_review` job and check it lands signed in.
7. Tests per gen conventions, and update gen `docs/TESTING.md` § Local stack plus `docs/API.md`.

### 6.2 Gen PR B: Google and Apple sign-in

1. **`POST /api/users/auth/google {id_token, locale?, device_fingerprint?, referral_code?}`:**
   - Verify the Google ID token's signature, issuer, expiry and audience. The audience is our OAuth client IDs, kept as config.
   - Require `email_verified`.
   - Find or create the gen user **by email**, exactly as `send-code` / `verify-code` do. That includes the welcome credit, attribution, disposable-email and signup-cap rules, and the tenant rules.
   - Return `VerifyMagicLinkResponse`.
2. **`POST /api/users/auth/apple {id_token, …}`:** the same steps against Apple's keys and audience.
   - Apple's "Hide My Email" gives a relay address, which becomes a separate gen account from the person's real email.
   - **Accept it.** The app shows a one-line note near the Apple button, or after sign-in, that relay addresses won't match a website account. The builder decides where it goes.
   - Apple sends the name only on the first sign-in; storing it is optional.
3. **Fake mode:** when `FAKE_WORKERS` is on, both endpoints also accept a fake token (for example `fake:<email>`) without calling Google or Apple. They are never enabled outside fake mode.
4. Tests, docs (`docs/API.md`), and the new config: client IDs and the Apple team, key and service IDs, stored as secrets or config following gen's conventions.

### 6.3 Console setup (Claude does it: gcloud admin plus Andrew's signed-in browser sessions; no spend)
- **Google:** create OAuth client IDs (iOS, Android, and a web or server client for the audience) in the nomadkaraoke Google Cloud project, under the Google Auth Platform. There's no API for this, so Claude does it in the console through Andrew's signed-in browser. The consent screen "Nomad Karaoke" already exists. The Android client needs the debug keystore's SHA-1 for local builds (and later the release key's).
- **Apple:** Andrew believes the KaraokeHunt-era paid developer account still exists. Check it's active before building Apple sign-in. Enable Sign in with Apple for `com.nomadkaraoke.mobile`, and add a Services ID and key if Android/web Apple sign-in is wanted. If the account turns out to be lapsed, **don't renew it**: that costs money. Google and email ship without Apple meanwhile, and the gap goes in the hand-off summary.
- **Prod config:** the gen secrets and env for the Google client IDs (and Apple IDs) are deployed with gcloud (admin).
- **Record** every console change in gen's infra docs (standing rule).

## 7. App architecture notes

- New routes (indicative; the builder decides names):
  - `(tabs)/{discover,tonight,make,me}`
  - `song/[id]`
  - `make/[songKey]`: the pick, confirm and search session
  - `credits`
  - `job/[id]`: the ready screen
  - sign-in screens, presented as a sheet or modal
- **"Pending make intent":** the song the person is making survives sign-in and checkout round trips, through the app's own state (Zustand plus route params), so §2's "never lose their place" anti-goal is met.
- `packages/core` gains:
  - the audio ranking port
  - the status → 5-step mapping
  - duration-confirm maths
  - the needs-user ordering

  Unit tests at ≥70% as today.
- `packages/api-gen` gains facades and zod overrides for every untyped gen endpoint the app calls (see `docs/gen-untyped-endpoints.md`: jobs, audio-search). Regenerate the OpenAPI snapshot after gen PRs A and B ship, using `pnpm gen:api` pointed at the local stack or prod.
- The API base URL comes from config: local stack by default in dev, with an env override for Android `10.0.2.2`.
- Native modules this phase likely adds (always through `npx expo install`):
  - `expo-web-browser`
  - Google sign-in: **`react-native-google-auth`**, which is free and built on Android Credential Manager for the native one-tap sheet. If it misbehaves on SDK 57 / the New Architecture, fall back to `expo-auth-session` (a browser account chooser, free, no native SDK). The paid "Universal Sign In" edition of `@react-native-google-signin` is not used (no spend), and its free edition wraps Google's deprecated legacy Android SDK.
  - `expo-apple-authentication`
  - `expo-video`
  - `expo-media-library` plus file system
  - `expo-clipboard`

  Read the versioned SDK 57 docs before using each. Dev-client rebuilds are expected.

## 8. Testing

- **Component tests:** one per screen at minimum, plus `packages/core` unit tests for the ranking port, step mapping and duration maths. jest-expo with RNTL, and the API mocked at the facade.
- **Maestro, on iOS simulator and Android emulator, against the local stack.** Each flow seeds its own state through `/api/test/scenario`, `fake-config` and `reset`, and reads sign-in codes from `/api/test/emails`. Flows:
  1. **Happy path (email sign-in).** Seed a user with 0 credits through `/api/test/scenario`, so the run doesn't depend on welcome-credit eligibility:
     - search → song → Make it → sign in with code
     - 0 credits → credits → fake checkout **Pay** → back to Make it
     - job progresses → ready screen shows the YouTube block → Copy link
  2. **Google sign-in path** via the fake social switch, landing in the make flow.
  3. **Cancelled payment:** fake checkout **Cancel** → "No payment made", still on credits, no charge.
  4. **Failed job:** `fail_at` set → failed card with explanation → Try again visible.
  5. **Needs review:** `auto_approve: false` → "Needs you" card → Review lyrics opens the bridge (assert the browser opened on the job; nothing more).
  6. **Duration confirm:** `audio_duration_seconds > 600` → Confirm cost sheet → Confirm → job continues. Also the 402 branch if cheap to add.
  7. **Code lockout:** 5 wrong codes → 429 → "Send a new code" → new code works.
  8. **"Not sure" audio pick:** the PR A result-shaping knob set to tier 3 → list shown → choose one → job created.
  9. **No YouTube link:** knob off → in-app player shown.
- Maestro running in CI is still undecided (see CLAUDE.md). Locally it is required.
- **Screenshot UX review:** after the flows pass, capture every screen and state on both platforms, review them against the mockup and VISION, fix issues, and re-capture. Commit the screenshots or attach them to the PR (the builder chooses).
- Also exercise the code on Andrew's Android phone if he asks. An APK sideload needs no accounts.

## 9. Order of work (suggested; the builder refines it in the plan)
1. Gen PR A (handoff, checkout return, fake YouTube link, scenario) → merge.
2. App: tabs, song page, email sign-in for real, the make flow, credits and checkout, Make tab, ready screen, bridge. Maestro flows as each lands.
3. Google OAuth client setup (Andrew) → Gen PR B → app Google button. Apple when the account is confirmed.
4. Screenshot UX review, docs (CLAUDE.md status, README), VISION.md roadmap note: Apple sign-in now lands in Phase 1 alongside Google rather than Phase 6.

## 10. Calls made by Claude (not explicitly decided by Andrew)
- Prod checkout returns to the app through gen's https bounce endpoint, not a custom-scheme `success_url`.
- Google sign-in uses `react-native-google-auth`, falling back to `expo-auth-session`.
- Apple sign-in is iOS-only in Phase 1.
- Tier 1 and 2 picks go straight to a single confirm card; only tier 3 shows a list.
- Five progress steps instead of gen's ten.
- Videos default to public (gen's default) so the YouTube link exists, with a note on the confirm block.
- No in-app player when a YouTube link exists. YouTube is the watch path, and the in-app player is the fallback.
- The review bridge uses the in-app browser sheet rather than an embedded web view.
- Google and Apple endpoints are for the app only. Web adoption is later.
- Apple relay emails are accepted as separate accounts, with a note.
- The Me tab holds the minimal set: credits, language, email, sign out.
- A failed job's Try again resumes the same job with gen's `/retry`, as the web does, rather than starting a new paid make (VISION: same endpoints as the web).
