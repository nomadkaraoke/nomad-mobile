# Phase 1 "Make it" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A singer can search → Make it → sign in (Google or email code; Apple when available) → pay with credits via the web checkout → watch progress → get a YouTube link and an MP4, on iOS and Android, against both prod and the gen local stack.

**Architecture:**
- Expo Router screens in `apps/mobile/src/app`, with feature hooks beside them in `apps/mobile/src/<feature>/`.
- Pure logic lives in `packages/core`: audio ranking, job steps, duration maths and intent.
- Typed gen facades with zod overrides live in `packages/api-gen`.
- The pending "make intent" survives sign-in and checkout in a Zustand store.
- Jobs are polled with TanStack Query.
- Checkout and the review bridge use `expo-web-browser`.

**Tech Stack:** Expo SDK 57, Expo Router (typed), TanStack Query 5, Zustand 5, zod, `@hey-api/openapi-ts`, `react-native-google-auth` (Credential Manager), `expo-apple-authentication`, `expo-web-browser`, `expo-video`, `expo-media-library`, `expo-file-system`, `expo-clipboard`, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-17-mobile-phase1-make-it-design.md`. The vision is `docs/VISION.md`. The backend counterpart is gen PR "mobile app backend support" (plan: `karaoke-gen/docs/archive/2026-10-17-mobile-app-auth-handoff-plan.md`).

## Global Constraints
- Everything in `CLAUDE.md` Rules 1–7:
  - verify on a running app
  - no hardcoded strings (`useTranslations`), with new `en.json` keys translated by `pnpm i18n:translate` before commit
  - a `testID` on every interactive element
  - no `@shopify/*` outside `packages/ui`
  - API clients never touch storage
  - zod overrides for untyped gen endpoints
  - no accounts or spend
- Native deps only via `npx expo install <pkg>`. Read the SDK 57 docs (`https://docs.expo.dev/versions/v57.0.0/…`) before using an Expo API.
- Env:
  - `EXPO_PUBLIC_GEN_API_URL`: default `https://api.nomadkaraoke.com`
  - `EXPO_PUBLIC_GEN_WEB_URL`: default `https://gen.nomadkaraoke.com`
  - `EXPO_PUBLIC_DECIDE_API_URL`: existing
  - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: default `718638054799-fush0smd1e4icq9pt0immp8n59jjlebh.apps.googleusercontent.com`
  - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`: default `718638054799-hre535n83p8i85tsqf6ai759nlubhd2o.apps.googleusercontent.com`
  - `EXPO_PUBLIC_APPLE_SIGNIN`: `1` shows the Apple button on iOS. Default off until Andrew's Apple developer account is confirmed.
  - `EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN`: `1` makes the Google and Apple buttons send `fake:<email>` tokens, but only when the gen URL is not `https://api.nomadkaraoke.com`. Enforce that in code, and test it.
- Gen endpoints used. These are the same as the web's, plus the gen PR's new ones:
  - `POST /api/users/auth/send-code`
  - `POST /api/users/auth/verify-code`
  - `POST /api/users/auth/google`
  - `POST /api/users/auth/apple`
  - `GET /api/users/me`
  - `GET /api/users/credits/packages`
  - `POST /api/users/credits/checkout {package_id, email, return_to:"app"}`
  - `POST /api/audio-search/search-standalone`
  - `POST /api/jobs/create-from-search`
  - `POST /api/jobs/create-from-url`
  - `GET /api/jobs?fields=summary`
  - `GET /api/jobs/{id}`
  - `POST /api/jobs/{id}/confirm-duration`
  - `POST /api/jobs/{id}/cancel`
  - `POST /api/jobs/{id}/retry`
  - `POST /api/users/auth/handoff-token`
  - `GET /api/jobs/{id}/download/{category}/{key}`
- Copy decided in the spec, used verbatim as `en.json` values:
  - "Make it · 1 credit"
  - "Sign in to make {title}"
  - "Continue with Google"
  - "Continue with Apple"
  - "Continue with email"
  - "Perfect match"
  - "Recommended"
  - "See other sources ({count})"
  - "Paste a YouTube link instead"
  - "Finding the best audio…"
  - "Posted publicly on YouTube so you can share it"
  - "1 credit = 1 karaoke video. Works on the website too."
  - "Continue to secure checkout"
  - "No payment made"
  - "Credits added"
  - "Needs you"
  - "Check the lyrics before it's finished"
  - "Review lyrics"
  - "Confirm cost"
  - "Cancel this video"
  - "Something went wrong making this one."
  - "Still working, this one's taking a little longer"
  - "Nothing made yet"
  - "Copy link"
  - "Share"
  - "Download MP4"
  - "Saved to Photos"
  - Steps: "Got the audio", "Separated the vocals", "Syncing lyrics", "Making the video", "Posting to YouTube"

## Review Focus
1. **The app goes to the background mid-checkout or mid-review, or is killed:** when it comes back, the make intent and the job list recover. The intent store persists to MMKV and expires after 30 min. A poll restarts on foreground. Add a test in Task 3 for persistence and expiry, and in Task 6 for refetch on `AppState` 'active'.
2. **The webhook credit lands a few seconds after the app-return bounce:** the balance poll (up to 10s) shows "Credits added" instead of bouncing back to the paywall. Add a test in Task 5.
3. **Double-tapping Make it:** only one `create-from-search` request. The button is disabled while the request is in flight. Add a test in Task 4.
4. **A 401 mid-flow (session expired):** the app signs out, keeps the make intent, and reopens sign-in instead of crashing to Discover. Add a test in Task 3.
5. **Very long titles and RTL locales:** text wraps, and the YouTube link doesn't overflow. Add RNTL snapshot-free assertions on `numberOfLines` and `flexShrink` in Task 7, plus the screenshot review in Task 9 with `ar`.

---

### Task 1: API layer (facades, zod overrides, config)

**Files:**
- Modify: `openapi/gen.json`. Regenerate from the local stack running the gen PR branch (`curl http://127.0.0.1:8010/openapi.json`), then `pnpm gen:api:offline`. Check that `scripts/fetch-openapi.mjs` can take a URL override; add one if not.
- Create: `packages/api-gen/src/overrides/{jobs.ts,audioSearch.ts}` (zod)
- Create: `packages/api-gen/src/facades/{auth.ts,credits.ts,make.ts,jobs.ts}`
- Modify: `packages/api-gen/src/index.ts`
- Modify: `apps/mobile/src/api/setup.ts` (add `GEN_WEB_URL`), `apps/mobile/src/config.ts` (new: all env reads and the fake-social guard)
- Test: `packages/api-gen/src/__tests__/facades.test.ts`, `apps/mobile/src/__tests__/config.test.ts`

**Interfaces (produced; later tasks use these exact names):**
```ts
// auth.ts: each returns GenSession {token, email, credits, creditsGranted}
sendCode(email: string, locale: string): Promise<void>
verifyCode(email: string, code: string): Promise<GenSession>
signInWithGoogle(idToken: string, locale: string): Promise<GenSession>
signInWithApple(idToken: string, locale: string): Promise<GenSession>
getMe(): Promise<{ email: string; credits: number }>
createHandoffUrl(jobId: string, locale: string): Promise<string>
// credits.ts
listCreditPackages(): Promise<CreditPackage[]>   // {id, credits, priceCents, name}
createAppCheckout(packageId: string, email: string): Promise<string>  // checkout_url
// make.ts
searchAudio(artist: string, title: string): Promise<{ sessionId: string; results: AudioResult[] }>
createJobFromSearch(a: { sessionId: string; index: number; artist: string; title: string }): Promise<string> // job_id
createJobFromUrl(a: { url: string; artist: string; title: string }): Promise<string>
// jobs.ts
listMyJobs(): Promise<JobSummary[]>
getJob(id: string): Promise<JobDetail>
confirmDuration(id: string, acknowledgedCredits: number): Promise<void>
cancelJob(id: string): Promise<void>
retryJob(id: string): Promise<void>
```
- `JobSummary` (zod) holds:
  - `job_id`, `status`, `progress`, `artist`, `title`, `created_at`, `error_message?`, `credit_refunded?`
  - `state_data` (passthrough) with `youtube_url?`, `pending_additional_credits?`, `credits_charged?`, `duration_actual_seconds?`, `brand_code?`
  - `file_urls?`
- `JobDetail` extends `JobSummary`, adding `download_urls?`.
- `AudioResult` is the fields gen's `getSearchConfidence` reads. Copy the field list from `karaoke-gen/frontend/lib/audio-search-utils.ts` and the backend's result model.
- Errors: every facade throws `ApiError` (existing). Add `isApiError(e, status, detail?)`.
  - A 402's detail `{credits_available, credits_required}` is exposed as `ApiError.detail`.
- `config.ts` exports `GEN_API_URL`, `GEN_WEB_URL`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `APPLE_SIGNIN_ENABLED`, and `fakeSocialEnabled(): boolean`. That last one is false whenever `GEN_API_URL` is prod.

- [ ] Step 1: Failing tests:
  - Each facade maps request and response. Mock `fetch` the way `configure.test.ts` does.
  - `JobSummary` zod accepts a real list payload. Capture a fixture from the local stack into `__tests__/fixtures/`.
  - `fakeSocialEnabled` is false for prod even with the env set.
- [ ] Step 2: Implement. Regenerate the client. Delete the `docs/gen-untyped-endpoints.md` rows for any endpoint now typed via `response_model` by the gen PR.
- [ ] Step 3: `pnpm test && pnpm typecheck && pnpm lint && pnpm gen:api:offline && git diff --exit-code packages/api-*/src/client`. Expect PASS.
- [ ] Step 4: Commit `feat(api): gen facades for sign-in, credits, make and jobs`.

### Task 2: Core logic (audio ranking port, job steps, duration, intent)

**Files:**
- Create: `packages/core/src/audioRank.ts`, a 1:1 port of `karaoke-gen/frontend/lib/audio-search-utils.ts`: `categorizeResult`, `groupResults`, `getBestResult`, `getSearchConfidence`, plus the title and artist helpers they use. Cross-check with `kjbox/kj-controller/static-sing/audio_rank.js`.
- Create: `packages/core/src/jobSteps.ts`
- Create: `packages/core/src/duration.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/{audioRank,jobSteps,duration}.test.ts`

**Interfaces:**
- `getSearchConfidence(results, title, artist): { tier: 1|2|3; best: AudioResult|null }`. The same semantics as gen.
- `groupResults(results): {category: string; results: AudioResult[]}[]`
- `jobStep(status: string): { step: 0|1|2|3|4|5; slow: boolean }`
  - 0: not started (pending)
  - 1: got audio
  - 2: separated
  - 3: lyrics synced
  - 4: video made
  - 5: posted or complete
  - `slow` is true for `download_pending_retry` and `render_pending_capacity`.
  - Derive the status → step table from `karaoke-gen/frontend/lib/job-status.ts`'s 10-step mapping. Put the table in the file with a comment linking the source.
- `sortJobsForMakeTab(jobs: JobSummary[]): JobSummary[]`: needsUser first, then working, then done, then failed or cancelled. Newest first within each group. Use the existing `jobPhase`.
- `durationConfirm(job): { totalCredits: number; extraCredits: number; seconds: number }`
  - `totalCredits = credits_charged + pending_additional_credits`

- [ ] Step 1: Failing tests:
  - Port gen's own `audio-search-utils` test cases. Find them in `karaoke-gen/frontend/__tests__` or `lib/__tests__`, and copy the cases verbatim.
  - Add the three fake-search shapes from the gen PR (`search_confidence` = perfect / recommended / unsure) as fixtures, asserting tiers 1, 2 and 3.
  - `jobStep` for every gen status, including unknown → `{step:0}` (stays 'working').
  - `durationConfirm({credits_charged:1, pending_additional_credits:1, duration_actual_seconds:872})` → `{totalCredits:2, extraCredits:1, seconds:872}`.
- [ ] Step 2: Implement. Step 3: `pnpm test:coverage`, with core at ≥70%. Commit `feat(core): audio ranking port, job steps, duration confirm`.

### Task 3: Sign-in (real email code, Google, Apple, sheet, make intent)

**Files:**
- Modify: `apps/mobile/src/auth/authApi.ts` (delete the mock; bind to Task 1 facades), `apps/mobile/src/auth/store.ts`
- Create: `apps/mobile/src/auth/social.ts` (Google via `react-native-google-auth`, Apple via `expo-apple-authentication`, fake-token path)
- Create: `apps/mobile/src/make/intentStore.ts`
- Routes: replace `app/sign-in/email.tsx` and `code.tsx`, and add `app/sign-in/index.tsx`, the sheet. Register all three in the root `_layout.tsx` with `presentation: 'formSheet'`, falling back to `modal` if formSheet misbehaves on Android, plus `sheetAllowedDetents`.
- `app.json` plugins: `react-native-google-auth` (iOS URL scheme = reversed iOS client id, if its plugin needs it) and `expo-apple-authentication` (`ios.usesAppleSignIn: true` only when the env flag is set; use `app.config.ts` if conditional config is needed).
- Tests: `apps/mobile/src/__tests__/{signInSheet,signInCode,authStore,intentStore,social}.test.tsx`

**Interfaces:**
- `useAuth` additions:
  - `signInWithSession(s: GenSession): Promise<void>`
  - `verify(code)` now returns `void`, or throws `SignInError` with `kind: 'invalid'|'locked'|'expired'|'tooManyCodes'|'disposable'|'network'` and `attemptsLeft?: number`. Count attempts client-side from 5, matching gen's limit.
- `social.ts`:
  - `signInWithGoogle(): Promise<GenSession | 'cancelled'>`
  - `signInWithApple(): Promise<GenSession | 'cancelled'>`
  - `appleAvailable(): Promise<boolean>`: `APPLE_SIGNIN_ENABLED` && iOS && `AppleAuthentication.isAvailableAsync()`
- `intentStore`:
  - `useMakeIntent`: `{ intent: MakeIntent|null; set(i: MakeIntent): void; clear(): void }`
  - `MakeIntent = { artist: string; title: string; decideSongId?: number; createdAt: number }`
  - Persisted to MMKV (`appStorage`).
  - `get()` returns null when older than 30 min.
- Sign-in route params: `{ returnTo?: Href }`. On success, go back to `returnTo`, which for the make flow is `/make`.

- [ ] Step 1: Failing tests:
  - The sheet shows the title "Sign in to make {title}" from the intent, plus the Google and email buttons. The Apple button shows only when `appleAvailable()` resolves true.
  - Email → code → success → `router.dismissTo('/make')`.
  - Wrong code shows "That code isn't right ({left} tries left)".
  - A 429 `too_many_attempts` shows the locked message and **Send a new code**, which calls `sendCode` again and resets the attempts.
  - Google cancelled → stays on the sheet with no error. Google success → session stored.
  - The fake path sends `fake:<email>`, using an email typed into a small "test email" field visible only when `fakeSocialEnabled()`.
  - A 401 during the make flow keeps the intent (Review Focus 4).
  - Intent expiry (Review Focus 1).
- [ ] Step 2: `npx expo install react-native-google-auth expo-apple-authentication`. Read the libraries' README or docs via ctx7 for the SDK 57 / New Architecture config plugin. If `react-native-google-auth` fails to build or sign in on SDK 57, switch to `expo-auth-session` Google (`useIdTokenAuthRequest`) and note it in the commit.
- [ ] Step 3: Implement. Remove `EXPO_PUBLIC_AUTH_MOCK`, `MOCK_CODE`, `devMockNotice` and their tests.
- [ ] Step 4: Tests, typecheck and lint pass. Commit `feat(auth): real email-code, Google and Apple sign-in sheet`.

### Task 4: Tabs, song page and make flow (pick → confirm → create)

**Files:**
- Routes:
  - Rename `(tabs)/find.tsx` → `(tabs)/discover.tsx`
  - Replace `videos.tsx` → `make.tsx` (Task 6 fills it in)
  - Replace `account.tsx` → `me.tsx`
  - Add `(tabs)/tonight.tsx` ("coming soon")
  - Update `(tabs)/_layout.tsx`: icons `search`, `moon`, `sparkles`, `person`; testIDs `tab-discover`, `tab-tonight`, `tab-make`, `tab-me`
  - Update `app/index.tsx` to redirect to `/discover`
- Modify: `app/song/[id].tsx`
- Create: `app/make/index.tsx` (pick and confirm, reading `useMakeIntent`), `apps/mobile/src/make/useAudioSearch.ts`
- Tests: `apps/mobile/src/__tests__/{songScreen,makeConfirm,tabs}.test.tsx`

**Behaviour:**
- **Song page:** the "No karaoke version found" badge (gold) when `brand_count == 0`, otherwise "Karaoke versions exist". **Make it · 1 credit** (`song-make`) sets the intent, then either opens `/sign-in?returnTo=/make` (signed out) or `/make`.
  - The make-any-song entry (`id=new`) keeps its artist and title fields and sets the intent from them.
- **`/make`:**
  - `useAudioSearch` (TanStack mutation, run once on mount) shows "Finding the best audio…" (`make-searching`).
  - **Tier 1 or 2:** the pick card (`make-pick`, badge `make-pick-badge`, reason text from category and quality), then the collapsed **See other sources** (`make-other-sources`) expanding the grouped list.
  - **Tier 3:** the grouped list expanded, with rows `make-source-<index>` selectable.
  - Below: **Paste a YouTube link instead** (`make-youtube-toggle` → `make-youtube-input` → uses `createJobFromUrl`).
  - Cost block (`make-cost`): "Cost 1 credit · You have {n}", and the public-YouTube line.
  - **Make it** (`make-submit`) is disabled while submitting (Review Focus 3). On success: `clear()` the intent, `router.replace('/(tabs)/make')`, invalidate `['jobs']`.
  - A 402 from search or create → `router.push('/credits?returnTo=/make')`.
  - No results → "We couldn't find audio for this song" and the YouTube option open.
- **Me:** credits (`me-credits`, from `getMe`), **Buy credits** (`me-buy`) → `/credits`, language, email, sign out (`me-signout`).
- **Tonight:** title plus one line, "Coming soon: your requests and tonight's queue".

- [ ] Step 1: Failing tests:
  - The tab bar shows 4 tabs.
  - Song signed out → the sheet route opens with the intent set.
  - `/make` tier 1 shows the pick card and a single Make it.
  - Tier 3 shows the list, and choosing a row enables Make it.
  - A double tap creates once.
  - A 402 navigates to credits.
  - The YouTube link path calls `createJobFromUrl`.
- [ ] Step 2: Implement. Step 3: green. Commit `feat(make): four tabs, song page and audio pick/confirm`.

### Task 5: Credits and checkout

**Files:**
- Create: `app/credits.tsx`, `apps/mobile/src/credits/useCheckout.ts`
- Test: `apps/mobile/src/__tests__/credits.test.tsx`

**Behaviour:**
- Packages from `listCreditPackages()`, with rows `credits-pkg-<id>`. Badges: "Popular" on `3_credits`, and "$6 each" (computed per credit) on `10_credits`. Default selection `3_credits`.
- **Continue to secure checkout** (`credits-checkout`):
  1. `createAppCheckout(id, email)`
  2. `WebBrowser.openAuthSessionAsync(url, 'nomadkaraoke://checkout')`
- Result handling:
  - `type:'success'` with `status=success` → poll `getMe()` every 1s for up to 10s until credits increase (Review Focus 2), then the toast "Credits added" and `router.back()` to `returnTo` (the make screen still holds the intent).
  - `status=cancelled`, or `type:'cancel'|'dismiss'` → the neutral banner "No payment made" (`credits-no-payment`), staying on the screen.
  - The balance doesn't rise within 10s → "Payment received, credits are on their way" and a refresh button. Never a red error.

- [ ] Step 1: Failing tests, with the mocked `expo-web-browser`: success + credits rise → back; cancel → banner; dismiss → banner; slow webhook → waits, then success.
- [ ] Step 2: `npx expo install expo-web-browser`. Implement. Step 3: green. Commit `feat(credits): package picker and checkout that returns to the app`.

### Task 6: Make tab (list, polling, needs-you, duration sheet, failures, review bridge)

**Files:**
- Modify: `app/(tabs)/make.tsx`
- Create:
  - `apps/mobile/src/jobs/useMyJobs.ts`
  - `apps/mobile/src/jobs/JobCard.tsx`
  - `app/job/duration/[id].tsx` (formSheet)
  - `apps/mobile/src/jobs/openReview.ts`
- Test: `apps/mobile/src/__tests__/{makeTab,jobCard,durationSheet}.test.tsx`

**Behaviour:**
- `useMyJobs` is `useQuery(['jobs'], listMyJobs)`:
  - `refetchInterval` is 10s while any job is not done, failed or cancelled, and `false` otherwise.
  - Paused when `AppState` isn't active. Refetch on becoming active (Review Focus 1).
  - Sorted with `sortJobsForMakeTab`.
- `JobCard` (`job-card-<id>`), by phase:
  - **working:** a progress bar (`progress`) and the 5 steps from `jobStep`. `slow` shows the slow line.
  - **needsUser + review:** the "Needs you" badge and **Review lyrics** (`job-review-<id>`). That calls `openReview(jobId)` = `createHandoffUrl` → `WebBrowser.openBrowserAsync`, then invalidates `['jobs']` once it resolves.
  - **needsUser + duration:** **Confirm cost** (`job-confirm-<id>`) → `/job/duration/<id>`.
  - **Other needs-user statuses:** "Finish this on the website" with the same handoff, using target `job_review`. That's acceptable for the bridge; gen 409s for other statuses, and the app then opens `GEN_WEB_URL/app` instead.
  - **failed:**
    - the message, plus collapsible details (`job-error-<id>`)
    - "Your credit was refunded" only when `credit_refunded`
    - **Try again** (`job-retry-<id>`) → `retryJob`
  - **cancelled:** muted.
  - **done:** tap → `/job/<id>`.
- **Duration sheet:** "This track is {mm:ss} long, so it costs {total} credits in total ({extra} more)." Buttons:
  - **Confirm** (`duration-confirm`) → `confirmDuration(id, total)`. A 402 goes to `/credits?returnTo=/job/duration/<id>`.
  - **Cancel this video** (`duration-cancel`) → `cancelJob`.
- Empty state (`make-empty`) with a **Find a song** button → `/discover`. Signed out: the sign-in prompt (`make-signin`).

- [ ] Step 1: Failing tests:
  - Sorting and polling stop when all jobs are done.
  - Each card state renders its testIDs.
  - The review button calls the handoff, then the browser.
  - Duration confirm sends `acknowledged_credits = 2` for the fixture. Duration 402 goes to credits.
  - Retry calls `retryJob`.
  - A refund line shows only with the flag.
- [ ] Step 2: Implement. Step 3: green. Commit `feat(make-tab): job progress, needs-you actions, retry and review bridge`.

### Task 7: Ready screen

**Files:**
- Create: `app/job/[id].tsx`, `apps/mobile/src/jobs/youtube.ts`, `apps/mobile/src/jobs/downloadMp4.ts`
- Test: `apps/mobile/src/__tests__/{readyScreen,youtube,downloadMp4}.test.ts(x)`

**Interfaces and behaviour:**
- `youtubeId(url: string): string | null`. Handles `youtu.be/<id>`, `youtube.com/watch?v=`, `/shorts/` and `/live/`.
- Thumbnail: `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
- Title: `"{artist} - {title} (Karaoke)"`. Check gen's YouTube title format (grep `youtube_upload_service.py` for the title template) and mirror it. Don't call oEmbed.
- YouTube block (`ready-youtube`):
  - the thumbnail (16:9)
  - the title (`numberOfLines={2}`)
  - the link `youtu.be/<id>` (large, selectable, `ready-youtube-link`)
  - tapping the thumbnail or title → `Linking.openURL('vnd.youtube://<id>')`, falling back to the https URL. On iOS, add `LSApplicationQueriesSchemes: ["youtube", "vnd.youtube"]` via app.json `ios.infoPlist`.
