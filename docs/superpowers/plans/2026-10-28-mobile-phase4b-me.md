# Phase 4b "Me: smarter picks" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice 4b of the approved Phase 4 spec. It has four parts:
- recommendations v2 driven by sung history and survey answers, with a Discover "Your go-tos" section;
- **Get this made** (Make it / Request it free / dismiss);
- **crowd singability** (counters, thresholds, song page line, crowd-pleasers ordering, the BigQuery fill);
- the 4a follow-ups the spec's "As built (4a)" lists.

**Architecture:**
- **Part C (karaoke-decide, one PR):**
  - the karaoke-log transaction keeps an exact per-record survey map on the `user_songs` row, and derives the recs fields from it;
  - it also keeps `song_crowd_stats/{song_key}` counters by voice bucket;
  - recs v2 reads the derived fields;
  - new routes `GET /api/my/get-made`, `POST|DELETE /api/my/get-made/{key}/dismiss`, and `GET /api/songs/{song_key}/crowd`.
- **Part D (nomad-mobile, one PR):**
  - the Discover go-tos section, the Me "Get this made" shelf and screen, the song page crowd line;
  - the restored "songs known" count;
  - the setlist no-cache settle fix;
  - Maestro flows.

**Tech Stack:** as Phase 4a.
- decide: FastAPI, Pydantic v2, Firestore, SQLite catalog, pytest, Pulumi.
- mobile: Expo SDK 57, Expo Router, TanStack Query 5, Zustand + MMKV, hey-api, use-intl, jest-expo, Maestro, run on the build host via `scripts/e2e-ci.sh`.

**Spec:** `docs/superpowers/specs/2026-10-25-mobile-phase4-me-design.md` §6.5, §6.7–6.9, §7, "As built (4a)". Plan 4a: `docs/superpowers/plans/2026-10-25-mobile-phase4a-me.md`; its Global Constraints still hold.

**Repos / worktrees:**
- decide: `/Users/andrew/Projects/nomadkaraoke/karaoke-decide-phase4-me`, branch `feat/sess-20261028-phase4b-me` (base main v0.34.2).
- mobile: `/Users/andrew/Projects/nomadkaraoke/nomad-mobile-phase4-me`, branch `feat/sess-20261028-phase4b-me` (base main 1329fc3).

**Execution order:** C1–C8, then D1–D8.

## Global Constraints

- Everything in plan 4a's Global Constraints, especially:
  - TDD;
  - no `user_id` / `email_hash` in responses;
  - no JSX literals, testIDs, all 33 locales;
  - per-account MMKV keys;
  - library identity is `song_key ?? "u:" + songKey(artist, title)`.
- **Rules from 4a that bind 4b:**
  - "Latest" survey answers are per field, by `answered_at` (R3).
  - API responses never put a song key into artist/title (R4).
  - The Saved filter means loved songs only (R6).
  - Uncatalogued songs have no Save heart (R11).
- **Go-to rule (identical in core `isGoTo` and decide):** the latest feel isn't `bad`, the song isn't hidden, and either the latest feel is `great` or `times_sung >= 2`.
- **Recs weights (spec §6.8):**
  - `sung_song_weight` is 1.0 when the latest feel is great, or when times_sung ≥ 2 with a latest feel that isn't bad;
  - 0.8 when sung once with no feel;
  - 0.7 when the latest feel is ok;
  - None when the latest feel is bad, which puts the song in `survey_no`.
  - `SURVEY_NO_PENALTY = 0.4`.
  - `weight = max(base, session, sung)`.
  - Survey-no songs never seed `because_*` sections and don't count toward their artist's affinity.
  - Phase 3d's best-of-`sources` and `session_*` semantics, and their pinned tests, stay unchanged.
- **Crowd (spec §6.7):**
  - one vote per singer per song, using the singer's latest key answer;
  - buckets are bass | baritone | tenor | alto | mezzo | soprano, or no bucket (a register-only or missing profile);
  - `CROWD_MIN_SINGERS = 5` overall;
  - `CROWD_MIN_BUCKET = 5` for the "singers with your range" figure;
  - thresholds are applied server-side, so raw counts below them never leave decide.
- **Get this made (spec §6.9, with ruling R15):**
  - **Request it free is ONE submit** (`POST /api/requests-board/requests`). Gen's submit spends the day's vote, and voting again after `already_exists` would toggle it off.
  - Handle the responses: `created` and `already_exists` mean done; 409 `vote_already_used` gets "you've used today's free vote"; 429 `submission_limit` gets "one free request a day".
  - No separate vote call.
- **No AI spend in the nomadkaraoke GCP project.** Pulumi apply only from decide main with a preview showing no deletions, and only with `--target`. Its known drift is a cloudrunv2 scaling update that must NOT be applied.
- **E2E:** run only on the build host (`scripts/e2e-ci.sh run --filter …` / PR runs), never on Andrew's Mac. Known main failures (review-3, review-10, connect-1, tonight-1 on iOS) don't block.
- **Coordination:**
  - Message Phase 3d (nomadkaraoke-6c) before merging recs_v2 changes.
  - Message Phase 6 (nomadkaraoke-52 [c26790]) about new collections: register them in `backend/services/user_deletion.py` (the guard test fails otherwise).
  - Tell the orchestrator nomadkaraoke-52 [6f4a7b] when each PR opens and merges.

