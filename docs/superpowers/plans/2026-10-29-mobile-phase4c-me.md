# Phase 4c "Me: claim past Nomad nights" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice 4c of the approved Phase 4 spec: a singer can claim the songs they sang at past Nomad nights. In Andrew's words, with "loose name matching (people often use variations of their name, sometimes with or without a last initial, etc.) but show songs before matching so people can recognise their nights and tick to select them easily", where "nights rebuilt before 14 Oct contribute only the songs that were linked to an entry".

**Architecture:**
- **Part E (kjbox, one PR):**
  - a new `history_claims.py` with the matching, suggestions and claims logic;
  - two new tables in `sing_store` (`history_claims`, `history_rejections`) that `forget_gen_account` erases;
  - two app API v1 routes, `GET /sing/api/v1/history/suggestions` and `POST /sing/api/v1/history/claim`. They authenticate with the gen token as the rest of v1 does, but need no event code and no open night (R29);
  - claimed entries go through the existing history outbox as ordinary `kj_` records;
  - a KJ-side undo route;
  - local-stack test API ops to seed past nights;
  - a pytest suite.
- **Part F (nomad-mobile, one PR):**
  - api-kjbox facades;
  - the Me "Were these you?" card (up to 2 nights) and a `/me/past-nights` screen;
  - the account purge;
  - Maestro flows me-13 and me-14 on the build host.
- **decide: no changes.** Reading main (v0.35.0) confirms this:
  - the partner `PUT /api/partner/kjbox/karaoke-log/{kj_id}` accepts past `sung_at`, `night_date`, `state: sung_unplayed` and `entry_id` strings;
  - `SUNG_STATES` counts both states;
  - unknown fields are ignored, and claims send none (R42).
  - If Part E or F finds a real gap, add a Part G and stop to tell the orchestrator.

**Tech Stack:**
- kjbox: Flask, SQLite, pytest, with the OpenAPI contract `kj-controller/docs/api/singer-v1.openapi.json` and the strict harness `tests/integration/v1_contract.py`.
- mobile: as 4b (Expo SDK 57, TanStack Query 5, Zustand + MMKV, hey-api 0.99, use-intl, jest-expo, Maestro via `scripts/e2e-ci.sh`).