- **Copy link** (`ready-copy`) uses `expo-clipboard` and shows a "Copied" toast. **Share** (`ready-share`) uses RN `Share.share({ url, message })`.
- **Download MP4** (`ready-download`), via `downloadMp4(jobId)`:
  1. Read the job's `download_urls` (signed, from `getJob`) and choose `lossy_720p_mp4`. Without one, use `/api/jobs/{id}/download/finals/lossy_720p_mp4` with the Authorization header.
  2. `File.downloadFileAsync` (expo-file-system next API) to the cache.
  3. `MediaLibrary.requestPermissionsAsync(true)` (write-only).
  4. `MediaLibrary.saveToLibraryAsync`.
  5. Show progress, then "Saved to Photos". On permission denied, show a message with an "Open settings" button.
  - A 410 `output_archived` → "This video has been archived. Ask for it to be re-made from the website." with a web handoff later. For Phase 1, just the message.
- No YouTube URL → `expo-video` `VideoView` playing the signed 720p URL (`ready-player`), plus Download.

- [ ] Step 1: Failing tests:
  - Every `youtubeId` URL form.
  - The ready screen with a YouTube URL shows the block and no player. Without one, it shows the player.
  - Copy calls the clipboard.
  - The download happy path and the denied-permission path, with mocked modules.
  - A long title gets `numberOfLines` 2 (Review Focus 5).