## Review Focus

1. **Survey edit, delete, re-answer, or the singer's voice type changing.** `song_crowd_stats` moves by exactly one vote per singer per song and never goes negative. A singer who answered twice counts once. Test in C1.
2. **The threshold edges (4 vs 5 singers, overall and per bucket).** The API returns no figure below 5, and never per-bucket numbers below 5 even when the overall count is ≥ 5. Test in C4.
3. **A song both in `survey_no` and loved (or sung twice).** Bad wins: the song isn't known, and gets the penalty. When the next answer is great, the song comes back. Test in C3.
4. **Get this made never lists a song the user already made, or one with a karaoke version.** It returns after the user un-dismisses. Tests in C5 and D3.
5. **Request it free when today's vote is already used, or the daily submission is used.** It shows a clear message, the row doesn't claim "requested", and it never sends a second (toggle) vote. Test in D3.

---

## Part C: karaoke-decide (worktree `karaoke-decide-phase4-me`)

### Task C1: Per-song survey state and crowd counters in the karaoke-log transaction

**Files:**
- Modify: `backend/services/karaoke_log_service.py` (`_transact` ~441-498, `_inc` ~303, `_dec` ~338).
- Create: `backend/services/crowd_stats.py`, containing:
  - `CROWD_COLLECTION = "song_crowd_stats"`, `CROWD_MIN_SINGERS = 5`, `CROWD_MIN_BUCKET = 5`;
  - `VOICE_BUCKETS = ("bass","baritone","tenor","alto","mezzo","soprano")`;
  - `def voice_bucket(profile: dict | None) -> str | None` (the `voice_type`, if it's a bucket, else None);
  - `def apply_vote(stats: dict | None, old: tuple[str|None, str|None] | None, new: tuple[str|None, str|None] | None) -> dict`, where each tuple is `(key_answer, bucket)`; it subtracts old and adds new in `total` and `by_bucket.<bucket>`, clamps at 0, and updates `updated_at`;
  - `crowd_pleaser_yes` handled the same way through `apply_pleaser(stats, old: bool|None, new: bool|None)`.
- Modify: `backend/services/user_deletion.py`: add `song_crowd_stats` to `NOT_USER_DATA` with the comment "aggregate counts; ≥5-singer threshold; no user ids".
- Test: `backend/tests/test_karaoke_log_service.py` (extend), `backend/tests/test_crowd_stats.py` (new).

**Design (exact state, no deltas to drift):**
- On the chosen `user_songs` row the transaction keeps `sung_surveys: {entry_id: {"feel", "key", "crowd_pleaser", "at": {"feel","key","crowd_pleaser": iso}}}`. Each record's answers come with the per-field `answered_at`; use the survey's `answered_at` for every field it sets.
- It removes the entry when the record stops counting (deleted, or no longer sung) or moves target.
- From the map it derives and stores, on every write:
  - `sung_feel_counts {great, ok, bad}`;
  - `sung_feel_latest`, `sung_key_latest` (per field, latest by `at`);
  - `sung_crowd_pleaser_count`;
  - `crowd_bucket`: the singer's bucket, recorded when their latest key answer was set.
- **Survey-only edits** (same target and times) must still read and write the row. `_transact` today skips the row when `(target, times)` is unchanged; add the branch.
- **Crowd:** compute the user's `(sung_key_latest, crowd_bucket)` and latest crowd_pleaser before and after the write. When either changes, read `song_crowd_stats/{song_key}` in the transaction and write `apply_vote` / `apply_pleaser`.
  - The bucket comes from `decide_users` (the voice profile), read in the transaction by `email_hash`, or by `user_id` for `guest_` ids, as `voice_profile_service` resolves it.
  - Resolve the doc id before the transaction when the record has no `email_hash`.
  - All reads happen before the first write (FakeTxn asserts this).
- Only resolved songs (catalog `song_key`) get `sung_surveys` and crowd stats; unresolved rows don't.
- A backfill record counts toward the crowd only if it carries a survey `key`.

- [ ] **Step 1: Write failing tests**
  - `test_survey_map_tracks_each_record`: two records for one song with feel great and ok give `sung_feel_counts == {great:1, ok:1, bad:0}`. `sung_feel_latest` follows `answered_at`. Editing the older record changes nothing about latest.
  - `test_survey_only_edit_writes_row`: editing just the survey on a counted record updates `sung_feel_latest`.
  - `test_delete_removes_survey_entry`: deleting the record drops its entry and recomputes the latest fields.
  - `test_crowd_one_vote_per_singer`: one singer with two records that both say too_high gives `total.too_high == 1`; changing the latest to right gives too_high 0, right 1.
  - `test_crowd_bucket_from_voice_profile`: a baritone profile gives `by_bucket.baritone.right == 1`. Then the profile changes to tenor and the user re-answers: baritone goes to 0 and tenor to 1, because the stored `crowd_bucket` makes the decrement exact.
  - `test_crowd_no_bucket`: a register-only profile counts only in `total`.
  - `test_crowd_pleaser_counts`: true/false toggling moves `crowd_pleaser_yes` by one per singer.
  - `test_unresolved_no_crowd`.
  - `test_backfill_without_key_no_crowd_vote`.
  - `test_apply_vote_never_negative` (unit, crowd_stats).
- [ ] **Step 2:** Run `poetry run pytest backend/tests/test_karaoke_log_service.py backend/tests/test_crowd_stats.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement. Keep `_inc`/`_dec` counting unchanged; the survey map is a separate step on the same row in the same transaction.
- [ ] **Step 4:** Run the karaoke-log, library and user-data-registry-guard tests, then `make test-backend` once: PASS.
- [ ] **Step 5:** Commit `feat(karaoke-log): per-song survey state + crowd counters`.

### Task C2: Backfill last_sung_at and a deduplicated known-songs total

**Files:**
- Modify: `backend/services/karaoke_log_service.py` `_inc` ~304. For `origin == "backfill"`, `when = sung_at or ended_at or night.date or None`, never now. `_later(old, None)` keeps the old value.
- Modify: `backend/services/music_service_service.py` and the summary route (`backend/api/routes/services.py` ~306). Add `SourcesSummaryResponse.known_songs: int`, the count of the user's `user_songs` rows whose `_base_weight > 0` or that are loved. It must be deduplicated by `song_key` (a song can have both a `sk:` and a `{kn}` row, as `list_loved` dedupes).
  - Compute it with one `query_documents(user_id==)` projection over the fields needed. This is an accepted cost: the summary is fetched rarely.
  - Exclude voice-session-only unloved rows (0 weight).
- Test: extend `test_karaoke_log_service.py` and the services summary tests.

- [ ] **Step 1: Write failing tests**
  - `test_backfill_undated_keeps_last_sung_at`: a row last sung on 2026-10-01 plus a backfill with no date leaves `last_sung_at` unchanged.
  - `test_backfill_month_date_sets_last_sung_at_from_night_date`.
  - `test_summary_known_songs_deduped`: the same song_key on two rows counts once. A voice-session-only row counts 0, a loved row counts.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `fix(karaoke-log): undated backfill keeps last_sung_at; services summary known_songs`.

### Task C3: Recs v2 from sung history and surveys, plus the go-tos section

**Files:**
- Modify: `backend/services/recs_v2/weights.py`. Add `SONG_SUNG_GREAT = 1.0`, `SONG_SUNG_ONCE = 0.8`, `SONG_SUNG_OK = 0.7`, `SURVEY_NO_PENALTY = 0.4`, and `def sung_song_weight(d: dict) -> float | None`, which returns None for latest bad or no times_sung, else the values per the Global Constraints.
- Modify: `backend/services/recs_v2/context.py`:
  - `UserContextV2` gains `survey_no: set[str]`, `go_tos: set[str]`, and `key_hints: dict[str, int]` (song_key → semitones: too_high gives -2, too_low gives +2).
  - `_map_songs`: `weight = max(base, session or 0, sung or 0)`. Latest bad (from `sung_feel_latest`) moves the key out of `known` into `survey_no`, and its artist doesn't count.
  - `go_tos` = keys that pass the go-to rule (from times_sung, sung_feel_latest and hidden).
- Modify: `backend/services/recs_v2/scoring.py`:
  - subtract `SURVEY_NO_PENALTY` for `survey_no`;
  - add a new reason `sung_before` for go-tos, taking precedence over `known_song`;
  - `because_seeds` skip `survey_no`.
- Modify: `backend/services/recs_v2/sections.py`:
  - a new FIRST slot `go_tos` (limit 10) accepting `has_karaoke and key in ctx.go_tos`;
  - update `SECTION_LIMITS`;
  - go-tos don't also appear in `songs_you_know`.
- Modify: `backend/services/recs_v2/service.py`:
  - `REASON_TEXT["sung_before"]`;
  - add `"sung_before"` to `ReasonType`;
  - in `_rec_song`, apply `key_hints`: if the song has a fit and a hint, adjust `RecFit.transpose` by the hint, and when the bucket is `fits`, set `fitsIn` with that transpose. Otherwise there's no fit change. This is the first consumer of a per-song key hint; 3d's `session_key_hint` isn't read anywhere, so leave it.
- Test: extend `backend/tests/recs_v2/test_context.py`, `test_scoring.py` (`test_formula_matches_weights_exactly` must still pass), `test_sections.py` (update `ORDER` in `test_section_order_and_ids` for `go_tos` first) and `test_route.py`.

- [ ] **Step 1: Write failing tests**
  - `test_sung_great_is_known_at_full_weight`.
  - `test_sung_once_no_survey_is_point_eight`.
  - `test_latest_bad_moves_to_survey_no_even_if_loved`.
  - `test_survey_no_penalised_0_4`.
  - `test_survey_no_not_a_because_seed`.
  - `test_go_tos_section_first_and_deduped`.
  - `test_key_hint_sets_transpose`: a too_high song that fits gives `fitsIn` with transpose -2.
  - `test_session_rules_unchanged`: run 3d's existing session tests unchanged.
  - `test_reason_sung_before`.
- [ ] **Step 2:** Run `poetry run pytest backend/tests/recs_v2 -v`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: the recs_v2 suite PASSES, including every pre-existing test.
- [ ] **Step 5:** Commit `feat(recs-v2): sung history + survey weights, go-tos section, key hints`.

### Task C4: The crowd API and crowd in recs

**Files:**
- Create: `backend/api/routes/songs.py`, mounted at `/api/songs`. It serves `GET /api/songs/{song_key:path}/crowd`, authenticated via `CurrentUser` and decoded with `my_songs._song_key`'s raw-path approach. It returns `SongCrowd`:
  - `{singers: int|null, comfortable_share: float|null, too_high_share: float|null, too_low_share: float|null, bucket: str|null, bucket_singers: int|null, bucket_comfortable_share: float|null, crowd_pleaser_share: float|null}`;
  - every overall field is null when total singers < `CROWD_MIN_SINGERS`;
  - the bucket fields are null unless the viewer has a bucket and that bucket has ≥ `CROWD_MIN_BUCKET`;
  - `singers` itself is null below the threshold.
  - Put `crowd_figure(stats, viewer_bucket) -> SongCrowd` in `crowd_stats.py`.
- Modify: `backend/services/recs_v2/service.py`:
  - after `_rank`, read `song_crowd_stats` for the returned songs with one `get_all` (at most ~100; add a `get_documents_batch` helper to FirestoreService if none exists);
  - set `RecSong.crowd: SongCrowd | None`;
  - within the `crowd_pleasers` section only, stably reorder songs with `crowd_pleaser_share >= 0.5` and singers ≥ threshold to the top.
  - If the batch read raises, fall back to `crowd=None` with a warning log, never ERROR.
  - Time it, and log at INFO when it takes > 50 ms.
- Modify: `backend/services/recs_v2/context.py`. When the viewer's bucket figure says mostly too high (`bucket_too_high_share >= 0.6` with ≥ threshold) and the user has no own key hint, add a crowd-based key hint (-2). Do the same for too low (+2). This needs the stats; compute it in service.py after the batch read, not in context.
- Test: `backend/tests/test_crowd_route.py`, plus extend `test_crowd_stats.py` and `recs_v2/test_route.py`.

- [ ] **Step 1: Write failing tests**
  - `test_crowd_hidden_below_five`: 4 singers give all nulls.
  - `test_crowd_overall_at_five`: 5 singers, 4 right, give `comfortable_share == 0.8`.
  - `test_crowd_bucket_needs_five_in_bucket`: overall 9, with 4 baritones, gives a baritone viewer `bucket_* == null`.
  - `test_crowd_bucket_shown`.
  - `test_crowd_route_auth_and_slash_key`.
  - `test_recs_attach_crowd_and_reorder_crowd_pleasers`.
  - `test_recs_crowd_read_failure_degrades`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat: crowd singability API + crowd in recs`.

### Task C5: The Get this made endpoint and dismissals

**Files:**
- Create: `backend/services/get_made_service.py`:
  - `GetMadeItem {key, song_key|null, artist, title, why: Literal["saved","sung","imported","voice","recommended"], weight: float}` and `GetMadeResponse {items: list[GetMadeItem]}`;
  - `GetMadeService(firestore, catalog_store, recs: RecommendationServiceV2)` with `async def list(user_id) -> GetMadeResponse`:
    - candidates are the user's `user_songs` with no karaoke version: `has_karaoke_key` false and `match_kn` None, the same test as `_map_songs`;
    - include rows that are loved, sung (times_sung > 0), imported (a listening source in `sources`) or voice-session-labelled with `session_would_sing` yes;
    - include uncatalogued songs that were sung (`user_karaoke_unresolved` docs, key `"u:"+norm_key`);
    - rank by recs weight, descending;
    - then top up with the recs v2 `make_it` section to a total of 30;
    - exclude dismissed keys and survey_no songs.
- Create: `backend/api/routes/get_made.py`, mounted at `/api/my/get-made`:
  - `GET ""` returns `GetMadeResponse`;
  - `POST "/{key:path}/dismiss"` and `DELETE "/{key:path}/dismiss"` return 204;
  - dismissals live in `user_make_dismissed/{user_id}:{sha1(key)[:24]}` with fields `{user_id, key, created_at}`.
- Modify: `backend/services/user_deletion.py`. Add `UserDataStore("user_make_dismissed", "user_id_field")` and tell Phase 6.
- Modify: `backend/api/routes/test_support.py`. Add `user_make_dismissed` to `USER_OWNED`, plus `POST /api/test/get-made/seed {email, songs: [{artist, title, song_key?, loved?, times_sung?}]}`, which writes `user_songs` rows for fixture songs with `in_kn=0`.
  - The catalog fixture's "Fixture Artist NN / Fixture Song NN-MM" rows have `in_kn=0`, so use one, e.g. "Fixture Artist 01 / Fixture Song 01-01". Check that availability.db doesn't list it.
- Test: `backend/tests/test_get_made.py`.

- [ ] **Step 1: Write failing tests**
  - `test_get_made_lists_loved_no_karaoke`.
  - `test_get_made_excludes_has_karaoke`.
  - `test_get_made_includes_sung_unresolved`.
  - `test_get_made_excludes_dismissed_and_survey_no`.
  - `test_get_made_topped_up_from_make_it_and_capped_30`.
  - `test_dismiss_roundtrip_and_privacy`: responses carry no `user_id`.
  - `test_registry_guard_passes`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat: GET /api/my/get-made + dismissals`.

### Task C6: The BigQuery crowd fill (lowest priority; may slip)

**Files:**
- Modify: `karaoke_decide/etl/vocal_range_refresh.py` (`CROWD_FIELDS` ~164, publish ~600). It fills `crowd_comfortable` / `crowd_too_low` / `crowd_too_high` from `song_crowd_stats` totals, only where singers ≥ `CROWD_MIN_SINGERS`, else NULL. It reads Firestore with the job's credentials.
- Modify: `infrastructure/__main__.py`. Add `gcp.projects.IAMMember("mb-refresh-datastore-viewer", role="roles/datastore.viewer", member=mb_refresh_member)`, the same pattern as `vocal-range-gen-datastore-viewer` ~1390.
- Test: extend the vocal_range_refresh tests with a fake Firestore.

- [ ] **Step 1:** Write a failing test: `test_publish_fills_crowd_when_threshold_met`, where 4 singers give NULL and 5 give counts.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement. Failures stay best-effort and are logged at WARNING.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(etl): fill song_vocal_range crowd_* from song_crowd_stats`.

### Task C7: The test API crowd seed

**Files:**
- Modify: `backend/api/routes/test_support.py`. Add `POST /api/test/crowd/seed {song_key, total: {right, too_low, too_high}, by_bucket?: {...}, crowd_pleaser_yes?}`, which writes `song_crowd_stats` directly, and `POST /api/test/crowd/reset {song_key}`.
- Test: `backend/tests/test_test_support.py`.

- [ ] **Step 1:** Write a failing test: `test_crowd_seed_then_route_shows_figure`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `test-api: crowd seed/reset`.

### Task C8: Docs, version, review, PR, deploy, Pulumi

**Files:**
- Modify: `docs/API.md` (get-made, crowd, summary `known_songs`, test API).
- Modify: `docs/ARCHITECTURE.md` § Personal data (`user_make_dismissed`; `song_crowd_stats` as aggregate).
- Modify: `docs/TESTING.md`.
- Modify: `pyproject.toml`, the next minor above main's version at PR time.

- [ ] **Step 1:** Write the docs and bump the version.
- [ ] **Step 2:** Run `make test-backend`, ruff and mypy (py3.12, the whole of `karaoke_decide` and `backend`, as CI does).
- [ ] **Step 3:** Run `/coderabbit` (max 3 cycles).
- [ ] **Step 4:** Message Phase 3d (recs_v2) and Phase 6 (registry). Open the PR and tell the orchestrator. Merge when CI is green.
- [ ] **Step 5:** After the deploy:
  - check that `GET /api/my/get-made` returns 401 (not 404) on prod;
  - from decide main, run `pulumi preview --target <mb-refresh-datastore-viewer URN>` (it must show 1 create and 0 deletions), then the targeted `up` via `scripts/gcp-admin` (ask Andrew for `/gcp-admin` if the grant has expired);
  - record the change in the decide infra docs.

---

## Part D: nomad-mobile (worktree `nomad-mobile-phase4-me`)

### Task D1: Clients and facades

**Files:**
- Modify: `openapi/decide.json`. Build it in-process from the decide worktree, as in 4a B1.
- Modify: `openapi/gen.json`. Refresh it from prod gen (`pnpm gen:api` gen part, or `fetch-openapi.mjs gen`). It must carry `VoteBody.confirm_delete` / `SongRequestPublic.request_deleted`.
- Regenerate both clients.
- Modify: `packages/api-decide/src/me.ts`. Add:
  - `getGetMade(): Promise<GetMadeItem[]>`;
  - `dismissGetMade(key: string): Promise<void>` and `undismissGetMade(key: string): Promise<void>`;
  - `getSongCrowd(songKey: string): Promise<SongCrowd>`.
  - Call the generated ops directly; never import from `./index` (R7).
- Create: `packages/api-gen/src/facades/requests.ts`, exported from the package index:
  - `type RequestOutcome = { status: 'created' | 'already_exists'; request: SongRequestPublic } | { status: 'vote_used' } | { status: 'submission_limit' }`;
  - `submitSongRequest(artist: string, title: string): Promise<RequestOutcome>`. It maps 409 `vote_already_used` to `vote_used` and 429 to `submission_limit`; other errors throw. It never calls vote (R15).
  - `listBoardRequests(): Promise<SongRequestPublic[]>`, active requests only.
- Test: `packages/api-decide/src/__tests__/me.test.ts` (extend) and `packages/api-gen/src/__tests__/requests.test.ts`.

- [ ] **Step 1:** Write failing tests:
  - `submitSongRequest` maps 201/200 `already_exists`, 409 `vote_already_used` and 429;
  - `submitSongRequest` sends no vote call;
  - `getSongCrowd` encodes a key containing `|`;
  - the get-made facades.
- [ ] **Step 2:** Run `pnpm jest packages/api-decide packages/api-gen`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus `pnpm gen:api:offline && git diff --exit-code packages/*/src/client`: PASS.
- [ ] **Step 5:** Commit `feat(api): get-made, crowd, requests-board facades`.

### Task D2: The Discover go-tos section and reason

**Files:**
- Modify: `packages/core/src/discover/reasons.ts`. Add `go_tos` to `SECTIONS` and `sung_before` to `REASON_TYPES`.
- Modify: `packages/i18n/messages/en.json`. Add `discover.section.go_tos` / `go_tosReason` and `discover.reason.sung_before` ("You've sung this {n}×" or "Your go-to"; pick the version that needs no count unless one is available) and translate.
- Rows already show the fit badge, so the key hint arrives through `fit.transpose` with no UI change.
- Test: the core reasons tests and `apps/mobile/src/__tests__/discoverRecs.test.tsx`: a `go_tos` section renders first, with its title and the reason chip.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement and translate (`/Users/andrew/Projects/nomadkaraoke/scripts/gcp-admin env -u GEMINI_API_KEY pnpm i18n:translate`).
- [ ] **Step 4:** Run the tests, plus `pnpm i18n:check`: PASS.
- [ ] **Step 5:** Commit `feat(discover): Your go-tos section`.

### Task D3: Get this made (Me shelf and screen)

**Files:**
- Create: `apps/mobile/src/me/useGetMade.ts`. `useGetMade(): { items: GetMadeRow[]; loading; offline; dismiss(key); undismiss(key) }`:
  - query `['decide', userKey, 'get-made']`, cached in MMKV `me.getmade.v1.<userKey>`;
  - add `'get-made'` to the purge list in `useClearMeOnAccountChange.ts`;
  - drop rows matching the user's gen jobs (`useMyJobs(email)` from `apps/mobile/src/jobs/useMyJobs.ts`, by normalised artist|title via `songKey`);
  - mark rows matching active board requests (`listBoardRequests`, query `['gen','requests-board']`, staleTime 5 min) with `boardVotes`;
  - dismiss is optimistic, enqueues a Me-outbox item `{ key: 'dismiss:<key>', op: 'dismiss', key, dismissed: boolean }` (a new op in `MeOutboxItem`, plus `meMerge` latest-wins and `sendMe`), and shows a 5 s undo toast.
- Create: `apps/mobile/src/me/GetMadeShelf.tsx`. Up to 3 rows (`me-getmade`, `me-getmade-${i}`), plus See all → `/me/get-made`. It renders in MeHome's 4b slot, and nothing when empty.
- Create: `apps/mobile/src/app/me/get-made.tsx` with the full list (`me-getmade-screen`). Each row has:
  - title, `artistLabel`, a why chip, and "N votes on the board" when it's on the board;
  - **Make it** (`getmade-make-${i}`): `identifiedIntent` (song_key) or `typedIntent`, then `/make/new`, or `openSignIn`;
  - **Request it free** (`getmade-request-${i}`): `submitSongRequest`. Outcomes: created/already_exists shows "Requested · N votes" and invalidates the board query; vote_used shows "You've used today's free vote"; submission_limit shows "One free request a day: try tomorrow". Offline disables it;
  - **Dismiss** (`getmade-dismiss-${i}`).
  - Register the route in `_layout.tsx` and test-utils routes.
- Modify: `apps/mobile/src/me/MeHome.tsx` (the 4b slot).
- Modify: `packages/i18n/messages/en.json` (`me.getMade.*`), then translate.
- Test: `apps/mobile/src/__tests__/me/getMade.test.tsx`:
  - a made song is hidden;
  - a board match shows its votes;
  - each request outcome shows its copy, and no vote call is sent;
  - dismiss and undo;
  - offline disables Make and Request;
  - a typed intent for a `u:` key.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement and translate.
- [ ] **Step 4:** Run the tests, plus the full `pnpm jest --forceExit` once: PASS.
- [ ] **Step 5:** Commit `feat(me): Get this made (Make it / Request it free / dismiss)`.

### Task D4: Go-tos shelf from recs, merged with local

**Files:**
- Modify: `apps/mobile/src/me/GoTosShelf.tsx`. When signed in and the recs go_tos section exists (from `useRecommendations` / the cached snapshot), show recs `go_tos` songs, which carry fit badges, then merge in the local `isGoTo` uncatalogued songs (`song_key == null`), deduped by `libraryKey`, max 5.
  - With no recs section (offline cold, or decide warming), fall back to today's local computation.
- Test: extend `apps/mobile/src/__tests__/me/meHome.test.tsx`:
  - recs go_tos come first, with a fit badge;
  - a local uncatalogued go-to is kept;
  - without recs, the local list is used.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(me): go-tos from recs with local uncatalogued go-tos`.

### Task D5: The song page crowd line

**Files:**
- Create: `apps/mobile/src/me/SongCrowdLine.tsx`. `SongCrowdLine({ songKey })` queries `['decide', userKey, 'crowd', songKey]` via `getSongCrowd`, signed in only, staleTime 1 h. It renders nothing when everything is null, and otherwise one line:
  - with a bucket figure: "72% of baritones found the key comfortable";
  - else overall: "8 of 11 singers found the key comfortable";
  - else "Most singers found it a bit high" when `too_high_share >= 0.6`.
  - Offline shows the last cached value, or nothing.
  - testID `song-crowd`.
- Modify: `apps/mobile/src/app/song/[id].tsx`. Put it inside `song-badge-card`, after `<SongFitCard>` (~L198).
- Modify: `packages/i18n/messages/en.json` (`song.crowd.*`, with the voice-type names reused from `fit.*`/voice keys), then translate.
- Test: `apps/mobile/src/__tests__/me/songCrowd.test.tsx`: each copy case, and null renders nothing.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement and translate.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(song): crowd singability line`.

### Task D6: Profile card "songs known" and the setlist no-cache fix (4a follow-ups)

**Files:**
- Modify: `apps/mobile/src/me/ProfileSummaryCard.tsx`. Restore `me-profile-known` from the services summary's `known_songs`, and hide it when it's absent (older decide). Restore the i18n key `me.home.known` (translate).
- Modify: `apps/mobile/src/me/setlistsCache.ts`, `useSetlists.ts` and `librarySettle.ts` (ruling R13 follow-up):
  - when nothing is cached, keep a sent Setlist in a settling overlay, cleared by a setlists fetch that started after the send, the same pattern as `librarySettle`;
  - `addSongs` / `removeItem` use the last-known setlist, as `save()` does.
- Test: extend `meHome.test.tsx` (known count) and `useSetlists.test.tsx`: no cache, then create, send, with the refetch rejected; the setlist stays visible, and `addSongs` during the gap works.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `fix(me): songs known from decide; setlists survive a no-cache sync gap`.

### Task D7: Maestro flows (build host)

**Files:**
- Modify: `maestro/scripts/stack.js`. Add:
  - `ACTION: get-made-seed` (`EMAIL`, `SONGS` → decide `POST /api/test/get-made/seed`);
  - `ACTION: crowd-seed` (`SONG_KEY`, `TOTAL`, `BY_BUCKET`) and `crowd-reset`;
  - document them in the header.
- Create flows (tags `[me]`):
  - `me-10-gotos-discover.yaml`: log-seed two great Hello records, then Discover. The `go_tos` section shows first with Hello; shot.
  - `me-11-get-made.yaml`: get-made-seed a loved fixture song with no karaoke. Me shows the Get this made shelf. See all → Request it free gives "Requested". Back, then Make it opens make with that song (assert the make screen title/artist). Dismiss → it's gone → undo → it's back.
  - `me-12-crowd.yaml`: crowd-seed Adele "Hello" (`adele|hello`) with 5 right + 1 too_high overall and 5 baritone right, and voice-seed baritone. The song page shows the `song-crowd` text ".*baritones.*comfortable.*". Then crowd-reset gives no line.
- Modify: `maestro/screens/me-tour.yaml`. Add shots of the Get this made shelf and screen, the go-tos section in Discover, and the song page crowd line.
- Modify: `maestro/durations.json` with estimates for me-10…12 (60 s each).
- Run: `scripts/e2e-ci.sh run --filter me-` (both platforms). Then the PR's affected run. Review the screenshots from `.e2e-ci/<run>/` (en; ar via the tour if the CI supports `--screen`, else note it). Judge flow by flow from the junit files. Known main failures don't block.

- [ ] **Step 1:** Write the flows and actions.
- [ ] **Step 2:** Push, then `scripts/e2e-ci.sh run --filter me-`. Iterate until me-1…12 pass on both platforms. Rerun only failures caused by infra.
- [ ] **Step 3:** Review the screenshots, fix real UX issues with jest tests, and re-run.
- [ ] **Step 4:** Commit `test(e2e): me-10…12 (go-tos, get made, crowd)`.

### Task D8: Docs, review, PR

**Files:**
- Modify: `CLAUDE.md`, adding Phase 4b to Status, the new modules, the E2E bullet (new actions, me-10…12) and any gotchas.
- Modify: `docs/VISION.md`, roadmap row 4 ("4a, 4b built; 4c next").
- Modify: the spec, adding an "As built (4b)" subsection.
- Modify: this plan, adding the execution ledger.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `pnpm typecheck && pnpm lint && pnpm jest --forceExit && pnpm i18n:check && pnpm gen:api:offline && git diff --exit-code`.
- [ ] **Step 3:** `/coderabbit` (max 3 cycles), then a final whole-branch review on the most capable model, with one fix wave.
- [ ] **Step 4:** Merge or rebase main. Message the sessions that share files. Open the PR with `e2e-full`, and tell the orchestrator.
- [ ] **Step 5:** Merge when E2E is green apart from known main failures. Tell the orchestrator. Add to the manual-pass list:
  - real crowd figures once data exists;
  - Request it free on prod with a real account;
  - go-tos on Andrew's real history.

## Execution ledger

Subagent-driven, with one implementer and one reviewer per task. Fix rounds are shown in the outcome column.
- decide = karaoke-decide-phase4-me (Part C). It merged as #200 (07a3e64, v0.35.0) and was deployed 2026-10-28; the prod smoke passed.
- mobile = this branch (Part D), BASE 366f9fd.
- Order: C1–C8, then D1–D8. D3/D4/D5 ran in parallel in one shared worktree, so commits were staged by path only.

| Task | Commits | Review outcome |
|---|---|---|
| C1 survey state + crowd counters in the log transaction | decide 5ff8c91..13c20aa | clean after 1 fix round (per-field stamps, R17 answered counter) |
| C2 backfill `last_sung_at` + `known_songs` | decide 13c20aa..3667d13 | approved; follow-up (malformed night.date, `u:` identity) clean |
| C3 recs v2 from history + `go_tos` section | decide 3667d13..27843a6 | clean after 1 fix round (R20a, R21) |
| C4 crowd API + crowd in recs | decide 27843a6..dc8e003 | clean after 1 fix round (own key beats crowd hint, R23 hashed ids) |
| C5 Get this made endpoint + dismissals | decide dc8e003..8589e97 | approved (0C/0I/6M); follow-up clean |
| C6 BigQuery crowd fill + Pulumi grant | decide 8589e97..3d7c342 | approved (0C/0I/4M); follow-up verified by diff read |
| C7 test-API crowd + get-made seeds | decide 3d7c342..eeb6213 | approved (0C/0I/3M); follow-up (bucket ≤ total → 422) |
| C8 docs, v0.35.0, R18 rebuild script, R19 web i18n, PR | decide ea9b025, bf691ec, 08231b1, 9140c7d, faa41bd; #200 merged 07a3e64 | CodeRabbit: 2 cycles. Whole-branch review "Fix first" (all-null `RecSong.crowd` revealed a sub-threshold doc; summary 500 on a `count_known_songs` failure) was fixed in faa41bd. The deploy, the Pulumi apply (mb-refresh-datastore-viewer, via gcp-admin) and the R18 dry run (no-op) are done. |
| D1 clients + facades (get-made, crowd, requests board) | d437062, 1bbe863 | approved (0C/0I/3M); follow-up (429 only with `submission_limit`, R26 board shape) |
| D2 Discover go-tos section + reason | 7d56295 | approved (0C/0I/2M) |
| D3 Get this made (Me shelf + screen) | af28cec, 96ba4b7, 694b81b; R28 UX 8e4e291, 2b2bb57 | Needs fixes (load failure showed a false empty state); clean after 1 fix round + follow-up |
| D4 go-tos shelf from recs merged with local | bdd808b, 1d8d4a3, 1bde9fa | Needs fixes (Discover Not for me not reflected on the shelf); clean after 1 fix round + follow-up |
| D5 song page crowd line | 67ae84b, 5c6733c, 3b6266e | Needs fixes (the query key ignored the viewer's voice); clean after 1 fix round; deviations approved |
| D6 "songs known" + setlist no-cache settle | 254379a, 779e6f4 | approved (0C/0I/3M); follow-up (settle after commit, per-account services summary) |
| D7 Maestro me-10…12 + me-tour shots | ef3d532, 9942560, dc18430, 2bb4bf0; lint c9727a5 | CI run 40791061721: me-1…12 passed on iOS and Android. me-11 after R28: iOS 40795789679, Android 40794700559. One app fix (duplicate title). |
| D8 docs, review, PR | this commit | final whole-branch review, PR |

Rulings R15–R28 are listed one per line in the spec's §5 "As built (4b)", together with the deviations, the deferred follow-ups and the manual-pass list.

Process notes:
- D3's first fix commit swept in D5's staged files in the shared worktree. It was rebuilt with a temporary index, so each commit holds only its own task's paths. D3's fix-round tests were written after the fixes; no red run was possible without disturbing the live agents.
- The build-host CI replaced local Maestro runs. me-7 flaked once on Android (launch timing), which is infra, not 4b.
- Coordination: the orchestrator ([6f4a7b]) and Phase 6 ([c26790]) were told about the new decide collections (`user_make_dismissed`, `song_crowd_stats`, `sung_surveys`).
