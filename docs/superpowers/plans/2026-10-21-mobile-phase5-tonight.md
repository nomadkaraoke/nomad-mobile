# Phase 5 "Tonight" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in Tonight tab in the Nomad Karaoke app that does everything sing.nomadkaraoke.com does at Andrew's nights, logs every sung song (at Nomad nights and any other bar) with an optional post-song survey to decide, and lets web singers claim their night.

**Architecture:** kjbox gains a versioned `/api/v1/` JSON layer that authenticates with the gen session token, derives a device identity from the gen email, checks ownership server-side and **delegates to the existing `/sing/*` view functions** so behaviour can't drift; a SQLite outbox on the box pushes Done entries to a new decide `karaoke_log` API. The app adds `packages/api-kjbox` (generated from kjbox's committed OpenAPI) and `apps/mobile/src/tonight/`, with a local-first log + outbox to decide.

**Tech Stack:** kjbox: Python 3.11 Flask, SQLite, pytest (`jsonschema` for contract tests). decide: FastAPI, Firestore, pytest. gen: local stack only. Cloudflare: Pulumi (`nomad-cloudflare`). Mobile: Expo SDK 57, Expo Router, TanStack Query 5, Zustand 5 + MMKV, `@hey-api/openapi-ts` 0.99.0, jest-expo + RNTL 13, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-21-mobile-phase5-tonight-design.md` (this repo). Section refs "§x" are the spec's; "A.n" are its Appendix A learnings. Read both.

**Repos / worktrees:** kjbox `../kjbox-singer-app-api` (branch `feat/sess-20261021-1515-singer-app-api`), nomad-mobile `../nomad-mobile-phase5-tonight` (branch `feat/sess-20261021-1515-phase5-tonight`). Create decide and gen worktrees with `/startnomad decide phase5-karaoke-log` and `/startnomad gen localstack-kjbox` when Parts B and C start.

## Global Constraints

- kjbox `/sing/*` endpoints stay byte-compatible; every existing kjbox test passes untouched (run `cd kj-controller && pytest` before every kjbox merge; CI doesn't run it).
- Every v1 response carries `"api_version": "1.0"` (minor bumps on additive changes); errors are `{"error": <code>, "message"?: str, "retry_after"?: int}`.
- v1 error code enum (closed; contract + app copy must list exactly these): `unauthenticated, gen_unavailable, not_open, night_changed, needs_name, not_found, not_owner, already_sung, on_stage, rate_limited, invalid, kj_pick_too_large, make_disabled, youtube_blocked, gen_rejected, already_generating, busy_retry, conflict, internal`.
- Identity: `app_device_id = hmac_sha256(app_identity_secret, "app:" + email.strip().lower()).hexdigest()[:32]` (secret: 32 random bytes persisted on the box, ruling A7-R5, so the id cannot be derived from an email).
- `night_id = sha256(f"{box_id}:{night_started_at}").hexdigest()[:16]`; config `box_id` default `"nomadpc"`.
- `history_id = "kj_" + sha256(f"{box_id}:{entry_id}:{email}").hexdigest()[:24]`.
- Gen token cache: 60 s positive / 10 s negative, keyed by `sha256(token)`; the raw token is never stored, logged or recorded by the ActionRecorder (redact `Authorization`).
- Singer copy says "host", never "KJ"; whole sentences with placeholders; 33 locales (app: `pnpm i18n:translate`; kjbox web: `static-sing/messages`).
- No `@shopify/*` imports outside `packages/ui`; `testID` on every interactive element; no hardcoded user-facing strings; screen tests in `apps/mobile/src/__tests__/` (never under `src/app`).
- Mobile local hosts only via the `config.ts` allowlist; prod defaults: kjbox `https://sing.nomadkaraoke.com`.
- Local stack ports: gen 8010/3010, decide search 8020, decide API 8030, **kjbox 8040**; event code `2121`.
- decide song identity: `song_key` (search service key) + denormalised artist/title. `user_songs` row (agreed with Phase 3, owner of the schema): if `CatalogReader.kn_ids_for_song_keys` maps the key to a kn_id **and** `user_songs/{user_id}:{kn_id}` exists, update that row; otherwise use `loved_doc_id(user_id, song_key)` imported from `backend/services/song_feedback_service.py` (never copied). New writes always carry `song_key`, `artist`, `title`; timestamps are ISO strings. Recs-v2 scoring on `times_sung`/survey is deferred to Phase 4.
- No accounts or spend. GCP writes (secret) via Andrew's `/gcp-admin`; Cloudflare via Pulumi local apply; record infra changes in the repo's infra doc.
- Coordination: message `nomadkaraoke-5a` + `nomadkaraoke-12` before merging any nomad-mobile shared file (i18n, `_layout.tsx`, `app.config.ts`/`app.json`, `song/[id].tsx`, `+native-intent.tsx`, `e2e-local.sh`, `stack.js`, package.json/lock, VISION.md); Phase 3 merges first.

## Review Focus

1. **Another person signs into the same phone mid-night** → the app must drop the previous account's night, log and outbox (never show or sync them under the new account). Test: E2 `nightStore resets on account change`, E8 `log outbox is per user`.
2. **The box starts a new night while the app still holds yesterday's** (same event code, A.89) → app shows the empty/join state and never yesterday's songs. Tests: A3 `test_v1_night_changed_returns_409`, E4 `night screen leaves when night_id changes`.
3. **A request retried after a timeout** → exactly one request and one rotation entry. Tests: A4 `test_submit_idempotent_on_client_request_id` (incl. after a simulated restart), E5 `retry reuses client_request_id`.
4. **Host marks Done, undoes it, marks Done again** → one decide record, final state sung; delete on undo. Test: A8 `test_done_undo_redo_single_record`.
5. **Duet where both singers use the app, and a friend song** → each linked singer gets their own record; the requester of a friend song gets none. Test: A8 `test_duet_and_friend_attribution`.

---

## Part A — kjbox (`kjbox-singer-app-api/kj-controller`)

### Task A1: Storage for accounts, idempotency, outbox, Expo push

**Files:**
- Modify: `sing_store.py` (schema in the `CREATE TABLE` block near :110 and its migration list), `config.py` (defaults near :119-139)
- Test: `tests/unit/test_sing_store_app.py`

**Interfaces — Produces (SingStore methods):**
- `link_account(device_id: str, gen_email: str, origin: Literal['app','web'], night_started_at: str) -> None` (upsert)
- `unlink_account(device_id: str, night_started_at: str) -> None`
- `account_devices(gen_email: str, night_started_at: str) -> list[str]` (all devices linked tonight, app + web)
- `account_for_device(device_id: str, night_started_at: str) -> str | None` (email)
- `idempotent_get(key: str) -> dict | None`, `idempotent_put(key: str, response: dict, ttl_s: int = 86400) -> None` (table `app_idempotency(key PK, response_json, expires_at)`)
- `outbox_enqueue(history_id: str, op: Literal['put','delete'], payload: dict) -> bool` (INSERT OR REPLACE when op differs from pending row, else no-op; returns whether changed), `outbox_due(now: datetime, limit: int = 20) -> list[dict]`, `outbox_mark_sent(history_id)`, `outbox_mark_failed(history_id, error: str, next_attempt_at: datetime, permanent: bool)`, `outbox_sent_ids_for_night(night_started_at) -> set[str]`
- `sing_push_subscriptions` gains columns `kind TEXT DEFAULT 'webpush'`, `expo_token TEXT`; `add_expo_subscription(device_id, expo_token, platform)`.
- Config defaults: `box_id="nomadpc"`, `decide_api_url=""`, `decide_kjbox_secret=""`, `history_outbox_interval_s=20`.

- [ ] **Step 1: Write failing tests** — `test_link_and_lookup_devices_scoped_to_night` (link app + web device for `a@x.com` night N → `account_devices` returns both; night N2 returns `[]`), `test_unlink`, `test_idempotency_roundtrip_and_expiry`, `test_outbox_enqueue_put_then_delete_replaces_pending`, `test_outbox_enqueue_same_op_is_noop`, `test_outbox_due_respects_next_attempt`, `test_expo_subscription_columns_migrate_existing_db` (create DB with old schema, open with new SingStore, column exists).
- [ ] **Step 2: Run** `pytest tests/unit/test_sing_store_app.py -v` → FAIL (missing methods).
- [ ] **Step 3: Implement** tables `singer_accounts(device_id, gen_email, origin, night_started_at, linked_at, PRIMARY KEY(device_id, night_started_at))`, `app_idempotency`, `history_outbox(history_id PK, op, payload_json, state pending|sent|failed, attempts, next_attempt_at, last_error, night_started_at, created_at, updated_at)` with the store's existing migration style.
- [ ] **Step 4: Run** the new tests + `pytest tests/unit/test_sing_store.py` → PASS.
- [ ] **Step 5: Commit** `feat(sing): storage for app accounts, idempotency, history outbox, expo push`.

### Task A2: Gen token verification and app identity

**Files:**
- Create: `app_identity.py`
- Modify: `gen_client.py` (add `get_me(session_token) -> dict` calling `GET /api/users/me` through `_singer_call`)
- Test: `tests/unit/test_app_identity.py`

**Interfaces — Produces:**
- `@dataclass(frozen=True) class AppUser: email: str; display_name: str | None; device_id: str`
- `app_device_id(email: str) -> str`
- `class GenTokenVerifier: __init__(gen_client, clock=time.monotonic); verify(token: str) -> AppUser` raising `AppAuthError(code='unauthenticated')` on gen 401/403 and `AppAuthError(code='gen_unavailable')` on network/5xx. Cache per Global Constraints; bounded to 1000 entries (LRU).
- `suggested_name(user: AppUser) -> str` (first word of gen `display_name`, else email local part with `.`/`_` → space, title-cased, max 40 chars).

- [ ] **Step 1: Failing tests** — `test_device_id_is_32_hex_and_case_insensitive`, `test_verify_caches_positive_60s` (fake clock: 2 calls → 1 gen call; at 61 s → 2), `test_verify_caches_negative_10s`, `test_gen_down_raises_gen_unavailable_not_cached`, `test_token_never_in_repr_or_logs` (caplog contains no token), `test_suggested_name_cases` (`"Jane Doe"`→`Jane`; `jane.doe@x.com`→`Jane Doe`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** gen's `/api/users/me` response field names: check `karaoke-gen/backend/api/routes/users.py` and use its email + display name fields.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sing): verify gen session tokens for the app API`.

### Task A3: v1 blueprint, auth, night scoping, contract harness, `/night` and `/join`

**Files:**
- Create: `sing_api_v1.py`, `docs/api/singer-v1.openapi.json`, `tests/integration/test_sing_api_v1_night.py`, `tests/integration/v1_contract.py`
- Modify: `app.py` (register blueprint under `/sing/api/v1`, construct `GenTokenVerifier` as `app.gen_verifier`), `sing.py` host guard (allow `/sing/api/v1/` and `/sing/.well-known/`), `action_recorder.py` (redact `Authorization`), `requirements-dev.txt` (`jsonschema`)

**Interfaces:**
- Consumes: A1 store methods, A2 `GenTokenVerifier`.
- Produces: decorator `@app_auth` that sets `g.app_user: AppUser`, `g.night_started_at: str`, `g.night_id: str`, `g.account_devices: list[str]` (calls `link_account(app_device_id,'app')` on first call per night); helper `v1_error(code: str, status: int, message: str | None = None, retry_after: int | None = None)`; `v1_json(payload: dict, status=200)` adding `api_version`; `night_id_for(store, cfg) -> str | None`. Optional request header/param `night_id`: when sent and different from the current one → 409 `night_changed`.
- Test helper: `assert_matches_contract(resp, operation_id)` in `tests/integration/v1_contract.py` (loads the OpenAPI JSON, validates status + body with jsonschema). Test fixture `app_token(sing_app, monkeypatch)` that stubs `gen_client.get_me` for a given email.
- Endpoints: `GET /night` (spec §5.3 shape; `open:false` + `not_open` fields when token disabled), `POST /join {name}` (sets alias origin `self` via `store.set_alias`; returns `{me:{name}}`); missing alias → `GET /night` includes `needs_name: true, suggested_name`.

- [ ] **Step 1: Failing tests** — `test_v1_requires_bearer` (401 `unauthenticated`), `test_v1_gen_down_503`, `test_v1_bad_event_code_403_not_open`, `test_v1_night_payload_matches_contract`, `test_v1_night_changed_returns_409`, `test_join_sets_alias_and_links_account`, `test_needs_name_until_join`, `test_v1_reachable_on_public_host` (Host `sing.nomadkaraoke.com`, path `/api/v1/night` → 200 via the rewriter), `test_authorization_header_redacted_in_action_log`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** blueprint + contract file (OpenAPI 3.1, `components/schemas` for every body used so far; `ErrorCode` enum = Global Constraints list).
- [ ] **Step 4: Run** new tests + `pytest tests/integration/test_host_guard.py tests/integration/test_sing_public_routes.py` → PASS.
- [ ] **Step 5: Commit** `feat(sing): /api/v1 blueprint with gen auth, night scoping, contract tests`.

### Task A4: Requests — submit, cancel, change, reorder, per-song consent

**Files:**
- Modify: `sing_api_v1.py`, `docs/api/singer-v1.openapi.json`
- Create: `tests/integration/test_sing_api_v1_requests.py`

**Interfaces:**
- Produces: `delegate(view_fn, *, method: str, path: str, json: dict | None = None, args: dict | None = None) -> tuple[dict, int]` — runs an existing `/sing/*` view inside `current_app.test_request_context(...)` with the original client IP (`environ_base={'REMOTE_ADDR': '127.0.0.1'}` + `CF-Connecting-IP` header copied from the outer request), injecting `t`, `device_id` (= the request's owning device for mutations, else `g.app_user.device_id`) and, for edit-token-gated views, the request's stored `edit_token` read server-side. Returns (body, status) for reshaping. *(Plan decision: delegation instead of refactoring the 5k-line `sing.py`; same no-drift guarantee, lower live-show risk.)*
- Produces: `owned_request_or_error(req_id: int) -> dict | Response` — 404 if missing/not tonight, 403 `not_owner` unless `req['device_id'] in g.account_devices`.
- Endpoints: `POST /requests` (body: web `/submit` fields minus `device_id`/`singer_name`, plus `client_request_id` (uuid, required), `for_friend`, `friend_name`; singer name = alias or 400 `needs_name`; idempotency via `idempotent_get/put` keyed `f"{device_id}:{client_request_id}"`); `POST /requests/<id>/cancel`; `POST /requests/<id>/change`; `POST /requests/reorder {items:[{id}|{entry_id}]}`; `PUT /requests/<id>/consent {consent: 'yes'|'no'|null}`. Map web error strings to the v1 enum (`already_sung`, `on_stage`, `kj_pick_too_large`, `make_disabled`, 429 → `rate_limited` with `retry_after`).

- [ ] **Step 1: Failing tests** — `test_submit_uses_alias_and_app_device`, `test_submit_idempotent_on_client_request_id` (same key twice → same request id, one row; also after clearing in-memory rate-limit state to simulate a restart), `test_submit_needs_name_before_join`, `test_cancel_own_request`, `test_cancel_other_device_403_not_owner`, `test_cancel_linked_web_device_request_allowed` (web device linked via A1 for same email), `test_change_keeps_slot`, `test_change_into_make_rejected`, `test_reorder_own_and_identity_entries`, `test_cancel_already_sung_409`, `test_kj_pick_over_50_trimmed`, `test_400_refunds_device_slot`, `test_friend_song_keeps_owner_device_and_friend_name`, all with `assert_matches_contract`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + `pytest tests/integration/test_sing_*.py` → PASS.
- [ ] **Step 5: Commit** `feat(sing): v1 request endpoints with server-side ownership and idempotency`.

### Task A5: `/me` and `PUT /me`

**Files:** Modify `sing_api_v1.py`, contract; Create `tests/integration/test_sing_api_v1_me.py`

**Interfaces:**
- `GET /me` → `{me:{name, phone, photo_consent, instagram}, songs:[Song], next:{entry_id, position, eta_s, range_low_s, range_high_s}|null, sung_tonight:[Song], unlinked_identity_entries: int}`. `Song` = the web `/my-requests` item (built by calling the same helpers `my_requests()` uses, via `delegate` with the request ids owned by `g.account_devices` tonight — never client-supplied ids) + `owner: 'me'|'friend'|'host'|'partner'`, `history_id` (Global Constraints formula, only for `performed`). Order by `_activeSortKey` semantics (A.49).
- `PUT /me {name?, phone?, photo_consent?, instagram?, confirm_rename?: bool}` → rename via delegated `/sing/rename` over all owned non-friend items; if the first name changes and own songs are queued and `confirm_rename` isn't true → 409 `conflict` with `{reason:'rename_guard', from, to}` (A.11). Phone → `/sing/update-phone`; consent → `/sing/photo-consent`.

- [ ] **Step 1: Failing tests** — `test_me_lists_owned_host_and_partner_songs`, `test_me_never_lists_other_devices_songs`, `test_me_excludes_previous_night`, `test_me_sung_have_history_id`, `test_me_friend_songs_marked_and_excluded_from_next` (fixes A.13), `test_rename_guard_conflict_then_confirm`, `test_rename_does_not_touch_done_entries`, `test_phone_update_applies_to_owned_requests`, `test_unlinked_identity_entries_counted`.
- [ ] **Steps 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(sing): v1 /me with linked-device songs and rename guard`.

### Task A6: Read endpoints — search, singers, rotation (ETag), now, preview, tips, stats, event info

**Files:** Modify `sing_api_v1.py`, contract; Create `tests/integration/test_sing_api_v1_read.py`

**Interfaces:** `GET /search`, `/search/identify`, `/search/resolve`, `POST /search/event`, `GET /singers`, `GET /rotation` (ETag `"<rotation_rev>"`; `If-None-Match` equal → 304, empty body), `GET /now`, `POST /preview/resolve` (returns absolute URLs on `request.host_url`), `POST /preview/close`, `GET /tips`, `POST /tips/claim`, `GET /my-stats` (top songs only, no name lookup). All delegate; `device_id` injected.

- [ ] **Step 1: Failing tests** — one contract test per endpoint, plus `test_rotation_etag_304`, `test_rotation_excludes_cancelled_from_now`, `test_search_not_open_maps_error`, `test_resolve_rate_limited_per_app_device`, `test_preview_urls_absolute_on_public_host`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(sing): v1 read endpoints`.

### Task A7: Make on the spot with the app's gen token

**Files:** Modify `sing_make.py` (add `_gen_account(store, device_id) -> dict | None`, used at every `store.get_gen_account(...)` call site in this file: :111, :150, :367, :452), `sing_api_v1.py`, contract; Create `tests/integration/test_sing_api_v1_make.py`

**Interfaces:** `_gen_account` returns `g.app_gen_account` (`{"email", "session_token"}`, set by `@app_auth` from the bearer) when `device_id == g.app_user.device_id`, else the stored account. v1: `POST /make/check`, `/make/search`, `/make/validate-url`, `/make/use-quick/<id>`; submit is `POST /requests` with `source_type:'make'` (A4). Errors → `youtube_blocked|gen_rejected|already_generating|busy_retry|make_disabled`.

- [ ] **Step 1: Failing tests** — `test_make_search_forwards_bearer_not_stored` (no `sing_gen_accounts` row afterwards; gen client called with the bearer), `test_make_submit_creates_being_made_entry`, `test_make_hidden_when_disabled_or_simple_mode`, `test_youtube_blocked_maps`, `test_use_quick_requires_ownership`, `test_web_make_flow_unchanged` (existing `tests/integration/test_sing_make_auto_flow.py` still passes).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(sing): v1 make-it with the app's gen account`.

### Task A8: History outbox (kjbox → decide)

**Files:** Create `history_outbox.py`, `tests/unit/test_history_outbox.py`; Modify `rotation.py` (`RotationManager.__init__` accepts `history_outbox=None`; `_after_mutation` calls `history_outbox.scan()` in a try/except like push), `app.py` (construct + start delivery thread), `stats_store.py` (add `first_play_started_at(entry_id: int) -> str | None`, UTC ISO)

**Interfaces — Produces:**
- `class HistoryOutbox: __init__(rotation_store, sing_store, stats_store, cfg, http_post=requests.post, clock=datetime.utcnow)`; `scan() -> int` (enqueued count); `deliver_due() -> int`; `start()` (daemon thread, `history_outbox_interval_s`).
- `build_records(entry: dict, night_started_at: str) -> list[tuple[str, dict]]` — one `(history_id, payload)` per linked singer on the entry: owner device's account (`account_for_device`) unless the request was `for_friend`; plus each member name (`_entry_members` + `_fold_name` from `sing.py`) whose device (alias tonight) is linked. Payload = spec §5.5 record; `sung_at` = `first_play_started_at` or `None` with `state:'sung_unplayed'`.
- scan: Done entries tonight → `outbox_enqueue(id,'put',payload)`; previously sent/pending `put` whose entry is no longer Done → `outbox_enqueue(id,'delete',{...})`.
- deliver: `PUT {decide_api_url}/api/partner/kjbox/karaoke-log/{history_id}` (or `DELETE`) with `X-Kjbox-Secret`; backoff `min(30*2**attempts, 1800)` s; 4xx (not 429) → permanent after 7 daily retries, logged at WARNING; inert (no HTTP) while `decide_api_url` or secret is empty.

- [ ] **Step 1: Failing tests** — `test_done_enqueues_one_record_per_linked_singer`, `test_unlinked_singer_not_enqueued`, `test_duet_and_friend_attribution` (Review Focus 5), `test_sung_at_is_play_start_not_done_at`, `test_done_without_play_is_sung_unplayed`, `test_done_undo_redo_single_record` (Review Focus 4), `test_delivery_backoff_and_permanent_failure`, `test_inert_without_config`, `test_scan_survives_restart` (new HistoryOutbox on same DB → no duplicates), `test_entry_id_reuse_across_nights_scoped` (A.15).
- [ ] **Steps 2–5:** FAIL → implement → PASS (+ `pytest tests/integration/test_rotation_routes.py`) → commit `feat(sing): history outbox sends sung songs to decide`.

### Task A9: Web claim — "Save tonight's songs to your Nomad account"

**Files:** Modify `sing_make.py` (routes `POST /sing/account/link {device_id}` → requires a stored gen account for the device, `link_account(...,'web')`, triggers `history_outbox.scan()`; `POST /sing/account/unlink {device_id}`; `GET /sing/make/account` gains `linked: bool`), `static-sing/sing.js` (link in Your songs + Sung tonight; offered after a make-it sign-in; "Stop saving"), `static-sing/messages/en.json` (+ translate all 33 with the kjbox i18n script), Create `tests/integration/test_sing_account_link.py`, `tests/e2e/test_sing_account_link.py` (Playwright)

**Copy (en):** link: "Save tonight's songs to your Nomad Karaoke account"; explainer: "We'll save the songs you sing tonight to your Nomad Karaoke account, so the app can show your history and recommend songs."; after linking: "Saving tonight's songs to {email}"; stop: "Stop saving".

- [ ] **Step 1: Failing tests** — `test_link_requires_signed_in_device`, `test_link_enqueues_already_sung_entries`, `test_make_sign_in_alone_does_not_link`, `test_unlink_stops_future_records`, e2e `test_link_flow_from_your_songs` (fake gen via the existing e2e fakes).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(sing): web singers can save tonight's songs to their account`.

### Task A10: Expo push channel and `POST /push-token`

**Files:** Modify `push_dispatcher.py` (send `kind='expo'` subscriptions to `https://exp.host/--/api/v2/push/send`, same steps + new `sung`), `sing_api_v1.py` (`POST /push-token {expo_push_token, platform}`), contract; Create `tests/unit/test_push_dispatcher_expo.py`

- [ ] **Step 1: Failing tests** — `test_expo_payload_shape` (`to`, `title`, `body`, `data:{step, request_id, night_id}`), `test_expo_and_webpush_dedup_per_step`, `test_expo_device_not_registered_disables_subscription` (Expo `DeviceNotRegistered` → row inactive), `test_push_token_endpoint_contract`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(sing): expo push channel ready for the app`.

### Task A11: App-link files

**Files:** Modify `sing.py` (routes `GET /sing/.well-known/assetlinks.json` and `/sing/.well-known/apple-app-site-association`, JSON, `Cache-Control: max-age=3600`), `config.py` (`app_android_sha256_fingerprints: list[str]` default = debug keystore SHA-256 — get it with `keytool -list -v -keystore apps/mobile/android/app/debug.keystore -storepass android` in the mobile repo after `expo prebuild`, `app_ios_team_id="55B76HN73D"`, `app_bundle_id="com.nomadkaraoke.mobile"`); Create `tests/integration/test_well_known.py`

- [ ] **Step 1: Failing tests** — `test_assetlinks_json_on_public_host` (relation `delegate_permission/common.handle_all_urls`, package, fingerprints), `test_aasa_paths` (`/` with `?t=` component and `/*` for kjbox.cc parity), `test_well_known_404_on_kj_host_unaffected`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(sing): serve app-link association files`.

### Task A12: Local stack, test API, fixture, night replay

**Files:** Create `scripts/local-stack.sh` (`up|down|reset|status`; runs `python dev_server.py --db ~/kjdata-localstack/rotation.db --port 8040 --host 127.0.0.1 --no-player` with env `KJBOX_TEST_API=1`, `KJ_CONFIG_OVERRIDES` for gen 8010 + decide 8030 URLs and local secrets `local-stack-secret`), `sing_test_api.py` (blueprint `/sing/api/test/*`, registered only when `KJBOX_TEST_API=1` and bind host is loopback), `scripts/build_localstack_fixture.py`, `tests/fixtures/localstack/night.json`, `tests/integration/test_night_replay.py`, `tests/integration/test_sing_test_api.py`; Modify `dev_server.py` (flags `--port`, `--host`, `--no-player`, `--fixture PATH`; read `KJ_CONFIG_OVERRIDES` JSON)

**Test API (POST unless noted, JSON):** `/reset {fixture?:'default'}`, `/seed {singers:[{name, device_id?, songs:[{artist,title,source_type}]}]}`, `/advance` (next → Now Singing, records a play event), `/done {entry_id?}` (current → Done), `/undone {entry_id}`, `/flags {make?, simple_mode?, ask_photo_consent?, open?, auto_approve?}`, `/host-add {name, artist, title}`, `/host-remove {entry_id}`, `/rate-limits {per_device?, per_ip?}`, `/outbox/drain` → `{sent}`, `GET /state` → rotation + requests + outbox.

**Fixture:** built from `~/nomad-nights/2026-09-24/` via `night_fixture.py`; script asserts no phone/email/token patterns before writing; includes catalog rows for every fixture song (local, divebar, KN, community) + a song with >50 versions; event code `2121`. If the recording isn't on this Mac, build the same shape from `tests/fixtures/real_rotation_samples.json` and note it in TESTING.md.

- [ ] **Step 1: Failing tests** — `test_test_api_absent_without_env`, `test_test_api_refuses_non_loopback`, `test_fixture_has_no_pii`, `test_night_replay_through_v1` (replays the fixture's singer actions via v1 with stubbed gen identities; final rotation order and outbox records match the fixture's expected snapshot).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; then `scripts/local-stack.sh up && curl -s -H 'Authorization: Bearer <gen local token>' 'http://127.0.0.1:8040/sing/api/v1/night?t=2121'` → 200 JSON (with the gen local stack up).
- [ ] **Step 5: Commit** `feat(sing): local stack, test API and replayable fixture night`.

### Task A13: Docs, version, ship

- [ ] Update `docs/FUNCTIONALITY-MAP.md` (v1 + claim + outbox), `docs/ARCHITECTURE.md` (v1 section), `docs/TESTING.md` (local stack, test API, replay), `docs/CHANGELOG.md` (dated), `CLAUDE.md` (v1 rules: delegate, never store gen tokens), bump `pyproject.toml` minor.
- [ ] `pytest` (full) → PASS; `/coderabbit`; `/pr`; merge; wait for auto-deploy (~60 s).
- [ ] Prod check (§8.4): `GET https://sing.nomadkaraoke.com/api/v1/night?t=<code>` with a real gen token → 200 (or `not_open` when no night); `assetlinks.json` served; Playwright: web singer page loads, submits a test request named `zz-claude-test`, cancels it.
- [ ] Message `nomadkaraoke-12`: kjbox v1 live.

---

## Part B — gen local stack (`karaoke-gen-localstack-kjbox`)

### Task B1: kjbox partner secret and fake quick version in the local stack

**Files:** gen `scripts/local-stack.sh` (export the kjbox partner secret env `local-stack-secret`, same name gen reads in prod config), the fake workers module that `FAKE_WORKERS=1` uses (add a quick-version output after the fake audio step for kjbox-sourced jobs, so `/api/jobs/{id}/download-urls` lists `quick/video_mp4`), `docs/TESTING.md` § Local stack; tests next to the existing fake-worker tests.

- [ ] Failing test: `test_fake_workers_emit_quick_version_for_kjbox_jobs`; `test_kjbox_routes_accept_local_secret`.
- [ ] Implement → tests pass → gen version patch bump → PR → merge (no prod impact: local-stack only).

---

## Part C — decide karaoke log (`karaoke-decide-phase5-karaoke-log`)

### Task C1: Model and service

**Files:** Create `backend/services/karaoke_log_service.py`, `backend/models/karaoke_log.py`, `backend/tests/test_karaoke_log_service.py`

**Interfaces — Produces:**
- Pydantic `KaraokeLogEntry` (spec §7.1 fields; `song_key`, `song_key_status: Literal['resolved','unresolved','ambiguous']`, `source: Literal['kjbox','app']`, `state: Literal['planned','requested','sung','sung_unplayed','skipped']`, `survey: Survey | None` with `feel: Literal['great','ok','bad'] | None`, `key: Literal['too_low','right','too_high'] | None`, `crowd_pleaser: bool | None`, `notes: str | None` (≤ 2000 chars), `answered_at`).
- `class KaraokeLogService: upsert_user(user_id, entry_id, patch: dict) -> KaraokeLogEntry` (owner fields only: `survey`, `deleted`, and for `app_` ids all fields), `upsert_partner(email, entry_id, patch) -> KaraokeLogEntry` (kjbox-owned fields), `delete(...)`, `list_for_user(user_id, since, night_id, limit, cursor)`.
- Counters: on a transition into `sung`/`sung_unplayed` with `song_key_status=='resolved'` → the `user_songs` row chosen per Global Constraints: `times_sung += 1`, `last_sung_at = sung_at or ended_at` (ISO string), existing rows keep their `source`, create with `source:'karaoke_log'` if missing; reverse on delete or transition out. Unresolved → `user_karaoke_unresolved/{user_id}:{sha1(norm artist|title)[:24]}` counter doc.
- Resolution: `resolve(artist, title) -> (song_key|None, status)` via `CatalogLookup.match`; run inline best-effort with a 300 ms budget, else leave `unresolved` and enqueue a retry (Cloud Tasks pattern in `cloud_tasks_service.py`, or a periodic sweep in the existing weekly job — pick whichever exists for user data).

- [ ] Failing tests: `test_counter_updates_existing_kn_id_row` (quiz-created `{user_id}:{kn_id}` row gets `times_sung`, no new row), `test_counter_uses_loved_doc_id_when_no_kn_row`, `test_app_entry_upsert_idempotent`, `test_partner_and_user_fields_merge_either_order`, `test_user_cannot_overwrite_kjbox_facts`, `test_sung_increments_and_delete_decrements`, `test_redo_does_not_double_count`, `test_unresolved_counted_separately`, `test_notes_length_limit`.
- [ ] FAIL → implement → PASS → commit.

### Task C2: Routes (user + partner) and settings

**Files:** Create `backend/api/routes/karaoke_log.py` (user routes under `/my/karaoke-log`; partner under `/partner/kjbox/karaoke-log`), register in `backend/api/routes/__init__.py`; Modify settings (`decide_kjbox_secret` from env `DECIDE_KJBOX_SECRET`), `infrastructure/__main__.py` (Secret Manager secret `decide-kjbox-secret` + Cloud Run env binding; Andrew applies via `/gcp-admin`), `backend/api/routes/test_support.py` (local stack: `DECIDE_KJBOX_SECRET=local-stack-secret` default when `DECIDE_TEST_API=1`; `GET /api/test/karaoke-log?email=`), `docs/API.md`

**Routes:** `GET /api/my/karaoke-log?since&night_id&limit&cursor`, `PUT /api/my/karaoke-log/{id}`, `DELETE /api/my/karaoke-log/{id}`, `PUT|DELETE /api/partner/kjbox/karaoke-log/{id}` (`X-Kjbox-Secret`, compare_digest; 503 when unset).

- [ ] Failing tests: `test_routes_require_gen_token`, `test_partner_requires_secret`, `test_partner_creates_profile_for_new_email`, `test_list_paginates_newest_first`, `test_app_cannot_write_kj_prefixed_facts`.
- [ ] FAIL → implement → PASS → version bump → `/coderabbit` → PR → merge (Phase 3 agreed it can merge before its 3b; whoever merges second rebases) → prod check: unauthenticated 401; with a real gen token `GET` → 200 `[]`.
- [ ] Ask Andrew to run `/gcp-admin` for the secret; then (with his OK, it's a box state change) set `decide_api_url` + `decide_kjbox_secret` on NomadPC config and restart kj-controller; record in kjbox `docs/MINIPC-SETUP.md` + CHANGELOG; verify one outbox record delivers (test night or next real night).

---

## Part D — Cloudflare (karaoke-gen `infrastructure/cloudflare/`)

### Task D1: `kjbox.cc/.well-known/*`

- [ ] Add a Worker (`kjbox-cc-well-known`) serving `assetlinks.json` and `apple-app-site-association` (same JSON as A11; fingerprints from Pulumi config) on route `kjbox.cc/.well-known/*`; exclude `/.well-known/*` from the kjbox.cc → sing redirect rule.
- [ ] `pulumi preview` shows only these changes → `pulumi up` (local) → `curl -sI https://kjbox.cc/.well-known/assetlinks.json` 200 JSON and `curl -sI http://kjbox.cc/2121` still 302 → sing. Record in the stack README. Commit via PR in gen.

---

## Part E — nomad-mobile (`nomad-mobile-phase5-tonight`)

Start Part E's shared-file tasks (E3, E9, E11, E12) only after rebasing onto Phase 3's merge; E1–E2, E4–E8 and E10 live in Tonight's own modules and can start earlier.

### Task E1: `@nomad/api-kjbox`

**Files:** Create `packages/api-kjbox/` (mirror `packages/api-decide`: `package.json` `@nomad/api-kjbox`, `openapi-ts.config.ts`, `src/client` generated, `src/configure.ts`, `src/facades.ts`, `src/errors.ts`, `src/index.ts`, `src/__tests__/`), `openapi/kjbox.json` (copied from kjbox `docs/api/singer-v1.openapi.json`); Modify `scripts/fetch-openapi.mjs` (`kjbox` source: `KJBOX_OPENAPI_PATH` default `../kjbox/kj-controller/docs/api/singer-v1.openapi.json`), root `package.json` (`gen:api`/`gen:api:offline` include kjbox), `apps/mobile/src/config.ts` (`KJBOX_API_URL`, allowlisted like the others), `apps/mobile/src/api/setup.ts` (`configureKjbox({baseUrl, getToken, getLocale})`; a kjbox 401 never signs out).

**Interfaces — Produces:** facades `getNight(t, nightId?)`, `joinNight(t, name)`, `getMe(t, nightId)`, `updateMe(t, patch)`, `searchSongs(t, q, sid)`, `identify(t, q)`, `resolve(t, q)`, `submitRequest(t, body)`, `cancelRequest`, `changeRequest`, `reorder`, `setSongConsent`, `getRotation(t, etag?) -> {notModified: true} | {etag, data}`, `getNow`, `getSingers`, `previewResolve`, `previewClose`, `getTips`, `claimTip`, `getMyStats`, `makeCheck`, `makeSearch`, `makeValidateUrl`, `useQuick`; `class KjboxError extends Error { code: KjboxErrorCode; status: number; retryAfter?: number }`; `type KjboxErrorCode` = the Global Constraints enum.

- [ ] Failing tests (`packages/api-kjbox/src/__tests__/facades.test.ts`): `sends bearer and t`, `maps error body to KjboxError`, `rotation 304 → notModified`, `401 does not call onUnauthorized`.
- [ ] FAIL → `pnpm gen:api:offline` + implement → `pnpm test --filter api-kjbox` PASS → `pnpm typecheck` → commit.

### Task E2: Night store and link parsing

**Files:** Create `apps/mobile/src/tonight/links.ts`, `apps/mobile/src/tonight/nightStore.ts`, tests `apps/mobile/src/__tests__/tonight/links.test.ts`, `nightStore.test.ts`

**Interfaces — Produces:**
- `parseNightLink(input: string): {code: string} | null` — accepts `http(s)://kjbox.cc/<code>` (any case), `https://sing.nomadkaraoke.com/?t=<code>`, `nomadkaraoke://tonight?t=<code>`, or a bare 4–8 digit code.
- `useNightStore` (zustand + MMKV key `tonight.night.v1.<userKey>`): `{active: NomadNight | OtherNight | null; joinNomad(code, nightId, kjName); startOther(venueName?); end(); touch()}`; `NomadNight = {kind:'nomad', code, nightId, kjName, joinedAt}`; `OtherNight = {kind:'other', nightId: string /* uuid */, venueName?: string, startedAt, lastActivityAt}`; Other auto-ends 12 h after `lastActivityAt`. `userKey` = sha256 of the signed-in email; switching accounts swaps the store (Review Focus 1).

- [ ] Failing tests: link cases incl. `HTTP://KJBOX.CC/2121`; `other night auto-ends after 12h idle`; `nightStore resets on account change`.
- [ ] FAIL → implement → PASS → commit.