**Spec:** `docs/superpowers/specs/2026-10-25-mobile-phase4-me-design.md`:
- §6.10 (the feature);
- §3 "kjbox Night Log" (line 55: `started_at`, not `sung_at`; the reconstruction; the `history_id` formula; identity by name);
- §4 anti-goals (line 92: a wrong-name claim must never be auto-imported);
- §6.5.2 (the card's slot);
- §6.12 (claims don't work offline);
- §7 (kjbox pytest, test API ops, the Maestro claim yes / no flows);
- "As built (4a)" and "As built (4b)".

Plans 4a and 4b: their Global Constraints still hold.

**Repos / worktrees:**
- kjbox: create `/Users/andrew/Projects/nomadkaraoke/kjbox-phase4c-claim` with `/startnomad kjbox phase4c-claim`, branch `feat/sess-20261029-phase4c-claim`, from origin/main (currently v0.142.0, 67d284e).
- mobile: `/Users/andrew/Projects/nomadkaraoke/nomad-mobile-phase4-me`, new branch `feat/sess-20261029-phase4c-me`. Its base is main **after the 4b PR merges** (4b is 28 commits ahead of main as of 2026-10-29). If 4b is still open when Part F starts, stack on the 4b branch and rebase after it merges.

**Execution order:** E1–E9, then the kjbox PR merges and deploys to NomadPC, then F1–F6. Part F can start once E6 (the contract) is committed: generate the client from the kjbox worktree's contract, and run CI flows with `--kjbox-ref`.

## Global Constraints

- **Plans 4a/4b Global Constraints**, especially:
  - TDD;
  - no JSX literals;
  - testIDs on every interactive element;
  - all 33 locales;
  - per-account state;
  - "host", never "KJ", in app copy;
  - no `user_id` / email in responses.
- **Worktrees only.** Never edit the kjbox, karaoke-decide or nomad-mobile main clones (the PreToolUse hook enforces this). Plans go to `docs/archive/` or this file, never `.claude/plans/`.
- **TDD everywhere:** write a failing test, run it red, implement, run it green, commit. Every kjbox v1 route has strict contract tests: a closed error enum, `api_version` on every response, and no undocumented field (the harness adds `unevaluatedProperties: false`).
- **kjbox v1 rules** (kjbox CLAUDE.md):
  - delegate to existing store/view logic rather than forking singer rules;
  - existing `/sing/*` responses stay byte-compatible;
  - never store or log gen tokens;
  - app device ids are `app_device_id(email, secret)` (HMAC), never client input;
  - every route goes in the contract.
- **History ids:** `history_id_for(box_id, entry_id, email)` = `"kj_" + sha256(f"{box_id}:{entry_id}:{email}")[:24]`, with the R30 namespacing for nights before 2026-06-04 (when entry ids stopped being recycled, kjbox #100). The claim payload uses the outbox's spec 5.5 shape, so decide sees ordinary `kj_` records.
- **Times:** a claimed song's `sung_at` is the Night Log `started_at` (play start, box-local → UTC ISO Z), **never** the Night Log `sung_at` (= Done = END, kjbox #284). `ended_at` is `done_at` when the row has one. No play gives `state: sung_unplayed` with `sung_at: null`, as the live outbox does (A.97).
- **Pre-2026-10-14 nights** contribute only entries with an exact or inferred `entry_id`. Unlinked rows are never offered; they only count toward the night's `unmatched` number.
- **Matching** (spec §6.10, R35):
  - fold names with `singer_names.fold_name`; a box name matches when its first word equals the first word of any account name;
  - the first word must be ≥ 2 characters;
  - a duet matches on any listed singer (`sing._entry_members`);
  - no nickname tables.
- **Nothing is ever auto-claimed.** Only `POST /history/claim` attributes an entry, and only from an explicit Save. The app's ticks default to on (spec), and the server never defaults anything.
- **Privacy (R37):**
  - responses carry no emails, device ids, request ids, phones or notes;
  - rejections are stored by `email_hash`;
  - `forget_gen_account` erases claims and rejections, and unsent claim outbox rows already go with its existing outbox sweep;
  - the mobile query is memory-only and per account (never MMKV), and is removed on any account change.
- **Process:**
  - `/coderabbit` before each PR (max 3 cycles; with no CLI, use a reviewer subagent `feature-dev:code-reviewer`);
  - a final whole-branch review per PR on the most capable model, with one fix wave.
- **No heavy builds or full suites on Andrew's Mac:**
  - the kjbox full suite (~3k tests, ~40 min) runs only via `/Users/andrew/Projects/nomadkaraoke/scripts/kjbox-test-remote <worktree>` on the build host. Locally, run only the new test files (`pytest tests/unit/test_history_claims.py …`);
  - kjbox CI has no pytest job (`.github/workflows` = i18n + gitleaks only), so the remote run is the gate;
  - mobile Maestro runs only on the build host (`scripts/e2e-ci.sh`); no native release builds locally.
- **Never `adb kill-server`** or restart the adb server, and never install to Andrew's Pixel.
- **nomad-mobile is a PUBLIC repo:**
  - no secrets, tokens, real emails or real singer names in code, fixtures, screenshots or PR text;
  - fixture singers use invented names (Wren, Wren B, Wrenna, Quill, Juno);
  - test emails are `e2e-<flow>-<ms>@example.com`.
- **No real lyrics** anywhere. Song metadata (artist / title, e.g. Adele "Hello", Muse "Starlight", the existing fixture songs) is fine.
- **kjbox version bump:** `git fetch && git show origin/main:kj-controller/pyproject.toml | grep version` at commit time, take the next minor, and verify the diff actually changed the file (memory feedback_kjbox_version_bump_from_main).
- **NomadPC deploy:**
  - merging to kjbox main auto-deploys within ~60 s;
  - a `*.py` change restarts kj-controller, and playback survives (players are separate processes; memory project_kjbox_autodeploy_paused_live_shows), so a mid-show deploy is safe;
  - **still verify**, read-only, after the deploy (E9 step 6):
    - the service is active;
    - if a show is on, the player process is still running and the current entry didn't change;
    - the new routes answer.
  - Ask Andrew before any state-changing SSH.
- **Coordination:**
  - Tell the orchestrator when each PR opens and when it merges. The 4b plan had orchestrator [6f4a7b] and Phase 6 [c26790]; confirm the live ids first.
  - Phase 6 has a kjbox worktree (`kjbox-phase6-push-deletion`). Message it before editing `SingStore.forget_gen_account` / `account_deletions.py` (E2).
  - Message any session with a nomad-mobile PR open before merging shared files: `MeHome.tsx`, `useClearMeOnAccountChange.ts`, i18n `en.json`, `stack.js`, `e2e-local.sh`, `e2e-plan-lib.mjs`.

## Review Focus

1. **A name that only looks like the singer's** ("Wrenna" vs "Wren", "W" vs "Wren", "DJ Wren") is never suggested. "Wren B", "wren b.", "WREN" and a duet "Juno & Wren B" are suggested. Tests in E1 and E4.
2. **First claimer wins, per entry, per singer slot.**
   - Two accounts racing for a solo entry: exactly one holds it, and the other gets it in `taken`.
   - A duet entry can be held by at most `len(members)` accounts (R31).
   - An entry the live outbox already recorded for anyone counts as held.
   - Test in E5 with two threads on one DB.
3. **Pre-14-Oct nights:**
   - unlinked rows are never offered and are counted in `unmatched`;
   - `sung_at` is the play start (never Done);
   - pre-2026-06-04 nights use the namespaced history id (R30), so a recycled entry id can't overwrite another night's record.
   Tests in E3–E5.
4. **The outbox:** a claimed entry is delivered once, re-claiming is idempotent (same `history_id`, no second row), tonight's scan never retracts a claim row, and an account deletion erases the claims, the rejections and the unsent claim rows. Tests in E2 and E5.
5. **The phone:**
   - the card never shows another account's suggestions (account switch);
   - it renders nothing when the box is unreachable, 404 (older box), 401/503, signed out or offline;
   - Save sends the ticked songs as `mine` and the unticked ones as `not_mine` (R33);
   - a failed Save keeps the card with an error line.
   Test in F3.

---

## Part E: kjbox (worktree `kjbox-phase4c-claim`, all paths under `kj-controller/`)

### Task E1: Name matching and the account's names

**Files:**
- Create: `history_claims.py`, the first part:
  - `MIN_FIRST_WORD = 2`;
  - `def first_word(name: str | None) -> str | None` gives `fold_name(name).split()[0]` when it is ≥ `MIN_FIRST_WORD` long, else None;
  - `def entry_matches(entry_members: list[str], account_words: set[str]) -> list[str]` returns the member names whose first word is in `account_words`, in order;
  - `def account_names(store, email: str, display_name: str | None, app_device: str) -> AccountNames`, where `AccountNames = {words: set[str], names: list[str]}`. The sources (R35) are:
    1. the gen `display_name`; there is NO email-derived fallback (`suggested_name`'s email local part is not a name);
    2. `singer_name` of every non-friend, non-reorder/tip `sing_requests` row from the account's devices, across **all** nights;
    3. those devices' `singer_aliases.canonical_name`, which includes KJ renames and merges (origin `kj`).
  - The account's devices are `app_device` plus `SELECT DISTINCT device_id FROM singer_accounts WHERE gen_email=?` (any night, app and claimed web devices).
- Modify: `sing_store.py`. Add `devices_for_email_any_night(email)` and `request_names_any_night(device_ids)`, which reuses `account_request_names`'s filters with no `since` and the friend join.
- Test: `tests/unit/test_history_claims.py` (new).

- [ ] **Step 1: Write failing tests**
  - `test_first_word_folds_accents_case_punctuation`: `"Wrén B."`, `"WREN"` and `" wren  b "` all give `wren`.
  - `test_first_word_min_length`: `"W"` and `"J. Smith"` give None, because the first word "j" is too short.
  - `test_entry_matches_ignores_rest_of_name`: "Wren B" and "Wren Bloggs" match `{wren}`; "Wrenna" and "DJ Wren" don't.
  - `test_duet_matches_any_member`: `["Juno", "Wren B"]` gives `["Wren B"]`.
  - `test_account_names_sources`: covers the display name, an app-device request on an old night, a claimed web device's request, a KJ-merge alias, and a friend request that does NOT count.
  - `test_account_names_no_email_fallback`: no display name and no box history give an empty set.
- [ ] **Step 2:** Run `cd kj-controller && pytest tests/unit/test_history_claims.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(history): loose name matching + an account's names on the box`.

### Task E2: Claim and rejection storage, plus account deletion

**Files:**
- Modify: `sing_store.py` `init_schema` (additive, idempotent):
  ```sql
  CREATE TABLE IF NOT EXISTS history_claims (
      night       TEXT NOT NULL,      -- Night Log night (YYYY-MM-DD, noon rollover)
      entry_id    INTEGER NOT NULL,   -- exact or inferred rotation entry id
      gen_email   TEXT NOT NULL,
      history_id  TEXT NOT NULL,
      member      TEXT NOT NULL,      -- the matched member's display name (duets)
      claimed_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (night, entry_id, gen_email)
  );
  CREATE TABLE IF NOT EXISTS history_rejections (
      email_hash  TEXT NOT NULL,
      night       TEXT NOT NULL,
      entry_id    INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (email_hash, night, entry_id)
  );
  ```
- Add `SingStore` methods:
  - `claims_for_nights(nights) -> {(night, entry_id): [gen_email]}`;
  - `rejections_for(email_hash) -> set[(night, entry_id)]`;
  - `try_claim(night, entry_id, email, history_id, member, capacity) -> "claimed" | "already_mine" | "taken"`. It runs in ONE `BEGIN IMMEDIATE` transaction: it counts the existing holders (claims plus `outbox_holders`, below), returns `already_mine` when this email holds it, `taken` when the count is ≥ capacity, else inserts;
  - `add_rejections(email_hash, night, entry_ids)` (INSERT OR IGNORE);
  - `delete_claim(night, entry_id, email=None) -> list[row]` (host undo);
  - `outbox_holders(entry_ids) -> {entry_id: set[gen_email]}`: `history_outbox` rows with `op='put' AND state IN ('pending','sent')`, read from `payload_json` `entry_id` / `gen_email`. These are live-night attributions; entry ids are monotonic since 2026-06-04 and the outbox began 2026-10-22, so entry_id alone is the key.
- Modify: `SingStore.forget_gen_account`. Delete `history_claims` rows whose `gen_email` hashes to `email_hash`, and `history_rejections` rows with that `email_hash`. Add the counts `history_claims` and `history_rejections`. Unsent claim outbox rows are already removed by the existing pending/failed sweep; assert it in a test. Message Phase 6's kjbox session first.
- Modify: `localstack.py` `_STATE_TABLES`. Add `history_claims` and `history_rejections`, so `/reset` clears them.
- Test: `tests/unit/test_history_claims_store.py` (new), plus extend `tests/unit/test_account_deletions.py`, or wherever the existing `forget_gen_account` tests live (grep first).

- [ ] **Step 1: Write failing tests**
  - `test_try_claim_first_wins_solo`.
  - `test_try_claim_already_mine_is_idempotent`.
  - `test_try_claim_duet_capacity_two`: a third account gets `taken`.
  - `test_try_claim_counts_outbox_holders`: a sent put for another email makes a solo entry `taken`.
  - `test_try_claim_concurrent_threads_one_winner`: two `SingStore` connections on one file DB, so the result is exactly one `claimed`.
  - `test_rejections_by_hash_only`: no email column exists.
  - `test_forget_gen_account_erases_claims_rejections_and_unsent_claim_rows`, where the other account's rows survive.
  - `test_reset_clears_claim_tables` (localstack).
- [ ] **Step 2:** Run the new files locally. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new files plus `tests/unit/test_account_deletions.py` and `tests/unit/test_localstack.py`: PASS.
- [ ] **Step 5:** Commit `feat(history): claim + rejection tables, first claimer wins, erased with the account`.

### Task E3: What the Night Log exposes for claims

**Files:**
- Modify: `night_log.py`. All additive; the KJ modal ignores unknown fields.
  - `_plays`: also select `artist, title` (`play_events` has both).
  - `_to_entry`: add
    - `link: "exact" | "inferred" | "none"`: exact when the row knows its `entry_id`, inferred from `entry_id_inferred`, else none;
    - `song_identity: {artist, title}`: the linked request's `song_artist`/`song_title`, else the matched play's artist/title, else `kj_make._naive_split(song_artist)`. This is the same precedence as `HistoryOutbox._payload`;
    - `done_at` (the row's, else None);
    - `members`: `sing._entry_members`-equivalent over `singers_json` or the "A & B" split. Import lazily, as the outbox does.
  - `_build` memo: `NightLog.build_cached(ttl_s=300)` keyed on `(SELECT MAX(id) FROM rotation_archive, rotation rev, count(play_events))`, R43. `list_nights` / `get_night` keep calling `_build()` uncached, so the KJ modal's behaviour is unchanged.
- Test: extend `tests/unit/test_night_log.py`.

- [ ] **Step 1: Write failing tests**
  - `test_exact_row_link_exact_and_started_at_from_play`: a row with `done_at` 22:10 and a play at 22:06 gives `started_at` 22:06, and `sung_at` stays 22:10 (the #284 rule pinned).
  - `test_legacy_row_inferred_link_via_play_event`.
  - `test_legacy_unlinked_row_link_none`.
  - `test_song_identity_precedence`: request, then play, then split.
  - `test_build_cached_invalidates_on_new_archive_row`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `tests/unit/test_night_log.py` and the Night Log route tests (`grep -l night_log tests/integration`): PASS.
- [ ] **Step 5:** Commit `feat(night-log): link kind, song identity and members for history claims`.

### Task E4: Suggestions

**Files:**
- Modify: `history_claims.py`. Add `def suggestions(night_log, store, cfg, names: AccountNames, email: str, now) -> dict`:
  1. Take `night_log.build_cached()` entries with `sung` true and a `night`.
  2. Drop the live rotation's entries while requests are open (`store.is_enabled()`), R34.
  3. Drop starter placeholders (song text equal to `RotationStore.archive`'s starter song "First Song of the Night"), R36.
  4. For each entry, `matched = entry_matches(members or [singer], names.words)`; skip it when empty.
  5. **Linked** (`link != "none"` with an `entry_id`) entries are candidates. **Unlinked** matching entries only add to that night's `unmatched`.
  6. Exclude:
     - entries in `rejections_for(email_hash)`;
     - entries this email holds (claims or outbox);
     - entries whose holder count is ≥ capacity (`max(1, len(members))`, R31).
  7. Group by night, newest first. Drop nights with no candidates (R38). Cap at `MAX_NIGHTS = 20`, with `more_nights` = the remainder.
  8. Night fields:
     - `night_id`: R32, `claim_night_id(store, box_id, night)`. It is the marker-based `night_id_for_marker(box_id, marker)` when a `history_outbox` / `singer_accounts` `night_started_at` maps to that night date (`NightLog._live_night`'s rule: a marker before 06:00 belongs to the previous day), else `night_id_for_marker(box_id, "night:" + date)`;
     - `date`;
     - `venue` (`sing._tip_settings(...)["kj_name"]`, as the outbox does, or null);
     - `names`: the distinct matched display names, e.g. `["Wren B"]`;
     - `unmatched` (int);
     - `songs: [{entry_id, singer_name, artist, title, started_at, state}]`. `singer_name` is the entry's singer text as the box showed it; `started_at` is box-local → UTC ISO Z or null; `state` is `sung` if started_at, else `sung_unplayed`. Songs are sorted by `started_at`, then `added_at`.
  9. The response is `{nights: [...], more_nights: int}`, with no emails, devices or request ids (R37).
- Test: `tests/unit/test_history_suggestions.py` (new). It uses an in-memory rotation + sing + stats store fixture, built with the helpers `tests/unit/test_night_log.py` already has, which you should reuse or extract.

- [ ] **Step 1: Write failing tests**
  - `test_suggests_matching_done_entries_only`: Waiting or Cancelled entries aren't suggested, and neither is "Wrenna".
  - `test_legacy_night_only_linked_entries_and_unmatched_count`.
  - `test_started_at_not_done_time`.
  - `test_excludes_claimed_by_other_rejected_and_own`.
  - `test_outbox_recorded_entry_excluded`.
  - `test_duet_still_offered_until_capacity`.
  - `test_live_night_hidden_while_open_shown_when_closed`.
  - `test_starter_entry_never_suggested`.
  - `test_night_id_matches_outbox_night_when_marker_known`: decide groups the claimed songs with the night's live records.
  - `test_night_id_fallback_for_old_nights`.
  - `test_cap_20_nights_more_count`.
  - `test_response_has_no_private_fields`: walk the dict and assert no `@`, `device`, `phone` or `request_id` keys or values.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(history): past-night suggestions by loose name`.

### Task E5: Claims through the history outbox

**Files:**
- Modify: `history_claims.py`. Add `def claim(night_log, store, outbox, cfg, names, email, night_id, mine, not_mine, now) -> dict`:
  - Recompute `suggestions` for that `night_id`. Unknown night gives `not_found`.
  - Every `entry_id` in `mine` / `not_mine` must be a song of that night that matches the account, or one this account already holds (idempotent replay). Anything else gives `invalid`, and nothing is written.
  - For `mine`, call `try_claim(...)` per entry with capacity `max(1, len(members))`.
    - `history_id` (R30): `history_id_for(box_id, entry_id, email)` when the night is ≥ `2026-06-04`, else `history_id_for(box_id, f"{night}:{entry_id}", email)`.
    - On `claimed`, call `store.outbox_enqueue(hid, "put", payload, night_started_at="claim:" + night, now)`. The `claim:` prefix keeps the row out of tonight's `outbox_rows_for_night`, so the live scan never retracts it.
    - On `already_mine`, re-enqueue only if no put row exists (repair), which makes it idempotent.
    - The payload comes from `claim_payload(entry, night, night_id, email, hid, venue)`: the outbox's spec 5.5 shape built from the Night Log entry. It has:
      - `source: "kjbox"`, `box_id`, `night_id`, `night_date = night`, `entry_id` (str);
      - artist/title from `song_identity`;
      - `sung_at` from `started_at` (UTC Z), and `ended_at` from `done_at` (UTC Z, clamped ≥ sung_at as the outbox does);
      - `state`;
      - `singers` (members, capped as `_MAX_SINGERS` / `_MAX_SINGER_LEN`);
      - `venue {kind: "nomad", name}`;
      - `media {source_type: added_by.source_type or "rotation", brand_code?, gen_job_id?}`.
      - Reuse `history_outbox`'s `_local_to_utc`, `_iso_z` and `_brand_code`; move them to a shared helper only if that's needed to avoid a cycle.
  - For `not_mine`, call `add_rejections(email_hash, night, ids)`. An id that is in both lists is `invalid`.
  - Call `outbox.notify_rotation_changed()` to wake delivery.
  - The response is `{saved: int, already_saved: int, taken: [entry_id], rejected: int}`.
- Test: `tests/unit/test_history_claim.py` (new). Delivery uses `HistoryOutbox(... http_post=fake, http_delete=fake)`.

- [ ] **Step 1: Write failing tests**
  - `test_claim_enqueues_kj_record_with_started_at`: check the payload's fields exactly, against an expected dict.
  - `test_claim_history_id_formula_and_pre_june_namespacing`.
  - `test_claim_twice_is_idempotent`: one outbox row and the same hid.
  - `test_claim_taken_entry_reported`.
  - `test_claim_rejects_foreign_entry_invalid_and_writes_nothing`.
  - `test_not_mine_remembered_and_hidden`.
  - `test_claim_row_survives_tonights_scan`: a live night with an un-Done entry of the same id.
  - `test_deliver_due_sends_claim_put_to_decide`.
  - `test_unplayed_entry_sung_unplayed_null_sung_at`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new file plus `tests/unit/test_history_outbox.py`: PASS.
- [ ] **Step 5:** Commit `feat(history): claim past songs through the history outbox`.

### Task E6: v1 routes, contract and auth

**Files:**
- Modify: `sing_api_v1.py`:
  - Add `app_auth(require_night=False)` (R29). It runs steps 1–2 only: bearer, gen verify, and the `gen_verify_limit` per IP. It skips the event code, the open-night check, the night marker, `night_id` and the device link.
    - It sets `g.app_user` and `g.app_gen_account`. It does NOT set `g.night_*`, and it never calls `link_account`.
    - The existing decorator path is unchanged; make it a keyword with the default `True`.
  - Add per-device sliding windows `history_read_limit = SlidingWindow(30, 600)` and `history_claim_limit = SlidingWindow(20, 600)`. Over the limit gives 429 `rate_limited` with `retry_after`.
  - `GET /history/suggestions` returns 200 `{nights, more_nights}`.
  - `POST /history/claim {night_id, mine: [int], not_mine: [int]}`:
    - lists of ≤ 200 ints each, at least one non-empty; else 400 `invalid`;
    - unknown night gives 404 `not_found`;
    - success gives 200 `{saved, already_saved, taken, rejected}`.
  - Both routes return 503 `gen_unavailable` when there's no `night_log` / `history_outbox` on the app (e.g. stats are unavailable).
- Modify: `app.py` if the routes need `current_app.night_log`. Reuse `routes._night_log()`'s construction; don't build a second one.
- Modify: `docs/api/singer-v1.openapi.json`:
  - add both paths, with `operationId` `getHistorySuggestions` and `claimHistory`;
  - add the schemas `HistorySuggestions`, `HistoryNight`, `HistorySong`, `HistoryClaimRequest` and `HistoryClaimResult`;
  - `api_version` is required on every response;
  - the error codes are only existing enum values (`unauthenticated`, `gen_unavailable`, `rate_limited`, `invalid`, `not_found`, `internal`), so the mobile `CODES` record is unchanged;
  - the description states that these two routes need no `t` and work while the night is closed.
- Test: `tests/integration/test_sing_api_v1_history.py` (new), using `v1_contract.py`'s strict validation and the gen-verifier stubs from `test_sing_api_v1_me.py`. Extend `tests/integration/test_host_guard.py` to cover the public host serving `/api/v1/history/suggestions`.

- [ ] **Step 1: Write failing tests**
  - `test_suggestions_requires_bearer_401`.
  - `test_suggestions_works_with_requests_closed_and_no_code`.
  - `test_suggestions_never_links_device_or_touches_tonight`: `singer_accounts` is unchanged.
  - `test_claim_roundtrip_contract_valid`.
  - `test_claim_validation_errors`.
  - `test_claim_unknown_night_404`.
  - `test_rate_limited_429_retry_after`.
  - `test_public_host_allows_history_paths`.
  - `test_token_never_logged`: caplog has no bearer.
- [ ] **Step 2:** Run the new file plus `test_host_guard.py`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS. Also run every `tests/integration/test_sing_api_v1_*.py` locally (a few dozen tests, well under the macOS file limit), to prove the decorator change broke nothing.
- [ ] **Step 5:** Commit `feat(api-v1): GET /history/suggestions + POST /history/claim (no event code)`.

### Task E7: Host undo and claims on the Night Log

**Files:**
- Modify: `routes.py`. Add `POST /history/claims/undo {night, entry_id, gen_email?}`, KJ-side (same auth as `/history/nights`: Cloudflare Access on the KJ host; not on the public host's allowlist).
  - It deletes the claim row(s) and enqueues `delete` for each `history_id` (the same `{history_id, gen_email, entry_id}` body the outbox uses), then wakes the outbox.
  - It returns `{undone: n}`.
  - This is R41: there's no UI, and a `docs/TROUBLESHOOTING.md` entry gives the curl.
- Modify: the `night_log.py` entries. Add `claims: int`, the claim count for that `(night, entry_id)`. That's a single read of `claims_for_nights` per build, so the KJ modal can show it later. The KJ modal marker is a follow-up (R41).
- Test: extend `tests/integration/test_routes.py`, or the Night Log route tests: undo sends a delete to decide (fake http) and the entry becomes suggestible again; the public host 404s the undo path.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(history): host undo for a wrong claim; claim counts on the Night Log`.

### Task E8: Local-stack test API ops for past nights

**Files:**
- Modify: `localstack.py`:
  - Add `seed_history(app, nights, identity=None)`. Each night is `{date: "YYYY-MM-DD", entries: [{ref, singer, singers?, artist, title, status?="Done", link: "exact"|"inferred"|"none", played?: true, claimed_by?: email}]}`. For each entry it writes:
    - a `rotation_archive` row with `night_date`, `created_at` = date 21:00 + i min, `status`, `singer`, `song_artist = song_text(artist, title)`, a fixture `file_path` / media id;
    - exact rows set `entry_id` and `done_at` (+ 4 min);
    - inferred rows have `entry_id` NULL, plus a `play_events` row with that media id, singer and an `entry_id`;
    - `none` rows have no play with an entry id;
    - with `played`, a live `play_events` row at `created_at` + 1 min with the artist/title;
    - with `claimed_by`, a `history_claims` row for that email.
    - Entry ids come from a counter above the live rotation's `sqlite_sequence`, so they never collide.
  - `identity` is `{email, names: [..], date}`. It writes, on that past night, one approved `sing_request` per name from `app_device_id(email)` (and a `singer_accounts` row with marker `date 18:00:00`), so the account "used that name through the app" (R35).
  - It returns `{nights: [{date, night_id, entries: {ref: entry_id}}]}`.
  - Add `history_state(app, email=None)`: `{claims: [...], rejections: [{night, entry_id}], outbox: [claim rows: history_id, op, state, entry_id, gen_email]}`. Filter by email when given; rejections are filtered by email hash.
- Modify: `sing_test_api.py`. Add `POST /history/seed` and `GET /history/state?email=`, with the same loopback and no-proxy guards. Validation errors give `invalid`.
- Modify: `docs/TESTING.md` § Test API table (two rows), plus a note that `/reset` also clears the claim tables and the archive.
- Test: extend `tests/integration/test_sing_test_api.py`: seed, then suggestions through v1 with a stub token show the seeded night with its `unmatched` count; claim, then `history/state` shows the claim and the outbox row; `/reset` clears them.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS. Then run a smoke on the build host: `ssh andrewmastech` into the kjbox worktree copy, `scripts/local-stack.sh up`, `curl` seed, then state.
- [ ] **Step 5:** Commit `test-api: seed past nights + history state for the claim flows`.

### Task E9: Docs, version, full suite, review, PR, deploy, prod checks

**Files:**
- Modify: `docs/ARCHITECTURE.md` (the v1 history routes, the tables, the claim flow through the outbox).
- Modify: `kj-controller/README.md` or `CLAUDE.md` § App API v1: one bullet saying the history routes skip the event code (R29).
- Modify: `docs/TROUBLESHOOTING.md` (undo a wrong claim).
- Modify: `docs/CHANGELOG.md` (dated entry).
- Modify: `pyproject.toml`: the next minor above origin/main's version at PR time (≥ 0.143.0).

- [ ] **Step 1:** Write the docs and bump the version. Verify the bump with `git diff --stat`.
- [ ] **Step 2:** Run the full suite on the build host: `/Users/andrew/Projects/nomadkaraoke/scripts/kjbox-test-remote /Users/andrew/Projects/nomadkaraoke/kjbox-phase4c-claim`. It must pass. Rerun only infra flakes.
- [ ] **Step 3: Prod-data dry run.** Read-only, on the build host, never through Andrew's Mac:
  1. On the build host, `scp nomadpctunnel:` copies of the box's rotation DB and media/stats DB into `~/Projects/kjbox-ci/phase4c-dryrun/`.
  2. Run a throwaway script that calls `suggestions()` for 3 synthetic names that exist on the box. Print **counts only**: nights, songs, unmatched, and the `_build` time. Never names or titles, so that real singers' data never reaches tool output or the PR.
  3. Check that `_build` is under 1 s, and record the numbers in the PR.
  4. Delete the copies afterwards.
- [ ] **Step 4:** Run `/coderabbit` (max 3 cycles), then the final whole-branch review with one fix wave. Re-run the remote suite if the fixes touched Python.
- [ ] **Step 5:** Open the PR, with the contract diff and the dry-run numbers in the body, and tell the orchestrator. Merge when green and the review is clean. This is the normal merge flow; ask Andrew first if the session hasn't been cleared to merge.
- [ ] **Step 6: Deploy verification**, read-only, ~2 min after the merge:
  - `ssh nomadpctunnel 'cd /opt/nomad/kjbox && git log -1 --oneline'` shows the merge commit;
  - `systemctl is-active kj-controller`;
  - `journalctl -u kj-controller --since "-5 min" | grep -iE "error|traceback"` is empty;
  - `curl -s localhost:5001/sing/api/v1/history/suggestions -o /dev/null -w '%{http_code}'` gives **401** (not 404);
  - `curl -s https://sing.nomadkaraoke.com/api/v1/history/suggestions -w '%{http_code}'` gives 401 with an `api_version` JSON body.
  - **If a show is on** (requests enabled and the rotation has a Now Singing entry): check that the mpv process PID is the same as before the deploy and that the Now Singing entry didn't change. If anything looks wrong, tell Andrew at once; don't SSH-fix it.
- [ ] **Step 7:** Commit any post-deploy doc fix. Record the deploy in `docs/CHANGELOG.md`, if Step 1 didn't already.

---

## Part F: nomad-mobile (worktree `nomad-mobile-phase4-me`, branch `feat/sess-20261029-phase4c-me`)

### Task F1: api-kjbox client and facades

**Files:**
- Modify: `openapi/kjbox.json`. Before the kjbox merge, run `KJBOX_OPENAPI_PATH=../kjbox-phase4c-claim/kj-controller/docs/api/singer-v1.openapi.json node scripts/fetch-openapi.mjs kjbox`. After the merge, re-run it against the main clone after `git -C ../kjbox pull` (Andrew's main clone: a read-only pull is fine; if in doubt, ask) and check the diff is empty.
- Regenerate `packages/api-kjbox/src/client` (`pnpm gen:api:offline`).
- Modify: `packages/api-kjbox/src/facades.ts`. These are the first facades without `t`:
  - `getHistorySuggestions(): Promise<HistorySuggestions>`;
  - `claimHistory(nightId: string, mine: number[], notMine: number[]): Promise<HistoryClaimResult>`.
- Export the types from `index.ts`.
- Test: `packages/api-kjbox/src/__tests__/facades.test.ts`:
  - no `t` or `night_id` is sent;
  - the bearer is set;
  - a 404 (older box) rejects with `KjboxError` code `not_found`;
  - a non-JSON 530 rejects with `unreachable: true`.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run `pnpm jest packages/api-kjbox`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, plus `pnpm gen:api:offline && git diff --exit-code packages/*/src/client`: PASS.
- [ ] **Step 5:** Commit `feat(api-kjbox): history suggestions + claim facades`.

### Task F2: The suggestions hook and the claim action

**Files:**
- Create: `apps/mobile/src/me/useClaimSuggestions.ts`. `useClaimSuggestions(): { nights: HistoryNight[]; more: number; visible: boolean; claim(night, ticked: number[]): Promise<ClaimOutcome> }`:
  - query `['kjbox', userKey, 'history-suggestions']`, enabled only when signed in and online (`useOffline()`), with `staleTime` 10 min, `retry: false` and `gcTime` 10 min;
  - **no MMKV** (R39);
  - `visible` is false on any error (unreachable, 404 older box, 401/503, 429), while loading, and when there are no nights. The card then renders nothing, with no error UI;
  - `claim(night, ticked)` sends `mine = ticked` and `not_mine` = the night's other songs (R33). On a timeout or `unreachable`, it retries once with the same body (the server is idempotent, R44);
  - on success it hides that night optimistically through an in-memory per-account `answered` set (Zustand, keyed by `userKey`), and invalidates the suggestions query;
  - it schedules a refetch of the library (`['decide', userKey, 'library']`) and the log mirror (`logMirrorKeyFor(userKey)`) at +10 s and +30 s, because kjbox's outbox delivers asynchronously (R42);
  - `ClaimOutcome = { saved, alreadySaved, taken: number, rejected } | { error: 'offline' | 'failed' }`.
- Modify: `apps/mobile/src/me/useClearMeOnAccountChange.ts`. On ANY account change, run `cancelQueries` + `removeQueries` for `q.queryKey[0] === 'kjbox' && q.queryKey[2] === 'history-suggestions'`, and clear the `answered` store.
- Test: `apps/mobile/src/__tests__/me/useClaimSuggestions.test.tsx`:
  - each error kind gives `visible` false;
  - offline means no fetch;
  - unticked songs go as `not_mine`;
  - the retry after a timeout uses the same body;
  - the night is hidden after success;
  - the library and mirror are invalidated later (fake timers);
  - an account switch removes the query, so account B never sees A's nights.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(me): claim suggestions hook (memory-only, per account)`.

### Task F3: The "Were these you?" card and the past-nights screen

**Files:**
- Create: `apps/mobile/src/me/ClaimNightCard.tsx`. One night, testID `me-claim-night-${i}`:
  - the header "Sat 12 Oct · 3 songs as "Wren B"", i18n with the date via the app's formatter, the name through `isolate()`, and the plural count;
  - the venue line when present;
  - one row per song with a checkbox (`me-claim-song-${i}-${j}`, `accessibilityRole="checkbox"`, `accessibilityState.checked`), ticked by default; the label is title, artist (`artistLabel` handles the "Unknown Artist" sentinel);
  - when `unmatched > 0`, the line "1 more song couldn't be matched";
  - **Save ticked songs** (`me-claim-save-${i}`), disabled with nothing ticked or offline;
  - **None of these are me** (`me-claim-none-${i}`), which sends all songs as `not_mine` (no confirm; the night leaves);
  - after Save, an inline result for 5 s, then the card goes:
    - "Saved 2 songs. They'll show in your history in a minute.";
    - plus "1 was already saved by someone else" when `taken`;
    - "Couldn't reach the host's machine. Try again later." on an error, with the card kept and the ticks kept.
- Create: `apps/mobile/src/me/ClaimNightsSection.tsx`. It renders nothing unless `visible`. It has the title "Were these you?" with a one-line explainer ("Songs sung under a name like yours at Nomad nights. Tick the ones that were you."), up to 2 `ClaimNightCard`s (R40), and "See all N nights" (`me-claim-all`) → `/me/past-nights` when there are more than 2 nights or `more > 0`.
- Create: `apps/mobile/src/app/me/past-nights.tsx` (testID `me-past-nights`). It shows every night card in a `@nomad/ui` `List`, with `more > 0` as the line "Showing your 20 most recent nights". It goes back to Me when the list empties. Register it in the Me stack `_layout.tsx` and in the test-utils routes.
- Modify: `apps/mobile/src/me/MeHome.tsx`. Put `<ClaimNightsSection />` in the 4c slot, between `ProfileSummaryCard` and `GoTosShelf`, and remove the slot comment.
- Modify: `packages/i18n/messages/en.json`. Add `me.claim.*` (title, explainer, nightHeader with plural, unmatched with plural, save, none, saved with plural, taken with plural, failed, seeAll, showingRecent), then translate (`/Users/andrew/Projects/nomadkaraoke/scripts/gcp-admin env -u GEMINI_API_KEY pnpm i18n:translate`, or the lapsed-login route in CLAUDE.md).
- Test: `apps/mobile/src/__tests__/me/claimNights.test.tsx`:
  - hidden when not visible;
  - ticks default on;
  - unticking one sends it as not_mine;
  - None of these are me sends all as not_mine;
  - Save is disabled offline and when nothing is ticked;
  - the error keeps the ticks;
  - the taken copy;
  - the See all link at 3 nights;
  - the past-nights screen lists all;
  - RTL (ar) renders the name isolated.
  Also extend `meHome.test.tsx`: the section sits between the profile card and the go-tos.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement and translate.
- [ ] **Step 4:** Run the tests, `pnpm i18n:check`, and the full `pnpm jest --forceExit` once: PASS.
- [ ] **Step 5:** Commit `feat(me): Were these you? (claim past Nomad nights)`.

### Task F4: E2E plumbing for kjbox-backed Me flows

**Files:**
- Modify: `scripts/e2e-local.sh` `needs_kjbox` and the matching check in `scripts/e2e-lane.sh` / `.github/workflows/e2e.yml` (grep for `tonight` there). They must also start the kjbox stack (and stack-control) for flows tagged `kjbox` (R46). Leave `tonight` as is.
- Modify: `scripts/e2e-plan-lib.mjs` affected map:
  - `packages/api-kjbox/` → add `me-13`, `me-14`;
  - `apps/mobile/src/me/` (check that an entry exists; else add one) → `me-`.
  - Extend `scripts/__tests__/` for the plan lib.
- Modify: `maestro/scripts/stack.js` `ACTION: kjbox`. Add `OP: history-seed` (`NIGHTS` JSON, `IDENTITY` JSON with `email` defaulting to setup's email; returns `output.historyNights`) and `OP: history-state` (`EMAIL`, `EXPECT_CLAIMS` = count, `EXPECT_REJECTIONS` = count, polled). Document them in the header.
- Test: `scripts/__tests__` for needs-kjbox tag detection, if a shell-test harness exists; else the plan-lib test only.

- [ ] **Step 1:** Write failing tests (plan lib).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `test(e2e): kjbox tag for Me flows; history-seed/state stack actions`.

### Task F5: Maestro me-13 and me-14 (build host)

**Files:**
- Create: `maestro/flows/me-13-claim-yes.yaml` (tags `[me, kjbox]`):
  1. `stack.js setup`, then `kjbox OP: reset`, then `history-seed` with:
     - `IDENTITY {names: ["Wren"], date: 2026-10-01}`;
     - night A (2026-10-16, exact links): "Wren B" Adele "Hello" (played), "Wren" Muse "Starlight" (played), "Quill" another fixture song, "Wrenna" a fourth;
     - night B (2026-10-02, legacy): "Wren B." inferred link on a fixture song, plus one `link: none` "Wren" row.
  2. Sign in through the Discover card, then `tab-me`.
  3. Assert `.*Were these you.*`, night A's header `.*2 songs as .*Wren.*`, and both rows ticked. Assert that neither "Quill" nor "Wrenna" is visible. Take a shot.
  4. Save on night A, then assert `.*Saved 2 songs.*`. Night A goes; night B shows `.*couldn't be matched.*`. Take a shot.
  5. `history-state EXPECT_CLAIMS: 2`, then `kjbox OP: drain`, then `ACTION: log` for the 2 records on decide.
  6. Wait for the library refetch (or `relaunch-keep-data`), then All your songs shows `.*Hello.*`.
- Create: `maestro/flows/me-14-claim-not-mine.yaml` (tags `[me, kjbox]`):
  1. Seed one night with 3 "Wren B" songs, one of them `claimed_by: e2e-other@example.com` (so it must not show), plus a second night.
  2. Untick one of the 2 visible songs, then Save. `history-state` gives claims 1 and rejections 1.
  3. On the second night, None of these are me, then `relaunch-keep-data`; the card is gone (server-side).
  4. Seed a fresh night, then `kjbox OP: stop`, then relaunch: the card is hidden and no error shows. Then `kjbox OP: start` and relaunch: the card is back. `onFlowComplete`: `kjbox OP: start`.
- Modify: `maestro/screens/me-tour.yaml`. Add shots me-32 (the card) and me-33 (the past-nights screen). CI has no `--screen`, so these go on the manual-pass list.
- Modify: `maestro/durations.json` (me-13 90 s, me-14 120 s).
- Run:
  - before the kjbox merge: `scripts/e2e-ci.sh run --kjbox-ref feat/sess-20261029-phase4c-claim --filter me-13`, then the same with `--filter me-14` (run them separately: `me-1` would also match me-10…12 and tonight-11's "rena**me-**guard");
  - after the merge: the PR's own run, plus `--filter me-` on both platforms.
  - Judge flow by flow from the junit files. Known main failures (review-3, review-10, connect-1, tonight-1 iOS) don't block.

- [ ] **Step 1:** Write the flows.
- [ ] **Step 2:** Push, then run the CI as above. Iterate until me-13 and me-14 pass on iOS and Android, and me-1…12 still pass.
- [ ] **Step 3:** Review the screenshots from `.e2e-ci/<run>/`. Fix real UX issues with jest tests and re-run.
- [ ] **Step 4:** Commit `test(e2e): me-13 claim yes, me-14 not mine / unreachable`.

### Task F6: Docs, review, PR, release check

**Files:**
- Modify: `CLAUDE.md`. Add to Status (4c built; needs kjbox ≥ the E9 version), the `me/` module list (useClaimSuggestions, ClaimNightCard / ClaimNightsSection, `app/me/past-nights.tsx`), the E2E bullet (`kjbox` tag, `history-seed` / `history-state`, me-13/14) and any gotchas found.
- Modify: `docs/VISION.md`, roadmap row 4 ("4a, 4b, 4c built").
- Modify: the spec, adding an "As built (4c)" subsection: the rulings R29+ as decided, deviations, deferred follow-ups, the manual pass.
- Modify: this plan, adding the execution ledger.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `pnpm typecheck && pnpm lint && pnpm jest --forceExit && pnpm i18n:check && pnpm gen:api:offline && git diff --exit-code`.
- [ ] **Step 3:** `/coderabbit` (max 3 cycles), then a final whole-branch review on the most capable model, with one fix wave.
- [ ] **Step 4:** Rebase on main (the 4b merge). Message the sessions that share files. Open the PR (label `e2e-full`) and tell the orchestrator. **Merge order: kjbox (E9) is merged and verified on NomadPC first**; the mobile PR's CI runs against kjbox main.
- [ ] **Step 5:** Merge when E2E is green apart from known main failures, and tell the orchestrator. Then the prod check, with a signed-in prod build (the end-of-phase release APK from main, built on the build host, never Andrew's Mac):
  1. Me opens with no claim card error when the account has no matching nights.
  2. With the box reachable, `GET https://sing.nomadkaraoke.com/api/v1/history/suggestions` with a real token answers 200. Andrew runs this, or a test account whose display name matches a fixture-free real night. Don't use a real singer's name in tool output.
  3. With NomadPC unreachable, the card is hidden.
  Add to the manual-pass list:
  - a real Nomad night claim by Andrew (or a regular), checked end to end into decide;
  - the me-tour shots me-32/33, en and ar;
  - the iPad check of the card.

---

## Ruling proposals (R29+, recommended answers; Andrew can overrule at review)

- **R29: history routes need no event code or open night.** The app opens Me any day of the week, usually without a code, often while the box is closed. The routes take only the gen bearer (with v1's gen-verify limits) plus per-device limits, and never link a device to tonight. *Recommend yes;* otherwise the card could only show during a show.
- **R30: claim history ids on recycled-id nights.** Entry ids were recycled across nights before 2026-06-04 (kjbox #100). For those nights, claims use `history_id_for(box_id, f"{night}:{entry_id}", email)`, so two old nights' entry 12 can't share one decide record. Later nights use the plain formula, which is identical to the live outbox. *Recommend yes.*
- **R31: duet capacity.** A per-entry, first-claimer-wins rule would block the second duet partner. An entry may be held by at most `max(1, len(members))` accounts (claims plus live outbox records), each account once. *Recommend yes.*
- **R32: night id for claims.** Use the night marker's `night_id` when a known marker (outbox / singer_accounts) maps to that date, so claimed songs join the same decide night (stats "nights" stays right). Otherwise use `night_id_for_marker(box_id, "night:"+date)`. *Recommend yes.*
- **R33: unticked songs on Save are "not mine".** Otherwise a night with one unticked song comes back forever. The spec's "None of these are me" covers the whole night. *Recommend yes.*
- **R34: tonight's songs.**
  - While requests are open, the live rotation is excluded (Tonight attributes it, and a claim mid-night could race it).
  - Once the host closes requests, the live night's Done entries become claimable. A claim then uses the same `history_id` the live outbox would, so a later live attribution is the same decide record.
  - *Recommend yes.* The alternative "only after New Rotation" is simpler but delays a Thursday claim by about a week.
- **R35: name sources.**
  - The gen profile display name: its first word, with no email-local-part fallback.
  - Every name the account's devices (the app device, plus web devices it claimed, any night) used on requests, excluding friend songs.
  - Those devices' aliases, including KJ merges.
  - A first word must be ≥ 2 characters.
  - *Recommend yes.*
- **R36:** the "First Song of the Night" starter entry (it is "Andrew" on every night) is never suggested. *Recommend yes;* otherwise Andrew's own account gets every night.
- **R37: privacy envelope.**
  - Suggestions show only matched entries: date, venue (kj_name), the singer text as the box displayed it (duet partners included, as on the venue screen), artist/title, start time and state. Never emails, devices, request ids, phones or notes.
  - The limits: suggestions 30 / 10 min and claims 20 / 10 min per device; ≤ 20 nights, plus `more_nights`.
  - **Decision for Andrew:** anyone can set their gen display name, so an account named "Wren" sees songs sung under any "Wren …" at past nights. Those songs were public on the venue screen at the time. *Recommend accepting this for 4c* (Andrew's loose-matching rule). The cheap hardening, if he prefers it: the profile name only counts after the account has joined at least one Nomad night through the app.
- **R38:** nights with no claimable songs are dropped. `unmatched` = Done legacy rows on that night whose names match but that have no entry id. *Recommend yes.*
- **R39:** a claim is online-only, with no phone outbox. Suggestions are not cached in MMKV: they hold other singers' names, and a claim needs the box anyway. *Recommend yes.*
- **R40:** Me shows at most 2 night cards plus "See all N nights" (`/me/past-nights`), so a regular with 15 nights doesn't push the go-tos off screen. *Recommend yes.*
- **R41: host undo.**
  - A KJ-side `POST /history/claims/undo` route (no UI), documented in TROUBLESHOOTING. It deletes the claim and retracts the decide record.
  - A `claims` count on the Night Log JSON.
  - The KJ modal marker is a follow-up.
  - *Recommend yes* (spec §6.10 allows the follow-up).
- **R42: no decide change.** Claims are plain `kj_` partner records with no new fields. The app refetches the library and log mirror at +10 s / +30 s and on the next foreground. *Recommend yes.*
- **R43:** the Night Log build for claims is memoized for 5 min, keyed on (max archive id, rotation rev, play count); the KJ modal stays uncached. *Recommend yes,* if the E9 dry run shows `_build` over ~200 ms on prod data. Otherwise drop the cache (simpler).
- **R44:** claims are idempotent: re-sending gives `already_saved`, with no second outbox row. The phone retries once after a timeout with the same body. *Recommend yes.*
- **R45: backfill double count.** A song already logged as "a while ago" (backfill `times`) that is then claimed from a Nomad night counts twice in decide. *Recommend accepting it* (backfill is rough); a later decide dedupe can follow if it shows up in real data.
- **R46:** a Maestro tag `kjbox` starts the kjbox stack for non-Tonight flows. me-13 and me-14 use it instead of `tonight`, so they don't join Tonight's grouping. *Recommend yes.*

## Risks

- **Privacy of loose matching (R37).** This is the biggest product risk. It is mitigated by: no auto-claim; songs shown before the tick; per-entry first claimer; no private fields; rate limits. Andrew decides on the hardening.
- **Wrong legacy links.** Pre-14-Oct nights are reconstructed by heuristics, so an "inferred" song may be someone else's. Mitigations: songs are shown, unticking is easy, and the host undo exists (R41).
- **NomadPC reachability.** The box may be offline or asleep, or the tunnel down. The card just doesn't show, so the feature is invisible rather than broken. Prod checks need the box up.
- **Performance.** `NightLog._build` scans all history on every call. The E9 dry run measures it, and R43 caches it if it's slow.
- **Shared files.** `forget_gen_account` / `account_deletions.py` are shared with Phase 6's kjbox worktree. On mobile, `MeHome`, `useClearMeOnAccountChange`, `en.json` and the E2E scripts are shared with other sessions. Message the owners first.
- **Ordering.** The mobile 4b PR isn't merged yet (base for F), and the kjbox PR must merge and deploy before the mobile PR's CI can pass without `--kjbox-ref`.
- **Maestro.** iOS 26 sheets and checkbox accessibility may be unreliable (`common/tonight-open-sheet.yaml` retry pattern). Recycled FlashList cells matter on the past-nights screen: assert by text with `.*` and order with `above:`.
- **The live-night race (R34).** A claim after requests close, followed by the host reopening and the live scan attributing the same entry to the same account, writes the same record (same id), which is safe. A different account's live attribution after someone's claim can exceed capacity for a solo entry: the outbox's live attribution doesn't consult claims. Mitigation, in the E5 or E6 fix wave: make `_attribution` skip `(entry, email)` pairs when a claim by another email already holds a solo entry. That is a small addition to `history_outbox._attribution`. Include it if the reviewer agrees it's in scope.

## Execution ledger

(Filled in during execution.)
