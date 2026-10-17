# Claude Code Instructions for Nomad Mobile

The combined Nomad Karaoke iOS/Android app: one app for every Nomad Karaoke project (decide recommendations, gen karaoke videos, kjbox nights, a singer's own history). **Read [docs/VISION.md](docs/VISION.md) first**: it has the four use cases, the navigation, the release bar (no publishing until all four have a first usable version) and the phase roadmap.

**Status:** Phase 1 "Make it" (2026-10-17): real gen sign-in → make → pay → watch, verified by nine Maestro flows on iOS and Android against the gen local stack. Next: Task 9 (screenshot UX review, prod verification, ship). Phase 0 (2026-10-14) laid the workspace, packages, CI and agent tooling.

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
apps/mobile/          Expo app (src/app routes, src/auth, src/api, src/find, src/providers)
packages/core/        pure TS: session model + input normalizers, job phases, poll backoff, formatting
packages/i18n/        messages/<33>.json, resolveLocale, IntlProvider; scripts/ vendored from karaoke-gen
packages/api-gen/     generated karaoke-gen client + configureClient + facades (auth, credits, make, jobs) + zod overrides
packages/api-decide/  generated karaoke-decide client + facades (searchSongs, popularSongs, getSong)
packages/ui/          tokens, Screen/Text/Button/TextField, <List> (FlashList), <WaveformCanvas> (Skia)
openapi/              gen.json + decide.json snapshots (refresh: pnpm gen:api)
maestro/flows/        E2E flows (make-1…9 against the gen local stack, smoke-discover); common/ shared steps; scripts/stack.js
scripts/e2e-local.sh  gen local stack + Metro + Maestro, per platform
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

scripts/e2e-local.sh --platform ios        # (repo root) all flows vs the gen local stack; or --platform android
scripts/e2e-local.sh --platform android make-4   # flows whose file name contains "make-4"
```

CocoaPods note (Andrew's Mac): a stale `~/.gem/ruby/3.3.0/bin/pod` shim shadows Homebrew's. Run iOS builds with `PATH=/opt/homebrew/bin:$PATH`.

## E2E (Maestro against the gen local stack)

- **Stack:** gen's `scripts/local-stack.sh` (real FastAPI on the Firestore/GCS emulators, `FAKE_WORKERS=1`; gen `docs/TESTING.md` § Local stack). API `http://127.0.0.1:8010`, web `:3010`, `LOCAL_STACK_API_URL=http://127.0.0.1:8010`. `scripts/e2e-local.sh` starts it from `GEN_DIR` (default `../karaoke-gen`, the main clone; needs gen ≥ v0.278.2. To test unmerged gen code, `GEN_DIR=../karaoke-gen-<worktree> scripts/e2e-local.sh …`, or run `scripts/local-stack.sh up --frontend` there yourself with `LOCAL_STACK_API_URL=http://127.0.0.1:8010`) when it isn't up.
- **One URL on both platforms:** Android uses `adb reverse tcp:8010` / `tcp:3010`, so the app, fake checkout and the review handoff all use `http://127.0.0.1`. Metro is started with `EXPO_PUBLIC_GEN_API_URL=http://127.0.0.1:8010 EXPO_PUBLIC_GEN_WEB_URL=http://127.0.0.1:3010 EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1` (inlined at bundle time: restart Metro with `--clear` after changing them). Cleartext http works out of the box (iOS ATS `NSAllowsLocalNetworking`; Android debug manifest `usesCleartextTraffic`).
- **Seeding:** each flow calls `maestro/scripts/stack.js` (`ACTION: setup`) for its own `e2e-<name>-<ms>@example.com` user (`CREDITS`, per-user `USER_CONFIG` knobs) and resets the GLOBAL knobs (search is global) to step delay 0.2 s / `perfect`. `ACTION: code` reads the newest sign-in code from `/api/test/emails`. Per-user fake-config **persists for that email** (a scenario's `fail_at`/`audio_duration_seconds` stick to the user), so never reuse an email across flows.
- **Never run the iOS and Android suites at the same time against one stack.** The search knobs (`search_confidence`, `search_result_count`) and step delay are GLOBAL fake-config: flow 8 sets `unsure` and every flow's setup resets it, so concurrent runs break each other. Run one platform, then the other (or give each its own stack on other ports).
- **Flows 2–9** use "Make any song" (reached through a no-match search, `common/make-any.yaml`; scrolling the popular list raced FlashList recycling) + the fake Google path; only flow 1 depends on live decide results. Screenshots land in `docs/screenshots/phase1/<platform>/` (paths are relative to the **working directory**, so run Maestro from the repo root).
- **Android emulator:** AVD `Pixel_8_API_35_Root` (`system-images;android-35;google_apis;arm64-v8a`; start it with `-gpu host`), configured with `hw.ramSize = 4096M`, `hw.cpu.ncore = 4`, `hw.gpu.mode = host`. With the default 1.5 GB / software GPU, adb dropped the emulator transport mid-flow ("device offline"), which also wipes every `adb reverse` rule.

## Rules

1. **Verify on a running app before claiming a UI task is done.** That means a simulator screenshot (`xcrun simctl io booted screenshot <file>` or the Maestro MCP) plus a passing Maestro flow.
2. **No hardcoded user-facing strings.** Use `useTranslations()`. ESLint fails on JSX text literals in `apps/mobile/src` and `packages/ui/src`. Any new key in `packages/i18n/messages/en.json` must be translated (`pnpm i18n:translate`) before commit.
3. **`testID` on every interactive element.** Maestro targets testIDs.
4. **No `@shopify/flash-list` or `@shopify/react-native-skia` imports outside `packages/ui`.** ESLint enforces this. Shopify is winding down both, and a fork or rename must only touch the wrappers.
5. **API clients never touch storage.** The app injects `baseUrl/getToken/getLocale/onUnauthorized` in `apps/mobile/src/api/setup.ts`. Gen owns identity (a 401 signs out). Decide is public for the MVP (no token, and a 401 never signs out).
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
- **Maestro on iOS:** `openAuthSessionAsync` (checkout) first shows a "… Wants to Use … to Sign In" alert (`common/web-auth-alert.yaml` taps Continue). The fake checkout's own Cancel needs `rightOf: Pay` (the browser toolbar has a Cancel too). `hideKeyboard` on iOS can tap whatever is under the keyboard; avoid it.
- **Android delivers the checkout return (`nomadkaraoke://checkout?status=…`) to Expo Router too.** `src/app/+native-intent.tsx` keeps the current screen, otherwise "Unmatched Route" covers the credits screen.
- **gen doesn't record `credits_charged` for create-from-search jobs.** Its reconcile reads a missing value as 1, its confirm-duration route as 0; `durationConfirm` shows the real total and acknowledges gen's arithmetic (`acknowledgedCredits`).
- **`renderRouter` (expo-router testing) switches jest to fake timers.** Reset with `jest.useRealTimers()` in `beforeEach` when code uses real delays.

## Phase 1 notes (deferred from Phase 0)

- Sign-in is real (Phase 1): gen email code, Google (`react-native-google-auth`) and Apple (`expo-apple-authentication`, off until `EXPO_PUBLIC_APPLE_SIGNIN=1`; `app.config.ts` strips the entitlement otherwise). Against the local stack, `EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1` makes Google/Apple send `fake:<email>` (never against prod gen).
- RTL (ar, he) currently applies on the next launch. Reload through `expo-updates` once EAS Update is configured.
- Sentry Expo config plugin (org/project, source maps, dSYMs) is added together with the Sentry account.
- EAS: `eas.json` and `.eas/workflows/*` are dormant. `runtimeVersion` / `updates.url` need an EAS project id.
- Maestro in CI: EAS Workflows `type: maestro` (paid plan) or macOS GitHub runners. This is still a decision to make.
- Decide personal recommendations, music services and vocal range: Phase 3 "Discover" in docs/VISION.md (needs spec §4.2 `exchange-gen-session`). Sung history, playlists and library are Phase 4 "Me".

## App identity

- iOS bundle id / Android package: `com.nomadkaraoke.mobile`
- URL scheme: `nomadkaraoke`
- Name: Nomad Karaoke