- [ ] Step 2: `npx expo install expo-video expo-media-library expo-file-system expo-clipboard`. Configure the media-library plugin's permission strings, phrased as translatable app config (English is fine in the plugin). Implement.
- [ ] Step 3: green. Commit `feat(ready): YouTube hand-off block, share, MP4 download`.

### Task 8: i18n, native builds, Maestro against the local stack (iOS and Android)

**Files:**
- `packages/i18n/messages/*.json`, translated with `pnpm i18n:translate`.
- `maestro/common/launch.yaml`: update it for the new first screen (`discover-search-input`, renamed from `find-search-input`; rename testIDs consistently in Task 4).
- `maestro/scripts/stack.js`: Maestro `runScript` helpers using `http.post` / `http.get` to `${STACK}/api/test/{reset,scenario,fake-config,emails}`. `STACK` is passed with `-e STACK=http://127.0.0.1:8010` on iOS and `http://10.0.2.2:8010` on Android. They output `output.email`, `output.code`, `output.jobId`.
- `maestro/flows/make-*.yaml`: one flow per spec §8 case, numbered 1–9.
- Delete `smoke-signin-gate.yaml` (mock-based); keep `smoke-find.yaml`, renamed for Discover.
- `scripts/e2e-local.sh`:
  1. Boots the gen local stack from `$GEN_DIR` (default `../karaoke-gen-mobile-app-auth`) with `LOCAL_STACK_API_URL` set per platform.
  2. Starts Metro with `EXPO_PUBLIC_GEN_API_URL` set to the stack and `EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1`.
  3. Runs `maestro test maestro/flows -e STACK=…` for `--platform ios|android`.
