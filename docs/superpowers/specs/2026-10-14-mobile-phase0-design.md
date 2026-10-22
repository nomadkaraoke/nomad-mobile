# Nomad Karaoke mobile app — Phase 0 design (MVP shape + foundation + shared auth)

*2026-10-14. Stack decision and rationale: `../nomadkaraoke/docs/archive/2026-10-14-mobile-app-stack-research.md` (workspace root). Backlog: Frog "Combined Nomad Karaoke mobile app".*

## 1. Intent

**Andrew asked for:** Phase 0 only:
- brainstorm and plan the MVP (decide search → gen make → pay → watch)
- build a fresh Expo SDK 57 scaffold
- wire the Expo Claude Code plugin/MCP and Maestro
- generate the gen and decide API clients from OpenAPI
- set up an i18n pipeline that reuses the 33 `messages/*.json` locales
- set up CI
- design shared auth

Constraints:
- Wrap Skia and FlashList behind our own components.
- Use free tiers only.
- Stop and ask before creating any Apple, Google, RevenueCat or EAS account, or anything that costs money.

**Why:** the KaraokeHunt store listings brought real visibility just by existing. A slick combined app with easy pay-to-generate is a growth and revenue lever, and about 30% of gen jobs are already created on mobile web.

**Phase 0 is done when:**
1. A pnpm workspace on SDK 57 builds and runs as a dev build on the iOS simulator and the Android emulator.
2. Placeholder screens exercise every package end to end: routing, i18n, generated clients, the UI wrappers, and auth plumbing against a mock.
3. CI is green: lint, tsc, jest, i18n completeness, OpenAPI drift.
4. Maestro smoke flows pass locally.
5. Claude can drive the app (expo-mcp screenshots and taps, `maestro mcp`).
6. This spec and an implementation plan for Phase 0 are committed.

No backend (gen or decide) changes happen in Phase 0.

## 2. MVP product flow (built in Phase 1)

There are three tabs: **Find**, **My Videos** and **Account**. Browsing is anonymous. Sign-in is required only when the user commits to making a video.

1. **Find:**
   - Debounced decide catalog search: `GET /api/catalog/songs?q=` (public, no token).
   - A badge when `brand_count > 0` ("karaoke versions exist").
   - `GET /api/catalog/songs/popular` when the query is empty.
   - A fallback row, "Can't find it? Make any song", with free-text artist and title.
2. **Song → "Make karaoke video".** This is the sign-in gate: email → 6-digit code (§4.1). Verifying claims the welcome credit.
3. **Make:**
   - `POST /api/audio-search/search-standalone` → auto-select the recommended result. "Choose audio source" stays collapsed and is shown only when it's needed.
   - The confirm sheet shows the cost, the balance and the gen default visibility.
4. **Pay** (only when the balance is short):
   - A paywall mirroring `GET /api/users/credits/packages`.
   - RevenueCat IAP consumables everywhere. Storefront-gated (not IP-gated) US-only "Buy on web, save ~X%", which opens the Stripe checkout through a handoff token (§4.3).
   - Then `POST /api/jobs/create-from-search` runs with `review_mode: "auto"`.
5. **My Videos:**
   - The job list, with `GET /api/jobs/{id}` polled through TanStack Query (backoff), plus Expo push (§4.5).
   - `awaiting_review` → "Review lyrics" opens the existing web review in an authenticated in-app browser (`expo-web-browser` + handoff token).
   - `awaiting_duration_confirm` → a native confirm sheet.
6. **Watch:**
   - `GET /api/jobs/{id}/download-urls` → MP4 played with `expo-video`.
   - Share sheet; YouTube link when the video is public.
7. **Account:** credit balance, buy credits, language picker, sign out, delete account (App Review 5.1.1(v)).

**Out of the MVP:**
- decide recommendations, quiz and Spotify (these need the §4.2 linking)
- kjbox singer flow (Phase 2)
- the native lyrics editor (Phase 3)
- themes and advanced gen options

## 3. Phase 0 foundation architecture

The repo becomes a pnpm workspace, and the old SDK 54 skeleton is replaced wholesale.