### Task E3: Getting in — empty state, scanner, code entry, deep links

**Files:** Modify `apps/mobile/src/app/(tabs)/tonight.tsx` (renders `TonightHome`), `apps/mobile/src/app/+native-intent.tsx` (`kjbox.cc`/`sing.nomadkaraoke.com`/`nomadkaraoke://tonight` → `/tonight/join?t=<code>`), `apps/mobile/app.json` / `app.config.ts` (Android intent filters with `autoVerify` for `kjbox.cc` http+https any path, `sing.nomadkaraoke.com` https path `/`; iOS `associatedDomains` only when `EXPO_PUBLIC_ASSOCIATED_DOMAINS=1`; camera permission text), `package.json` (`npx expo install expo-camera`); Create `apps/mobile/src/app/tonight/join.tsx`, `apps/mobile/src/app/tonight/scan.tsx`, `apps/mobile/src/tonight/TonightHome.tsx`, `apps/mobile/src/tonight/EmptyState.tsx`, `apps/mobile/src/tonight/CodeEntry.tsx`, tests `apps/mobile/src/__tests__/tonight/{emptyState,scan,join,nativeIntent}.test.tsx`

**Behaviour:** `join.tsx` requires sign-in (`openSignIn('/tonight/join?t=…')`), calls `getNight`; `needs_name` → name confirm sheet (prefilled `suggested_name`, testID `tonight-name-input`, `tonight-name-confirm`) → `joinNight` → `nightStore.joinNomad` → `router.replace('/tonight')`. Not open → closed state with the host's message. testIDs: `tonight-scan`, `tonight-enter-code`, `tonight-code-input`, `tonight-code-submit`, `tonight-start-other`.