- Docs: `CLAUDE.md` (status, commands, the E2E section, gotchas found) and `README.md`.

**Flow specifics:**
- **1. Happy path:**
  1. scenario `user` with credits 0
  2. sign in via email (code from `/api/test/emails`)
  3. search, then the song
  4. Make it → credits → fake checkout (`tapOn: "Pay"` in the in-app browser; Maestro can see Custom Tabs and SFSafariViewController content) → back
  5. Make it → the job → wait for `job-card-*` done (set `step_delay_seconds` low)
  6. ready → `ready-youtube-link` visible → Copy
- **2. Google:** the fake social path.
- **3. Cancelled payment:** tap "Cancel" on the fake checkout → `credits-no-payment`.
- **4. Failed job:** `fail_at: lyrics` → `job-retry-*` visible.
- **5. Needs review:** `auto_approve: false` → `job-review-*` → assert the browser shows the gen web review URL or page text → close.
- **6. Duration confirm:** `audio_duration_seconds: 900` → `job-confirm-*` → `duration-confirm` → the job continues.
- **7. Lockout:** 5 wrong codes → the locked message → resend → the new code works.
- **8. Not sure:** `search_confidence: unsure` → the list → `make-source-*` → Make it.
- **9. No YouTube link:** `youtube_url_enabled: false` → `ready-player`.

