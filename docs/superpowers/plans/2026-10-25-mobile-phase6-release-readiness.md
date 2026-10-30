# Mobile Phase 6: Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Nomad Karaoke app store-ready (IAP, push, account deletion, observability, signing, updates, store prep, test tracks) without publishing.

**Architecture:** Backend first, each repo in its own worktree and PR. gen gets the RevenueCat webhook, Expo push and `DELETE /api/users/me`. decide gets a user-data registry with a partner delete endpoint. kjbox gets push filtering plus an account-deletion poller. The app then adds a purchases adapter (RevenueCat, or a fake against the local stack), push registration and settings, an account deletion flow, Sentry/PostHog, and config (blocked permissions, associated domains, expo-updates). Release ops (keys, fingerprints, store docs, uploads) run as checklist tasks once their accounts exist.

**Tech Stack:** Expo SDK 57 / RN 0.86, expo-router, TanStack Query, Zustand, MMKV, `react-native-purchases`, `expo-notifications`, `expo-updates`, `@sentry/react-native`, `posthog-react-native`; gen and decide FastAPI + Firestore; kjbox Flask + SQLite; Maestro.

**Spec:** `docs/superpowers/specs/2026-10-25-mobile-phase6-release-readiness-design.md` (read it first; § refs below point there).

## Global Constraints

- Nothing is submitted for review or published. Builds go to TestFlight internal and Play internal testing only (spec §9).
- No new account or spend beyond spec §2. Never sign Apple's Paid Apps agreement (it waits for the LLC conversion).
- IAP product ids: `nomad_credits_1`, `nomad_credits_3`, `nomad_credits_5`, `nomad_credits_10`. US prices are $9.99 / $23.99 / $34.99 / $59.99. They map to gen packages `1_credit`, `3_credits`, `5_credits`, `10_credits`.
- `web_link` defaults to `{"show_for": {"ios": ["USA"], "android": []}, "copy_key": "credits.webLink.default"}`.
- Push types (gen `push_prefs` keys): `ready`, `review`, `problems`. The app setting `nightAlerts` controls kjbox registration. kjbox app subscriptions receive only `up_next` and `now_singing`.
- `ACCOUNT_DELETION_ENABLED` is on in the local stack and **off in prod** until Andrew's manual pass.
- The App Review demo login is inert unless both `APP_REVIEW_DEMO_EMAIL` and the `app-review-demo-code` secret are set.
- No PII to RevenueCat, Sentry or PostHog. Use `app_user_id` (UUID4) only, and PostHog stays anonymous.
- Every new user-facing string goes in `packages/i18n/messages/en.json` (app) or gen's `frontend/messages/en.json` (web), and all 33 locales are translated before commit.
- Every interactive element gets a `testID`. Every new backend endpoint gets unit tests.
- Shared files (`app.config.ts`, `app.json`, `_layout.tsx`, `(tabs)/me.tsx`, `AppProviders.tsx`, i18n messages, `package.json`/lock, CI, decide/gen models): message `nomadkaraoke-36` (Phase 4) before editing. Milestones go to `nomadkaraoke-12`.
- Pulumi runs only from main, targeted, with a preview showing zero deletions. Never run an untargeted gen `pulumi up` (divebar_mirror drift).
- The live kjbox box (NomadPC) config changes only with Andrew's go-ahead, outside a live night, with a backup.
- The iPad lock is `mkdir /tmp/nomad-ipad.lock` plus an owner file. Remove it when done.

## Review Focus

1. **Duplicate or concurrent RevenueCat deliveries.** The same `transaction_id` arriving twice at once must grant exactly once (G2 concurrency test).
2. **A push token whose device signs into another account.** Registering a token removes it from every other gen user, so the previous account's videos never notify the new person (G3 test). The app unregisters before sign-out (M2 test).
3. **Account deletion failing part-way and then retried.** For example decide succeeds and Dropbox fails. The retry must finish without double effects, and the user must still be able to sign in and retry, because sessions are revoked last (G4 test).
4. **Deletion while offline, or while the request times out.** The app keeps all local data and shows a retry. It never wipes locally before gen returns 200 (M4 test).
5. **A refund after the credits were spent.** The balance goes negative, the credits screen shows 0, and make is refused with 402 until the user tops up (G2 and M1 tests).

---

## Part G: karaoke-gen (worktree `karaoke-gen-phase6-release`)

### Task G1: `app_user_id`, `/me` capabilities, account-deletion flag

**Files:**
- Modify: `backend/models/user.py` (`User`: `app_user_id: Optional[str]`, `push_prefs: dict[str, bool]`, `expo_push_tokens: list[ExpoPushToken]`)
- Modify: `backend/config.py` (`account_deletion_enabled: bool` from `ACCOUNT_DELETION_ENABLED`, default False; `app_review_demo_email: str = ""`)
- Modify: `backend/api/routes/users.py` (`get_current_user` at ~:904)
- Modify: `scripts/local-stack.sh` (export `ACCOUNT_DELETION_ENABLED=1`)
- Test: `backend/tests/test_users_me_app_fields.py`

**Interfaces:**
- Produces: `UserService.ensure_app_user_id(email: str) -> str` (mints UUID4 once, transactionally). `/me` response gains `app_user_id: str`, `capabilities: {account_deletion: bool}`, `push_prefs: {ready: bool, review: bool, problems: bool}` (missing keys default True).