- [ ] Failing tests for each screen state + `native intent maps kjbox.cc uppercase`.
- [ ] FAIL → implement → PASS → simulator screenshot of empty state, scanner and name confirm → commit.

### Task E4: Night home — status tile, Your songs, rotation, freshness, unreachable

**Files:** Create `apps/mobile/src/tonight/nomad/{NightScreen,StatusTile,YourSongs,SongRow,SungTonight,RotationList,Freshness,Unreachable,VenueInfo}.tsx`, `apps/mobile/src/tonight/nomad/queries.ts`, tests per component in `apps/mobile/src/__tests__/tonight/nomad/`

**Interfaces — Produces:** `useMe()` (TanStack Query, `refetchInterval` 15 s while focused + app active, keeps previous data, `night_changed` → `nightStore.end()`), `useRotation()` (30 s, ETag via `getRotation(etag)`, keeps last data on `notModified`), `useNow()`. Rows per spec §4.1 (owner labels, make phases, quick version actions, host-removed + Dismiss, ✓ Already sung collapsed). `Unreachable` per spec §4.2 (button opens `http://l.kjbox.cc/` via `Linking.openURL`; last-known songs read-only). Freshness label ticks every 5 s.

- [ ] Failing tests: `status tile urgent at <=3`, `your songs ordered by position`, `host-added and partner rows labelled`, `host-removed shows honest copy and dismiss`, `sung collapsed with count`, `night screen leaves when night_id changes` (Review Focus 2), `unreachable shows web fallback and keeps last songs`, `rotation keeps data on 304`, `unlinked identity hint shown only when count > 0`.
- [ ] FAIL → implement → PASS → screenshot → commit.