```
nomad-mobile/
  apps/mobile/          Expo SDK 57 (expo@57.0.29+, RN 0.86, React 19.2, Hermes v1, New Arch),
                        Expo Router (typed routes), TS strict, Uniwind (Tailwind v4), dev-client.
                        app/(tabs)/{find,videos,account}.tsx, app/sign-in/{email,code}.tsx,
                        app/song/[id].tsx: placeholder screens wired to real packages.
  packages/api-gen/     @hey-api/openapi-ts output from openapi/gen.json (committed snapshot)
  packages/api-decide/  same, from openapi/decide.json (fetched from the decide Cloud Run URL)
  packages/core/        pure TS, no RN imports: Session model, credit/price formatting,
                        job-status helpers (terminal / needs-user-action), polling backoff
  packages/i18n/        messages/<33 locales>.json (top-level namespace per feature),
                        use-intl provider, locale resolution (expo-localization → supported
                        locale → en), RTL list, scripts/translate.py + validate-translations.py
                        vendored from karaoke-gen
  packages/ui/          tokens (mirroring gen web Tailwind theme) + wrappers:
                        <List> (FlashList inside; same props can fall back to FlatList),
                        <WaveformCanvas> (Skia inside; props = peaks[], progress, height, colors),
                        Screen / Text / Button / TextField. Every interactive wrapper requires testID.
  maestro/              flows/smoke-*.yaml
  openapi/              gen.json, decide.json snapshots + scripts/fetch-openapi.ts
  .github/workflows/    ci.yml (new), security.yml (kept)
  .eas/workflows/, eas.json   written but dormant until an EAS account exists
  .mcp.json, CLAUDE.md  agent tooling + rules
```

### 3.1 Boundaries and rules
- **Only `packages/ui` may import `@shopify/flash-list` or `@shopify/react-native-skia`.** ESLint `no-restricted-imports` enforces this everywhere else. Shopify is winding down stewardship of both, so a fork or rename then touches one package.
- **The API clients never touch storage.** Each client exports `configureClient({ baseUrl, getToken, getLocale, onUnauthorized })`, and `apps/mobile` injects these from the auth store.
- **No hardcoded user-facing strings.** An ESLint rule (`react-native/no-raw-text` or equivalent) applies in `apps/mobile` and `packages/ui`.
- **`testID` on every interactive element.** Maestro and expo-mcp both target testIDs.

### 3.2 API clients
- The `pnpm gen:api` script:
  1. fetches `https://api.nomadkaraoke.com/openapi.json` and the decide Cloud Run `/openapi.json` into `openapi/`
  2. regenerates both packages with `@hey-api/openapi-ts`, using the fetch client plus the TanStack Query plugin
- **CI drift check:** regenerate from the committed snapshot and `git diff --exit-code`. Generated code always matches the snapshot.
- A separate scheduled or manual job compares the snapshots to prod.
- **Gen endpoints with untyped responses** (about half; mostly review, jobs and admin): each one the app calls gets a hand-written zod schema in `packages/api-gen/src/overrides/`. `docs/gen-untyped-endpoints.md` lists the gen `response_model` follow-ups.

### 3.3 Auth plumbing in Phase 0
- `packages/core` defines `Session = { token, email, expiresHint }` and the auth state machine: signed-out → code-sent → signed-in → expired.
- `apps/mobile/src/auth/` holds a Zustand store persisted to `expo-secure-store`.
- The sign-in screens call `authApi.sendCode` and `authApi.verifyCode` through an `AuthApi` interface. Phase 0 binds them to a mock implementation, `EXPO_PUBLIC_AUTH_MOCK=1`, which is the default in dev. Phase 1 swaps in the generated gen client once §4.1 ships.

### 3.4 i18n
- **Messages:** the `en.json` source holds mobile-specific namespaces such as `find`, `signIn`, `videos`, `account` and `common`.
- **Reuse:** strings are copied from gen and decide `en.json` where they fit, and the translate cache makes repeated strings free.
- **Tooling:**
  - `pnpm i18n:translate` runs the vendored `translate.py --messages-dir packages/i18n/messages --target all`.
  - `pnpm i18n:check` runs `validate-translations.py --keys-only`. **CI fails hard on missing keys or placeholders.**
- **RTL** (ar, he): `I18nManager.forceRTL` is applied on locale change, followed by a reload.

### 3.5 Observability and analytics
- `@sentry/react-native` and `posthog-react-native` are installed and initialized only when `EXPO_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_POSTHOG_KEY` are set. With neither set they are a no-op.
- Creating accounts and adding the MCPs waits for Andrew's go-ahead.

### 3.6 Agent tooling
- **Expo:**
  - The Claude Code plugin is installed at project scope: `claude plugin install expo@claude-plugins-official --scope project`.
  - The local `expo-mcp` dev dependency runs with `EXPO_UNSTABLE_MCP_SERVER=1`. Remote EAS tools need an Expo account and stay dormant.