Song search uses live decide, as Phase 0 did. To avoid flakiness, use the make-any-song entry (artist and title fields) in flows 2–9, and real search only in flow 1.

- [ ] Step 1: Build dev clients: `PATH=/opt/homebrew/bin:$PATH npx expo run:ios --device "iPhone 17 Pro"` and `npx expo run:android` (AVD `Pixel_8_API_35_Root`).
- [ ] Step 2: Write the flows. Run them on iOS until all 9 pass, then on Android until all 9 pass. Fix app bugs found along the way, each with a regression component test.
- [ ] Step 3: `pnpm i18n:translate && pnpm i18n:check`. Commit `test(e2e): Maestro make-it flows on iOS and Android against the gen local stack`.

### Task 9: Screenshot UX review, prod verification, ship
- [ ] Step 1: Capture every screen and state on both platforms into `docs/screenshots/phase1/{ios,android}/`, using Maestro `takeScreenshot` in the flows. Include `ar` for RTL, and a long-title song. Review them against the mockup and VISION: alignment, tap-target size (≥44pt), truncation, empty and loading states, and dark-theme contrast. Fix, re-capture and commit.
- [ ] Step 2: Prod verification. Build an Android release APK pointed at prod (`EXPO_PUBLIC_GEN_API_URL` default):
  - Install it on the emulator.
  - **Google sign-in** with a real Google account if the emulator has one; otherwise email-code sign-in to prod with a test address readable through the Gmail MCP.
  - Open the credits checkout, confirm the live Stripe page loads, tap back or cancel, and confirm the app shows "No payment made". **No real payment.**
  - Search a song and reach the pick card. Don't create a prod job unless the account already has credits.
  - Record the results in the PR.
- [ ] Step 3: Run the workflow: `/test` → `/test-review` → `/docs-review` (`CLAUDE.md` status → Phase 1, the VISION roadmap note that Google and Apple sign-in landed in Phase 1, the README) → `/coderabbit` → `/pr` → CI green → merge.
- [ ] Step 4: Write the session record and update memory `project_nomad_mobile_app`.
