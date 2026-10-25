# Phase 4a "Me: collection and library" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice 4a of the approved Phase 4 spec: the redesigned Me home with a profile summary card, the karaoke collection, setlists, Save / Add to setlist / Mark as sung, the bulk picker, survey vibe and why chips, the music profile fixes, and offline reading and editing. It is backed by decide changes for the library, backfill and setlists.

**Architecture:**
- **Part A (karaoke-decide, one PR):**
  - extends `karaoke_log` (survey chips, backfill records with `times`);
  - adds `GET /api/my/library`, which aggregates the user's log, loves, hides and setlists with catalog facets;
  - upgrades `playlists` into ordered setlists with titles, client ids and a full-replace items PUT.
- **Part B (nomad-mobile, one PR):**
  - Me's data layer caches the library and setlists per account in MMKV;
  - a generic outbox (factored out of Tonight's) carries setlist and love edits, overlaying pending edits on the cache;
  - the screens build on existing components (SurveySheet, RecSongRow patterns, SongTonightAction, the make intent).

**Tech Stack:**
- decide: FastAPI, Pydantic v2, Firestore, SQLite catalog, pytest (`asyncio_mode=auto`), Pulumi.
- mobile: Expo SDK 57 / RN 0.86, Expo Router, TanStack Query 5, Zustand 5 + MMKV, hey-api clients, use-intl, Skia (only in `packages/ui`), jest-expo, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-25-mobile-phase4-me-design.md` (Phase 4 design, approved 2026-10-25). Raw survey beside it. Slices 4b and 4c get their own plans after 4a merges.

**Repos / worktrees:** decide `/Users/andrew/Projects/nomadkaraoke/karaoke-decide-phase4-me`, mobile `/Users/andrew/Projects/nomadkaraoke/nomad-mobile-phase4-me`. Both are on branch `feat/sess-20261024-0045-phase4-me`. Part B's generated client needs Part A's OpenAPI. Run Part A first, then point `DECIDE_OPENAPI_URL` at the local decide stack (`http://127.0.0.1:8030/openapi.json`) for B1.

**Execution order:** A1–A8, then B1–B7, B10, B11, B9, B8, B12, B13. B9 uses B10's `MarkSungSheet` and B11's `AddToSetlistSheet`; B8 uses B11's `SetlistNameSheet`.

## Global Constraints

- **decide:**
  - TDD is mandatory.
  - Bump `pyproject.toml` `tool.poetry.version` to `0.29.0` in A8 (the current version is 0.28.2; another session may bump it first, so take the next minor at merge time).
  - Run `make lint` (ruff + mypy) and `make test-backend` before the PR.
- **decide privacy:** responses never include `user_id` or `email_hash` (follow `karaoke_log.py`'s `response_model_exclude` pattern).
- **mobile:**
  - Put no user-facing string literals in JSX; every new key goes in `packages/i18n/messages/en.json` and runs `pnpm i18n:translate` (all 33 locales) before commit.
  - Copy says "host", never "KJ". Interpolated titles go through `isolate()`.
  - Every interactive element gets a `testID`.
  - Import FlashList and Skia only inside `packages/ui`.
  - Never put tests under `apps/mobile/src/app`; screen tests go in `apps/mobile/src/__tests__/`.
- **mobile:** use `userKeyFor(email)` for every per-account MMKV key. Sign-out clears Me's caches. A different account signing in purges the previous owner's Me data and unsent Me outbox items.
- **Library identity:** `libraryKey = song_key ?? "u:" + songKey(artist, title)`. The TS `songKey` is in `packages/core/src/search/normalize.ts:191`; the Python one is `karaoke_decide/song_search/text_normalize.py:253` `song_key`. They match.
- **The stored artist sentinel `"Unknown Artist"` is shown translated:** use `artistLabel()` from `tonight/log/logStore.ts`.
- **Survey enums:**
  - Vibe: `party | ballad | warm_up | duet | emotional | rock_out | singalong`.
  - Reason: `out_of_range | too_hard | crowd_quiet | awkward_music | too_long | didnt_know_it`.
- **Backfill:** `times` is 1–50 (default 1). `origin` is `live | backfill`. `night.date_precision` is `day | month | year | unknown`.
- **Setlists:** at most 500 items. A client id matches `^pl_[A-Za-z0-9-]{8,64}$`. `rev` is an int bumped on every write. Edits are last-writer-wins.
- **Go-to rule** (one helper, used by the shelf and the sort): the latest survey feel isn't `bad`, the song isn't hidden, and either the latest feel is `great` or `times_sung >= 2`.
- **Coordination before merging shared files:** message the active sessions (nomadkaraoke-14 Phase 6, nomadkaraoke-72 3d if still active) before merging `(tabs)/me.tsx`, `_layout.tsx`, `packages/i18n` messages, `packages/ui`, `packages/core` index, package.json/lock, CI, or decide `models`/`ci.yml`/Pulumi. Message the orchestrator nomadkaraoke-12 at each PR opened and merged.

## Review Focus

1. **Two accounts on one phone:** after sign-out → sign-in as B, nothing of A's library, setlists or pending setlist edits is visible or sent. The test is in B4.
2. **A setlist made offline, edited, then synced:** one create with the final items reaches decide, the id is unchanged, and nothing is duplicated after a retry (create is idempotent on the client id). Tests in A5 and B3.
3. **A song sung only as an uncatalogued free-text entry:** it shows in All your songs, counts in stats, opens `me/history/[key]`, and can be added to a setlist. Tests in A4, B8 and B9.
4. **Editing a backfill record's `times`, or deleting it:** `user_songs.times_sung` moves by the exact delta and never goes negative. Test in A2.
5. **Library etag revalidation:** a 304 keeps the cached items, and an edit (love, setlist change, new log record) changes the etag. Tests in A4 and B2.

---

## Part A: karaoke-decide (worktree `karaoke-decide-phase4-me`)

### Task A1: Make `karaoke_log` a real UserSong source

**Files:**
- Modify: `karaoke_decide/core/models.py:114-129` (the `UserSong.source` Literal)
- Modify: `frontend/src/components/ui/Badge.tsx:53-70` (`SOURCE_BADGES`: add `karaoke_log` and `manual`)
- Modify: `frontend/messages/en.json` and every locale (badge labels "Sung at karaoke" / "Added by you"; run the repo's translate script)
- Test: `backend/tests/test_user_songs_sources.py` (new)

**Interfaces:**
- Produces: `UserSong.source` accepts `"karaoke_log"`.

- [ ] **Step 1: Write failing tests**
  - `test_get_user_songs_with_karaoke_log_row`: seed a `user_songs` doc `{source:"karaoke_log", song_key:"adele|hello", times_sung:2}`, call `RecommendationService.get_user_songs(user_id)` (or `GET /api/my/songs` with a `dependency_overrides` user, following `test_karaoke_log_routes.py:51-135`), and assert 200 with one item whose `source == "karaoke_log"` and `times_sung == 2`.
  - `test_user_song_accepts_every_written_source`: for each value in `{"karaoke_log","manual","voice_session"}`, `UserSong(id="u:s", user_id="u", song_id="s", source=v)` validates.
- [ ] **Step 2:** Run `poetry run pytest backend/tests/test_user_songs_sources.py -v`. Expect FAIL (a validation error).
- [ ] **Step 3:** Add `"karaoke_log"` to the Literal, and add the two badge entries plus i18n keys.
- [ ] **Step 4:** Run the tests: PASS. `make lint`: clean.
- [ ] **Step 5:** Commit `fix: karaoke_log is a valid UserSong source (GET /api/my/songs 500)`.

### Task A2: Survey chips and backfill records in the karaoke log

**Files:**
- Modify: `backend/models/karaoke_log.py`. Add type aliases `Vibe`, `Reason`, `LogOrigin = Literal["live","backfill"]` and `DatePrecision`. `Survey` gains `vibes: list[Vibe] = []` and `reasons: list[Reason] = []` (deduped, each at most 7 / 6). `LogNight` gains `date_precision: DatePrecision | None`. `KaraokeLogEntry` gains `origin: LogOrigin | None` and `times: int = Field(1, ge=1, le=50)`.
- Modify: `backend/services/karaoke_log_service.py`:
  - add `origin` and `times` to `USER_APP_FIELDS` (not to `USER_KJ_FIELDS` or `PARTNER_FIELDS`);
  - validate `times` 1–50 (otherwise `KaraokeLogInvalidError`);
  - `_inc` / `_dec` move by `times`;
  - `_transact` treats `(target, times)` as the counted identity, storing `counted = {collection, doc_id, times}`, so a `times` change on the same target decs the old times and incs the new times;
  - `_dec` clamps at 0.
- Test: `backend/tests/test_karaoke_log_service.py` (extend; reuse `MemoryFirestore` / `FakeReader`)

**Interfaces:**
- Produces: `KaraokeLogEntry.origin`, `.times`, `Survey.vibes`, `Survey.reasons`, `LogNight.date_precision` (these reach the OpenAPI used by B1).

- [ ] **Step 1: Write failing tests**
  - `test_survey_vibes_and_reasons_roundtrip`: `upsert_user(uid, "app_x", {state:"sung", artist:"Adele", title:"Hello", survey:{feel:"ok", vibes:["ballad","ballad","emotional"], reasons:["too_long"]}})`, then `entry.survey.vibes == ["ballad","emotional"]` and `entry.survey.reasons == ["too_long"]`.
  - `test_unknown_vibe_rejected`: `vibes:["moshpit"]` raises `KaraokeLogInvalidError`.
  - `test_backfill_times_counts`: an `app_` record `{state:"sung", origin:"backfill", times:5, night:{kind:"other", date:"2024", date_precision:"year"}}` gives the target row `times_sung == 5`.
  - `test_backfill_times_edit_moves_by_delta`: 5 → 2 gives `times_sung == 2`; then a delete gives 0, and a `source=="karaoke_log"` unloved row is removed.
  - `test_times_bounds`: `times:0` and `times:51` are rejected.
  - `test_kj_record_cannot_set_times`: `upsert_user(uid, "kj_…", {times:3})` raises `NotOwnerError`.
- [ ] **Step 2:** Run `poetry run pytest backend/tests/test_karaoke_log_service.py -v -k "vibe or backfill or times"`. Expect FAIL.
- [ ] **Step 3:** Implement as described in Files.
- [ ] **Step 4:** Run the whole `test_karaoke_log_service.py` + `test_karaoke_log_routes.py`: PASS (the existing tests are unchanged).
- [ ] **Step 5:** Commit `feat(karaoke-log): survey vibes/reasons, backfill records with times`.

### Task A3: Per-song filter on the karaoke log list

**Files:**
- Modify: `backend/services/karaoke_log_service.py`. `list_for_user(..., song: str | None = None)`; `song` is a library key (`song_key`, or `"u:" + song_key(artist,title)` for unresolved records) and filters in Python after the equality query.
- Modify: `backend/api/routes/karaoke_log.py`. Add `song: str | None = Query(None, max_length=600)`.
- Test: extend `test_karaoke_log_service.py` and `test_karaoke_log_routes.py`.

**Interfaces:**
- Produces: `GET /api/my/karaoke-log?song=<libraryKey>`, and a helper `library_key(doc: dict) -> str` in `karaoke_log_service.py` that A4 uses.

- [ ] **Step 1:** Write a failing test, `test_list_filter_by_library_key`: three records (two "Adele|Hello" resolved to `adele|hello`, one unresolved "Nobody Knows / My Song"). `song="adele|hello"` returns 2; `song="u:nobody knows|my song"` returns 1.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement `library_key(doc)`: `doc["song_key"]` when `song_key_status == "resolved"`, else `"u:" + make_song_key(artist, title)`.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(karaoke-log): filter list by library key`.

### Task A4: Library endpoint with catalog facets

**Files:**
- Create: `backend/services/catalog_facets.py`, containing:
  - `SongFacets` (Pydantic: `mood: str|None`, `energy_band: Literal["low","mid","high"]|None`, `has_karaoke: bool`, `community: bool`, `karafun: bool`, `vr_tier: str|None`);
  - `def song_facets(reader: CatalogReader, keys: Sequence[str]) -> dict[str, SongFacets]`: synchronous, chunked at 500. It reads `songs.mood/energy/in_kn/vr_tier`, uses `energy_band()` from `karaoke_decide/catalog/moods.py`, and gets community/karafun from the same SQL as `recs_v2/candidates._Gatherer.availability()` (lines 138-163), extracted into a shared function rather than copied. Keys not in the catalog are omitted.
  - `def song_titles(reader, keys) -> dict[str, tuple[str, str]]` (artist, title).
- Create: `backend/services/library_service.py`, containing:
  - `LibraryItem`:
    - `key`, `song_key: str|None`, `artist`, `title`;
    - `times_sung: int`, `backfill_times: int`, `first_sung_at`, `last_sung_at`;
    - `feel_counts: dict[Literal["great","ok","bad"], int]`, `latest_feel`, `latest_key`, `crowd_pleaser_count: int`, `vibes: list[Vibe]`;
    - `loved: bool`, `hidden: bool`, `setlist_ids: list[str]`, `facets: SongFacets|None`.
  - `LibraryResponse(items: list[LibraryItem], etag: str)`.
  - `class LibraryService(firestore, feedback: SongFeedbackService, playlists: PlaylistService, catalog_store: CatalogStore)` with `async def get_library(user_id) -> LibraryResponse`.
- Create: `backend/api/routes/library.py`: `GET /api/my/library`. It returns 304 with no body when the `If-None-Match` header equals the etag, and otherwise 200 with an `ETag` header. Mount it in `backend/api/routes/__init__.py` at `/my/library`. Add a dependency `get_library_service` in `deps.py`.
- Test: `backend/tests/test_library_service.py`, `backend/tests/test_library_routes.py`, `backend/tests/test_catalog_facets.py` (uses the fixture catalog built by `python -m karaoke_decide.catalog.fixtures build`, or a tiny sqlite built in the test with the `schema.py` DDL).

**Interfaces:**
- Consumes: `library_key(doc)` (A3); `list_loved`, `hidden_keys` (`song_feedback_service.py`); `PlaylistService.list_playlists` items (A5; until A5 lands use `song_ids`).
- Produces: `GET /api/my/library` → `LibraryResponse`; `song_facets` / `song_titles` (A5 uses them).

Aggregation rules (from the spec):
- Count only records where `state in {"sung","sung_unplayed"}` and not deleted (as `_counts`), adding `times`.
- `backfill_times` sums records with `origin=="backfill"`.
- `first_sung_at` / `last_sung_at` use `sung_at or ended_at or night.date`, skipping backfill records with no date.
- Latest feel and key come from the survey with the greatest `answered_at`.
- Library membership: sung, loved or in a setlist. Hidden-only songs are not included.
- etag = sha1 of the canonical JSON of `items`, sorted by key.

- [ ] **Step 1: Write failing tests**
  - `test_library_groups_and_counts`: two "Hello" records (one with `times` 3 backfill) give one item with `times_sung == 4`, `backfill_times == 3` and `feel_counts == {"great":1,"ok":0,"bad":0}`.
  - `test_library_latest_survey_wins`: an older great and a newer bad give `latest_feel == "bad"`.
  - `test_library_includes_loved_unsung_and_setlist_items`: a loved song with no sung records gives `times_sung == 0` and `loved is True`. A song only in a setlist is included with `setlist_ids == [pl_id]`.
  - `test_library_uncatalogued`: an unresolved record gives `key` starting `u:`, `song_key is None` and `facets is None`.
  - `test_library_excludes_hidden_only_and_deleted`.
  - `test_library_facets`: a fixture song gives `facets.mood` in `MOODS`, the right `energy_band`, and `has_karaoke`.
  - `test_library_etag_304` (route): the first call's etag sent back as `If-None-Match` gives 304; after `love()` the etag changes and the response is 200.
  - `test_library_hides_private_fields`: the response JSON has no `user_id` or `email_hash`.
- [ ] **Step 2:** Run `poetry run pytest backend/tests/test_library_service.py backend/tests/test_library_routes.py backend/tests/test_catalog_facets.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement. Call the catalog via `asyncio.to_thread`. When the catalog is warming up (`CatalogUnavailable`), return items with `facets=None` rather than a 503.
- [ ] **Step 4:** Run: PASS. `make lint`.
- [ ] **Step 5:** Commit `feat: GET /api/my/library (collection aggregate with facets + etag)`.

### Task A5: Ordered setlists on `playlists`

**Files:**
- Modify: `backend/services/playlist_service.py`:
  - `PlaylistInfo` gains `items: list[PlaylistItem]` and `rev: int`, where `PlaylistItem = {item_id: str, song_key: str|None, artist: str, title: str, added_at: datetime}`.
  - `create_playlist(user_id, name, description=None, playlist_id: str|None=None, items: list[PlaylistItemIn]|None=None)`. When `playlist_id` exists for the same user, it returns the existing doc (idempotent); for another user it raises `PlaylistAccessDeniedError`.
  - New `replace_items(playlist_id, user_id, items: list[PlaylistItemIn], base_rev: int|None) -> PlaylistInfo`: last writer wins, `rev += 1`, `song_ids = [i.song_key for i in items if i.song_key]`, at most 500 items, and `item_id` is generated when missing.
  - The legacy `add_song_to_playlist` appends an item (artist/title from `song_titles`, falling back to `song_id`).
  - `_doc_to_playlist` lazily upgrades docs that have `song_ids` and no `items`, via `song_titles`, in memory (written back on the next write).
- Modify: `backend/api/routes/playlists.py`:
  - `PlaylistResponse` gains `items: list[PlaylistItemOut]` (`PlaylistItem` + `facets: SongFacets|None`) and `rev`.
  - `CreatePlaylistRequest` gains `id: str|None` (pattern `^pl_[A-Za-z0-9-]{8,64}$`) and `items: list[PlaylistItemIn] = []`.
  - New `PUT /{playlist_id}/items` with body `{items: list[PlaylistItemIn] (max 500), base_rev: int|None}`.
  - Change `DELETE /{playlist_id}/songs/{song_id}` to `{song_id:path}` using `my_songs._song_key`'s raw-path decoding (`my_songs.py:~51-74`).
- Modify: `infrastructure/__main__.py`. Add `gcp.firestore.Index("playlists-user-updated-index", collection="playlists", fields=[user_id ASC, updated_at DESC], opts=protect=True)`. First check with `gcloud firestore indexes composite list --project nomadkaraoke` (read-only ADC works) whether it already exists. If it does, use `import_=` per memory feedback_pulumi_import_option_gotcha (remove `import_` after the first apply).
- Modify: `backend/api/routes/test_support.py`. Add `"playlists"` to `USER_OWNED`.
- Test: `backend/tests/test_playlist_service.py` (new, MemoryFirestore), extend `backend/tests/test_playlists.py`.

**Interfaces:**
- Consumes: `song_titles`, `song_facets` (A4).
- Produces:
  - `POST /api/playlists {id?, name, description?, items?}`;
  - `PUT /api/playlists/{id}/items {items, base_rev}`;
  - `PlaylistResponse.items[].{item_id, song_key, artist, title, added_at, facets}`, `.rev`;
  - `PlaylistItemIn = {item_id?: str, song_key?: str|None, artist: str (1–300), title: str (1–300)}`.

- [ ] **Step 1: Write failing tests**
  - `test_create_with_client_id_is_idempotent`: the same id twice gives one doc, and the second call returns the first.
  - `test_create_with_other_users_id_denied`.
  - `test_replace_items_orders_and_bumps_rev`: items [B, A] give `rev == 1`, `song_ids == [B.key, A.key]`; an uncatalogued item has `song_key=None` and keeps artist/title.
  - `test_replace_items_stale_base_rev_still_applies` (last writer wins).
  - `test_replace_items_limit`: 501 items give 422.
  - `test_legacy_doc_upgraded_on_read`: a doc with only `song_ids` gives `items` with titles from the fixture catalog.
  - `test_delete_song_with_slash_key` (route): `DELETE /api/playlists/{id}/songs/ac%2Fdc|tnt` gives 204.
  - `test_reset_clears_playlists` (test_support).
- [ ] **Step 2:** Run `poetry run pytest backend/tests/test_playlist_service.py backend/tests/test_playlists.py backend/tests/test_test_support.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement. Writes go through `run_transaction` where read-modify-write (create-if-absent, replace_items).
- [ ] **Step 4:** Run: PASS. `cd infrastructure && pulumi preview` is NOT run from this branch (only from main after merge); `python -c "import ast; ast.parse(open('infrastructure/__main__.py').read())"` passes.
- [ ] **Step 5:** Commit `feat(playlists): ordered setlist items, client ids, PUT items, index`.

### Task A6: Test API seeding for Me flows

**Files:**
- Modify: `backend/api/routes/test_support.py`. Add `POST /api/test/karaoke-log/seed {email, entries: list[dict]}`, where each entry is an app patch plus an `id` (`app_…`). It calls `KaraokeLogService.upsert_user` for the user (created if needed) and returns `{user_id, count}`.
- Test: `backend/tests/test_test_support.py`.

**Interfaces:**
- Produces: the seed route used by `maestro/scripts/stack.js ACTION: log-seed` (B13).

- [ ] **Step 1:** Write failing test `test_seed_karaoke_log`: seeding 2 entries with surveys gives `GET /api/test/karaoke-log?email=` with 2 entries and a `sung` row with `times_sung` 2.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement (mounted only under `decide_test_api` outside production, like the rest).
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `test-api: seed karaoke log records`.

### Task A7: Web playlists page shows titles

**Files:**
- Modify: `frontend/src/types/index.ts:260-273` (`Playlist.items`, `rev`).
- Modify: `frontend/src/lib/api.ts:907-973` (`removeSong` uses `encodeURIComponent`).
- Modify: `frontend/src/app/[locale]/playlists/page.tsx:292-330`. Render `items` (artist and title; the "song details will load" placeholder goes away), with `openKaraokeSearch` using `"${artist} ${title} karaoke"`.
- Modify: `frontend/messages/*.json` (drop the unused keys or keep them; translate any new key).
- Test: the frontend's existing test runner for that page if one exists; otherwise `npm run build` and `npm run lint` in `frontend/`.

- [ ] **Step 1:** If `frontend` has page tests (`ls frontend/src/**/__tests__`), add a test that the page renders "Hello" from `items`. Otherwise skip to Step 3.
- [ ] **Step 2:** Run it: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cd frontend && npm run lint && npm run build`: success.
- [ ] **Step 5:** Commit `fix(web): playlists page shows song titles`.

### Task A8: Docs, version, PR

**Files:**
- Modify: `docs/API.md`:
  - Karaoke log at lines 95-107: `vibes`, `reasons`, `origin`, `times`, `date_precision`, `?song=`.
  - New "Library" section after it: `GET /api/my/library`, the item fields, ETag/304.
  - Playlists at 1847-2004: items, rev, client id, `PUT /items`, path song id.
  - Test API at 143-158: `karaoke-log/seed`.
- Modify: `docs/ARCHITECTURE.md` § Personal data. List `playlists` (already per user) as user data for the Phase 6 deletion registry.
- Modify: `pyproject.toml` version → `0.29.0`.

- [ ] **Step 1:** Write the docs; bump the version.
- [ ] **Step 2:** Run `make lint && make test-backend`: all pass.
- [ ] **Step 3:** Run `/coderabbit` (or a reviewer subagent if the CLI is unavailable); fix real issues, at most 3 cycles.
- [ ] **Step 4:** Message nomadkaraoke-14 (the deletion registry: `playlists`) and nomadkaraoke-72 (A1 touched `models.py` UserSong). Open the PR with `gh pr create` (`@coderabbitai ignore` only if the local review completed). Message the orchestrator nomadkaraoke-12.
- [ ] **Step 5:** Merge when CI is green (squash). Deploy happens via decide CI. Run `pulumi up` for the index from decide **main** with `--target` the new index URN; the preview must show 0 deletions; this needs Andrew's `/gcp-admin`. Ask him if it isn't available, and the index can follow (the list query works without it on a small dataset only, so do this before the mobile PR merges).

---

## Part B: nomad-mobile (worktree `nomad-mobile-phase4-me`)

### Task B1: Regenerate the decide client and add Me facades

**Files:**
- Modify: `openapi/decide.json` (fetched from the local decide stack running Part A: `DECIDE_OPENAPI_URL=http://127.0.0.1:8030/openapi.json node scripts/fetch-openapi.mjs decide`, then `pnpm --filter @nomad/api-decide generate`).
- Create: `packages/api-decide/src/me.ts`, exported from `src/index.ts`:
  - `getLibrary(etag?: string): Promise<{ status: 'not-modified' } | { status: 'ok'; etag: string; items: LibraryItem[] }>`: sends `If-None-Match`; maps 304 to not-modified.
  - `listSetlists(): Promise<Setlist[]>`: pages `GET /api/playlists?limit=100` until done.
  - `createSetlist(input: { id: string; name: string; items: SetlistItemIn[] }): Promise<Setlist>`.
  - `putSetlistItems(id: string, items: SetlistItemIn[], baseRev: number | null): Promise<Setlist>`.
  - `renameSetlist(id: string, name: string): Promise<Setlist>`.
  - `deleteSetlist(id: string): Promise<void>`.
  - `listSongHistory(libraryKey: string): Promise<KaraokeLogEntry[]>`: `listKaraokeLog` with `song`, all pages.
  - Type aliases `Setlist = PlaylistResponse`, `SetlistItemIn = PlaylistItemIn`, `LibraryItem`, `SongFacets` re-exported.
- Modify: `packages/api-decide/src/index.ts`. `listKaraokeLog` opts gain `song?: string`.
- Test: `packages/api-decide/src/__tests__/me.test.ts`.

**Interfaces:**
- Produces: the facades above (all of Part B uses them).

- [ ] **Step 1:** Write failing tests with a mocked fetch (follow existing facade tests in that package):
  - `getLibrary` sends `If-None-Match: "abc"` and returns `{status:'not-modified'}` on 304;
  - `listSetlists` concatenates two pages;
  - `putSetlistItems` sends `{items, base_rev}`.
- [ ] **Step 2:** Run `pnpm jest packages/api-decide -t me`: FAIL.
- [ ] **Step 3:** Regenerate and implement.
- [ ] **Step 4:** Run the tests, plus `pnpm gen:api:offline && git diff --exit-code packages/api-decide/src/client` (CI drift check): PASS.
- [ ] **Step 5:** Commit `feat(api-decide): library + setlist facades (decide v0.29)`.

### Task B2: Pure Me logic in `@nomad/core`

**Files:**
- Create: `packages/core/src/me/library.ts`, `packages/core/src/me/stats.ts`, `packages/core/src/me/index.ts`; export from `packages/core/src/index.ts`.
- Test: `packages/core/src/me/__tests__/library.test.ts`, `stats.test.ts`.

**Interfaces (structural types, so core doesn't depend on api-decide):**
- `type MeSong = { key: string; song_key: string | null; artist: string; title: string; times_sung: number; backfill_times: number; first_sung_at?: string | null; last_sung_at?: string | null; feel_counts: { great: number; ok: number; bad: number }; latest_feel?: 'great' | 'ok' | 'bad' | null; latest_key?: 'too_low' | 'right' | 'too_high' | null; crowd_pleaser_count: number; vibes: string[]; loved: boolean; hidden: boolean; setlist_ids: string[]; facets?: { mood?: string | null; energy_band?: string | null; has_karaoke: boolean; community: boolean; karafun: boolean; vr_tier?: string | null } | null }`
- `libraryKey(artist: string, title: string, songKey?: string | null): string`: `songKey ?? 'u:' + songKey(artist, title)` (the search normaliser).
- `isGoTo(s: MeSong): boolean`: the Global Constraints rule.
- `type LibraryQuery = { text?: string; feel?: ('great'|'ok'|'bad'|'unrated')[]; often?: 'twice' | 'once' | 'unsung' | null; moods?: string[]; vibes?: string[]; library?: 'any'|'community'|'karafun'; savedOnly?: boolean; sort: 'most' | 'recent' | 'rated' | 'az' | 'goto' }`
- `queryLibrary(items: MeSong[], q: LibraryQuery): MeSong[]`. Text matches artist/title through `normalize()`. `rated` sorts by great share then count. `goto` puts go-tos first, then most sung. Hidden songs show only when `feel` includes their rating.
- `type PendingLog = { id: string; artist: string; title: string; song_key?: string | null; state: string; times?: number; origin?: string; survey?: { feel?: string; key?: string; crowd_pleaser?: boolean; vibes?: string[]; answered_at?: string }; deleted?: boolean; sung_at?: string | null }`
- `overlayLibrary(items: MeSong[], pending: { log: PendingLog[]; loves: Record<string, { loved: boolean; artist: string; title: string; song_key: string }>; setlists: { id: string; items: { song_key: string | null; artist: string; title: string }[]; deleted?: boolean }[] }): MeSong[]`: applies unsynced edits on top of the server items (adds new songs, adjusts counts / latest survey / loved / setlist_ids).
- `karaokeStats(items: MeSong[], log: PendingLog[] /* full mirror, for nights & venues */, scope: { year?: number }): { songs: number; performances: number; nights: number; venues: number; topArtist: string | null; mostSung: { artist: string; title: string; count: number } | null; greatShare: number | null }`. Backfill counts only in `performances` and `songs`, never in nights.

- [ ] **Step 1:** Write failing tests, including:
  - `isGoTo` truth table: great once → true; ok + 2 times → true; latest bad + 5 times → false; hidden → false; ok once → false.
  - `libraryKey('Adele','Hello',null) === 'u:' + songKey('Adele','Hello')`.
  - `queryLibrary` filters: each feel / often / mood / vibe / savedOnly, combined with text, and each sort order.
  - `overlayLibrary`:
    - a pending new backfill `times` 3 for an unknown song adds a `u:` item with `times_sung` 3;
    - a pending survey bad flips `latest_feel`;
    - a pending unlove clears `loved`, and drops the song if unsung and in no setlist;
    - a pending setlist item adds its id to `setlist_ids`.
  - `karaokeStats` for a year scope excludes other years and backfill nights.
- [ ] **Step 2:** Run `pnpm jest packages/core -t me`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS, with coverage ≥ 70% for `me/`.
- [ ] **Step 5:** Commit `feat(core): Me library query, go-to rule, overlay, stats`.

### Task B3: Generic outbox and the Me outbox

**Files:**
- Create: `apps/mobile/src/sync/createOutbox.ts`:
  - `createOutbox<I extends { key: string }>(cfg: { storageKey: (userKey: string) => string; send: (item: I) => Promise<void>; merge: (queued: I, next: I) => I | null /* null = drop both */; isPermanent: (e: unknown) => boolean; backoff: (attempts: number) => number })`
  - returns a zustand store hook with `{ userKey, items: I[], attempts, retryAt, synced, enqueue(item: I), flush(): Promise<void>, rehydrate(email: string | null), clear(): void }`.
  - Coalescing is one item per `key`, keeping the FIFO position of the first insertion. A 401 stops the flush; a permanent error drops the item; other errors back off.
- Modify: `apps/mobile/src/tonight/log/outbox.ts`. Re-implement it on `createOutbox` (key = entry id, `merge` = today's `mergePatch` / delete rules). **Keep its exported API identical** (`OutboxItem`, `useOutbox`, `outboxIdle`, `mergePatch`, `isPermanent`, `outboxBackoffMs`, constants) so Tonight's tests pass unchanged.
- Create: `apps/mobile/src/me/meOutbox.ts`:
  - `MeOutboxItem = { key: \`setlist:${string}\`; op: 'save'; id: string; name: string; items: SetlistItemIn[]; create: boolean; baseRev: number | null } | { key: \`setlist:${string}\`; op: 'delete'; id: string } | { key: \`love:${string}\`; op: 'love'; song_key: string; artist: string; title: string; loved: boolean }`
  - `merge` rules: a save after a save keeps `create` true if either was a create and takes the newer name/items. A delete after a pending create drops both (`null`). A delete after a save becomes the delete. A love after a love takes the newer.
  - `send`: create → `createSetlist` (idempotent on id); save → `putSetlistItems` (+ `renameSetlist` when the name changed); delete → `deleteSetlist` (404 = done); love → `loveSong` / `unloveSong`.
  - MMKV key `me.outbox.v1.<userKey>`. Export `useMeOutbox`.
- Modify: `apps/mobile/src/tonight/log/useLogSync.ts`. It also flushes `useMeOutbox` on the same triggers (rename it to `useSync` only if trivial; otherwise add the call).
- Test: `apps/mobile/src/__tests__/sync/createOutbox.test.ts`, `apps/mobile/src/__tests__/me/meOutbox.test.ts`. The existing `__tests__/tonight/log/outbox*.test.ts` must pass unchanged.

**Interfaces:**
- Produces: `createOutbox`, `useMeOutbox`, `MeOutboxItem`.

- [ ] **Step 1:** Write failing tests:
  - createOutbox: coalesce keeps first position; a 401 stops and keeps items; a permanent error drops; backoff schedules `retryAt`; `synced` increments.
  - meOutbox: create then two edits offline → one `createSetlist` call with the final items; create then delete → no network call; delete of an unknown id → `deleteSetlist` 404 treated as done; love/unlove coalesce to the last.
- [ ] **Step 2:** Run `pnpm jest apps/mobile -t "outbox"`: new tests FAIL, old ones still PASS.
- [ ] **Step 3:** Implement and migrate Tonight's outbox.
- [ ] **Step 4:** Run `pnpm jest apps/mobile -t "outbox|tonight"`: all PASS.
- [ ] **Step 5:** Commit `refactor(sync): generic outbox; Me outbox for setlists and saves`.

### Task B4: Me data layer, caches and account privacy

**Files:**
- Create: `apps/mobile/src/me/useLibrary.ts`:
  - `useLibrary(): { items: MeSong[]; loading: boolean; offline: boolean; error: boolean; refetch(): void }`.
  - Query key `['decide', userKey, 'library']`.
  - `initialData` comes from MMKV `me.library.v1.<userKey>` (`{etag, items, savedAt}`). The queryFn calls `getLibrary(etag)`, keeps the cache on not-modified, and writes the cache on ok.
  - Result = `overlayLibrary(cache, pending)`, where pending comes from: karaoke-log outbox items + `useLogStore` entries for those ids; `useMeOutbox` love items; setlist save items.
  - It invalidates when `useOutbox.synced` or `useMeOutbox.synced` changes.
- Create: `apps/mobile/src/me/useSetlists.ts`:
  - `useSetlists(): { setlists: Setlist[]; loading; offline }`: query `['decide', userKey, 'setlists']`, MMKV `me.setlists.v1.<userKey>`, overlaid with pending saves and deletes.
  - Mutators (enqueue into `useMeOutbox`, optimistic): `createSetlist(name): string /* new id pl_<uuid> */`, `renameSetlist(id, name)`, `setItems(id, items)`, `addSongs(ids: string[], song: {artist,title,song_key?})`, `removeItem(id, itemId)`, `deleteSetlist(id)`.
- Create: `apps/mobile/src/me/useLogMirror.ts`:
  - `useLogMirror(): { entries: KaraokeLogEntry[] }`: MMKV `me.logmirror.v1.<userKey>` = `{entries, since}`. Sync with `listKaraokeLog({since})` paging (deleted rows remove entries); a full pull when `since` is absent.
  - It replaces `IdeasPanel`'s direct `listKaraokeLog({limit:500})`. Change `IdeasPanel.tsx` to compute `mostSung` from the mirror, and export `karaokeLogKey` if still needed.
- Create: `apps/mobile/src/me/useClearMeOnAccountChange.ts`, mounted in `AppProviders` next to `useClearDiscoverOnSignOut`:
  - on sign-out it removes the `['decide', *, 'library'|'setlists']` queries and the three MMKV keys for the old user;
  - on sign-in as a different `userKey` than the last owner (store `me.owner.v1`), it deletes every `me.*.<oldUserKey>` key including `me.outbox.v1.<oldUserKey>`.
- Modify: `apps/mobile/src/providers/AppProviders.tsx` (mount the hook).
- Modify: `apps/mobile/src/me/` song-save helper: `useSaveSong(): { saved(key): boolean; toggle(song: {artist,title,song_key}) }`. It enqueues `love` and keeps `useSongFeedback`'s loved set in sync (Discover hearts reflect Me saves and vice versa).
- Test: `apps/mobile/src/__tests__/me/useLibrary.test.tsx`, `useSetlists.test.tsx`, `useLogMirror.test.tsx`, `accountPrivacy.test.tsx`.

**Interfaces:**
- Consumes: B1 facades, B2 core, B3 `useMeOutbox`, `useOutbox`, `useLogStore`.
- Produces: `useLibrary`, `useSetlists`, `useLogMirror`, `useSaveSong`.

- [ ] **Step 1:** Write failing tests:
  - useLibrary: a 304 keeps the cached items; offline (ApiError status 0) serves the cache with `offline: true`; a pending backfill shows immediately.
  - useSetlists: create offline shows the new setlist at once with its `pl_` id.
  - useLogMirror: a `since` sync applies updates and deletions.
  - accountPrivacy: user A caches a library + queues a setlist save → sign out → sign in as B → `useLibrary` for B never shows A's items, `useMeOutbox.items` is empty, and A's MMKV keys are gone; signing back in as A after sign-out alone (no other account) keeps A's pending outbox.
- [ ] **Step 2:** Run `pnpm jest apps/mobile -t "useLibrary|useSetlists|useLogMirror|accountPrivacy"`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS. Also run `pnpm jest apps/mobile -t "Ideas"` (Tonight ideas still pass on the mirror).
- [ ] **Step 5:** Commit `feat(me): library/setlist caches, log mirror, account privacy`.

### Task B5: Survey vibe and why chips

**Files:**
- Modify: `apps/mobile/src/tonight/log/logStore.ts`. `LogSurvey` gains `vibes?: Vibe[]` and `reasons?: Reason[]`; `saveSurvey` strips empty arrays.
- Modify: `apps/mobile/src/tonight/log/SurveySheet.tsx`. After the crowd question, a "Vibe" chip row (multi-select, testIDs `survey-vibe-<value>`) and, only when feel is `ok` or `bad`, a "What got in the way?" chip row (`survey-reason-<value>`). `initial` pre-selects them.
- Modify: `packages/i18n/messages/en.json`, adding `tonight.survey.vibesLabel`, `tonight.survey.reasonsLabel`, `tonight.survey.vibe.<value>` and `tonight.survey.reason.<value>`. Then `pnpm i18n:translate`.
- Test: extend `apps/mobile/src/__tests__/tonight/log/SurveySheet.test.tsx`.

- [ ] **Step 1:** Write failing tests:
  - reason chips are hidden for great and shown for ok;
  - Save sends `{feel:'ok', vibes:['ballad'], reasons:['too_long']}` through `saveSurvey`;
  - `initial` pre-selects.
- [ ] **Step 2:** Run the tests: FAIL.
- [ ] **Step 3:** Implement; translate.
- [ ] **Step 4:** Run `pnpm jest apps/mobile -t SurveySheet && pnpm i18n:check`: PASS.
- [ ] **Step 5:** Commit `feat(survey): vibe and why chips`.

### Task B6: Brand icons in `@nomad/ui`

**Files:**
- Create: `packages/ui/src/BrandIcon.tsx`:
  - `export type BrandId = 'spotify' | 'apple_music' | 'youtube_music' | 'lastfm' | 'listenbrainz'`;
  - `export function BrandIcon(props: { brand: BrandId; size?: number /* default 20 */; testID?: string }): JSX.Element`.
  - Skia `Canvas`/`Path` like `GoogleLogo` (`SocialButton.tsx`), with each brand's official mark and colours (Spotify #1DB954 circle + bars; Apple Music red-pink gradient tile + note; YouTube Music red circle + play ring; Last.fm red #D51007 "as" mark; ListenBrainz purple/orange "LB" mark). Paths come from each brand's published press kit or simple-icons (CC0) paths, credited in a comment.
  - Export it from `packages/ui/src/index.ts`.
- Modify: `apps/mobile/src/discover/connect/ConnectCard.tsx`. Optional prop `brand?: BrandId`, rendered before the title. `ConnectHub` passes it for `listenbrainz`, `lastfm` and `apple`, and for `spotify-export` (spotify).
- Modify: `apps/mobile/src/discover/connect/ConnectedSources.tsx`. Each `connected-row-${source}` shows its `BrandIcon` when the source maps to a brand (`spotify*` → spotify, `apple_*` → apple_music, `youtube_music`, `lastfm`, `listenbrainz`).
- Test: `packages/ui/src/__tests__/BrandIcon.test.tsx` (renders for every id with the Skia jest mock the package already uses), extend `ConnectedSources` tests (an icon testID is present for a lastfm row).

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run `pnpm jest packages/ui -t BrandIcon`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS. Screenshot the Connect hub on the iOS simulator (`xcrun simctl io booted screenshot`) and check the icons render crisply in dark mode.
- [ ] **Step 5:** Commit `feat(ui): BrandIcon; brand marks on Connect and connected sources`.

### Task B7: Music profile page fixes

**Files:**
- Modify: `apps/mobile/src/app/me/music-profile.tsx`. New section order: `VoiceProfileSection` (and 3d's `vs-entry-me` / `RecordingsSection` right after it), then `profile-connected`, `profile-services`, artists, loved, quiz, hidden, then the admin row. **3d owns parts of this file:** message nomadkaraoke-72 before editing if it's still active.
- Create: `apps/mobile/src/discover/profile/ArtistsYouLove.tsx`. `ArtistsYouLove({ artists: {artist_name: string; affinity?: string}[]; onRemove(name): void })`:
  - the top 12 (`ARTISTS_PREVIEW = 12`) by affinity (love > like > occasionally, then the given order) as `Chip`s with a remove × (testIDs `profile-artist-chip-${i}`, `profile-artist-remove-${i}`);
  - a filter field (`profile-artists-search`) that filters the chips;
  - **See all (N)** (`profile-artists-all`), which pushes `/me/artists`.
- Create: `apps/mobile/src/app/me/artists.tsx`, an A–Z screen:
  - a flattened `List` of header rows (letter) and artist rows (`artists-row-${i}`, remove `artists-remove-${i}`);
  - a vertical letter jump bar (`artists-jump-${letter}`) that calls `scrollToIndex`;
  - non-Latin initials group under "#".
  Register it in `_layout.tsx` with `title: tAccount('artistsAll')` and `profileBack`.
- Modify: `packages/i18n/messages/en.json` (`account.artistsSearch`, `account.artistsSeeAll` "{count, plural, …}", `account.artistsAll`) + translate.
- Test: extend `apps/mobile/src/__tests__/musicProfile.test.tsx` (section order: `voice-section` before `profile-connected`; 30 artists → 12 chips + "See all (30)"; search filters); new `apps/mobile/src/__tests__/me/artistsAll.test.tsx` (jump to "M" scrolls to the M header; remove calls `removeArtist`).

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run `pnpm jest apps/mobile -t "musicProfile|artistsAll"`: FAIL. Also update the voice flows that scroll to `voice-section-method` if their scroll direction changes (the section is now at the top).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(profile): voice first, artists chips + A–Z screen`.

### Task B8: Me home and the collection screen

**Files:**
- Create: `apps/mobile/src/me/ProfileSummaryCard.tsx`, testID `me-profile-card`:
  - voice: `PianoStrip` (height 28) using the voice store's range and the voice type, or a `me-profile-voice-cta` "Find your voice range" button (pushes `/discover/voice`);
  - source `BrandIcon`s from the services summary query (`SERVICES_SUMMARY_KEY`), or `me-profile-connect` "Connect your music" (pushes `/discover/connect`);
  - counts (songs known from the services summary, songs sung, saved) from `useLibrary`;
  - `me-profile-manage` pushes `/me/music-profile`.
- Create: `apps/mobile/src/me/Shelf.tsx`. `Shelf({ testID, title, onSeeAll?, empty?: ReactNode, children })` (title row + See all `${testID}-all`).
- Create: `apps/mobile/src/me/GoTosShelf.tsx`: up to 5 `isGoTo` songs sorted `goto` (`me-gotos`, rows `me-goto-${i}`); empty state opens the bulk picker.
- Create: `apps/mobile/src/me/SetlistsShelf.tsx`: horizontal cards `me-setlist-${id}` (name, count) plus `me-setlist-new` (asks for a name via the setlist name sheet from B11, then opens it).
- Create: `apps/mobile/src/me/StatsCard.tsx`: `me-stats` with This year / All time chips (`me-stats-year`, `me-stats-all`), showing `karaokeStats` fields.
- Modify: `apps/mobile/src/app/(tabs)/me.tsx`. Signed in, the order is: `ProfileSummaryCard`, (4c slot: nothing yet), `GoTosShelf`, `SetlistsShelf`, (4b slot: Get this made, nothing yet), `me-all-songs` row ("All your songs (N)", pushes `/me/songs`), `StatsCard`, then the existing credits / buy / signed-in-as / offline list / language / sign-out. Keep every existing testID. The music-profile button `me-music-profile` stays (it's lower down; the card's Manage is the primary entry).
- Create: `apps/mobile/src/app/me/songs.tsx`, the collection screen (`me-songs`):
  - search `me-songs-search`;
  - sort chips `me-songs-sort-${most|recent|rated|az}`;
  - filter chips `me-songs-feel-${great|ok|bad|unrated}`, `me-songs-often-${twice|once|unsung}`, `me-songs-mood-${happy|chill|sad|intense}`, `me-songs-vibe-${v}` (only vibes the user has used), `me-songs-saved`, and the existing `LibraryFilterPicker`;
  - rows `me-song-${i}` (title, `artistLabel`, a times-sung pill, a feel icon, a crowd-pleaser star, `LibraryBadge`, `FitBadge` from `useSongFit` when the song has a key);
  - empty and offline notes.
  Tapping a row opens `/song/[id]` for a `song_key`, else `/me/history/[key]`. Register it in `_layout.tsx` (`title: tMe('allSongs')`).
- Modify: `packages/i18n/messages/en.json`, adding a new top-level namespace `me` (home, shelves, stats, songs screen, filters) + translate.
- Test: `apps/mobile/src/__tests__/me/meHome.test.tsx` (signed in with a fixture library: shelves render in order, go-tos limited to 5, the profile card shows the voice CTA when there's no voice profile; signed out shows `me-signin`); `apps/mobile/src/__tests__/me/songsScreen.test.tsx` (filters and sort drive `queryLibrary`; an uncatalogued row routes to `/me/history/u:…`).

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run `pnpm jest apps/mobile -t "meHome|songsScreen"`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS. Simulator screenshot of the Me home with seeded data (en + ar).
- [ ] **Step 5:** Commit `feat(me): home shelves, profile card, stats, All your songs`.

### Task B9: Song page actions, history, and row menus

**Files:**
- Create: `apps/mobile/src/me/SongLibraryActions.tsx`. `SongLibraryActions({ song: { artist: string; title: string; song_key?: string | null } })` renders:
  - the Save heart `song-save` (`useSaveSong`, label "Save to My songs" / "Saved");
  - `song-add-setlist` (opens `AddToSetlistSheet`, B11);
  - `song-mark-sung` (opens `MarkSungSheet`, B10).
- Create: `apps/mobile/src/me/SongHistory.tsx`. `SongHistory({ libraryKey: string })` lists records from `useLogMirror` filtered by `libraryKey` (falling back to `listSongHistory` when the mirror is empty), with rows `song-history-${id}`:
  - the date, or "Before the app" for backfill without a date, with "×N" when `times > 1`;
  - the venue / Nomad night;
  - a survey summary (feel, key, crowd, vibes) and notes;
  - Edit (`song-history-edit-${id}`, opens `SurveySheet` with `initial`; for `kj_` records only the survey is editable);
  - Remove (`song-history-remove-${id}`, `useLogStore.remove`; for `kj_` it sets `deleted` through the outbox as Tonight does).
- Modify: `apps/mobile/src/app/song/[id].tsx`. Add `SongLibraryActions` next to `SongTonightAction` and `song-make`, and `SongHistory` below `VersionList` when the user is signed in.
- Create: `apps/mobile/src/app/me/history/[key].tsx`: the uncatalogued-song page. Its header is title and artist, plus `SongLibraryActions`, a Make it button (`history-make`, `typedIntent({artist,title})` → `/make/new`), and `SongHistory`. Register it in `_layout.tsx`.
- Modify: `apps/mobile/src/discover/components/SongMenuSheet.tsx`. Add `song-menu-setlist` and `song-menu-sung` (new optional props `onAddToSetlist(song)` and `onMarkSung(song)`, shown when provided), and relabel `song-menu-love` to "Save to My songs" / "Saved". `discover.tsx` passes the new handlers.
- Modify: `packages/i18n/messages/en.json` (`song.save`, `song.saved`, `song.addToSetlist`, `song.markSung`, `song.history.*`) + translate. Change the existing Love labels to the Save wording in the en source, so translations update.
- Test: `apps/mobile/src/__tests__/me/songLibraryActions.test.tsx`, `songHistory.test.tsx` (a backfill without date shows "Before the app ×3"; edit on a `kj_` record opens the survey only); extend the song page and `SongMenuSheet` tests.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run `pnpm jest apps/mobile -t "songLibraryActions|songHistory|SongMenuSheet|song page"`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit `feat(me): save / add to setlist / mark as sung on song pages and menus; song history`.

### Task B10: Mark as sung sheet and the bulk picker

**Files:**
- Create: `apps/mobile/src/me/MarkSungSheet.tsx`. `MarkSungSheet({ song: {artist,title,song_key?} | null; onClose(): void })`:
  - When: `mark-when-tonight`, `mark-when-date` (a month + year picker; precision `month`; optional day → `day`), `mark-when-ago` ("A while ago", precision `unknown`);
  - How many times: a stepper `mark-times-minus|plus|value`, 1–50, shown for date / ago;
  - then `mark-save`, after which it offers the survey (`SurveySheet` for the new id, raised from `onDismiss`, per the iOS Alert/Modal gotcha).
  - Tonight → `useLogStore.addOther(song, 'sung')` (joins the open other-bar night, as Tonight does).
  - Otherwise a new logStore method `addBackfill(song, { times, date?: string, precision })`: it creates an `app_<uuid>` entry with `origin:'backfill'`, `night:{kind:'other', date, date_precision}`, `state:'sung'` and `times`, and enqueues the full put.
- Modify: `apps/mobile/src/tonight/log/logStore.ts` (`addBackfill`, `LogEntry.times?`, `LogEntry.origin?`).
- Create: `apps/mobile/src/app/me/sung-before.tsx`, the bulk picker (`sung-before`):
  - a multi-select list of candidates: saved songs, then the user's top imported songs (from `getRecommendationsV2`'s `songs_you_know` section in the cached recs snapshot when present), then search results (`useSearch`, as `discover/quiz/SongStep.tsx`), deduped by `libraryKey`;
  - rows `sung-before-row-${i}` with a checkbox; already-sung songs are shown checked and disabled;
  - Done `sung-before-done` → `addBackfill(song, {times: 1, precision: 'unknown'})` for each selected song.
  Register it in `_layout.tsx`. Reached from the go-tos empty state and the songs screen's header menu (`me-songs-add-past`).
- Test: `apps/mobile/src/__tests__/me/markSung.test.tsx` ("A while ago" ×3 → `addBackfill` with `times` 3 and precision unknown; Tonight → `addOther`); `sungBefore.test.tsx` (select 2 → 2 backfill entries; already-sung rows are disabled).

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run `pnpm jest apps/mobile -t "markSung|sungBefore"`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS, and `pnpm jest apps/mobile -t tonight` still passes.
- [ ] **Step 5:** Commit `feat(me): mark as sung with rough dates, bulk "songs I've sung" picker`.

### Task B11: Setlist screens

**Files:**
- Create: `apps/mobile/src/me/SetlistNameSheet.tsx`. `SetlistNameSheet({ visible; initial?: string; onSave(name: string): void; onClose(): void })`: name 1–100 chars, `setlist-name-input`, `setlist-name-save`.
- Create: `apps/mobile/src/me/AddToSetlistSheet.tsx`. `AddToSetlistSheet({ song: {artist,title,song_key?} | null; onClose(): void })`:
  - a tick list of setlists (`add-setlist-${id}`; ticked if the song is already in it);
  - `add-setlist-new` (inline name → create + add);
  - `add-setlist-done` → `useSetlists().addSongs(...)` / `removeItem` for unticked ones.
- Create: `apps/mobile/src/app/me/setlists/index.tsx`: the list screen (`setlists`), rows `setlists-row-${id}` (name, count), `setlists-new`.
- Create: `apps/mobile/src/app/me/setlists/[id].tsx`, the detail screen (`setlist`). It has:
  - a header menu: rename `setlist-rename` and delete `setlist-delete` (with a confirm);
  - `setlist-add` opens a search sheet (`SetlistSearchSheet`: `useSearch` + a library filter, rows `setlist-search-row-${i}`, plus a "Add '<typed>' as a new song" row for free text);
  - item rows `setlist-item-${i}` (title, `artistLabel`, `LibraryBadge` from facets) with:
    - `SongTonightAction` (when a night is active);
    - `setlist-item-sung-${i}` (MarkSungSheet);
    - `setlist-item-make-${i}` (when `facets.has_karaoke === false` or no facets: the make intent);
    - `setlist-item-remove-${i}`;
  - Edit order mode `setlist-edit-order`: ▲▼ buttons `setlist-item-up-${i}` / `setlist-item-down-${i}` (copy the `ArrowButton` pattern from `tonight/manage/ReorderList.tsx`; move it to `apps/mobile/src/ui/ArrowButton.tsx` and import it in both places), `setlist-order-save`.
- Modify: `_layout.tsx` (register `me/setlists/index`, `me/setlists/[id]`, titles from `me.*`).
- Modify: `packages/i18n/messages/en.json` (`me.setlists.*`) + translate.
- Test: `apps/mobile/src/__tests__/me/setlists.test.tsx`:
  - create → it appears with 0 songs;
  - add 3 → reorder (down on the first) → save → `setItems` called with the new order;
  - delete confirm → gone;
  - AddToSetlistSheet ticks existing membership;
  - the free-text add creates an item with `song_key: null`.

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Run `pnpm jest apps/mobile -t setlists`: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: PASS, and the Tonight reorder tests pass after the `ArrowButton` move.
- [ ] **Step 5:** Commit `feat(me): setlists (list, detail, add-to-setlist, reorder)`.

### Task B12: Maestro flows, screen tour and screenshot UX review

**Files:**
- Modify: `maestro/scripts/stack.js`:
  - `ACTION: log-seed` (`EMAIL`, `ENTRIES` JSON → decide `POST /api/test/karaoke-log/seed`);
  - `ACTION: setlists-assert` (`TOKEN`, `EXPECT_NAME`, `EXPECT_TITLES` comma list in order → `GET /api/playlists` with the gen token);
  - `ACTION: library-assert` (`TOKEN`, `EXPECT_KEY`, `EXPECT_TIMES` → `GET /api/my/library`).
  Document them in the header.
- Modify: `scripts/e2e-local.sh`. Add `ME_SHOTS=docs/screenshots/phase4/<platform>/` next to the other shot variables (lines ~275-285) and pass `-e ME_SHOTS=…` (lines ~352-354).
- Create: `maestro/common/me-seeded.yaml` (setup user → decide-seed profile → log-seed → sign in → `tab-me` → wait for `me-profile-card`).
- Create flows (tags `[me]`):
  - `me-1-home.yaml`: seeded log with 2 go-tos and 1 OK song → shelves visible, go-to rows show the great song, stats show 3 songs; shot.
  - `me-2-collection.yaml`: All your songs → filter Great → only the great song; sort A–Z; an uncatalogued seeded song opens `me/history`; shot.
  - `me-3-mark-sung.yaml`: search "hello" → song page → Mark as sung → A while ago ×3 → Save → skip survey → `library-assert` `EXPECT_TIMES: 3`.
  - `me-4-bulk.yaml`: go-tos empty → "Songs I've sung" → pick 2 → Done → both in All your songs.
  - `me-5-setlist.yaml`: New setlist "Friday" → add "hello" and "starlite muse" via search → edit order → swap → `setlists-assert` `EXPECT_TITLES: "Starlight,Hello"`.
  - `me-6-setlist-offline.yaml` (tag `force-offline`, runs in the offline group): create a setlist offline → relaunch online (`relaunch-keep-data`) → `setlists-assert` shows it once.
  - `me-7-survey-chips.yaml`: an other-bar night → sung → survey with vibe Party + feel OK + reason Too long → `ACTION: log` asserts the feel; then song history shows the chips.
  - `me-8-account-switch.yaml`: user A seeds and makes a setlist → sign out → sign in as B → `me-setlists` shows none, and All your songs is empty.
  - `me-9-profile.yaml`: Manage → voice section first; 30 seeded artists → 12 chips → See all → jump to a letter; brand icon rows visible for a seeded Last.fm source (`fake-lastfm-user`).
- Create: `maestro/screens/me-tour.yaml` (every Me screen and sheet, for `--screen me-tour` in `en` and `ar`).
- Run:
  - `scripts/e2e-local.sh --platform ios me` → all `me-*` pass;
  - then `--platform android me`;
  - then the full suites on each platform (`--skip` nothing) to catch regressions: discover/voice flows (profile order change), tonight flows (survey sheet, outbox refactor).
  Never run both platforms at once.
- UX review: `scripts/e2e-local.sh --platform ios --locale en --screen me-tour` and `--locale ar`. Review every shot (layout, truncation, RTL, dark theme, spacing against Discover), fix issues, and re-shoot. Do one device check on Andrew's iPad (lock `mkdir /tmp/nomad-ipad.lock` with an owner file containing this session's name; remove it when done): a signed Release build, Me home and a setlist.

- [ ] **Step 1:** Write the flows and stack.js actions.
- [ ] **Step 2:** Run the iOS `me` group: the flows fail until the screens exist (they do by now), then iterate until they pass.
- [ ] **Step 3:** Android `me` group: pass.
- [ ] **Step 4:** Full regression on iOS, then Android. Record the counts. Pre-existing failures (review-10 on iOS) must be unchanged.
- [ ] **Step 5:** Screen tour en + ar, the review fixes, the iPad check. Commit the flows + screenshots: `test(e2e): Me flows me-1…9, me-tour`.

### Task B13: Docs, review, PR

**Files:**
- Modify: `CLAUDE.md` (Status: Phase 4a; Workspace: `apps/mobile/src/me/`, `apps/mobile/src/sync/`; E2E: the Me flows and `ME_SHOTS`, the stack.js actions; Gotchas found during the build).
- Modify: `docs/VISION.md` roadmap row 4 ("4a built").
- Modify: the spec's §5, adding an "As built (4a)" note listing any deviations.
- Modify: `docs/superpowers/plans/2026-10-25-mobile-phase4a-me.md` (this file): the execution ledger at the end (task → commit, reviewer verdicts, amendments).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check && pnpm gen:api:offline && git diff --exit-code`: all clean.
- [ ] **Step 3:** `/coderabbit` (or reviewer subagent); fix real issues, at most 3 cycles. Then a final whole-branch review across both repos' 4a changes on the most capable model (`superpowers:requesting-code-review`, model opus); fix the findings.
- [ ] **Step 4:** Rebase onto `origin/main`. Message the active sessions about shared files (`(tabs)/me.tsx`, `_layout.tsx`, i18n messages, `packages/ui` index, `packages/core` index, `music-profile.tsx`). Open the PR, and message the orchestrator.
- [ ] **Step 5:** Merge when CI is green **after** decide Part A is deployed to prod (check `GET https://decide.nomadkaraoke.com/api/my/library` returns 401, not 404). Message the orchestrator. Add anything only a human can check to the final manual-pass list (memory project_nomad_mobile_app):
  - Me home on Andrew's real data;
  - a setlist used at a real bar offline;
  - brand icons on a phone.

## Execution ledger

(Filled in during execution: task, commit, reviewer verdict, amendments.)