### Task E5: Request flow — search, versions, auto-correct, no-karaoke card, confirm, submit

**Files:** Create `apps/mobile/src/app/tonight/search.tsx`, `apps/mobile/src/app/tonight/confirm.tsx`, `apps/mobile/src/tonight/request/{useKjboxSearch.ts,ResultsList.tsx,VersionRow.tsx,VersionInfoSheet.tsx,CorrectionBanner.tsx,NoKaraokeCard.tsx,MakeBar.tsx,ConfirmCard.tsx,errorCopy.ts,requestStore.ts}`, tests in `apps/mobile/src/__tests__/tonight/request/`

**Interfaces — Produces:** `useKjboxSearch(q)` (300 ms debounce, generation guard: only the latest response renders, A.17; resolve only on empty results, A.29); `useListArm()` (300 ms after a list change taps are queued and replayed, not dropped); `requestStore` (zustand: `pending: {song, version | 'auto', mode: 'new'|'change'|'friend', replaces?, friendName?, clientRequestId}`; `clientRequestId` minted once per confirm and reused on retry; cleared when leaving search/confirm, A.39); `errorCopyKey(code: KjboxErrorCode): string` (i18n key under `tonight.errors.*`, one per enum value).

- [ ] Failing tests: `latest response wins`, `tap during arm is queued`, `auto-correct banner with undo`, `no-karaoke card on confident identify`, `make bar when not confident`, `confirm shows searched breadcrumb except for make`, `retry reuses client_request_id` (Review Focus 3), `every error code has copy`.
- [ ] FAIL → implement → PASS → screenshot → commit.