- [ ] **Step 1: Write failing tests**: `test_me_mints_app_user_id_once` (two `/me` calls return the same UUID4 string); `test_me_capabilities_reflect_flag` (flag off → `account_deletion: False`, on → `True`); `test_me_push_prefs_default_true`.
- [ ] **Step 2: Run** `cd backend && pytest tests/test_users_me_app_fields.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the model fields, `ensure_app_user_id` (Firestore transaction: read, set only if absent), and the `/me` additions.
- [ ] **Step 4: Run** the same tests plus `pytest tests -k "users or me" -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(users): app_user_id, push_prefs and capabilities on /me`.

### Task G2: RevenueCat webhook, store payments, referral net earnings, packages

**Files:**
- Create: `backend/services/iap_service.py`
- Modify: `backend/api/routes/users.py` (route beside `stripe_webhook` ~:1564; `list_credit_packages` ~:962)
- Modify: `backend/services/stripe_service.py` (`CREDIT_PACKAGES[*]["store_product_id"]`)
- Modify: `backend/services/referral_service.py:449` (`record_earning`)
- Modify: `backend/config.py` (`revenuecat_webhook_auth`, `revenuecat_secret_api_key` from Secret Manager env)
- Modify: `backend/api/routes/test_support.py` (`POST /api/test/fake-iap/purchase`, `POST /api/test/fake-iap/refund`)
- Modify: the admin revenue aggregation that sums `stripe_payments` (find it with `grep -rn stripe_payments backend/services`) so it includes `store_payments`
- Test: `backend/tests/test_revenuecat_webhook.py`, `backend/tests/emulator/test_iap_transaction_emulator.py`

**Interfaces:**
- Consumes: G1 `app_user_id`.
- Produces:
  - `IapService.handle_event(event: dict) -> IapResult` (`IapResult.action ∈ {"granted","debited","duplicate","ignored","unknown_user","unknown_product"}`).
  - `UserService.find_by_app_user_id(app_user_id: str) -> Optional[User]`.
  - Packages response: each package has `store_product_id`, plus top-level `web_link: {show_for: {ios: list[str], android: list[str]}, copy_key: str}`.
  - `record_earning(referred_email, source_key: str, purchase_amount_cents: int)`, with the parameter renamed from `stripe_session_id`. The earning doc gets `source: "stripe"|"app_store"|"play_store"`, and the field keeps the name `stripe_session_id` for Stripe rows.

- [ ] **Step 1: Write failing tests** (`test_revenuecat_webhook.py`), using RevenueCat-shaped payloads (`{"event": {"type", "app_user_id", "product_id", "transaction_id", "store", "price", "currency", "country_code", "takehome_percentage"}}`):
  - `test_rejects_bad_auth`: 401 without the header or with a wrong one.
  - `test_grants_package_credits`: `NON_RENEWING_PURCHASE` of `nomad_credits_3` → balance +3, `credit_transactions[-1].reason == "iap_purchase"`, a `store_payments` doc exists.
  - `test_replay_is_noop`: the same event twice → +3 once, the second response is 200 with `duplicate`.
  - `test_concurrent_duplicates_grant_once`: 5 threads post the same event → +3 total (emulator test file).
  - `test_refund_debits_and_can_go_negative`: grant 1, spend 1, `REFUND` → balance −1, reason `iap_refund`. The refund replay is a no-op.
  - `test_unknown_user_records_and_200`: unknown `app_user_id` → 200, no grant, a WARNING is logged, a `store_payments` doc with `unmatched: true`.
  - `test_unknown_product_200_no_grant`.
  - `test_referral_earning_on_net`: a referred user buying `nomad_credits_10` at 59.99 with `takehome_percentage: 0.85` → `record_earning` receives `5099` cents (round down). Without `takehome_percentage` → `price × 0.85`.
  - `test_packages_include_store_ids_and_web_link`.
  - `test_make_refused_when_negative`: a negative balance → job create returns 402.
- [ ] **Step 2: Run** `pytest tests/test_revenuecat_webhook.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `IapService.handle_event`. Follow the `KjboxPartnerService.grant_show_credit` pattern: a single Firestore transaction that `create`s `processed_revenuecat_transactions/{store}:{transaction_id}` (or `…:refund`), updates `gen_users.credits` and appends to `credit_transactions`. `store_payments` and the referral earning are written after the commit. Auth uses `hmac.compare_digest` on the `Authorization` header. Product to credits comes from `CREDIT_PACKAGES` via `store_product_id`.
- [ ] **Step 4: Add the fake-iap test routes.** They build the same event and call `IapService.handle_event` directly (local stack only).
- [ ] **Step 5: Run** `pytest tests/test_revenuecat_webhook.py tests/emulator/test_iap_transaction_emulator.py tests -k "referral or credit or package" -q`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(iap): RevenueCat webhook, store payments, net referral earnings`.

### Task G3: Expo push tokens, preferences, sender, new triggers

**Files:**
- Create: `backend/services/expo_push_service.py`
- Modify: `backend/api/routes/push.py` (`POST /api/push/expo-token`, `DELETE /api/push/expo-token`)
- Modify: `backend/api/routes/users.py` (`PATCH /api/users/me/push-prefs`)
- Modify: `backend/services/job_manager.py:660` (`_trigger_state_notifications`), `:847` (`_send_push_notification`)
- Modify: `backend/services/push_notification_service.py` (check `push_prefs` before Web Push)
- Modify: `backend/api/routes/test_support.py` (`GET /api/test/push-outbox`, `DELETE /api/test/push-outbox`)
- Test: `backend/tests/test_expo_push.py`

**Interfaces:**
- Consumes: G1 `push_prefs`, `expo_push_tokens`.
- Produces:
  - `ExpoPushService.send(email: str, kind: Literal["ready","review","problems"], title: str, body: str, url: str) -> int`. Batches ≤100 per request to `https://exp.host/--/api/v2/push/send` and removes tokens on a `DeviceNotRegistered` ticket. In fake-workers mode it appends to an in-memory outbox instead.
  - `POST /api/push/expo-token` takes `{token: str (ExponentPushToken[...]), platform: "ios"|"android", device_id: str}` and returns 204.
  - `PATCH /api/users/me/push-prefs` takes a partial `{ready?, review?, problems?}` and returns the full prefs.
- Status → kind/url mapping (exact):
  - `COMPLETE`→`ready`, url `/job/{id}`
  - `AWAITING_REVIEW`→`review`, url `/review/{id}`
  - `AWAITING_DURATION_CONFIRM`→`review`, url `/job/duration/{id}`
  - `AWAITING_AUDIO_EDIT`, `AWAITING_INSTRUMENTAL_SELECTION`→`review`, url `/job/{id}`
  - `AWAITING_AUDIO_SELECTION`→`problems`, url `/job/{id}`
  - `FAILED`→`problems`, url `/job/{id}`. When `error_details.code == "audio_download_stalled"` the body says it can keep trying.
  - `FAILED` and `AWAITING_AUDIO_SELECTION` also send Web Push (new).

