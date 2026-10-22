# Claude Code Instructions for Nomad Mobile

The combined Nomad Karaoke iOS/Android app: one app for every Nomad Karaoke project (decide recommendations, gen karaoke videos, kjbox nights, a singer's own history). **Read [docs/VISION.md](docs/VISION.md) first**: it has the four use cases, the navigation, the release bar (no publishing until all four have a first usable version) and the phase roadmap.

**Status:** Phase 1 "Make it" (2026-10-17): real gen sign-in → make → pay → watch, verified by nine Maestro flows on iOS and Android against the gen local stack, plus a prod check of the release APK (real email-code sign-in, live Stripe checkout open/cancel, real audio search). Phase 1b "Search parity" (2026-10-19) then rebuilt song search on decide's search service: offline song list, outcomes (did-you-mean, resolve, versions, pick screen), make-flow match judge, flows search-1…4 + make-10. Phase 2 "Native review" (2026-10-20) is built: lyrics review (line list, issues bar, word/edit/nudge sheets, Tap To Sync, vocal-gap callouts) and Finish (A/B instrumental chooser, preview, three-call submit) run natively, replacing the web bridge; its prod check is pending. Phase 3a "Discover core" (2026-10-21) is built: sign-in card, 4-step taste quiz, personalised recommendations from decide (sections, Love / Not for me, offline last picks), the filter bar and sheets, the KaraFun / community library filter (also on search), and Me's music profile; decide accepts the gen session token directly. 3b (music services) and 3c (vocal range) are next. See docs/VISION.md. Phase 0 (2026-10-14) laid the workspace, packages, CI and agent tooling.

- Phase 3a spec: [docs/superpowers/specs/2026-10-21-mobile-phase3a-discover-core-design.md](docs/superpowers/specs/2026-10-21-mobile-phase3a-discover-core-design.md); plan: [docs/superpowers/plans/2026-10-21-mobile-phase3a-discover-core.md](docs/superpowers/plans/2026-10-21-mobile-phase3a-discover-core.md); survey: [docs/superpowers/specs/2026-10-21-mobile-phase3-discover-survey.md](docs/superpowers/specs/2026-10-21-mobile-phase3-discover-survey.md); 3b and 3c specs sit beside it
- Phase 2 spec: [docs/superpowers/specs/2026-10-19-mobile-phase2-native-review-design.md](docs/superpowers/specs/2026-10-19-mobile-phase2-native-review-design.md); plan: [docs/superpowers/plans/2026-10-19-mobile-phase2-native-review.md](docs/superpowers/plans/2026-10-19-mobile-phase2-native-review.md); platform-neutral behaviour doc for gen web: [docs/REVIEW-UX.md](docs/REVIEW-UX.md)
- Phase 1b spec: [docs/superpowers/specs/2026-10-18-mobile-search-parity-design.md](docs/superpowers/specs/2026-10-18-mobile-search-parity-design.md); plan: [docs/superpowers/plans/2026-10-18-mobile-search-parity.md](docs/superpowers/plans/2026-10-18-mobile-search-parity.md)
- Phase 1 spec: [docs/superpowers/specs/2026-10-17-mobile-phase1-make-it-design.md](docs/superpowers/specs/2026-10-17-mobile-phase1-make-it-design.md); plan: [docs/superpowers/plans/2026-10-17-mobile-phase1-make-it.md](docs/superpowers/plans/2026-10-17-mobile-phase1-make-it.md)
- Phase 0 spec: [docs/superpowers/specs/2026-10-14-mobile-phase0-design.md](docs/superpowers/specs/2026-10-14-mobile-phase0-design.md) (MVP flow §2, foundation §3, shared auth + payments §4)
- Phase 0 plan: [docs/superpowers/plans/2026-10-14-mobile-phase0-foundation.md](docs/superpowers/plans/2026-10-14-mobile-phase0-foundation.md)
- Stack decision and research: `../docs/archive/2026-10-14-mobile-app-stack-research.md` (workspace root)
- Expo-specific guidance: [AGENTS.md](AGENTS.md). **Read the versioned Expo docs before touching Expo APIs.** Training data is stale.

## Stack

| Layer | Choice |
|---|---|
| Framework | Expo SDK 57 (`expo@~57.0.29`, RN 0.86, React 19.2, Hermes v1, New Arch), dev-client builds (not Expo Go) |
| Routing | Expo Router, typed routes. Routes live in `apps/mobile/src/app/` |
| Server state | TanStack Query 5 |
| Client state | Zustand 5; session in `expo-secure-store` |
| API clients | `@hey-api/openapi-ts` 0.99 (pinned) generated from committed OpenAPI snapshots |
| i18n | `use-intl` + `expo-localization`, 33 locales, English fallback |
| Styling | Uniwind (Tailwind v4); tokens mirror gen web |
| Lists / graphics | FlashList and Skia, **only through `@nomad/ui` wrappers** |
| Tests | jest-expo + @testing-library/react-native 13; Maestro E2E |
| Observability | Sentry + PostHog SDKs, inert until `EXPO_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_POSTHOG_KEY` are set |

## Workspace

```
apps/mobile/          Expo app (src/app routes, src/auth, src/api, src/find (useSearch, components, outcome.ts), src/offline (opt-in offline song index), src/providers)
apps/mobile/src/discover/  Discover tab (useRecommendations, filtersStore, quizStore, staleStore, recsSnapshot = MMKV offline picks cleared on sign-out by useClearRecsOnSignOut, components/ RecSection, FilterBar, sheets, quiz/ steps, profile/ Me's music profile)
apps/mobile/src/find/library/  library filter (any / community / karafun): store, picker, badge, shared by search and Discover
apps/mobile/src/review/  native review (ReviewScreen, lyrics/, sheets/, sync/, finish/, audio/, store.ts, drafts.ts)
packages/review-core/ pure-TS review logic (doc model, edits, timing, Tap To Sync, issues, vocal gaps, instrumental, peaks, media URLs); to be shared with gen web later (see docs/REVIEW-UX.md)
packages/core/        pure TS: library/ (library filter model), discover/ (filters, quiz, reasons, offline snapshot freshness), session model + input normalizers, job phases + steps, audio-search ranking, duration confirm, formatting, search/ (song matcher; Python parity fixtures synced from decide by scripts/sync-search-fixtures.mjs, `DECIDE_DIR`)
packages/i18n/        messages/<33>.json, resolveLocale, IntlProvider; scripts/ vendored from karaoke-gen
packages/api-gen/     generated karaoke-gen client + configureClient + facades (auth, credits, make, jobs) + zod overrides
packages/api-decide/  generated karaoke-decide catalog client (facade `getSong`, legacy by numeric id) + the search service client and its facades (searchSongs, popularSongs, getSongDetail, resolveQuery, getOfflineIndexManifest, logSearchEvent, pingSearch); decide's search service is the app's single song-search backend
packages/ui/          tokens, Screen/Text/Button/TextField, <List> (FlashList), <WaveformCanvas> + <NomadLoader> (Skia; the brand "N" icon vector in nomadN.ts, exported as apps/mobile/assets/brand/nomad-n-strip.svg)
openapi/              gen.json + decide.json + decide-search.json snapshots (refresh: pnpm gen:api; point at another stack with GEN_OPENAPI_URL / DECIDE_SEARCH_OPENAPI_URL, see scripts/fetch-openapi.mjs)
maestro/flows/        E2E flows (make-1…10, search-1…4, review-1…12, smoke-discover) against the gen + decide search local stacks; common/ shared steps; scripts/stack.js
maestro/screens/      screenshot-only flows for UX reviews, not in the suite (long-title.yaml: any locale, e.g. ar for RTL; review-tour.yaml: the whole native review, run with --screen)
scripts/e2e-local.sh  gen local stack + decide search local stack + Metro + Maestro, per platform
```

## Commands

```bash
pnpm install                       # pnpm 12; settings live in pnpm-workspace.yaml (nodeLinker: hoisted)
pnpm test                          # all jest projects   (pnpm test:coverage enforces 70%+ on packages/*)
pnpm typecheck && pnpm lint
pnpm gen:api                       # refresh OpenAPI snapshots from prod + regenerate clients
GEN_OPENAPI_URL=http://127.0.0.1:8010/openapi.json node scripts/fetch-openapi.mjs gen  # gen snapshot from another stack
pnpm gen:api:offline               # regenerate from committed snapshots (CI drift check)
pnpm i18n:translate                # translate new en.json keys → 32 locales (Gemini, GCS cache)
pnpm i18n:check                    # key/placeholder completeness (CI hard-fails)

cd apps/mobile
npx expo install <pkg>             # ALWAYS use this for native deps (SDK-compatible versions)
npx expo run:ios --device "iPhone 17 Pro"   # dev build on simulator (needs working CocoaPods)
npx expo run:android               # dev build on emulator (AVD Pixel_8_API_35_Root)

scripts/e2e-local.sh --platform ios        # (repo root) all flows vs the gen + decide search local stacks; or --platform android
scripts/e2e-local.sh --platform android make-4   # flows whose file name contains "make-4"
```

CocoaPods note (Andrew's Mac): a stale `~/.gem/ruby/3.3.0/bin/pod` shim shadows Homebrew's. Run iOS builds with `PATH=/opt/homebrew/bin:$PATH`.

## E2E (Maestro against the gen local stack and decide's search local stack)

- **Stack:** gen's `scripts/local-stack.sh` (real FastAPI on the Firestore/GCS emulators, `FAKE_WORKERS=1`; gen `docs/TESTING.md` § Local stack). API `http://127.0.0.1:8010`, web `:3010`, `LOCAL_STACK_API_URL=http://127.0.0.1:8010`. `scripts/e2e-local.sh` starts it from `GEN_DIR` (default `../karaoke-gen`, the main clone; needs gen ≥ v0.278.2. To test unmerged gen code, `GEN_DIR=../karaoke-gen-<worktree> scripts/e2e-local.sh …`, or run `scripts/local-stack.sh up --frontend` there yourself with `LOCAL_STACK_API_URL=http://127.0.0.1:8010`) when it isn't up.
- **Decide main API stack (Phase 3a):** decide's `scripts/local-stack.sh up` runs the main API on **:8030** plus the search service on :8020, both on gen's Firestore emulator (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`), so gen sessions made by gen's local stack validate in decide. `EXPO_PUBLIC_DECIDE_API_URL` is the main API (:8030), `EXPO_PUBLIC_DECIDE_SEARCH_URL` the search service (:8020; defaults to the decide API URL when unset, as in prod). `scripts/e2e-local.sh` and the discover-* Maestro flows are wired up in the Phase 3a E2E task and may lag this doc.
- **Search stack:** decide's `scripts/search-local-stack.sh up` (now a thin wrapper of the above) (the search service on a fixture song index, :8020; decide `docs/TESTING.md` § Search local stack), started from `DECIDE_DIR` (default `../karaoke-decide-search-parity` while that branch is unmerged, else `../karaoke-decide`). Both stacks get `DECIDE_GEN_PARTNER_SECRET=local-stack-secret` so decide's `/resolve` reaches gen (the fake judge's global verdict). Fixture songs the flows use: "hello" → Adele, "starlite muse" → Muse "Starlight" (Community + Commercial), "machu picchu strokes" (no karaoke version), "baby" (which one?), "rocket man" (long title).
- **One URL on both platforms:** Android uses `adb reverse tcp:8010` / `tcp:3010` / `tcp:8020` / `tcp:8030`, so the app, fake checkout, the review handoff and the offline-list download all use `http://127.0.0.1`. Metro is started with `EXPO_PUBLIC_GEN_API_URL=http://127.0.0.1:8010 EXPO_PUBLIC_GEN_WEB_URL=http://127.0.0.1:3010 EXPO_PUBLIC_DECIDE_API_URL=http://127.0.0.1:8030 EXPO_PUBLIC_DECIDE_SEARCH_URL=http://127.0.0.1:8020 EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1` (inlined at bundle time: restart Metro with `--clear` after changing them). Cleartext http works out of the box (iOS ATS `NSAllowsLocalNetworking`; Android debug manifest `usesCleartextTraffic`).
- **Force offline:** flows tagged `force-offline` (search-4) run last, on a Metro restarted with `EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1`: search and the song page act as if there were no connection (`useOffline()`), while Me's offline-list download still reaches decide. `config.ts` honours it only against a local decide host.
- **Match judge:** Make it stays disabled until gen's match judge settles (≤ 12 s); `common/make-submit.yaml` waits for it enabled. Every flow's user gets the fake judge's `none`; `stack.js` `ACTION: judge` sets `judge_kind` (`cosmetic`/`content`/`ambiguous`) and the canonical artist/title per user, and `ACTION: job` asserts the user's newest job's artist/title (`TOKEN` = setup's `output.token`).
- **Seeding:** each flow calls `maestro/scripts/stack.js` (`ACTION: setup`) for its own `e2e-<name>-<ms>@example.com` user (`CREDITS`, per-user `USER_CONFIG` knobs) and resets the GLOBAL knobs (search is global) to step delay 0.2 s / `perfect`. `ACTION: code` reads the newest sign-in code from `/api/test/emails`. Per-user fake-config **persists for that email** (a scenario's `fail_at`/`audio_duration_seconds` stick to the user), so never reuse an email across flows.
- **Never run the iOS and Android suites at the same time against one stack.** The search knobs (`search_confidence`, `search_result_count`) and step delay are GLOBAL fake-config: flow 8 sets `unsure` and every flow's setup resets it, so concurrent runs break each other. Run one platform, then the other (or give each its own stack on other ports).
- **Flows 2–10** use "Make any song" (reached through a no-match search's make bar, `common/make-any.yaml`) + the fake Google path; flow 1 and the search flows use the search stack's fixture songs. Screenshots land in `${SHOTS}` = `docs/screenshots/phase1b/<platform>/` (`phase1/` keeps Phase 1's set; paths are relative to the **working directory**, so run Maestro from the repo root).
- **Review flows (review-1…12)** screenshot to `${REVIEW_SHOTS}` = `docs/screenshots/phase2/<platform>/`. Flows tagged `locale-he` (review-9) run as their own group with the app in Hebrew (RTL): `e2e-local.sh` sets the app language before them and resets it after.
- **Screen tours:** `scripts/e2e-local.sh --platform ios --locale he --screen review-tour` runs one `maestro/screens/<name>.yaml` with the app in that language (default `en`), shots in `docs/screenshots/phase2/review/<platform>/<locale>/`.
- **Gen review knobs** (per user, `stack.js` `USER_CONFIG`; gen `docs/TESTING.md` § Local stack): `review_fixture` (`default`, `corrections`, `duet`, `rtl`, `large`), `backing_vocals`, `stems_delay_seconds`, `review_mode` (`always_review` …), `auto_approval`, `review_complete_fail_once`. `large` (review-7) needs `audio_duration_seconds` ≥ 305 (it uses 320), or its lines run past the audio.
- **Android emulator:** AVD `Pixel_8_API_35_Root` (`system-images;android-35;google_apis;arm64-v8a`; start it with `-gpu host`), configured with `hw.ramSize = 4096M`, `hw.cpu.ncore = 4`, `hw.gpu.mode = host`. With the default 1.5 GB / software GPU, adb dropped the emulator transport mid-flow ("device offline"), which also wipes every `adb reverse` rule.

## Rules

1. **Verify on a running app before claiming a UI task is done.** That means a simulator screenshot (`xcrun simctl io booted screenshot <file>` or the Maestro MCP) plus a passing Maestro flow.
2. **No hardcoded user-facing strings.** Use `useTranslations()`. ESLint fails on JSX text literals in `apps/mobile/src` and `packages/ui/src`. Any new key in `packages/i18n/messages/en.json` must be translated (`pnpm i18n:translate`) before commit.
3. **`testID` on every interactive element.** Maestro targets testIDs.
4. **No `@shopify/flash-list` or `@shopify/react-native-skia` imports outside `packages/ui`.** ESLint enforces this. Shopify is winding down both, and a fork or rename must only touch the wrappers.
5. **API clients never touch storage.** The app injects `baseUrl/getToken/getLocale/onUnauthorized` in `apps/mobile/src/api/setup.ts`. Gen owns identity (a 401 signs out). Decide now receives the gen session token (decide validates gen sessions directly, Phase 3a spec §4; no exchange endpoint). A decide 401 never signs the user out: it marks Discover stale (`discover/staleStore.ts`) and Discover shows a refresh prompt. Search endpoints stay public.
6. **Gen endpoints with untyped responses** are listed in [docs/gen-untyped-endpoints.md](docs/gen-untyped-endpoints.md). Before calling one, add a zod schema in `packages/api-gen/src/overrides/` and file a gen follow-up to add `response_model`.
7. **Never create Apple, Google Play, Expo/EAS, RevenueCat, Sentry or PostHog accounts, or run anything that costs money, without asking Andrew first.**

## Agent tooling

- **Expo plugin** (`.claude/settings.json` enables `expo@claude-plugins-official`): Expo Skills work locally.
- **Expo MCP** (remote server plus local automation such as screenshot, tap by testID and logs via `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start` with the `expo-mcp` dev dependency): **pending.** It needs an Expo account login; local capabilities are proxied through the remote server too. Ask Andrew before setting it up.
- **Maestro MCP** (`.mcp.json` → `maestro mcp`): drive and inspect the simulator or emulator, and write and run flows.

## Gotchas (found on device; jest on Node hides them)

- **Hermes has no `Intl.PluralRules` or `Intl.DisplayNames`.** `installIntlPolyfills()` (`@nomad/i18n`) runs first in `AppProviders` and loads FormatJS plural data for all 33 locales (plus `fil`, because `tl` canonicalizes to it). Language names come from the static `LOCALE_NAMES`. If you use another `Intl` API, check Hermes support or polyfill it.
- **The iOS Keychain (SecureStore) survives uninstall.** The auth store discards a session that has no MMKV install marker, which is wiped on uninstall, so reinstalling the app always starts signed out.
- **Maestro on a dev-client build (iOS):** `maestro/common/launch.yaml` uses `stopApp` and `clearKeychain` instead of `clearState` on iOS. `clearState` drops the remembered Metro server, and reconnecting triggers an iOS "Open in …?" SpringBoard prompt that Maestro cannot see. Use the header back button (`tapOn: "Back|Navigate up"`) and avoid `openLink` on iOS for the same reason.
- **Maestro on Android:** `clearKeychain` is a no-op there (the session survives), so `launch.yaml` uses `clearState` on Android, which also forgets the Metro server; it then `openLink`s the dev-client URL `exp+nomad-karaoke://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081` (Metro through 10.0.2.2, no adb reverse). Don't type the URL into the dev launcher: `inputText`/`eraseText` there hung Maestro's driver (120 s gRPC timeout) late in a suite. The header back button is "Navigate up" on Android (`tapOn: "Back|Navigate up"`). A fresh emulator's Chrome shows a first-run screen inside Custom Tabs (`e2e-local.sh` disables it; `common/web-auth-alert.yaml` taps past it). Don't `kill $(lsof -ti tcp:8081)` to restart Metro: the emulator's qemu holds a connection to 8081 and dies with it.
- **Close the in-app browser before `stopApp` on iOS.** Stopping the app with SFSafariViewController (the review handoff) or an auth session (checkout) still open crashes SafariViewService in the simulator (macOS crash dialogs). `maestro/common/close-browser-if-open.yaml` runs before every `stopApp` and as `onFlowComplete` in flows that open a browser (make-1, make-3, review-12); add it to any new one.
- **The dev menu's floating Tools button overlaps the review's header menu** (top right, it takes the ⋯ taps). Review flows run `common/move-dev-tools-button.yaml` before tapping `review-menu`: on Android it drags the button to the left edge (`clearState` resets it every launch); on iOS `e2e-local.sh` turns it off.
- **Maestro on iOS:** `openAuthSessionAsync` (checkout) first shows a "… Wants to Use … to Sign In" alert (`common/web-auth-alert.yaml` taps Continue). The fake checkout's own Cancel needs `rightOf: Pay` (the browser toolbar has a Cancel too). `hideKeyboard` on iOS can tap whatever is under the keyboard; avoid it.
- **Android delivers the checkout return (`nomadkaraoke://checkout?status=…`) to Expo Router too.** `src/app/+native-intent.tsx` keeps the current screen, otherwise "Unmatched Route" covers the credits screen. If the return cold-starts the app (Android killed it during card entry), it opens `/make/new` when a fresh make intent is stored, else Me.
- **Duration confirm sends the full total.** `durationConfirm` (`@nomad/core`) computes `totalCredits` = the job's `state_data.credits_charged` (`?? 1`: jobs made before gen v0.278.2 never recorded it, and gen charged 1) + the pending extra; the app sends that total and gen (≥ v0.278.2) records `credits_charged` on create and resolves the confirm against it.
- **RTL text alignment:** iOS "natural" alignment (RN's `auto`) ignores `I18nManager.forceRTL`, so paragraphs stayed left-aligned in ar/he. `@nomad/ui` `Text` defaults to `textAlign: 'left'`, which RN mirrors to the right under RTL. Interpolated titles/emails go through `isolate()` (`@nomad/i18n`) so Latin text doesn't scramble inside an Arabic sentence.
- **Metro started with `CI=1` doesn't watch files** (`e2e-local.sh` starts it that way): after editing code, restart it, or run your own `npx expo start --dev-client` (same env, no `CI=1`) while iterating.
- **expo-sqlite closes crash (segfault) after an FTS5 query.** Every open of `offline.db` passes `{useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false}` (a typed but `@hidden` option); go through `openOfflineReader()`. `expo-sqlite` is pinned (see the `"//"` key in package.json). Don't bump it without re-checking on device.
- **Tests must not live under `src/app`.** expo-router's `require.context` bundles every `.tsx` there as a route. Put screen tests in `apps/mobile/src/__tests__/`.
- **Never run `PRAGMA quick_check` on the JS thread at open:** 15 s on the 300 MB prod list (release, Android emulator). `openOfflineReader()` only checks `meta`; the full check runs once per download via expo-sqlite's async API. The download/unpack itself streams 256 KiB slices (a whole-file read ran Android out of Java heap on the 104 MB .gz).
- **Offline identify cost scales with the index.** Median ~50 ms, p95 ~280 ms on big indexes, on the JS thread; `useSearch` debounces it (300 ms) and runs it after the cloud request is sent. Don't call it per keystroke.
- **`sid` vs the device id:** `sid` is the in-memory search-session id (`find/searchSession.ts`, renewed when a song is picked or the app restarts) that decide logs with each search. The device id (MMKV, so it resets on uninstall) is only sent as the `X-Device-Id` header to decide.
- **colima stale lock after a crash or reboot:** `colima start` fails until you remove the symlink `~/.colima/_lima/_disks/colima/in_use_by`.
- **`make.categoryCount` (`"{label} ({count})"`) is hand-written and format-only**, already in `.en-snapshot.json`, so a plain `pnpm i18n:translate` won't redo it (`--no-cache` will).
- **`pnpm i18n:translate` needs `gcloud auth login`** (or, with a lapsed login, `GEMINI_API_KEY=<AI Studio key> pnpm i18n:translate`, which still uses the GCS cache when ADC works; add `--no-cache` via `python3 packages/i18n/scripts/translate.py` if not) (GCS cache + Gemini via ADC) and `env -u GEMINI_API_KEY`. If auth has lapsed, new keys stay out of `.en-snapshot.json` and get translated on the next run.
- **react-native-gesture-handler gestures inside an RN `Modal` (our `@nomad/ui` Sheet) got no touches on iOS 26**, even with a `GestureHandlerRootView` wrapper. Use RN `Pressable` or the responder system inside sheets: the Tap To Sync pad uses `onResponderGrant` / `onResponderRelease` (and terminate as release).
- **`npx expo run:android` in a fresh worktree needs `ANDROID_HOME=$HOME/Library/Android/sdk`** (no `local.properties` there).
- **gen's `/vocals-peaks` u8 values are absolute**, not per-track normalized: run `normalizePeaks` before drawing or quiet vocals render as a flat line.
- **`pnpm i18n:translate` with a lapsed gcloud user login:** run it through the workspace `scripts/gcp-admin` wrapper (only in sessions where Andrew typed `/gcp-admin`), with `env -u GEMINI_API_KEY`.
- **iOS drops an `Alert` presented while a `Modal` is dismissing.** Raise it from the Sheet's `onDismiss`, not right after closing the sheet.
- **Finish leaves via `router.dismissTo('/make')`**; back on Finish goes to Lyrics first (a `beforeRemove` listener that only intercepts GO_BACK / POP, so the post-submit dismiss still leaves).
- **`renderRouter` (expo-router testing) switches jest to fake timers.** Reset with `jest.useRealTimers()` in `beforeEach` when code uses real delays.

## Sign-in and session

- Gen email code, Google (`react-native-google-auth`) and Apple (`expo-apple-authentication`, off until `EXPO_PUBLIC_APPLE_SIGNIN=1`; `app.config.ts` strips the entitlement otherwise). Against the local stack, `EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1` makes Google/Apple send `fake:<email>`; `config.ts` only honours it when the gen URL is a local host (loopback, 10.0.2.2, private LAN, `*.local`).
- `useSessionCheck` (in `AppProviders`) calls `GET /api/users/me` on launch and on every foreground while signed in; a 401 signs out through the gen client's `onUnauthorized`. Open sign-in with `openSignIn(returnTo)` (`auth/signInUi.ts`).

## Deferred / later-phase notes

- RTL (ar, he) currently applies on the next launch. Reload through `expo-updates` once EAS Update is configured.
- Sentry Expo config plugin (org/project, source maps, dSYMs) is added together with the Sentry account.
- EAS: `eas.json` and `.eas/workflows/*` are dormant. `runtimeVersion` / `updates.url` need an EAS project id.
- Maestro in CI: EAS Workflows `type: maestro` (paid plan) or macOS GitHub runners. This is still a decision to make.
- Library filter: 3a ships `any | community | karafun` (KaraFun / Karaoke Version, KaraokeNerds brand `KV`). Other commercial libraries (Karaoke Cloud, Singa) only if an authoritative list turns up. Me's sung history will be recorded on the phone first and synced later (Phase 4), per VISION's offline principle.
- Music services (3b) and vocal range (3c): see their specs. Sung history, playlists and library are Phase 4 "Me".

## App identity

- Apple: App ID `com.nomadkaraoke.mobile` ("Nomad Karaoke") registered 2026-10-17 in Andrew's Apple Developer account (Individual, team `55B76HN73D`, renews 2027-06-25) with Sign in with Apple enabled. Turning the Apple button on (`EXPO_PUBLIC_APPLE_SIGNIN=1`) and verifying it needs a team-signed iOS build (Xcode signed into Andrew's Apple ID): parked to Phase 6 with TestFlight.
- Google OAuth clients (project `nomadkaraoke`, created 2026-10-17): web `718638054799-fush0smd1e4icq9pt0immp8n59jjlebh` (the token audience gen verifies), iOS `718638054799-hre535n83p8i85tsqf6ai759nlubhd2o`, Android `718638054799-q0f65m68a31du5nn9h5accsauad232ku` (debug keystore SHA-1 `5E:8F:…:F6:25`; add the release key's SHA-1 when a real signing key exists).

- iOS bundle id / Android package: `com.nomadkaraoke.mobile`
- URL scheme: `nomadkaraoke`
- Name: Nomad Karaoke