### Task E6: Managing songs — cancel, change, reorder, friend, duet, rename guard, consent, phone, tips

**Files:** Create `apps/mobile/src/tonight/manage/{SongActions.tsx,ReorderList.tsx,FriendBanner.tsx,DuetPicker.tsx,RenameSheet.tsx,ConsentToggle.tsx,PhoneSheet.tsx,TipsScreen.tsx}`, `apps/mobile/src/app/tonight/tips.tsx`, tests in `apps/mobile/src/__tests__/tonight/manage/`

**Behaviour:** per spec §4.1 rows (cancel instant + 15 s notice; change banner "Replacing {title}"; ▲/▼ + row numbers, polling paused while editing, one `reorder` call, "✓ New order saved"; friend flow banner + "For {name}"; duet picker = filterable A–Z of `getSingers` + "+ Add '{name}' as a new singer", max 3; rename guard handles 409 `conflict` reason `rename_guard` with the three buttons in A.11 order; consent toggle debounced 600 ms and skips unchanged; yes→no after singing asks "Just this song / Nothing from tonight"; phone sheet with region example).

- [ ] Failing tests per behaviour above (one test each), incl. `consent debounced and skips unchanged`, `rename guard buttons order`.
- [ ] FAIL → implement → PASS → screenshot → commit.