- [ ] **Step 1: Write failing tests**:
  - `test_register_token_and_replace_per_device`: the same device_id with a new token → one entry.
  - `test_register_moves_token_from_other_user`: user A registers T; user B registers T → A has no T, B has T.
  - `test_delete_token`.
  - `test_rejects_non_expo_token`: 422.
  - `test_prefs_patch_partial`.
  - `test_complete_sends_ready_with_url`: via the fake outbox.
  - `test_failed_sends_problems_and_webpush`.
  - `test_pref_off_suppresses_expo_and_webpush`.
  - `test_device_not_registered_removes_token`: a mocked httpx ticket error.
  - `test_batches_over_100`.
- [ ] **Step 2: Run** `pytest tests/test_expo_push.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, routes and trigger changes. Token moves run in a transaction: query `expo_push_tokens` containing the token across users, remove it, then add it to the caller.
- [ ] **Step 4: Run** `pytest tests/test_expo_push.py tests/test_push_routes.py tests -k "notification" -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(push): Expo push tokens, per-type prefs, failed/needs-attention triggers`.

### Task G4: Account deletion (`DELETE /api/users/me`) and the kjbox deletion queue

**Files:**
- Create: `backend/services/account_deletion_service.py`
- Create: `backend/services/decide_partner_client.py`
- Modify: `backend/api/routes/users.py` (`DELETE /me`; refuse when `account_deletion_enabled` is False with 404)
- Modify: `backend/api/routes/kjbox.py` (`GET /api/kjbox/account-deletions?since=<iso>`, `POST /api/kjbox/account-deletions/{id}/ack`, both `require_kjbox_partner`)
- Modify: `backend/config.py` (`decide_api_url` for the main API; reuse `decide_partner_secret`)
- Modify: `backend/services/user_service.py` (welcome credit: refuse when `sha256(email)` is in `deleted_users`)
- Test: `backend/tests/test_account_deletion.py`, `backend/tests/emulator/test_account_deletion_emulator.py`

**Interfaces:**
- Consumes: G1, G3 (tokens), D2 (decide endpoint), G5 (`AppleRevoker.revoke(authorization_code) -> bool`).
- Produces:
  - `DELETE /api/users/me` with body `{apple_authorization_code?: str}`. Returns 200 `{deleted: true, summary: {...}}`; 409 `{code: "admin"|"referral_balance"|"connect_account"|"kj_partner"|"order_in_progress"}`; 503 `{step: str}` on any step failure; 404 when the flag is off.
  - `GET /api/users/me/deletion-preview` → `{credits: int, jobs_in_progress: int, blocked: code|null}` (the confirm screen uses it).
  - `DecidePartnerClient.delete_user(email: str) -> dict`: `DELETE {decide_api_url}/api/partner/gen/users` with `X-Partner-Secret`. Raises on non-2xx.
  - kjbox queue doc `account_deletions/{uuid}`: `{email_hash: sha256(lower email), created_at, targets: {kjbox: "pending"|"done"}}`.
- Step order (spec §6.1, exact):
  1. preconditions (409)
  2. cancel the user's active jobs (`job_manager.cancel_job`, no refund since credits are forfeited)
  3. decide
  4. RevenueCat `DELETE https://api.revenuecat.com/v1/subscribers/{app_user_id}` (skipped without a key)
  5. Apple revoke (when a code is given)
  6. enqueue kjbox
  7. gen files
  8. gen records + `deleted_users/{uuid}`, then delete `gen_users/{email}`

  Every step is idempotent and safe to re-run.
- Inputs step (Andrew, 2026-10-25: never delete published output files): delete GCS `uploads/` objects for the user and `jobs/{id}/input/**`; strip personal fields (`user_email`→`deleted:{uuid}`, `state_data` keys `customer_email`, `customer_name`, `notification_email`, `display_name`); revoke the Dropbox share link in `state_data.dropbox_link` (keep the key's absence, never delete the folder). **Never delete** `output_files`, stems, renders, the Dropbox folder or YouTube.
- [ ] **Step 1: Write failing tests**:
  - `test_flag_off_404`.
  - `test_refusals`: one test per 409 code.
  - `test_preview_counts`.
  - `test_happy_path_order`: mocks record the call order. Asserts decide → revenuecat → kjbox enqueue → files → records, `gen_users/{email}` gone, `deleted_users` has no email and has `email_sha256`, `credit_transactions` kept, sessions revoked, magic links gone, jobs' `user_email == "deleted:<uuid>"`.
  - `test_decide_failure_503_and_user_intact`: the session still works and a retry succeeds.
  - `test_outputs_never_deleted`: output_files, stems and the Dropbox folder are untouched; only inputs are gone.
  - `test_files_failure_then_retry_completes`: no double cancel, no double enqueue (the queue doc is keyed `sha256(email)`).
  - `test_resignup_no_second_welcome_credit`.
  - `test_kjbox_queue_list_and_ack_requires_secret`.
  - `test_active_jobs_cancelled`.
  - `test_apple_code_passed_to_revoker`.
- [ ] **Step 2: Run** `pytest tests/test_account_deletion.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `AccountDeletionService.delete(email: str, apple_code: Optional[str]) -> dict` and `preview(email) -> dict`, with the routes and the decide client.
- [ ] **Step 4: Run** `pytest tests/test_account_deletion.py tests/emulator/test_account_deletion_emulator.py -v` (emulator via `scripts/run-emulator-tests.sh` or the repo's documented command). Expected: PASS.
- [ ] **Step 5: Commit** `feat(users): self-serve account deletion behind ACCOUNT_DELETION_ENABLED`.

### Task G5: Sign in with Apple revocation

**Files:**
- Create: `backend/services/apple_revoke_service.py`
- Modify: `backend/config.py` (`apple_siwa_key_p8`, `apple_siwa_key_id`, `apple_team_id = "55B76HN73D"`, `apple_client_id = "com.nomadkaraoke.mobile"`)
- Test: `backend/tests/test_apple_revoke.py`

**Interfaces:**
- Produces: `AppleRevoker.revoke(authorization_code: str) -> bool`. It builds an ES256 client-secret JWT (iss team, sub client id, aud `https://appleid.apple.com`, 5-min exp), POSTs `/auth/token` (grant_type authorization_code), then POSTs `/auth/revoke` with the refresh token (falling back to the access token). It returns False and logs a WARNING without a key. In deletion, a revoke failure is a WARNING, not a 503, since a stale code shouldn't block erasure.

- [ ] **Step 1:** Write `test_builds_client_secret_claims` (decode with the test key), `test_token_then_revoke_calls` (httpx mocked), `test_no_key_returns_false`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3:** Implement. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): revoke Sign in with Apple tokens on account deletion`.

### Task G6: App Review demo sign-in

**Files:**
- Modify: the email-code verify path (`POST /api/users/auth/verify-code`; find its service with `grep -n "verify-code" backend/api/routes/users.py`)
- Test: `backend/tests/test_review_demo_login.py`

**Interfaces:** `verify-code` accepts `code == app_review_demo_code` only when `email.lower() == app_review_demo_email` and both are non-empty. It logs `INFO "app review demo login"` and keeps the normal attempt limits.

- [ ] **Step 1:** `test_demo_code_inert_when_unset`, `test_demo_code_only_for_demo_email`, `test_demo_code_signs_in`, `test_attempt_limit_still_applies`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(auth): App Review demo sign-in (inert until configured)`.