- **Maestro:** `maestro mcp` is registered in `.mcp.json`.
- **`CLAUDE.md` rules:**
  - Every UI task ends with a simulator screenshot and a passing Maestro flow.
  - No hardcoded strings.
  - testIDs are required.
  - No `@shopify/*` imports outside `packages/ui`.
  - Never create store or EAS/RevenueCat accounts without asking.

### 3.7 CI (GitHub Actions, free)
- `ci.yml` on PR and on main: `pnpm install --frozen-lockfile` → lint → `tsc -b` → jest (coverage at least 70% on `packages/*`) → `i18n:check` → OpenAPI drift → `expo-doctor`.
- Maestro runs locally in Phase 0. Running it in CI (EAS Workflows `type: maestro`, or macOS GitHub runners) is a Phase 1 decision.
- The EAS workflow YAMLs are written now but dormant: `ci.yml` (lint + tests + preview update) and `release.yml` (build → Maestro → submit).

## 4. Shared auth + payments design (backend built in Phase 1)

**Identity of record:** the gen user (`gen_users`, keyed by email). The app holds one gen session token.

### 4.1 Email-code login (karaoke-gen)
- `POST /api/users/auth/send-code {email, locale}` → 202 Accepted.
- `POST /api/users/auth/verify-code {email, code}` → the same response model as `GET /api/users/auth/verify`: `{session_token, user, credits_granted, credit_status}`. The welcome credit is granted the same way.
- Mechanics follow kjbox `send-code` / `verify-code`, but without the partner secret:
  - 6 digits
  - stored hashed
  - 10-minute TTL
  - 5 verify attempts, then 429
  - send rate limits per email and per IP
- The email contains the code *and* the existing web magic link.
- **Session lifetime is unchanged** (7 days idle / 30 days absolute). The app calls `GET /api/users/me` on launch and foreground, which slides the idle window. A 401 clears the session and returns to Find, and the next make action asks for a code again. There are no refresh tokens.

### 4.2 Decide linking (post-MVP, needed for recommendations)
- **Superseded:** the `exchange-gen-session` endpoint was never built. Decide accepts gen session tokens directly, and the app sends its gen token to decide (see the [Phase 3a spec §4](2026-10-21-mobile-phase3a-discover-core-design.md)). The app keeps no separate decide token.

### 4.3 Web handoff (in-app review + US web checkout)
- `POST /api/users/auth/handoff-token` (authenticated) returns a single-use token that expires in 60 seconds. This follows the `create_admin_login_token` pattern.
- The app opens `https://gen.nomadkaraoke.com/<path>?handoff=<t>`, and gen web exchanges the token for a normal session.
- Long-lived tokens never appear in URLs.

### 4.4 IAP via RevenueCat (karaoke-gen)
- **User id:** RevenueCat `app_user_id` = the gen user id, set after sign-in.
- **Products:** consumables `credits_1`, `credits_3`, `credits_10`, priced at the StoreKit / Play tier that absorbs the store cut (15% under the Small Business programmes).
- **Webhook:** `POST /api/users/webhooks/revenuecat`, verified against a shared authorization header.
  - Credit grants are written with `transaction_id` as the idempotency key.
  - `REFUND` / `CANCELLATION` → debit.
  - The grant uses the same Firestore credit ledger that Stripe uses.
- **US web link:** shown only when the RevenueCat storefront country is US. The "save X%" copy is server-driven, so it can change with the pending Apple fee ruling without a release.

### 4.5 Push
- `POST /api/push/expo-token {token, platform}` stores Expo push tokens on the gen user.
- The existing Web Push trigger points (completion, blocking states) also send to the Expo push API, which is free.

### 4.6 Account deletion
- Self-serve `DELETE /api/users/me` (authenticated):
  - anonymizes the user's email and PII
  - revokes all sessions
  - keeps job and payment records for accounting
- Required by App Review 5.1.1(v).

## 5. Risks
- **Untyped gen endpoints** weaken codegen. Mitigation: zod overrides plus a gen `response_model` follow-up list (§3.2).
- **Monorepo/Metro friction:** SDK 57 supports pnpm workspaces. If `node-linker` causes trouble, fall back to `node-linker=hoisted` in `.npmrc`.
- **Uniwind on SDK 57:** verify compatibility first. If it's broken, fall back to NativeWind 4. The approach is unchanged; only the styling layer swaps.
- **Spending:** nothing in Phase 0 needs an account or money. EAS, RevenueCat, Apple, Google, Sentry and PostHog each wait for an explicit go-ahead.