### Task E7: Make on the spot

**Files:** Create `apps/mobile/src/tonight/make/TonightMake.tsx`, `apps/mobile/src/app/tonight/make.tsx`, tests; reuse `apps/mobile/src/make/{useAudioSearch,SourcePicker,JudgeNotices,useMatchJudge}` with an injected `submit` that calls kjbox `makeSearch`/`submitRequest({source_type:'make', source_meta:{search_session_id, selection_index}|{youtube_url}})` instead of gen's create.

**Interfaces — Consumes:** Phase 1 make components (check their prop types; add an optional `submitter` prop rather than forking). Produces: `TonightMake({artist, title})`.

- [ ] Failing tests: `make submits through kjbox`, `make hidden when features.make false shows ask the host`, `youtube_blocked copy`, `review it now opens /review/[jobId]`.
- [ ] FAIL → implement → PASS → commit.

### Task E8: Karaoke log — decide facade, local store + outbox, survey

**Files:** Modify `openapi/decide.json` (refresh after Part C deploys, or from decide local stack via `DECIDE_OPENAPI_URL`), `packages/api-decide/src/facades` (add `listKaraokeLog`, `putKaraokeLog`, `deleteKaraokeLog`); Create `apps/mobile/src/tonight/log/{logStore.ts,outbox.ts,useLogSync.ts,SurveySheet.tsx,IdeasPanel.tsx}`, tests in `apps/mobile/src/__tests__/tonight/log/`