### Task G7: gen web `/account/delete`

**Files:**
- Create: `frontend/app/[locale]/account/delete/page.tsx` (follow the app's existing locale routing; check `frontend/app` for the pattern)
- Modify: the existing account/settings page to link to it; `frontend/messages/en.json` and 32 locales (gen's `scripts/translate.py`)
- Test: the frontend unit test beside similar pages, plus a Playwright e2e if gen's suite has an account page spec

**Interfaces:** Uses `GET /api/users/me/deletion-preview` and `DELETE /api/users/me`. Hidden (404 page) when `/me.capabilities.account_deletion` is false. Same copy as the app (spec §6.1): kept data, the "N credits will be lost" line, "N videos in progress will be cancelled", and the 409 → "Contact support" message with the support email.

- [ ] **Step 1:** Tests: renders preview counts; confirm calls DELETE and shows the deleted state; 409 shows support copy; hidden when the capability is false.
- [ ] **Step 2–4:** run (FAIL) → implement → `cd frontend && npm test -- account && npm run lint`.
- [ ] **Step 5: Commit** `feat(web): account deletion page`.
- [ ] **Step 6:** Bump the gen version per its CLAUDE.md, `/coderabbit`, open the gen PR (G1–G7), message `nomadkaraoke-12`, merge after CI. Deploy: prod keeps `ACCOUNT_DELETION_ENABLED` unset. Andrew adds the secrets (`revenuecat-webhook-auth`, `revenuecat-secret-api-key`, `apple-siwa-key`, `app-review-demo-code`). This session can create them now with `scripts/gcp-admin` while its grant lasts (until 2026-10-27 14:43). Wire them in Pulumi with a targeted `pulumi up --target` on the Cloud Run service only, after a preview.

## Part D: karaoke-decide (worktree `karaoke-decide-phase6-deletion`)

### Task D1: User-data registry and `delete_all_user_data`

**Files:**
- Create: `backend/services/user_deletion.py`
- Modify: `backend/api/routes/test_support.py` (`reset_voice` calls the shared voice-erasure helper instead of duplicating it)
- Modify: `docs/ARCHITECTURE.md` § Personal data (registry rule)
- Test: `backend/tests/test_user_deletion.py`, `backend/tests/test_user_data_registry_guard.py`

**Interfaces:**
- Produces:
  - `UserDataStore(collection: str, match: Literal["user_id_field","doc_id_user_id","doc_id_prefix","doc_id_email_hash","email_field"], field: str = "user_id")`
  - `USER_DATA_STORES: tuple[UserDataStore, ...]`
  - `NOT_USER_DATA: frozenset[str]`
  - `async erase_voice_data(fs, bucket, user_id: str) -> None` (moved from `reset_voice`)
  - `async delete_all_user_data(fs, bucket, email: str) -> dict[str, int]`, which returns counts per collection and `{}` for an unknown email.
- Initial registry: `decide_users` (doc_id_email_hash), `user_songs`, `user_artists`, `user_hidden_songs`, `user_imports`, `user_import_artists`, `user_karaoke_unresolved`, `karaoke_log`, `music_services`, `lastfm_users`, `quiz_progress`, `screenshot_imports`, `spotify_playlist_imports`, `youtube_music_imports`, `playlists`, `sessions`, `magic_links` (email_field), plus the voice stores via `erase_voice_data`. Per collection, the implementer reads each service to pick the right `match` mode. `NOT_USER_DATA`: `quiz_songs_cache`, `listenbrainz_cache`, `oauth_states`, `gen_users`, `users`, and anything else that is global or keyed by state token. Each entry gets a one-line comment saying why.
- Also delete GCS objects under any per-user import prefix (find it in the import services). Run `erase_voice_data` before the `user_songs` deletion. Delete `decide_users` last.

- [ ] **Step 1: Write failing tests**:
  - `test_guard_every_collection_classified`: parse every `COLLECTION = "..."` and `collection("...")` literal under `backend/` and assert each name is in the registry or in `NOT_USER_DATA`.
  - `test_delete_all_removes_every_registry_store`: seed one doc per store for user A and one for user B. After the call, A's are gone and B's remain.
  - `test_voice_contract`: seed sessions, attempts, labels, recordings (local dir bucket), a purge marker, and mixed `user_songs`. Afterwards all are gone, including the mixed rows' session fields.
  - `test_unknown_email_noop`.
  - `test_idempotent_second_call`.
- [ ] **Step 2: Run** `cd backend && pytest tests/test_user_deletion.py tests/test_user_data_registry_guard.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Look up the user via the `decide_users/{sha256(email)}` doc **without creating it**. Don't call `resolve_gen_user`, since it creates the profile.
- [ ] **Step 4: Run** the tests plus `pytest tests -k "voice or test_support" -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(privacy): user-data registry and delete_all_user_data`. Message `nomadkaraoke-36` and `nomadkaraoke-72` with the module path `backend/services/user_deletion.py` and the registry rule.

### Task D2: Partner endpoint `DELETE /api/partner/gen/users`

**Files:**
- Create: `backend/api/routes/partner_gen.py` (router `/api/partner/gen`)
- Modify: `backend/config.py` (`gen_partner_secret` from `DECIDE_GEN_PARTNER_SECRET`), the router registration, decide's local stack (export the same `local-stack-secret`), and Pulumi for the main API service (secret env ref already used by the search service)
- Test: `backend/tests/test_partner_gen_delete.py`

**Interfaces:** body `{email: str}`, header `X-Partner-Secret`. The handler calls `delete_all_user_data`. Returns 200 `{deleted: dict[str,int]}`; 401 on a missing or wrong secret (`hmac.compare_digest`); 503 when the secret is unset.

- [ ] **Step 1:** `test_requires_secret`, `test_unset_secret_503`, `test_deletes_and_returns_counts`, `test_second_call_empty_counts`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5:** Bump the version, `/coderabbit`, open the PR, message `nomadkaraoke-12`, merge, then a targeted `pulumi up` for the main API env var from main (preview first).

## Part K: kjbox (worktree `kjbox-phase6-push-deletion`)

### Task K1: App push filtering, `DELETE /push-token`, fake outbox

**Files:**
- Modify: `kj-controller/sing_api_v1.py` (~:1459 add `DELETE /push-token {expo_push_token}`)
- Modify: `kj-controller/sing_store.py` (`remove_expo_subscription(device_id, token)`)
- Modify: `kj-controller/push_dispatcher.py` (`_dispatch_expo` ~:346: app subscriptions only for steps `up_next`, `now_singing`; titles "You're up next" and "It's your turn", `data.url = "/tonight"`; the fake outbox when the test API is on)
- Modify: the test API module (`/sing/api/test/push-outbox` GET/DELETE)
- Test: `kj-controller/tests/test_push_app_filter.py`

- [ ] **Step 1:** `test_app_sub_gets_only_up_next_and_now_singing`, `test_web_sub_still_gets_all_steps`, `test_delete_push_token`, `test_payload_has_tonight_url`.
- [ ] **Step 2–4:** run (FAIL) → implement → `cd kj-controller && pytest tests/test_push_app_filter.py -q` (PASS).
- [ ] **Step 5: Commit** `feat(push): app pushes only up-next and your-turn; unregister endpoint`.

### Task K2: Account-deletion poller

**Files:**
- Create: `kj-controller/account_deletions.py`
- Modify: `kj-controller/gen_client.py` (`list_account_deletions(since)`, `ack_account_deletion(id)`, sent with `X-Kjbox-Secret` on `/api/kjbox/*`)
- Modify: `kj-controller/sing_store.py` (`forget_gen_account(email_hash: str) -> dict[str,int]`)
- Modify: app startup to run the poller every 600 s and once at start (follow how `history_outbox` is scheduled)
- Test: `kj-controller/tests/test_account_deletions.py`

**Interfaces:** `forget_gen_account` matches rows where `sha256(lower(gen_email)) == email_hash`. It deletes `singer_accounts` and `sing_gen_accounts` rows, push subscriptions for those devices, phone numbers on those devices' `sing_requests`, `singer_aliases`, `app_friend_requests`, `singer_photo_consent`, `song_media_consent` and pending `history_outbox` rows. In `photo_consent_events` it nulls the device link but keeps the row. The poller acks only after the local delete commits, and keeps going when gen is unreachable.

- [ ] **Step 1:** `test_forget_removes_linked_rows_only`, `test_consent_events_unlinked_not_deleted`, `test_poller_acks_after_delete`, `test_poller_survives_gen_down`, `test_idempotent`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5:** `/coderabbit`, open the PR (K1+K2), message `nomadkaraoke-12`, merge after G4 is deployed (the endpoint must exist first). Auto-deploy picks it up on NomadPC. Check `journalctl` after deploy, outside a live night.

## Part M: nomad-mobile (this worktree)

### Task M1: Purchases adapter and credits screen

**Files:**
- Create: `apps/mobile/src/credits/purchases/types.ts`, `revenueCatAdapter.ts`, `fakeAdapter.ts`, `index.ts` (`getPurchases()`)
- Create: `apps/mobile/src/credits/useStorePurchase.ts`
- Modify: `apps/mobile/src/app/credits.tsx` (store prices, web link, referral note), `apps/mobile/src/config.ts` (`FAKE_IAP`, RevenueCat keys), `apps/mobile/src/auth/store.ts` (logIn/logOut hooks), `packages/api-gen` (regenerate; zod override for `web_link` if untyped), `packages/i18n/messages/*.json`
- Test: `apps/mobile/src/__tests__/credits.test.tsx`, `apps/mobile/src/credits/purchases/__tests__/*.test.ts`

**Interfaces:**
- Consumes: G1 `app_user_id`, G2 packages and fake-iap routes.
- Produces: `interface PurchasesAdapter { configure(appUserId: string): Promise<void>; logOut(): Promise<void>; products(ids: string[]): Promise<StoreProduct[]>; purchase(productId: string): Promise<PurchaseOutcome>; storefrontCountry(): Promise<string | null> }` with `StoreProduct {id, priceString, price, currency}` and `PurchaseOutcome = {kind: 'purchased'} | {kind: 'cancelled'} | {kind: 'failed', message: string}`. `getPurchases(): PurchasesAdapter | null` (null = IAP off → today's web checkout). `fakeAdapter` returns fixed products and posts to gen `/api/test/fake-iap/purchase`. `FAKE_IAP` storefront comes from `EXPO_PUBLIC_FAKE_STOREFRONT` (default `USA`).

- [ ] **Step 1: Write failing tests**:
  - `shows store price strings when IAP on`.
  - `buy calls purchase then polls /me until credits rise`.
  - `cancelled purchase shows nothing and re-enables`.
  - `US iOS storefront shows web link; non-US hides it; android hidden while show_for.android empty`.
  - `referral discount note shown when /me has active discount`.
  - `IAP off falls back to web checkout`.
  - `negative balance shows 0`.
  - `logOut on sign-out`.
- [ ] **Step 2: Run** `pnpm --filter mobile test credits`. Expected: FAIL.
- [ ] **Step 3:** `cd apps/mobile && npx expo install react-native-purchases`, then implement (message `nomadkaraoke-36` before touching `package.json`/lock and i18n).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm i18n:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credits): in-app purchases via RevenueCat with US web link`.

### Task M2: Push registration

**Files:**
- Create: `apps/mobile/src/notifications/push.ts` (`registerPush`, `unregisterPush`, `askPushPermissionInContext`), `apps/mobile/src/notifications/handler.ts` (`setNotificationHandler` with Tonight suppression)
- Modify: `apps/mobile/src/discover/connect/reminders.ts` → move `useReminderTapRouting` to `src/notifications/tapRouting.ts` (re-export at the old path so 3d's code is untouched), `apps/mobile/app.config.ts` (push entitlement kept unless `EXPO_PUBLIC_PUSH=0`; `extra.eas.projectId`), `apps/mobile/src/make/new.tsx` (ask after make starts), `apps/mobile/src/tonight/...` join success (ask and register with kjbox), `packages/api-gen` and `packages/api-kjbox` facades (`registerExpoToken`, `deleteExpoToken`, `registerKjboxPushToken`, `deleteKjboxPushToken`), `appConfig.test.ts`
- Test: `apps/mobile/src/notifications/__tests__/push.test.ts`, `handler.test.ts`

**Interfaces:**
- Consumes: G3 endpoints, K1.
- Produces: `registerPush(): Promise<string | null>` (needs permission, creates channels `jobs` and `tonight`, gets the Expo token with `projectId`, POSTs gen with `device_id` from the existing device id). `unregisterPush(): Promise<void>` (gen DELETE plus kjbox DELETE when in a night) runs **before** `signOut` clears the session. `askPushPermissionInContext(where: 'make' | 'night'): Promise<boolean>` asks at most once per `where` per install (MMKV flag).

- [ ] **Step 1:** Tests: `register posts token with device id`, `no permission → no request`, `unregister runs before session cleared on sign-out`, `asks once per context`, `handler suppresses tonight push while Tonight focused`, `tap routing still handles reminder data.url`, and an appConfig test for `aps-environment` present by default and stripped with `EXPO_PUBLIC_PUSH=0`.
- [ ] **Step 2–4:** run (FAIL) → implement → `pnpm test && pnpm typecheck && pnpm lint` (PASS).
- [ ] **Step 5: Commit** `feat(push): Expo push registration, in-context permission, foreground handler`.

### Task M3: Notifications settings screen

**Files:**
- Create: `apps/mobile/src/app/me/notifications.tsx`, `apps/mobile/src/notifications/usePushPrefs.ts`
- Modify: `apps/mobile/src/app/(tabs)/me.tsx` (add an "Account and notifications" row above Sign out; message `nomadkaraoke-36` first), i18n
- Test: `apps/mobile/src/__tests__/notificationsScreen.test.tsx`

**Interfaces:** Toggles have testIDs `notif-ready`, `notif-review`, `notif-problems`, `notif-night`. gen prefs go through `PATCH /api/users/me/push-prefs` (optimistic, revert on error). `nightAlerts` lives in MMKV (default true): off → `deleteKjboxPushToken`. When OS permission is denied, a banner with `notif-open-settings` calls `Linking.openSettings()`.

- [ ] **Step 1–4:** tests (toggle patches, revert on error, night toggle unregisters, denied banner) → FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(me): notification settings`.

### Task M4: Account screen and delete-account flow

**Files:**
- Create: `apps/mobile/src/app/me/account.tsx`, `apps/mobile/src/app/me/delete-account.tsx`, `apps/mobile/src/account/deleteAccount.ts`, `apps/mobile/src/account/wipeLocal.ts`
- Modify: `apps/mobile/src/auth/store.ts` (export a `signOutAndWipe()` used by deletion), `packages/api-gen` facades (`getDeletionPreview`, `deleteMyAccount`), i18n
- Test: `apps/mobile/src/__tests__/deleteAccount.test.tsx`, `apps/mobile/src/account/__tests__/wipeLocal.test.ts`

**Interfaces:**
- Consumes: G4 endpoints, G1 capabilities, M1 `logOut`, M2 `unregisterPush`, 3d `deleteMyRecordings` local part (`recordingQueue.clearAll()`).
- Produces: `deleteAccount(opts: {appleAuthorizationCode?: string}): Promise<{ok: true} | {ok: false, reason: 'blocked', code: string} | {ok: false, reason: 'retry'}>`. `wipeLocal(): Promise<void>` runs every `useAuth.subscribe` cleanup (Discover, importQueue, Tonight log, outbox, nightStore), `recordingQueue.clearAll()`, `Purchases.logOut`, `posthog.reset()`, then `storage.clearAll()` on every MMKV instance, then SecureStore session delete.
- Screens: the Account row is visible only when `capabilities.account_deletion`. The delete screen shows the preview (credits lost, jobs cancelled, kept data). Its confirm button `delete-account-confirm` triggers Apple re-auth on iOS when the account signed in with Apple (`expo-apple-authentication` `signInAsync` → `authorizationCode`; the user cancelling aborts). On 200 → `wipeLocal()` → `router.replace('/')` with a one-shot "Your account was deleted" notice. On 409 → support copy and `mailto:`. On 503 or network error → a "Couldn't delete, try again" message with no local wipe.

- [ ] **Step 1:** Tests: `confirm shows credits and jobs counts`, `success wipes then signs out`, `503 keeps local data and offers retry`, `offline keeps local data`, `409 shows support`, `apple user on iOS passes authorization code`, `apple cancel aborts`, `row hidden without capability`, and for wipeLocal: `clears every store and queue`.
- [ ] **Step 2–4:** FAIL → implement → `pnpm test && pnpm typecheck && pnpm lint && pnpm i18n:check` (PASS).
- [ ] **Step 5: Commit** `feat(account): delete account from the app`.

### Task M5: Sentry and PostHog

**Files:**
- Modify: `apps/mobile/app.json`/`app.config.ts` (`@sentry/react-native/expo` plugin with `organization: "nomad-karaoke"`, `project: "mobile"`), `apps/mobile/metro.config.js` (Sentry metro serializer per the SDK 57 docs), `apps/mobile/src/observability.ts` (`Sentry.wrap` export, `setObservabilityUser(appUserId | null)`, `track(event: AppEvent, props?: Record<string, string|number|boolean>)`), `apps/mobile/src/app/_layout.tsx` (wrap), call sites for the ten events
- Test: `apps/mobile/src/__tests__/observability.test.ts`

**Interfaces:** `type AppEvent = 'app_opened'|'signed_in'|'make_started'|'purchase_started'|'purchase_completed'|'review_submitted'|'night_joined'|'song_requested'|'recs_viewed'|'voice_test_completed'`. PostHog init sets `disableSessionReplay: true` and `captureAppLifecycleEvents: false`, and autocapture stays off. Sentry init sets `sendDefaultPii: false`, `tracesSampleRate: 0.1`, `environment` from `Updates.channel ?? 'development'`.

- [ ] **Step 1:** Tests: `inert without env`, `track forwards known events only` (type-level, plus a runtime guard dropping unknown names), `user set to app_user_id, never email`, `reset on sign-out`.
- [ ] **Step 2–4:** FAIL → `npx expo install @sentry/react-native` (already a dep; check the version) → implement → PASS.
- [ ] **Step 5: Commit** `feat(observability): Sentry release config and PostHog events`.

### Task M6: Native config, EAS project, expo-updates, blocked permissions

**Files:**
- Modify: `apps/mobile/app.config.ts` (`android.blockedPermissions: ["android.permission.READ_MEDIA_VIDEO","android.permission.READ_MEDIA_IMAGES","android.permission.READ_MEDIA_AUDIO","android.permission.READ_EXTERNAL_STORAGE"]`; `runtimeVersion: {policy: "fingerprint"}`; `updates.url: "https://u.expo.dev/<projectId>"`; `owner: "nomadkaraoke"`), `apps/mobile/app.json` (remove the duplicate `expo-secure-store`/`expo-localization` plugin entries), `apps/mobile/eas.json` (per-profile `env`: prod URLs, `EXPO_PUBLIC_ASSOCIATED_DOMAINS=1` and push on for preview/production, `EXPO_PUBLIC_PUSH=0` and fakes for e2e-test, the RevenueCat/Sentry/PostHog public keys), language change handler (`src/locale.ts` or the language screen: on RTL flip call `Updates.reloadAsync()` when `Updates.isEnabled`, else today's "applies next launch" message), `appConfig.test.ts`, CLAUDE.md "Deferred" notes
- Test: `apps/mobile/src/__tests__/appConfig.test.ts`, `apps/mobile/src/__tests__/rtlReload.test.ts`

- [ ] **Step 1:** Tests: `blocks READ_MEDIA_* and READ_EXTERNAL_STORAGE`, `RECORD_AUDIO and CAMERA still present`, `runtimeVersion fingerprint and updates url set when project id present`, `associated domains only with flag`, `RTL change reloads when updates enabled`.
- [ ] **Step 2:** `npx expo install expo-updates`, then implement.
- [ ] **Step 3:** `npx expo prebuild --clean -p android` and check that `android/app/src/main/AndroidManifest.xml` has no `READ_MEDIA_*` (expect `tools:node="remove"` entries). Build a release APK and save a video to the gallery on the emulator (it must succeed with no permission prompt).
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && npx expo-doctor`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(release): EAS project, expo-updates, blocked media permissions`.

### Task M7: Maestro flows and the E2E harness

**Files:**
- Create: `maestro/flows/purchase-1-iap.yaml`, `purchase-2-web-link.yaml`, `account-1-delete.yaml`, `notify-1-settings-and-job-push.yaml`, `notify-2-night-up-next.yaml`
- Modify: `scripts/e2e-local.sh` (Metro env `EXPO_PUBLIC_FAKE_IAP=1`, `EXPO_PUBLIC_PUSH=0`; reset the gen and kjbox push outboxes), `maestro/scripts/stack.js` (`ACTION: push-outbox` with `SOURCE: gen|kjbox`, `EXPECT_URL`, `EXPECT_KIND`; `ACTION: credits` asserting the balance; `ACTION: user-exists` asserting the gen user is gone), CLAUDE.md E2E section

Flow contents:
- **purchase-1:** a fresh user with 0 credits → credits screen → buy `nomad_credits_3` → balance 3 (assert via UI and `stack.js credits`).
- **purchase-2:** storefront `USA` (default) on iOS → web link visible (Android: hidden). With `EXPO_PUBLIC_FAKE_STOREFRONT=GBR` this is a separate Metro run, so instead **unit-test** the GBR case and keep the flow to USA.
- **account-1:** a user with 2 credits → Me → Account → Delete → sees "2 credits will be lost" → confirm → signed-out notice → `stack.js user-exists` false → signing in again with the same email creates a fresh account with no welcome credit.
- **notify-1:** toggles persist across a relaunch. Turning `Video ready` off then completing a job writes no `ready` push. Turning it on → a `ready` push in the gen outbox with `data.url /job/<id>`.
- **notify-2:** join night 2121, request, advance so the singer is next → the kjbox outbox has `up_next` with url `/tonight`.

- [ ] **Step 1:** Write the flows.
- [ ] **Step 2:** `scripts/e2e-local.sh --platform ios purchase && … account && … notify` (gen worktree via `GEN_DIR`, kjbox worktree via `KJBOX_DIR`). Expected: 5/5.
- [ ] **Step 3:** The same on Android (never concurrently with iOS). Expected: 5/5.
- [ ] **Step 4:** Full-suite regression on both platforms. Record the pass counts in the PR, comparing against the 2026-10-23 baseline (iOS 37/39, Android 38/39 plus later phases' flows).
- [ ] **Step 5: Commit** `test(e2e): purchase, account deletion and notification flows`.

## Part R: release ops (checklist tasks; each records its results in `docs/RELEASE.md`)

### Task R1: Android release signing and fingerprints
- [ ] Run `eas credentials` (Android, production) to generate the EAS-managed upload keystore. Download a copy outside git and note its path in RELEASE.md. Record the upload key SHA-1 and SHA-256.
- [ ] Once the Play app exists, enable Play App Signing and record the app signing key SHA-1 and SHA-256.
- [ ] Create one Google OAuth **Android** client per key in GCP `nomadkaraoke` (package `com.nomadkaraoke.mobile`), via Andrew's signed-in console or `scripts/gcp-admin`. Record the client ids.
- [ ] kjbox.cc Worker: add both SHA-256s in gen `infrastructure/cloudflare/well_known.py` (worktree, PR with its test). After merge, from main: `pulumi preview` on `nomad-cloudflare` targeted to the Worker, check zero deletions, then `pulumi up --target`. Confirm `curl https://kjbox.cc/.well-known/assetlinks.json` lists them, and that `/.well-known/apple-app-site-association` is served (fix the redirect exclusion if not).
- [ ] Box config (NomadPC): ask Andrew. Then back up `config.json`, append both SHA-256s to `app_android_sha256_fingerprints`, and restart kj-controller outside a night. Confirm `https://sing.nomadkaraoke.com/.well-known/assetlinks.json`. Record it in kjbox `docs/CHANGELOG.md`.
- [ ] Update CLAUDE.md "App identity" with the new client ids and fingerprints.

### Task R2: iOS associated domains on the iPad
- [ ] Take the iPad lock. Build a team-signed Release with `EXPO_PUBLIC_ASSOCIATED_DOMAINS=1` (`xcodebuild … DEVELOPMENT_TEAM=55B76HN73D -allowProvisioningUpdates`) and install it with `xcrun devicectl device install app`.
- [ ] Open `https://kjbox.cc/2121` and `https://sing.nomadkaraoke.com/?t=2121` on the iPad. Launch with `xcrun devicectl device process launch --payload-url https://kjbox.cc/2121 com.nomadkaraoke.mobile` if Safari can't be driven. Screenshot with `pymobiledevice3 developer dvt screenshot`; the app should open into Tonight. Save the screenshots to `docs/screenshots/phase6/ipad/`.
- [ ] Release the lock. If it can't be checked without a tap, add it to the manual-pass list.

### Task R3: Store documents (`docs/store/`)
- [ ] `listing.md` (spec §9 fields, English), `privacy-inventory.md` (the spec §9 table, with each row's answer for Apple labels and Play data safety; confirm location and screenshot retention by reading the code), `age-rating.md` (questionnaire answers), `review-notes.md` (demo account steps, sandbox purchase, Nomad night video placeholder, deletion path), `fees.md` (Apple SBP 15%, Google 15% on the first $1M; US link rules with sources and dates).
- [ ] Privacy policy check: compare nomadkaraoke.com's policy (public-website repo) against the inventory. Draft any missing sections in `docs/store/privacy-policy-additions.md` for Andrew.
- [ ] **Google US external-link research** (spec §2): Play's current US policy for links to outside payments (programs, fees, enrolment). Put it in `fees.md` with sources and bring Andrew the numbers to decide `show_for.android`.

### Task R4: Store screenshots
- [ ] (Roadmap change 2026-10-26: Phase 7 "UX review and polish" runs before Andrew's manual pass, so final screenshots and visual listing copy are placeholders here. Build the pipeline so it can be re-run after Phase 7: `maestro/screens/store-tour.yaml` + a script (`scripts/store-screenshots.sh`) that runs the tour per device size and writes `docs/store/screenshots/<device>/`; commit placeholder output.)
- [ ] Add `maestro/screens/store-tour.yaml` covering Discover picks, the song page with fit badge, the Make progress list, the review screen, Tonight at a night, and Me. Run it on iPhone 17 Pro Max (6.9"), an iPad 13" simulator and the Android Pixel AVD, in English, against the seeded local stacks. Shots go in `docs/store/screenshots/<device>/`.

### Task R5: Test builds
- [ ] When the Expo project id exists: `eas build -p ios --profile production` and `-p android --profile production` (falling back to `--local` if the free queue is slow). Upload with `eas submit` to TestFlight (internal group with Andrew) and to the Play internal testing track (once the Play account exists). Record the build numbers. Nothing goes to external testing, production or review.
- [ ] Upload Sentry source maps and dSYMs from these builds and confirm a test error from the preview build shows symbolicated.

### Task R6: Docs, memory, wrap-up
- [ ] Update `CLAUDE.md` (status, Phase 6 workspace notes, gotchas found, "Deferred" section cleanup), `docs/VISION.md` roadmap row 6 (built; publish pending), `docs/RELEASE.md` complete.
- [ ] Add the spec §11 list to memory `project_nomad_mobile_app` (the manual-pass list), plus anything only a human can check that came up during the build.
- [ ] Mobile PR (M1–M7 + docs): `/coderabbit`, then a final whole-branch review on the most capable model across all four repos' diffs. Open the PR, message `nomadkaraoke-12`, and message `nomadkaraoke-36` and `nomadkaraoke-72` before merging shared files. Merge.
- [ ] Session record `docs/sessions/2026-Q4/2026-10-25-mobile-phase6-release-readiness.md` (workspace root), and a BACKLOG 4.6 status update.

## Execution order

G1 → G2 → G3 → G5 → G4 → G6 → G7 (gen PR) ∥ D1 → D2 (decide PR) → K1 → K2 (kjbox PR, after gen deploy) → M6 → M5 → M1 → M2 → M3 → M4 → M7 (mobile PR). R1–R5 run whenever their accounts exist; R3/R4 can run any time after M6.
