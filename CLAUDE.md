# Claude Code Instructions for Nomad Mobile

The combined Nomad Karaoke iOS/Android app: one app for every Nomad Karaoke project (decide recommendations, gen karaoke videos, kjbox nights, a singer's own history). **Read [docs/VISION.md](docs/VISION.md) first**: it has the four use cases, the navigation, the release bar (no publishing until all four have a first usable version) and the phase roadmap.

**Status:** Phase 0 foundation (2026-10-14). The workspace, packages, CI and agent tooling are in place. The screens are placeholders, and sign-in uses a **mock** email-code API. Phase 1 ("Make it": real sign-in → make → pay → watch, against the gen local stack) is next.

- Spec: [docs/superpowers/specs/2026-10-14-mobile-phase0-design.md](docs/superpowers/specs/2026-10-14-mobile-phase0-design.md) (MVP flow §2, foundation §3, shared auth + payments §4)
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
maestro/flows/        E2E smoke flows
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
maestro test ../../maestro/        # E2E smoke flows against the running dev build
```

CocoaPods note (Andrew's Mac): a stale `~/.gem/ruby/3.3.0/bin/pod` shim shadows Homebrew's. Run iOS builds with `PATH=/opt/homebrew/bin:$PATH`.

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
- **Maestro on a dev-client build:** `maestro/common/launch.yaml` uses `stopApp` and `clearKeychain` instead of `clearState`. `clearState` drops the remembered Metro server, and reconnecting triggers an iOS "Open in …?" SpringBoard prompt that Maestro cannot see. Use the header back button (`tapOn: "Back"`) and avoid `openLink` on iOS for the same reason.
- **`renderRouter` (expo-router testing) switches jest to fake timers.** Reset with `jest.useRealTimers()` in `beforeEach` when code uses real delays.

## Phase 1 notes (deferred from Phase 0)

- Swap `mockAuthApi` (`apps/mobile/src/auth/authApi.ts`, code `123456`) for gen's `POST /api/users/auth/send-code` / `verify-code` once they ship (spec §4.1). Set `EXPO_PUBLIC_AUTH_MOCK=0`.
- RTL (ar, he) currently applies on the next launch. Reload through `expo-updates` once EAS Update is configured.
- Sentry Expo config plugin (org/project, source maps, dSYMs) is added together with the Sentry account.
- EAS: `eas.json` and `.eas/workflows/*` are dormant. `runtimeVersion` / `updates.url` need an EAS project id.
- Maestro in CI: EAS Workflows `type: maestro` (paid plan) or macOS GitHub runners. This is still a decision to make.
- Decide personal recommendations, music services and vocal range: Phase 3 "Discover" in docs/VISION.md (needs spec §4.2 `exchange-gen-session`). Sung history, playlists and library are Phase 4 "Me".

## App identity

- iOS bundle id / Android package: `com.nomadkaraoke.mobile`
- URL scheme: `nomadkaraoke`
- Name: Nomad Karaoke