**Interfaces — Produces:** `logStore` (zustand + MMKV `tonight.log.v1.<userKey>`): `entries: Record<string, LogEntry>`; `addOther(song: {song_key?, artist, title}, state)`, `setState(id, state)`, `saveSurvey(id, survey)`, `remove(id)`; ids `app_<uuid>` for other bars, kjbox `history_id` for Nomad songs. `outbox`: FIFO of `{id, op:'put'|'delete', patch}` coalesced per id, flushed on connectivity/foreground (reuse the app's `useOffline()`), exponential backoff, per user (Review Focus 1). `SurveySheet({entryId, artist, title})` per spec §6.3 (testIDs `survey-feel-<v>`, `survey-key-<v>`, `survey-crowd-<v>`, `survey-notes`, `survey-save`, `survey-skip`). `IdeasPanel` ("Sung here before? Need ideas?", testID `tonight-ideas`) on the Nomad search screen: your most-sung songs from `listKaraokeLog` (all bars) + tonight's crowd favourites from `getMyStats`; tapping fills the search (A.38). Nomad trigger: `useMe()` reports a new `sung_tonight` item with `history_id` not yet surveyed/skipped → open once.

- [ ] Failing tests: `survey opens once per newly sung song`, `survey save writes to outbox with survey only for kj_ ids`, `outbox coalesces and retries`, `log outbox is per user`, `offline then online flushes`, `ideas panel fills search`.
- [ ] FAIL → implement → PASS → commit.

### Task E9: Other-bar mode and the song-page action

**Files:** Create `apps/mobile/src/tonight/other/{OtherNightScreen.tsx,AddSong.tsx,LogRow.tsx,YouTubeLink.ts}`, tests; Modify `apps/mobile/src/app/song/[id].tsx` (one adaptive action: "Request tonight" / "Add to tonight" / hidden; testID `song-tonight-action`).

**Behaviour:** grouped Sung / Up next / Maybe; add via existing search UI with `LibraryFilterPicker` (from `apps/mobile/src/find/library/`) above results; no result → "Log "{query}" anyway" (artist + title fields, prefilled) creating an unresolved entry; row actions "I've requested it" / "Maybe later" / "I sang it" (→ survey); `youTubeLinkFor(song) -> string | null` = the user's own gen job YouTube URL for the same artist+title (Phase 1 jobs query) else decide `youtube_url` of a community version; "Copy YouTube link" / "Share with the host". "Request tonight" during a Nomad night runs kjbox `searchSongs("<artist> <title>")` and opens confirm with the best group when it matches by `identity` artist+title, else the results.

- [ ] Failing tests: `other night groups`, `library filter applies to add search`, `log anyway creates unresolved entry`, `sang it opens survey`, `youtube link only when one exists`, `song page action adapts to night kind`.
- [ ] FAIL → implement → PASS → screenshot → commit.

### Task E10: Turn awareness and preview

**Files:** Create `apps/mobile/src/tonight/nomad/useTurnAlerts.ts`, `apps/mobile/src/tonight/request/PreviewButton.tsx`, tests

**Behaviour:** `useTurnAlerts(me)` fires one haptic (`expo-haptics`, already a dependency? if not `npx expo install expo-haptics`) + in-app banner on transitions to `up_next` and `now_singing`, once per entry per state, foreground only. Preview: `previewResolve` → expo-video/expo-audio player for stream/HLS; CD+G → "Preview on the web" opening `https://sing.nomadkaraoke.com/?t=<code>`; `previewClose` on unmount.

- [ ] Failing tests: `alerts fire once per transition`, `no alert when backgrounded`, `cdg falls back to web`.
- [ ] FAIL → implement → PASS → commit.

### Task E11: Local stack wiring and Maestro

**Files:** Modify `scripts/e2e-local.sh` (start kjbox stack from `KJBOX_DIR` default `../kjbox`, `adb reverse tcp:8040`, Metro env `EXPO_PUBLIC_KJBOX_API_URL=http://127.0.0.1:8040`), `maestro/scripts/stack.js` (`ACTION: kjbox` with `OP` = the A12 test API ops; `ACTION: log` reads decide `/api/test/karaoke-log?email=`); Create `maestro/flows/tonight-1-join-link.yaml` … `tonight-11-rename-guard.yaml` (spec §8.3 list, with `tonight-9-edge` including "box unreachable"), `maestro/screens/tonight-tour.yaml`; docs in `CLAUDE.md` § E2E.

- [ ] Write flows; run `scripts/e2e-local.sh --platform ios tonight` → all pass; then `--platform android tonight` (never both at once); tour in `en`, `ar`, `he` → `docs/screenshots/phase5/<platform>/`.
- [ ] Android: verify a camera-style intent with the uppercase URL (`adb shell am start -a android.intent.action.VIEW -d "HTTP://KJBOX.CC/2121"`) opens the app; if not, add the uppercase host to the filter or record the gap (spec §4.2).
- [ ] Screenshot UX review: look at every shot, fix layout/copy issues, re-run affected flows.
- [ ] Commit.

### Task E12: i18n, docs, release APK, merge

- [ ] Rebase onto main (after Phase 3 merges), resolve shared files, `pnpm i18n:translate` (see CLAUDE.md gotchas for auth), `pnpm i18n:check`, `pnpm test`, `pnpm typecheck && pnpm lint`, re-run the full Maestro suite on one platform.
- [ ] Docs: `CLAUDE.md` (status, Tonight workspace lines, kjbox stack, gotchas found), `docs/VISION.md` roadmap row status.
- [ ] Release APK `~/Downloads/nomad-karaoke-phase5-release.apk` against prod.
- [ ] Prod check (§8.4) with the release APK on the emulator: join a real night code when one is open, or `GET /night` shows the closed state; Other-night log syncs to prod decide.
- [ ] Message `nomadkaraoke-5a` + `nomadkaraoke-12` → `/coderabbit` → `/pr` → merge → message both.
- [ ] `/backlog-finish` prep: BACKLOG 4.5 note + session record (`/wrap`).
