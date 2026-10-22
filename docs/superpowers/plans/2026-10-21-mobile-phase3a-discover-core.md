# Phase 3a "Discover core" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Nomad account across gen, decide web and the app; a native quiz; a fast recommendation engine (v2) where every filter works, including the library filter; and a decide main service that cold-starts in under 10 s.

**Architecture:**
- **Auth.** decide accepts gen session tokens, validating them against gen's `sessions` collection in the shared Firestore, and resolves each one to the decide profile keyed by the email hash. Legacy decide JWTs keep working until 2026-11-30.
- **Data.** The weekly `mb-refresh` job builds `catalog.db`, a SQLite file of per-song facets, artists, similarity and the KN id map, and publishes it to GCS behind a pointer. The main API downloads it at startup, together with the search service's daily `availability.db`, and ATTACHes the two. Recommendations v2 then score candidates in SQLite plus Python, with no BigQuery on the request path.
- **Clients.** decide web switches to gen's email-code sign-in and the v2 page. The app gets a Discover tab with sign-in, quiz, filters, sections, feedback and offline last picks. A shared library-filter module in `@nomad/core` is the piece Phase 5 Tonight will import.

**Tech Stack:**
- decide: Python 3.11/3.12, FastAPI, async Firestore, SQLite, BigQuery (build only), GCS, Pulumi, Next.js 15 static export with next-intl, Playwright.
- mobile: Expo SDK 57, Expo Router, TanStack Query 5, Zustand + MMKV, `@hey-api/openapi-ts`, use-intl, jest-expo + RNTL, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-21-mobile-phase3a-discover-core-design.md` (nomad-mobile). Its survey is `docs/superpowers/specs/2026-10-21-mobile-phase3-discover-survey.md`, cited as "survey §n". Read both before every task.

**Repos and worktrees:**
- decide: `/Users/andrew/Projects/nomadkaraoke/karaoke-decide-phase3-discover` (branch `feat/sess-20261021-1515-phase3-discover`). Read its `CLAUDE.md`, `docs/TESTING.md` and `docs/ARCHITECTURE.md`.
- mobile: `/Users/andrew/Projects/nomadkaraoke/nomad-mobile-phase3-discover` (same branch name). Read `CLAUDE.md` and `AGENTS.md`.
- gen: `/Users/andrew/Projects/nomadkaraoke/karaoke-gen`. Read only; **no gen changes in 3a**.

**PR boundaries:**
- PR 1 = Part A (decide v0.16.0).
- PR 2 = Part B (decide v0.17.0).
- PR 3 = Parts C and D (decide v0.18.0).
- PR 4 = Part E (nomad-mobile).

After each decide PR merges, start the next part on a fresh branch from `origin/main` in the same worktree (`git fetch && git checkout -b feat/sess-<yyyymmdd-hhmm>-phase3a-<part> origin/main`).

## Global Constraints

- **Identity.** gen session tokens contain no dots (`secrets.token_urlsafe(32)`); decide JWTs always contain dots. Branch on `"." in token`.
- **Validation order (copied from gen `validate_session`, `karaoke-gen/backend/services/user_service.py:965-1030`):**
  1. doc exists;
  2. `is_active`;
  3. `now > expires_at` → expired;
  4. `last_activity_at < now - 7 days` → idle;
  5. `gen_users/{email.lower()}` (falling back to a query on `email`) exists;
  6. user `is_active`.

  Naive datetimes are UTC. decide adds one rule: a truthy `tenant_id` gives 401.
- **Session cache and sliding window.** Positive results are cached for 60 s and negative ones for 10 s, in process. decide writes `last_activity_at` at most once per hour per token.
- **Legacy decide JWTs** are accepted until 2026-11-30 inclusive (`legacy_jwt_sunset`).
- **Profile doc** is `decide_users/{sha256(lowercase email)}`. `User.id` stays `user_<hex>`. gen admin status is never imported.
- **No live MusicBrainz API calls** (`musicbrainz.org/ws/2`) anywhere. No BigQuery on any recommendations request path.
- **No new spend beyond pennies**: no min-instances, no new paid services. Pulumi changes are written in `infrastructure/__main__.py` and applied by Andrew (`/gcp-admin`). Code must degrade gracefully until they are.
- **Library filter** values are `any | community | karafun`. `karafun` maps to KaraokeNerds brand code `KV`; display "KaraFun", info line "KaraFun / Karaoke Version catalogue". `community` means a version with `kind = 'community'`.
- **Recommendation filters** (query params): `genre` (multi), `mood` (multi), `energy` (low|mid|high), `decade` (multi), `popularity` (min 0–100), `popularity_max` (0–100, for decide web's "hidden gems"), `lead_gender` (male|female|mixed), `duration` (short <180000 ms | medium 180000–300000 | long >300000), `classic` (bool), `explicit` (exclude|include), `has_karaoke` (yes|make|any), `library` (any|community|karafun).
- **Sorts:** `best` (default), `popular`, `newest`, `oldest`, `shortest`, `az`.
- **Section order** (empty sections are omitted): `songs_you_know`, `artists_you_love`, `because_<artist_key>` (at most 2), `crowd_pleasers`, `make_it`. A non-`best` sort returns one flat section with id `all`.
- **Diversity:** at most 3 songs per artist per section, and no song appears in two sections. Hidden songs never appear.
- **Performance and size:** v2 p50 < 500 ms warm. `catalog.db` < 150 MB uncompressed and < 50 MB gzipped. Main service spawn to serving < 10 s.
- **i18n:**
  - decide web: every new string goes in `frontend/messages/en.json` plus the 32 other locales (`python scripts/translate.py --messages-dir ./frontend/messages --target all`), and backend strings in `backend/translations/`.
  - mobile: every string goes in `packages/i18n/messages/en.json`, then `env -u GEMINI_API_KEY pnpm i18n:translate` and `pnpm i18n:check`.
  - Invented example data only; never real lyrics.
- **Mobile rules** (mobile `CLAUDE.md`):
  - `testID` on every interactive element.
  - No JSX string literals.
  - No FlashList or Skia imports outside `packages/ui`.
  - Tests never go under `src/app`.
  - API clients never touch storage.
  - A decide 401 never signs the user out.
  - Native deps install via `npx expo install`. 3a adds none.
- **Mobile code locations.** New 3a code lives under `apps/mobile/src/discover/`, `apps/mobile/src/find/library/`, `packages/core/src/library/` and `packages/core/src/discover/`.
- **Shared mobile files** (Phase 5 Tonight, session nomadkaraoke-a7, is working in parallel):
  - `packages/ui`
  - `packages/i18n/messages/*`
  - `packages/core/src/index.ts`
  - `apps/mobile/src/app/(tabs)/*`
  - `scripts/e2e-local.sh`
  - `maestro/scripts/stack.js`
  - `package.json` and the lockfile

  Message Tonight before merging changes to any of these.
- **Versions:**
  - decide bumps `[tool.poetry] version` in `pyproject.toml` once per PR.
  - decide `frontend/package.json` is not bumped.
  - nomad-mobile has no bump convention: `apps/mobile/app.json` has been `1.0.0` since Phase 0 and stays unchanged until publishing (VISION release bar).
- **Test commands:**
  - decide: `poetry run pytest tests/unit -q` (≥ 70% coverage in CI), `poetry run pytest backend/tests -q --ignore=backend/tests/emulator` (≥ 60%), `poetry run ruff check . && poetry run ruff format --check . && poetry run mypy karaoke_decide backend --ignore-missing-imports`, and `cd frontend && npm run type-check && npm run lint && npm run build`.
  - mobile: `pnpm test`, `pnpm test:coverage` (≥ 70% on `packages/*`), `pnpm typecheck && pnpm lint`.

## Review Focus

1. **gen session timestamps in all three shapes.** gen writes sessions with `model_dump(mode='json')`, so `expires_at` and `last_activity_at` are usually ISO strings. Older docs may hold Firestore timestamps or naive datetimes. All three must validate the same way. Test in Task A1: `test_timestamp_shapes`.
2. **A `song_key` that needs URL encoding** (`|`, `&`, `/`, `#`, `?`, `%`, accents, Arabic) in `/api/my/songs/{song_key}/hide|love`. It must round-trip exactly, and the doc id must never contain `/`. Tests in Task B10 (`test_song_key_round_trip`) and Task E3 (`hideSong encodes the key`).
3. **`catalog.db` missing, corrupt, or a GCS download that hangs at startup.** The service must still start within the probe budget. `/api/health` and search keep working, and v2 returns 503 `warming_up`. Test in Task B5: `test_startup_without_catalog`, `test_download_timeout`, `test_corrupt_catalog`.
4. **decide returns 401 or 5xx while the gen session is valid.** The app stays signed in, search and Make keep working, and Discover shows a retry instead of an error wall. Test in Task E4 (`decide 401 does not sign out`) and Task E6 (`recs error shows retry; search still renders`).
5. **Filters plus hidden songs leave no candidates.** v2 returns `sections: []`, the app shows the "No picks match these filters" empty state with Clear filters, and no 500. Test in Task B9 (`test_everything_filtered_returns_empty_sections`) and Task E6 (`empty state offers clear filters`).

---

## Part A: decide accepts gen sessions (PR 1, decide v0.16.0)

### Task A1: gen session validator

**Files:**
- Create: `backend/services/gen_session.py`
- Test: `backend/tests/test_gen_session.py`

**Interfaces:**
- Produces:
  - `GEN_SESSIONS_COLLECTION = "sessions"`, `GEN_USERS_COLLECTION = "gen_users"`, `GEN_SESSION_IDLE_DAYS = 7`, `SLIDE_INTERVAL_S = 3600`, `POSITIVE_TTL_S = 60`, `NEGATIVE_TTL_S = 10`
  - `def is_gen_token(token: str) -> bool` returns `"." not in token`.
  - `@dataclass(frozen=True) class GenIdentity: email: str` (lowercased)
  - `class GenSessionError(Exception)` with `reason: Literal["invalid","revoked","expired","idle","tenant","user_not_found","user_disabled","error"]`
  - `class GenSessionValidator`:
    - `__init__(self, firestore: FirestoreService, *, now: Callable[[], datetime] = lambda: datetime.now(UTC))`
    - `async validate(self, token: str) -> GenIdentity`, which raises `GenSessionError`
    - `clear_cache(self) -> None`
  - `def get_gen_session_validator() -> GenSessionValidator`: a process singleton built on `FirestoreService(get_backend_settings())`.
  - `def _as_utc(value: datetime | str | None) -> datetime | None`

- [ ] **Step 1: Write the failing tests.**
  - Put a parity table at the top: `CASES = [(name, session_doc, user_doc, expected_reason_or_None), ...]`. The comment says it mirrors `karaoke-gen/backend/services/user_service.py` `validate_session`, and that gen has no table of its own (backlog item in A4).
  - Rows:
    - `missing_doc` → `invalid`
    - `inactive` (`is_active: False`) → `revoked`
    - `expired` (`expires_at` = now − 1 s) → `expired`
    - `idle` (`last_activity_at` = now − 7 d − 1 s) → `idle`
    - `idle_boundary` (now − 6 d 23 h) → valid
    - `tenant` (`tenant_id: "acme"`) → `tenant`
    - `tenant_empty_string` (`tenant_id: ""`) → valid
    - `user_missing` → `user_not_found`
    - `user_disabled` (`is_active: False` on the user) → `user_disabled`
    - `legacy_hash_keyed_user` (no `gen_users/{email}` doc, but a doc with field `email` == email) → valid
    - `mixed_case_email` (`user_email: "Ann@X.com"`) → `GenIdentity("ann@x.com")`
  - `test_parity_table` (parametrized over `CASES`): uses `mock_firestore_service` with `get_document` and `query_documents` side effects.
  - `test_timestamp_shapes`: `expires_at` as an ISO string with `+00:00`, as a naive ISO string, as a naive `datetime`, and as an aware `datetime`. All four validate when in the future and are `expired` when in the past.
  - `test_slides_idle_window_hourly`: the first validate with `last_activity_at` = now − 2 h calls `update_document("sessions", token, {"last_activity_at": <now iso>})` once. A second validate at now + 10 min makes no further call. With `last_activity_at` = now − 30 min, there is no call.
  - `test_positive_cache_60s`: two validates within 59 s make one `get_document("sessions", …)` call. At 61 s there are two.
  - `test_negative_cache_10s`: an invalid token is read once within 9 s and re-read at 11 s.
  - `test_firestore_error_is_error_reason`: `get_document` raises → `GenSessionError("error")`, and the result is not cached.
  - `test_is_gen_token`: `is_gen_token("abc_DEF-123")` is true; `is_gen_token("a.b.c")` is false.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_gen_session.py -q`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the interfaces above.
  - Writes are ISO strings, matching gen's json-mode dumps.
  - The cache is a `dict[str, tuple[float, GenIdentity | GenSessionError]]` keyed by token. Store only `sha256(token)` as the key so raw tokens don't sit in memory dumps.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): validate gen session tokens against gen's sessions collection`.

### Task A2: profile resolution and dual-token `get_current_user`

**Files:**
- Modify: `backend/services/auth_service.py` (add `resolve_gen_user`)
- Modify: `backend/api/deps.py:45-90` (`get_current_user`)
- Modify: `karaoke_decide/core/config.py` (add `legacy_jwt_sunset: date = date(2026, 11, 30)`)
- Test: `backend/tests/test_auth_gen_tokens.py`

**Interfaces:**
- Consumes: Task A1 `is_gen_token`, `get_gen_session_validator`, `GenSessionError`.
- Produces:
  - `AuthService.resolve_gen_user(self, email: str) -> User`. It reads `decide_users/{_hash_email(email)}`.
    - If the doc is missing, it creates `{user_id: _generate_user_id(), email, display_name: None, is_guest: False, gen_linked_at: now, created_at, updated_at, total_songs_known: 0, total_songs_sung: 0, last_sync_at: None}`.
    - If the doc lacks `gen_linked_at`, it sets that field once with `update_document`.
    - It returns the `User`. `is_admin` comes from the decide doc only.
  - `get_current_user`:
    - A gen token goes to `validator.validate` and then `resolve_gen_user`. A `GenSessionError` gives 401 with `detail="gen_session_<reason>"`.
    - A dotted token goes down the existing JWT path. When `date.today() > settings.legacy_jwt_sunset`, it gives 401 `detail="legacy_token_expired"`.

- [ ] **Step 1: Write the failing tests.** Use the `auth_client` pattern in `backend/tests/conftest.py`; patch `backend.api.deps.get_gen_session_validator`.
  - `test_gen_token_new_user_creates_profile`: `GET /api/auth/me` with a valid gen token and no decide doc → 200 and `is_guest false`. `set_document("decide_users", sha256("ann@x.com"), …)` is called with `gen_linked_at`.
  - `test_gen_token_existing_decide_user_keeps_id`: a decide doc `{user_id: "user_abc"}` under the hash → `/me` `id == "user_abc"`. `gen_linked_at` is written once, and not again on the next request.
  - `test_gen_token_invalid_401`: `detail == "gen_session_expired"`.
  - `test_legacy_jwt_still_valid_before_sunset`: freezegun or a patched `date` set to 2026-11-30 → 200.
  - `test_legacy_jwt_rejected_after_sunset`: 2026-12-01 → 401 `legacy_token_expired`.
  - `test_gen_user_passes_verified_user_dep`: `GET /api/services` (a `VerifiedUser` route) with a gen token → not 403.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_auth_gen_tokens.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `get_optional_user` delegating to `get_current_user`.
- [ ] **Step 4: Run** `poetry run pytest backend/tests -q --ignore=backend/tests/emulator`. Expected: PASS, with the existing auth tests unchanged.
- [ ] **Step 5: Commit** `feat(auth): resolve gen users to decide profiles; legacy JWT sunset`.

### Task A3: claim a guest profile

**Files:**
- Create: `backend/services/guest_claim_service.py`
- Modify: `backend/api/routes/auth.py` (add `POST /claim-guest`)
- Modify: `backend/api/deps.py` (add `GuestClaimServiceDep`)
- Test: `backend/tests/test_guest_claim.py`

**Interfaces:**
- Consumes: `AuthService.validate_jwt`, `FirestoreService.query_documents/set_document/delete_document/update_document`.
- Produces:
  - `@dataclass class ClaimResult: songs_moved: int; artists_moved: int; services_moved: int; playlists_moved: int; quiz_copied: bool`
  - `class GuestClaimError(Exception)` with `status: int` and `detail: str`. The cases:
    - 400 `not_a_guest_token`
    - 404 `guest_not_found`
    - 403 `requires_gen_session`
  - `class GuestClaimService(firestore, auth_service)` with `async claim(self, target: User, guest_token: str) -> ClaimResult`
  - Route `POST /api/auth/claim-guest`, body `ClaimGuestRequest{guest_token: str}`, returns `ClaimGuestResponse` with the `ClaimResult` fields. The bearer must be a gen token: a JWT bearer gives 403 `requires_gen_session`.
- Migration rules:
  - **`user_songs`:** every doc where `user_id == guest`, with no 1000 cap. The new id is `"{target}:{song_id}"`. On collision, add `play_count` together and keep the earliest `created_at`.
  - **`user_artists`:** the new id replaces the guest id prefix in the doc id.
  - **`music_services`:** check the doc id scheme in `music_service_service.py:35`. If the target already has that service, keep the target's.
  - **`playlists`:** update the `user_id` field.
  - **Quiz fields** (`quiz_completed_at, quiz_songs_known, quiz_artists_known, quiz_artist_mbids, quiz_artist_affinities, quiz_decade_pref, quiz_decades, quiz_energy_pref, quiz_genres, quiz_vocal_comfort_pref, quiz_crowd_pleaser_pref, quiz_manual_artists`): copied only when the target has no `quiz_completed_at`. Otherwise genres, decades and affinities are unioned.
  - **`quiz_progress`** doc: moved if the target has none.
  - Finally, delete the guest `decide_users` doc.

- [ ] **Step 1: Write the failing tests.**
  - `test_claim_moves_all_collections`: a guest with 1,200 user_songs, 3 user_artists, 1 music_service, 1 playlist and quiz fields → `songs_moved == 1200` and the rest move too.
  - `test_claim_merges_song_collision_play_counts`
  - `test_claim_keeps_target_quiz_when_present_and_unions_genres`
  - `test_claim_rejects_verified_jwt`: a non-guest JWT → 400 `not_a_guest_token`.
  - `test_claim_twice_404`: the second call gives `guest_not_found`.
  - `test_claim_requires_gen_bearer`: 403.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_guest_claim.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write in chunks of ≤ 400 with the `batch_set` helper from Task B10. If B10 isn't merged yet, add `FirestoreService.batch_set(collection: str, docs: dict[str, dict], merge: bool = False) -> None` here, using `self.client.batch()` and committing every 400.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): claim-guest migrates a guest profile onto the gen user`.

### Task A4: ship PR 1

**Files:**
- Modify: `pyproject.toml` (`version = "0.16.0"`)
- Modify: `docs/API.md` (auth: gen bearer, claim-guest, JWT sunset), `docs/ARCHITECTURE.md` (§auth: one account)
- Modify: workspace `BACKLOG.md` via `/backlog-add` with Andrew's words where they exist. Items:
  1. remove decide JWT auth and magic links after 2026-11-30;
  2. a `return_to` origin on gen send-code so the email link can land on decide;
  3. a gen-side comment plus a parity table test in `validate_session` pointing at decide `backend/tests/test_gen_session.py`;
  4. the kjbox `version_priority.py` "Karaoke Cloud Digitrax" alias belongs with CB.

- [ ] **Step 1: Run** the full decide check: tests, lint, mypy (Global Constraints). Expected: all pass.
- [ ] **Step 2: Commit, then** `/coderabbit` → `/pr` → merge → wait for CI deploy (`gh run watch`).
- [ ] **Step 3: Verify on prod.**
  - Get a real gen token: Andrew signs in on gen web, or use `scripts/get_prod_test_token.py` if it supports gen. Then `curl -H "Authorization: Bearer $GEN" https://decide.nomadkaraoke.com/api/auth/me`. Expected: 200, `is_guest:false`, the same `id` as Andrew's existing decide account if one exists for that email.
  - `curl` with `$GEN` + `x` (an invalid token). Expected: 401 `gen_session_invalid`.
- [ ] **Step 4:** Record the result in the session notes.

---

## Part B: catalog, recommendations v2, filters, library, quiz fixes, cold start (PR 2, decide v0.17.0)

### Task B1: shared catalog keys, genre map and mood buckets

**Files:**
- Create: `karaoke_decide/catalog/__init__.py`, `karaoke_decide/catalog/keys.py`, `karaoke_decide/catalog/genres.py`, `karaoke_decide/catalog/moods.py`
- Modify: `backend/services/catalog_lookup.py:53-80` (import `match_key` normalization from `keys.py`)
- Modify: `backend/services/quiz_service.py:895-940` (`_map_spotify_genres_to_ids` delegates to `map_genres`)
- Modify: `backend/services/user_data_service.py:154,187,215` (read and write `quiz_genres`, falling back on read to the legacy `quiz_genres_pref`; add `decades` ↔ `quiz_decades`)
- Modify: `backend/api/routes/my_data.py` (`PreferencesResponse` and `UpdatePreferencesRequest` gain `decades: list[str]`)
- Test: `tests/unit/catalog/test_genres.py`, `tests/unit/catalog/test_moods.py`, `tests/unit/catalog/test_keys.py`, plus additions to `backend/tests/test_my_data_routes.py`

**Interfaces:**
- Produces:
  - `keys.artist_key(name: str | None) -> str` = `identity_normalize(name)`
  - `keys.song_key` (re-exported from `song_search.text_normalize`)
  - `keys.match_key(artist: str, title: str) -> str`: byte-identical to today's `CatalogLookup._make_key`
  - `genres.GENRE_IDS`: the 22 ids `pop, rock, hiphop, rnb, country, electronic, metal, punk, emo, grunge, jazz, latin, indie, kpop, disco, classic-rock, folk, blues, ska, musical, reggae, other`. The 21 genres plus `other` ("Something else"), matching decide web `quiz/page.tsx:90-112`.
  - `genres.map_genres(raw: Iterable[str]) -> list[str]`: the keyword table from `quiz_service.py:905-932`, matched **longest keyword first**. It returns **every** matching id, not just the first: `"classic rock"` gives `["classic-rock", "rock"]`. Today's dict order maps it to `rock` only, which is a bug.
  - `moods.MOODS = ("happy", "chill", "sad", "intense")`, `VALENCE_SPLIT = 0.5`, `ENERGY_SPLIT = 0.55`
  - `moods.mood_for(valence: float | None, energy: float | None) -> str | None`: a high-valence/high-energy quadrant is happy, high/low is chill, low/low is sad, low/high is intense. It returns None if either input is None.
  - `moods.ENERGY_BANDS = {"low": (0.0, 0.4), "mid": (0.4, 0.7), "high": (0.7, 1.01)}` and `moods.energy_band(e: float | None) -> str | None`

- [ ] **Step 1: Write the failing tests.**
  - `map_genres(["classic rock"]) == ["classic-rock", "rock"]` (order: longest first)
  - `map_genres(["k-pop"]) == ["kpop", "pop"]`
  - `map_genres(["polka"]) == []`
  - `mood_for(0.8, 0.9) == "happy"`, `mood_for(0.8, 0.2) == "chill"`, `mood_for(0.1, 0.2) == "sad"`, `mood_for(0.1, 0.9) == "intense"`, `mood_for(None, 0.5) is None`
  - `energy_band(0.4) == "mid"`
  - `match_key("Guns N' Roses", "Sweet Child O' Mine")` equals the pre-change `CatalogLookup()._make_key(...)`. Capture the value before editing.
  - Routes: `PUT /api/my/data/preferences {genres:["rock"], decades:["1990s"]}` writes `quiz_genres` and `quiz_decades`. `GET` returns them, and a doc holding only `quiz_genres_pref` is still read.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/catalog backend/tests/test_my_data_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `backend/tests/test_quiz_service.py backend/tests/test_catalog_lookup.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): shared keys, genre map (multi-match), mood buckets; fix quiz_genres field`.

### Task B2: `catalog.db` schema, builder and fixture catalog

**Files:**
- Create: `karaoke_decide/catalog/schema.py`, `karaoke_decide/catalog/build.py`, `karaoke_decide/catalog/fixtures.py`
- Test: `tests/unit/catalog/conftest.py` (a `make_rows(**overrides) -> CatalogRows` factory), `tests/unit/catalog/test_build.py`, `tests/unit/catalog/test_fixtures_build.py`

**Interfaces:**
- Produces:
  - `schema.CATALOG_SCHEMA_VERSION = 1`
  - `schema.DDL` creates these tables:
    - `meta(key PK, value)`
    - `songs(song_key PK, artist, title, artist_key, brand_count INT, is_classic INT, explicit INT, duration_ms INT, year INT, decade TEXT, lb_listeners INT, spotify_pop INT, popularity INT, energy REAL, valence REAL, danceability REAL, tempo REAL, mood TEXT, lead_gender TEXT, genres_json TEXT, in_kn INT)`
    - `song_genres(song_key, genre_id, PK(genre_id, song_key)) WITHOUT ROWID`
    - `artists(artist_key PK, name, mbid, lb_listeners, popularity, gender, genres_json)`
    - `artist_similar(artist_key, similar_key, score REAL, source, PK(artist_key, similar_key)) WITHOUT ROWID`
    - `genre_map(raw_genre PK, genre_id)`
    - `kn_song_map(kn_id INT PK, song_key, artist, title, brands, brand_count INT, match_key)`
  - Indexes: `songs(artist_key)`, `songs(popularity DESC)`, `songs(decade)`, `songs(year)`, `kn_song_map(match_key)`, `kn_song_map(song_key)`.
  - `build.SongRow`, `ArtistRow`, `SimilarRow` and `KnRow` are frozen dataclasses mirroring the columns. `SongRow.genres` is a `tuple[str, ...]` of genre ids.
  - `build.CatalogRows(songs, artists, similar, kn, genre_map: dict[str, str])`
  - `build.CatalogStats(songs: int, artists: int, similar: int, kn: int, coverage: dict[str, float], bytes: int)`. Coverage keys are `genre, mood, decade, lead_gender, duration, popularity, explicit`; each value is the share of `in_kn=1` songs with the facet set.
  - `build.popularity_blend(lb_pct: float | None, spotify_pop: int | None) -> int | None`: `round(100 * (0.6 * lb_pct + 0.4 * spotify_pop / 100))` when both are present, the one present value scaled to 0–100 otherwise, and None if neither. `lb_pct` is the song's `lb_listeners` percentile among catalog songs (0–1), computed inside `build_catalog_db`.
  - `build.build_catalog_db(rows: CatalogRows, dest: Path, run: str) -> CatalogStats`. It writes `meta` with `schema`, `run`, `built_at`, and `coverage` as JSON. It drops duplicate song_keys, keeping the row with the higher `lb_listeners`, and runs `VACUUM`.
  - `fixtures.build(dest: Path) -> Path`, with CLI `python -m karaoke_decide.catalog.fixtures build <dir>`. It builds `<dir>/catalog.db` from:
    - every song in `tests/fixtures/song_search/kn_full_fixture.json`, with `in_kn=1` and kn ids 1..N in file order;
    - 200 synthetic `in_kn=0` "no karaoke version yet" songs by invented artists ("Fixture Artist 01…20"). Never use real lyrics.
    - Facets are assigned deterministically from `sha256(song_key)`, cycling through every genre, mood, energy band, decade 1950s–2020s, lead gender, duration band, explicit value and classic value.
    - Pinned rows that flows rely on: Muse "Starlight" is `rock`/`indie`, `2000s`, high energy, male; Adele "Hello" is `pop`, `2010s`, chill, female.
    - `artist_similar` pairs artists sharing a primary genre, with score 0.5–0.9.

- [ ] **Step 1: Write the failing tests.**
  - `test_build_roundtrip`: `make_rows()` with 3 songs → `songs` has 3 rows, `song_genres` has the expected pairs, and `meta.schema == "1"`.
  - `test_duplicate_song_key_keeps_more_listened`
  - `test_popularity_blend`: `(1.0, 100) → 100`, `(0.5, None) → 50`, `(None, None) → None`.
  - `test_coverage`: 2 of 4 songs have a mood → `coverage["mood"] == 0.5`.
  - `test_fixture_build_covers_every_filter_value`: every value of `GENRE_IDS[:-1]`, `MOODS`, each energy band, each decade, `male/female/mixed`, each duration band and `explicit 0/1` has ≥ 1 `in_kn=1` song. Muse "Starlight" has `decade == "2000s"`. File size < 5 MB.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/catalog -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): catalog.db schema, builder and fixture catalog`.

### Task B3: BigQuery source for the catalog

**Files:**
- Create: `karaoke_decide/catalog/bq_source.py`
- Modify: `karaoke_decide/services/bq_limits.py` (add `MAX_BYTES_CATALOG = 120 * GIB`; check the real bytes with a dry run before pinning)
- Test: `tests/unit/catalog/test_bq_source.py`

**Interfaces:**
- Consumes: Task B1 `map_genres`, `mood_for`, `song_key`, `artist_key`, `match_key`; Task B2 row dataclasses.
- Produces:
  - `fetch_catalog_rows(bq: bigquery.Client, *, dry_run: bool = False) -> CatalogRows`
  - SQL constants: `KN_SQL`, `SONG_FACETS_SQL`, `NO_KARAOKE_SQL`, `ARTISTS_SQL`, `SIMILAR_SQL`, `RAW_GENRES_SQL`
  - Every query runs with `maximum_bytes_billed=MAX_BYTES_CATALOG` and streams through `result(page_size=50_000)`.
  - All tables are `nomadkaraoke.karaoke_decide.*` unless noted.

| Constant | Reads | Notes |
|---|---|---|
| `KN_SQL` | `karaokenerds_raw` (`Id, Artist, Title, Brands`) | `brand_count = ARRAY_LENGTH(SPLIT(Brands, ','))`. Python adds `song_key`/`match_key`, and `is_classic = brand_count >= 20`. |
| `SONG_FACETS_SQL` | per `karaoke_id`, via `karaoke_recording_links` | Picks one Spotify track with `QUALIFY ROW_NUMBER() OVER (PARTITION BY karaoke_id ORDER BY spotify_tracks.popularity DESC) = 1`, so the audio features come from that single row (survey §6), **never per-column MAX**. From that track: `spotify_audio_features` (energy, valence, danceability, tempo), `spotify_tracks` (explicit, duration_ms, popularity, artist_spotify_id). `year` = MIN `mb_release_groups.first_release_year` over the recording's release groups (`mb_tracks.recording_mbid` → `release_group_mbid`), preferring `primary_type IN ('Album','Single','EP')` with empty `secondary_types`, else any. `lb_listeners` from `lb_recording_popularity` (`stats_range = 'all_time'`; confirm the value with `SELECT DISTINCT stats_range`). |
| `NO_KARAOKE_SQL` | `lb_recording_popularity` ⨝ `mb_recordings_enriched` (+ `mb_artist_credit_artists`) | The top 10 recordings by listeners per artist that has ≥ 1 KN song, where `song_key` is not in KN and listeners ≥ 1000. Exclude live, remix and demo titles (`LOWER(title)` NOT LIKE `%live%`, `%remix%`, `%demo%`). Gives `in_kn = 0`. |
| `ARTISTS_SQL` | `mb_artists_normalized` | `mbid, name, gender, spotify_genres, mb_tags, popularity` + `lb_artist_popularity` listeners. `lead_gender`: a Person uses `gender`. A Group uses the gender of members with a "member of band" link whose attribute is lead vocals (`nomadkaraoke.musicbrainz.l_artist_artist` → `link` → `link_type.name = 'member of band'` → `link_attribute`/`link_attribute_type.name = 'lead vocals'`). All one gender gives that gender; both give `mixed`; otherwise NULL. |
| `SIMILAR_SQL` | `mlhd_artist_similarity` | `artist_a_name, artist_b_name, jaccard_similarity`; top 30 per artist by jaccard. `source = 'mlhd'`; `score` = jaccard scaled to 0–1 by the per-artist max. This is the only artist-similarity data in BigQuery; ListenBrainz similarity exists only via the live labs API. |
| `RAW_GENRES_SQL` | `spotify_artist_genres` + `mb_artist_tags` | Distinct raw genre strings. Python fills `genre_map` with `map_genres`. A song's genres are its primary artist's mapped genres (Spotify + MB tags with `vote_count >= 1`). |

- [ ] **Step 1: Write the failing tests.**
  - `test_sql_never_maxes_audio_features`: none of the SQL constants matches the regex `MAX\(\s*(af\.)?(energy|valence|danceability|tempo)`.
  - `test_facets_pick_one_track`: `"ROW_NUMBER() OVER (PARTITION BY"` is in `SONG_FACETS_SQL`.
  - `test_every_query_has_byte_cap`: a fake `bq.query` records each `job_config.maximum_bytes_billed == MAX_BYTES_CATALOG`.
  - `test_rows_assembled`: a fake bq routes on SQL substrings (as in `tests/unit/test_musicbrainz_refresh.py:_mock_bq`) and returns 2 KN rows, facets for one, 1 no-karaoke row, 2 artists and 1 similarity pair. The resulting `CatalogRows` has the expected `song_key`, `mood`, `decade`, `genres` and `lead_gender`. The song without facets has `mood None`.
  - `test_no_musicbrainz_http`: the module imports neither `httpx` nor `requests`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/catalog/test_bq_source.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before merging, run each query with `dry_run=True` against prod using the read-only ADC (`bq` dry runs are free) and record the bytes in the PR description. Pin `MAX_BYTES_CATALOG` at about 1.5× the total.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): BigQuery source rows for catalog.db (one feature row per song)`.

### Task B4: publish, gate and `mb-refresh` integration

**Files:**
- Create: `karaoke_decide/catalog/publish.py`
- Modify: `karaoke_decide/etl/musicbrainz_refresh.py`:
  - add a best-effort `build_catalog` step after `publish_mirror` (around L421) and in `publish_existing()` (L429-444);
  - add the `--skip-catalog` flag next to `--skip-mirror` (L465/L468);
  - add a new `catalog` subcommand that builds and publishes only.
- Test: `tests/unit/catalog/test_publish.py`, plus additions to `tests/unit/test_musicbrainz_refresh.py`

**Interfaces:**
- Consumes: Tasks B2 and B3. `tests/unit/fake_gcs.py` `FakeBucket`/`FakeBlob`.
- Produces:
  - `CATALOG_BUCKET = "nomadkaraoke-musicbrainz-data"`, `CATALOG_PREFIX = "catalog"`, `CATALOG_LATEST = "catalog/latest.json"`, `KEEP_RUNS = 3`
  - `MIN_SONGS_PROD = 100_000`, `MAX_COVERAGE_DROP = 0.10` (absolute), `MAX_SONG_DROP = 0.10`
  - `catalog_gate(stats: CatalogStats, prev: dict | None, *, min_songs: int = MIN_SONGS_PROD) -> list[str]` returns failure strings. It fails when:
    - `songs < min_songs`;
    - with `prev`, `songs < prev.songs * 0.9`;
    - any coverage key is more than 0.10 below `prev.coverage`.
  - `publish_catalog(bucket, db_path: Path, stats: CatalogStats, run: str) -> dict`:
    - gzips the file (mtime 0) and uploads `catalog/<run>/catalog.db.gz`;
    - writes `catalog/latest.json` **last**, as `{run, path, sha256 (of the uncompressed db), bytes, gz_bytes, schema, built_at, coverage, songs}`;
    - prunes to the last `KEEP_RUNS` run directories.
  - `build_and_publish_catalog(bq, gcs, workdir: Path, *, min_songs: int = MIN_SONGS_PROD) -> dict | None`:
    - fetches, builds and gates;
    - on gate failure it logs `catalog gate failed: …` at **WARNING**, leaves the pointer unchanged and returns None (one aggregated message);
    - on success it returns the pointer.
- The `run` id is `datetime.now(UTC).strftime("%Y%m%d-%H%M%S")`.

- [ ] **Step 1: Write the failing tests.**
  - `test_gate_first_build_min_songs`
  - `test_gate_coverage_drop` (mood 0.8 → 0.65 fails; 0.8 → 0.75 passes)
  - `test_pointer_written_last`: the FakeBucket write order ends with `catalog/latest.json`.
  - `test_pointer_sha_matches_uncompressed`
  - `test_prune_keeps_three`
  - `test_gate_failure_keeps_old_pointer`
  - `TestRun.test_catalog_step_runs_after_mirror_and_never_fails_run`: `build_and_publish_catalog` raises → the run still logs `success`.
  - `test_skip_catalog_flag`
  - `test_catalog_subcommand_only_builds_catalog`: no extract, load or publish calls.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/catalog/test_publish.py tests/unit/test_musicbrainz_refresh.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The workdir is `tempfile.mkdtemp()` under `/tmp`; the job has 4 GiB.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mb-refresh): build and publish catalog.db weekly (best-effort, gated)`.

### Task B5: catalog store, startup and cold start (main API)

**Files:**
- Create: `karaoke_decide/catalog/reader.py`, `backend/services/catalog_store.py`
- Modify: `backend/main.py:31-52`:
  - drop the `karaokenerds_raw` preload;
  - call `await asyncio.to_thread(get_catalog_store().load, settings)` with an overall timeout;
  - add the `test_support` mount hook used by Task C1.
- Modify: `backend/api/routes/health.py` (add `GET /api/ready`)
- Modify: `backend/services/catalog_lookup.py` (`CatalogLookup.match` reads `kn_song_map` by `match_key` through `CatalogReader`; drop `load_from_bigquery` and its call)
- Modify: `backend/services/track_matcher.py:283-298, 380-389` (the `is_loaded` check becomes `catalog_store.status == "ready"`; the BigQuery fallback stays)
- Modify: `karaoke_decide/core/config.py`. Add:
  - `catalog_bucket: str = "nomadkaraoke-musicbrainz-data"`
  - `catalog_local_dir: str = ""`
  - `song_index_bucket: str = "nomadkaraoke-kn-data"`
  - `song_index_local_dir: str = ""`
  - `catalog_load_timeout_s: float = 60`
  - `catalog_dir: str = "/tmp/decide-catalog"`
  - `bigquery_disabled: bool = False`
- Modify: the module-level `from google.cloud import bigquery` in `backend/services/{recommendation_service,quiz_service,known_songs_service}.py` and `karaoke_decide/services/{bigquery_catalog,bq_limits,spotify_features}.py`. Move each import into the functions that use it, with `if TYPE_CHECKING:` for annotations. `make_client` raises `RuntimeError("bigquery disabled")` when `settings.bigquery_disabled`.
- Test: `backend/tests/test_catalog_store.py`, `backend/tests/test_cold_start.py`, `tests/unit/catalog/test_reader.py`, plus updates to `backend/tests/test_catalog_lookup.py` and `backend/tests/test_track_matcher.py`

**Interfaces:**
- Consumes: `backend/search/index_loader.load(run, bucket, dest_dir)` and `load_local(dir)` for `availability.db`. Add a `files: tuple[str, ...] = SERVER_FILES` parameter so the main API can download only `("availability.db",)`. Task B2 `catalog.db`.
- Produces:
  - `CatalogReader(catalog_path: Path, availability_path: Path | None)`:
    - `conn() -> sqlite3.Connection`: thread-local, read-only `file:…?mode=ro` URIs. It runs `ATTACH DATABASE '<availability>' AS av` when the availability path is present. Reuse `song_search/thread_conns.py`.
    - `has_availability: bool`
    - `artist_mbid(name: str) -> str | None`
    - `similar(artist_keys: Sequence[str], limit_per: int = 30) -> list[tuple[str, str, float]]`
    - `kn_song_keys(kn_ids: Sequence[int]) -> dict[int, str]`
    - `match_kn(artist: str, title: str) -> KnMatch | None`, where `KnMatch(kn_id, artist, title, brands, brand_count)`
    - `top_songs_for_artists(artist_keys: Sequence[str], per_artist: int) -> list[sqlite3.Row]`
  - `CatalogStore`:
    - `status: Literal["ready", "warming_up"]`, `reader: CatalogReader | None`, `run: str | None`
    - `load(settings) -> None`:
      - local dirs win when set;
      - otherwise it reads `gs://{catalog_bucket}/catalog/latest.json`, downloads and gunzips the db into `catalog_dir`, and verifies its sha256;
      - availability comes through `index_loader`;
      - it never raises (it logs WARNING and stays `warming_up`).
    - `require() -> CatalogReader`, which raises `CatalogUnavailable`
    - `get_catalog_store() -> CatalogStore` (a singleton)
  - `GET /api/ready` returns 200 `{ok: true, catalog: bool, availability: bool, run: str | null}` once the lifespan has finished.

- [ ] **Step 1: Write the failing tests.**
  - `test_startup_without_catalog`: the pointer is missing → `TestClient(app)` starts, `/api/ready` gives `catalog:false`, `/api/health` gives 200.
  - `test_download_timeout`: patch the download to sleep 5 s with `catalog_load_timeout_s=0.5` → `load` returns within ~1 s and the status is `warming_up`.
  - `test_corrupt_catalog`: a sha mismatch → `warming_up`.
  - `test_local_dirs_load`: the Task B2 fixture plus the search fixture index dir (`backend/tests/search/conftest.py` `index_dir`) → `ready` and `has_availability`.
  - `test_reader_attach_availability`: `SELECT COUNT(*) FROM av.songs` > 0.
  - `test_match_kn_uses_match_key`: Toto "Africa" → kn id 1.
  - `test_main_import_does_not_import_bigquery`: `subprocess.run([sys.executable, "-c", "import backend.main, sys; print('google.cloud.bigquery' in sys.modules)"])` prints `False`.
  - `test_track_matcher_uses_catalog_when_ready`
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_catalog_store.py backend/tests/test_cold_start.py tests/unit/catalog/test_reader.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The lifespan wraps `load` in `asyncio.wait_for(..., settings.catalog_load_timeout_s + 5)`.
- [ ] **Step 4: Run** `poetry run pytest backend/tests tests/unit -q --ignore=backend/tests/emulator`. Expected: PASS.
- [ ] **Step 5: Measure locally.**
  - Record `python -X importtime -c "import backend.main" 2>&1 | sort -t'|' -k2 -n | tail -15` before and after.
  - Record time to the first `/api/ready` 200 with the fixture catalog.
  - Put both numbers in the commit message.
- [ ] **Step 6: Commit** `perf(api): catalog.db + availability.db at startup behind /api/ready; drop KN preload; lazy BigQuery`.

### Task B6: v2 filters and sorts (SQL)

**Files:**
- Create: `backend/services/recs_v2/__init__.py`, `backend/services/recs_v2/filters.py`
- Test: `backend/tests/recs_v2/conftest.py` (a `reader` fixture built from Task B2's fixture catalog plus the search fixture `availability.db`), `backend/tests/recs_v2/test_filters.py`

**Interfaces:**
- Produces:
  - `class RecFilters(BaseModel)`, all fields optional with defaults:
    - `genre: list[str] = []`, `mood: list[Literal[*MOODS]] = []`, `energy: Literal["low","mid","high"] | None`, `decade: list[str] = []`
    - `popularity: int | None` (0–100), `popularity_max: int | None` (0–100)
    - `lead_gender: Literal["male","female","mixed"] | None`, `duration: Literal["short","medium","long"] | None`
    - `classic: bool = False`, `explicit: Literal["exclude","include"] = "include"`
    - `has_karaoke: Literal["yes","make","any"] = "any"`, `library: Literal["any","community","karafun"] = "any"`
  - `Sort = Literal["best","popular","newest","oldest","shortest","az"]`
  - `LIBRARY_CODES: dict[str, str] = {"karafun": "KV"}`
  - `def where_sql(f: RecFilters, alias: str = "s") -> tuple[str, list[object]]`
  - `ORDER_SQL: dict[Sort, str]`:
    - `popular`: `popularity DESC NULLS LAST`
    - `newest`: `year DESC NULLS LAST`
    - `oldest`: `year ASC NULLS LAST`
    - `shortest`: `duration_ms ASC NULLS LAST`
    - `az`: `title COLLATE NOCASE, artist COLLATE NOCASE`
    - `best`: handled in Python
    - every order ends with `, s.song_key` for stability
  - `def filters_applied(f: RecFilters) -> dict[str, object]`: only non-default values.
- How the conditions are built:
  - `has_karaoke`: `yes` = `EXISTS(SELECT 1 FROM av.songs a WHERE a.song_key = s.song_key)`; `make` = `NOT EXISTS`.
  - `library=community`: `EXISTS(SELECT 1 FROM av.versions v WHERE v.song_key = s.song_key AND v.kind = 'community')`.
  - `library=karafun`: `EXISTS(SELECT 1 FROM av.song_libraries l WHERE l.song_key = s.song_key AND l.library_code = 'KV')`.
  - `genre`: `EXISTS` on `song_genres`.
  - Durations use the Global Constraints boundaries.
  - Without `av` attached (`has_availability` false): `has_karaoke` and `library` filters other than `any` fall back to `in_kn = 1`, and `/v2` reports `filters_applied.availability = "approximate"`.

- [ ] **Step 1: Write the failing tests.**
  - `test_each_filter_changes_result_set` (parametrized over one non-default value per field: `genre=["rock"]`, `mood=["sad"]`, `energy="high"`, `decade=["1980s"]`, `popularity=70`, `popularity_max=30`, `lead_gender="female"`, `duration="long"`, `classic=True`, `explicit="exclude"`, `has_karaoke="make"`, `library="community"`, `library="karafun"`): the count of `SELECT song_key FROM songs s WHERE …` differs from the unfiltered count and is > 0 on the fixture.
  - `test_karafun_is_kv`: every karafun row has a `KV` library.
  - `test_sorts`: `newest` gives a non-increasing `year`; `az` is sorted by title; ties are stable.
  - `test_unknown_values_rejected`: `RecFilters(mood=["romantic"])` raises `ValidationError`.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/recs_v2/test_filters.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(recs-v2): filter and sort SQL over catalog.db + availability.db`.

### Task B7: v2 user context

**Files:**
- Create: `backend/services/recs_v2/context.py`, `backend/services/recs_v2/weights.py`
- Test: `backend/tests/recs_v2/test_context.py`

**Interfaces:**
- Consumes: `FirestoreService`, `CatalogReader.kn_song_keys`, the Task B10 `SongFeedbackService.hidden_keys(user_id)` (stub its interface if B10 lands later), `artist_key`, `song_key`.
- Produces:
  - `@dataclass class ArtistSignal: weight: float; source: str; name: str`
  - `@dataclass class UserContextV2`:
    - `user_id: str`
    - `artists: dict[str, ArtistSignal]` (key = artist_key)
    - `known_songs: dict[str, float]` (song_key → weight)
    - `known_without_karaoke: list[tuple[str, str, str]]` (song_key, artist, title)
    - `hidden: set[str]`, `genres: set[str]`, `decades: set[str]`
    - `energy_pref: Literal["chill","medium","high"] | None`, `crowd_pref: Literal["hits","deep_cuts","any"] | None`
    - property `has_profile: bool` (any artists, known songs, genres or decades)
    - property `is_cold: bool` (no artists and no known songs)
  - `async def build_context(firestore, reader: CatalogReader, feedback: SongFeedbackService, user_id: str) -> UserContextV2`. It reads `user_songs` (no cap; page by 1000), `user_artists`, the `decide_users` doc (quiz fields, `quiz_artist_affinities`, `quiz_manual_artists`, `excluded_artists`) and hidden keys. Songs map through `kn_song_map` for numeric `song_id`, otherwise `song_key(doc.artist, doc.title)`.
  - Weights in `weights.py` (decide `docs/VISION.md` §Recommendation Engine Weighting):

| Signal | Constant | Value |
|---|---|---|
| Spotify, Last.fm or ListenBrainz top artist | `ARTIST_TOP` | `1.0 × max(0.5, 1 − rank/200)` |
| Quiz love | `QUIZ_LOVE` | 0.9 |
| Quiz like | `QUIZ_LIKE` | 0.7 |
| Quiz occasionally | `QUIZ_OCCASIONALLY` | 0.45 |
| Manual or quiz manual artist | `ARTIST_MANUAL` | 0.8 |
| Artist of known songs | `ARTIST_FROM_SONGS` | `min(0.9, 0.4 + 0.1 × n_songs)` |
| Last.fm song plays ≥ 10 / 3–9 / 1–2 | `SONG_LASTFM_HIGH` / `_MID` / `_LOW` | 1.0 / 0.7 / 0.4 |
| Spotify saved song | `SONG_SPOTIFY_SAVED` | 0.9 |
| Spotify top song | `SONG_SPOTIFY_TOP` | 0.8 |
| Loved song (`manual`) | `SONG_MANUAL` | 1.0 |
| YouTube Music song | `SONG_YTMUSIC` | 0.8 |
| Quiz or other song | `SONG_DEFAULT` | 0.6 |

  - Where a signal comes from several sources, the max wins. `excluded_artists` are removed.

- [ ] **Step 1: Write the failing tests.**
  - `test_max_across_sources`
  - `test_excluded_artist_removed`
  - `test_kn_id_maps_to_song_key`
  - `test_spotify_id_song_maps_by_artist_title`
  - `test_no_karaoke_known_song_listed`
  - `test_hidden_loaded`
  - `test_cold_and_has_profile`: quiz genres only → `has_profile` and `is_cold`.
  - `test_over_1000_user_songs_all_read`
- [ ] **Step 2: Run** `poetry run pytest backend/tests/recs_v2/test_context.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(recs-v2): user context from every source with VISION weights`.

### Task B8: candidates, scoring and sections

**Files:**
- Create: `backend/services/recs_v2/candidates.py`, `backend/services/recs_v2/scoring.py`, `backend/services/recs_v2/sections.py`
- Modify: `backend/services/recs_v2/weights.py` (scoring weights)
- Test: `backend/tests/recs_v2/test_scoring.py`, `backend/tests/recs_v2/test_personas.py`, `backend/tests/recs_v2/test_sections.py`

**Interfaces:**
- Consumes: Tasks B6 (`where_sql`) and B7 (`UserContextV2`), `CatalogReader`.
- Produces:
  - `@dataclass class Candidate`: `song_key, artist, title, artist_key, has_karaoke: bool, community: bool, commercial: bool, karafun: bool, brand_count: int, is_classic: bool, explicit: bool, duration_ms, year, decade, popularity, energy, mood, lead_gender, genres: tuple[str, ...]`, plus `similar_via: str | None` (the seed artist_key) and `similar_score: float`.
  - `def gather_candidates(reader, ctx, f: RecFilters) -> list[Candidate]`: the union of the source queries below, each with `where_sql(f)` applied, deduped by song_key, hidden songs removed.
  - `@dataclass class Scored: c: Candidate; score: float; reason_type: str; reason_artist: str | None`
  - `def score(c: Candidate, ctx: UserContextV2) -> Scored`
  - `def build_sections(scored: list[Scored], ctx, sort: Sort) -> list[Section]`
  - `@dataclass class Section: id: str; title_key: str; reason_key: str; title_params: dict[str, str]; songs: list[Scored]`
  - `reason_type` values are `known_song | known_artist | similar_artist | genre_match | decade_match | crowd_pleaser | make_it`.
  - Section limits: `songs_you_know` 10, `artists_you_love` 15, each `because_*` 10, `crowd_pleasers` 15 (30 when `ctx.is_cold`), `make_it` 10.
  - i18n keys (mobile and web share the same names):
    - `recs.section.<id>.title` / `.reason`
    - `because_*` uses `recs.section.because.title` with `{artist}`
    - `crowd_pleasers` uses `recs.section.crowd_pleasers.title`
- Candidate sources (each capped):

| Source | Query | Cap |
|---|---|---|
| Known artists | songs by the top 200 artists by weight | top 40 per artist by popularity |
| Similar artists | songs by the top 100 similar artists by `max(weight(a) × score(a, b))` | top 15 per artist |
| Quiz genres | genres ignoring `other`; decades and energy band applied when the user set them | top 300 by popularity |
| Crowd pleasers | `is_classic = 1 OR popularity >= 70` | top 300 |
| Make it | `in_kn = 0` songs by known artists, plus `ctx.known_without_karaoke` | top 10 per artist |

- Scoring algorithm (`scoring.py`). The constants live in `weights.py`:

```python
aff   = ctx.artists.get(c.artist_key).weight or 0
sim   = c.similar_score                       # max over seeds of weight(seed) * score(seed, artist)
known = ctx.known_songs.get(c.song_key, 0)
genre = 1.0 if ctx.genres - {"other"} and set(c.genres) & ctx.genres else 0.0
dec   = 1.0 if c.decade in ctx.decades else 0.0
nrg   = {"chill": 1 - e, "high": e, "medium": 1 - min(1, abs(e - 0.55) * 2)}[pref] if pref and e is not None else 0.0
pop   = (c.popularity or 0) / 100
brand = min(c.brand_count, 20) / 20
score = (0.30*aff + 0.15*sim + 0.15*known + 0.12*genre + 0.08*dec + 0.08*nrg
         + 0.07*pop + 0.05*brand)
if ctx.crowd_pref == "hits":      score += 0.05 * pop
if ctx.crowd_pref == "deep_cuts": score += 0.03 * (1 - pop) - 0.05 * pop
reason_type = first of: known_song (known>0), known_artist (aff>0), similar_artist (sim>0),
              make_it (not has_karaoke), genre_match (genre), decade_match (dec), crowd_pleaser
```

- Section assembly (`best`). Go through `scored` in descending score order, putting each song into the first section whose predicate it meets and which still has room. The per-artist cap is 3 per section, and a song lands in only one section.

| Section | Predicate |
|---|---|
| `songs_you_know` | `known > 0 and has_karaoke` |
| `artists_you_love` | `aff > 0 and has_karaoke` |
| `because_<seed>` | `similar_via == seed and has_karaoke`; seeds are the 2 highest-weight artists with ≥ 3 similar candidates; `title_params = {"artist": display name}` |
| `crowd_pleasers` | `has_karaoke` (and `is_classic or popularity >= 70` unless `ctx.is_cold`) |
| `make_it` | `not has_karaoke` |

- For other sorts there is one section `{id:"all", title_key:"recs.section.all.title"}`, holding every scored candidate ordered by `ORDER_SQL` semantics.

- [ ] **Step 1: Write the failing tests.**
  - `test_scoring.py`:
    - a known song outranks an unknown song by the same artist;
    - `energy_pref="chill"` ranks energy 0.2 above 0.9;
    - `deep_cuts` lowers popular songs;
    - `reason_type` order as above.
  - `test_sections.py`:
    - no song is in two sections;
    - ≤ 3 per artist per section;
    - the section order matches the Global Constraints;
    - empty sections are omitted;
    - `sort="popular"` gives a single `all` section;
    - known songs are **shown** (boosted, `reason_type == "known_song"`), not excluded.
  - `test_personas.py`, with three contexts on the fixture catalog:
    - A: rock, 1990s, high energy, loves 2 rock artists;
    - B: pop, 2010s, chill, no artists (cold);
    - C: a Last.fm-style heavy profile with 50 top artists and 300 known songs.

    Assertions:
    - the top 20 song_keys of A and B overlap by ≤ 4;
    - A's top 10 is ≥ 60% `rock` genre;
    - B's top 10 is ≥ 60% `pop` and ≥ 50% `2010s`;
    - C's first section is `songs_you_know`;
    - every persona gets ≥ 1 `crowd_pleasers` song.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/recs_v2 -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(recs-v2): candidates, scoring and explained sections`.

### Task B9: `GET /api/my/recommendations/v2`

**Files:**
- Create: `backend/services/recs_v2/service.py`
- Modify: `backend/api/routes/recommendations.py` (route plus models), `backend/api/deps.py` (`RecommendationServiceV2Dep`)
- Test: `backend/tests/recs_v2/test_route.py`

**Interfaces:**
- Consumes: Tasks B5–B8, and B10 (`SongFeedbackService`).
- Produces:
  - `RecommendationServiceV2.recommend(user: User, f: RecFilters, sort: Sort, cursor: str | None) -> RecommendationsV2Response`
  - Query params: the `RecFilters` fields as plain query params (lists repeated, e.g. `genre=rock&genre=pop`), plus `sort` and `cursor`.
  - Models:
    - `RecKaraoke{community: bool, commercial: bool, karafun: bool, brand_count: int}`
    - `RecFacets{decade, genres: list[str], mood, energy: float | None, lead_gender, duration_ms, popularity, is_classic: bool, explicit: bool}`
    - `RecSong{song_key, artist, title, reason: str, reason_type, reason_artist: str | None, score: float, has_karaoke_version: bool, karaoke: RecKaraoke, facets: RecFacets}`
    - `RecSection{id, title_key, reason_key, title_params: dict[str, str], songs: list[RecSong]}`
    - `RecommendationsV2Response{sections: list[RecSection], filters_applied: dict, next_cursor: str | None, has_profile: bool, catalog_run: str}`
  - `reason` is an English fallback for clients without i18n ("You know this", "Like {artist}", "Crowd pleaser", …). Clients render from `reason_type` and `reason_artist`.
  - Paging: only the flat `all` section pages, 30 per page. `next_cursor` is `base64url("o:<offset>")`. A bad cursor gives 400 `bad_cursor`.
  - When `CatalogUnavailable` is raised, the route returns 503 `{"detail": "warming_up"}` with header `Retry-After: 30`.
  - When everything is filtered out: 200 with `sections: []`.
  - The legacy v1 routes stay unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `test_v2_shape`
  - `test_v2_warming_up_503` (retry-after 30)
  - `test_everything_filtered_returns_empty_sections` (`genre=["ska"]` plus every ska song hidden)
  - `test_hidden_song_absent`
  - `test_flat_sort_paging` (two pages without overlap, then `next_cursor None`)
  - `test_bad_cursor_400`
  - `test_two_quiz_users_differ` (persona A vs B through the route)
  - `test_p50_under_500ms`: 20 warm calls on the fixture, median < 0.5 s. Mark it `@pytest.mark.slow` if CI is noisy, and record the real prod p50 in B13.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/recs_v2/test_route.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Context building and scoring run in `asyncio.to_thread` for the SQLite and CPU work.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): GET /api/my/recommendations/v2 with filters, sorts and sections`.

### Task B10: song feedback (hide, love) and Firestore batch helpers

**Files:**
- Create: `backend/services/song_feedback_service.py`, `backend/api/routes/my_songs.py`
- Modify: `backend/api/routes/__init__.py` (mount `my_songs.router` at `/my/songs`, **before** the `/my` recommendations router so `/api/my/songs` GET still resolves to the existing handler; check that it does)
- Modify: `backend/services/firestore_service.py` (add `batch_set` and `get_many`)
- Modify: `karaoke_decide/core/models.py:106` (add `"manual"` to `UserSong.source`)
- Test: `backend/tests/test_song_feedback.py`, plus additions to `backend/tests/test_firestore_service.py`

**Interfaces:**
- Produces:
  - `FirestoreService.batch_set(collection, docs: dict[str, dict], merge: bool = False) -> None` (commits every 400)
  - `FirestoreService.get_many(collection, ids: list[str]) -> dict[str, dict]` (`client.get_all`)
  - `HIDDEN_COLLECTION = "user_hidden_songs"`
  - `def feedback_doc_id(user_id: str, song_key: str) -> str`: `f"{user_id}:{sha1(song_key.encode()).hexdigest()[:24]}"`. It never contains `/`.
  - `SongFeedbackService`:
    - `hide(user_id, song_key, artist, title)`, `unhide(user_id, song_key)`
    - `love(user_id, song_key, artist, title)`: writes `user_songs/{user_id}:sk:{sha1[:24]}` with `source: "manual"`, `song_id: song_key`, `song_key`, `artist`, `title` and `play_count: 0`
    - `unlove(user_id, song_key)`
    - `hidden_keys(user_id) -> set[str]`
    - `list_hidden(user_id) -> list[FeedbackSong]`, `list_loved(user_id) -> list[FeedbackSong]`
  - `FeedbackSong{song_key, artist, title, created_at}`
  - Routes, all under the `CurrentUser` dependency:
    - `POST /api/my/songs/{song_key:path}/hide` → 204
    - `DELETE /api/my/songs/{song_key:path}/hide` → 204
    - `POST /api/my/songs/{song_key:path}/love` → 204
    - `DELETE /api/my/songs/{song_key:path}/love` → 204
    - `GET /api/my/songs/hidden` → `{songs: [FeedbackSong]}`
    - `GET /api/my/songs/loved` → `{songs: [FeedbackSong]}`
  - POST bodies are optional `{artist, title}`. When they are missing, the artist and title are looked up from catalog.db. An unknown key gives 404 `unknown_song`.
  - The path is matched with a regex route that strips a trailing `/hide` or `/love`, so a `song_key` containing `/` works.

- [ ] **Step 1: Write the failing tests.**
  - `test_hide_then_unhide`
  - `test_love_adds_user_song_manual`
  - `test_song_key_round_trip`: parametrized over `"ac dc|back in black"`, `"a&b|c#?"`, `"x/y|z%20"`, `"beyonce|halo"` with accents, and an Arabic key. Encode with `urllib.parse.quote(key, safe="")`; the stored `song_key` must equal the input exactly.
  - `test_doc_id_has_no_slash`
  - `test_get_songs_still_existing_handler`
  - `test_batch_set_chunks_400` (1000 docs → 3 commits)
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_song_feedback.py backend/tests/test_firestore_service.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Not for me / Love it feedback endpoints`.

### Task B11: quiz backend fixes

**Files:**
- Modify: `backend/services/listenbrainz_service.py:24, 63-95, 138-170`:
  - delete `MUSICBRAINZ_API_URL` and the HTTP lookup;
  - `search_artist_mbid` uses `CatalogReader.artist_mbid`, returning None when the catalog isn't ready.
- Modify: `backend/services/quiz_service.py`:
  - `_query_collaborative_sources` (L806-870): drop `query_organic` (the scan of up to 500 `decide_users`) and use `reader.similar(seed_artist_keys)` for "people also like" (`fans_also_like`). The Last.fm `array_contains_any` query stays.
  - `get_smart_quiz_artists` L306: replace `random.sample` with a sort by `(REASON_PRIORITY[reason.type], -score)` and take `count`. `REASON_PRIORITY = {"fans_also_like": 0, "similar_artist": 1, "genre_match": 2, "decade_match": 3, "popular_choice": 4}`. Every returned artist has a non-empty `suggestion_reason`, falling back to `popular_choice`.
  - `submit_quiz` L1361-1390 and L1495: top-5 songs per artist come from `reader.top_songs_for_artists(..., per_artist=5)` (BigQuery is the fallback when warming). Existing docs are fetched with one `get_many` and missing ones written with one `batch_set`. Every new doc includes `song_key`.
- Modify: `backend/api/routes/quiz.py`: add `GET /api/quiz/progress` returning the saved `QuizProgressRequest` shape, or 204 if there is none.
- Test: additions to `backend/tests/test_quiz_service.py` and `backend/tests/test_quiz_routes.py`, plus `backend/tests/test_listenbrainz_service.py` (create it if missing)

**Interfaces:**
- Consumes: Task B5 `get_catalog_store()`, Task B10 `batch_set` and `get_many`.

- [ ] **Step 1: Write the failing tests.**
  - `test_no_musicbrainz_http`: patch `httpx.AsyncClient.get` to fail on any URL containing `musicbrainz.org` → `get_similar_artists_by_name("Muse")` never calls it.
  - `test_people_also_like_reads_no_decide_users`: no `query_documents("decide_users", filters=[], …)` call.
  - `test_smart_suggestions_ranked_and_explained`: deterministic over 3 calls with the same input; every artist has a reason.
  - `test_submit_one_batch`: 3 artists × 5 songs → exactly one `get_many` and one `batch_set`, with zero per-song `get_document` calls. Docs carry `song_key`.
  - `test_get_progress_roundtrip` (PUT then GET)
  - `test_get_progress_none_204`
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_quiz_service.py backend/tests/test_quiz_routes.py backend/tests/test_listenbrainz_service.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(quiz): no live MusicBrainz, catalog similarity, ranked suggestions, batched submit, GET progress`.

### Task B12: library filter on the search service and the KV alias fix

**Files:**
- Create: `karaoke_decide/song_search/library_filter.py`
- Modify: `karaoke_decide/song_search/availability.py`. Add a `library` parameter to `AvailabilityIndex.search(query, limit, library="any")` (L427) and `popular(limit, library="any")` (L452).
- Modify: `backend/search/service.py:86,151`, so that `SearchService.search(q, limit, library)` and `popular(limit, library)` filter both the merged and the corrected group.
- Modify: `backend/search/app.py:144,174`. Add the `library: Literal["any","community","karafun"] = "any"` query param and log it in the search event.
- Modify: `karaoke_decide/song_search/version_priority.py:32`. Move `"Karaoke Cloud Digitrax"` out of the KV aliases into the CB aliases (L36).
- Test: `tests/unit/song_search/test_library_filter.py`, `backend/tests/search/test_search_api.py` (additions), `tests/unit/song_search/test_version_priority.py` (addition)

**Interfaces:**
- Produces:
  - `LibraryFilter = Literal["any", "community", "karafun"]`
  - `LIBRARY_CODES = {"karafun": "KV"}`
  - `def library_clause(library: LibraryFilter, key_col: str = "song_key") -> tuple[str, list[str]]`. Reuse it in Task B6 instead of duplicating the logic.

- [ ] **Step 1: Write the failing tests.**
  - `GET /api/search/popular?library=karafun`: every group has a version with `brand_code == "KV"`.
  - `library=community`: every group has a `kind == "community"` version.
  - `GET /api/search?q=starlite%20muse&library=karafun` behaves as follows:
    - it still returns Muse "Starlight" if that song has a KV version;
    - otherwise the group is filtered out;
    - in both cases the identification is unchanged.
  - `resolve_brand(brand_name="Karaoke Cloud Digitrax")` gives `CB`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/song_search backend/tests/search -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS. The fixture index must still pass its eval gates: `python -m karaoke_decide.song_search.fixtures build /tmp/fx`.
- [ ] **Step 5: Commit** `feat(search): library= filter on search and popular; Digitrax alias belongs to CB`.

### Task B13: infra, CI deploy flags, docs; ship PR 2; first catalog build; measure

**Files:**
- Modify: `infrastructure/__main__.py`:
  1. **Main service startup probe** (L345-350): change it to `http_get` `/api/ready` on port 8000 with `timeout_seconds=5, period_seconds=10, failure_threshold=24`.
  2. **Memory.** Keep 1Gi unless the measured `catalog.db` + `availability.db` exceeds 350 MB. In that case use 2Gi (request-billed, pennies); `/tmp` is in-memory on Cloud Run.
  3. **Uptime check.** Add a resource `decide-api-health-uptime` cloned from `search-health-uptime` (L958-978) with path `/api/health`, `period="60s"`, content match `"status"` (check the real body). Keep-warm cost is about $0, since idle CPU is released.
  4. **Bucket IAM.** Add `BucketIAMMember` resources giving `roles/storage.objectViewer` to `{PROJECT_NUMBER}-compute@developer.gserviceaccount.com` on `nomadkaraoke-musicbrainz-data` (with an IAM condition on prefix `catalog/`) and on `nomadkaraoke-kn-data` (condition on prefix `song-index/`).
- Modify: `.github/workflows/ci.yml:335-349` (the main deploy). Add `--startup-probe httpGet.path=/api/ready,httpGet.port=8000,timeoutSeconds=5,periodSeconds=10,failureThreshold=24 --cpu-boost`, plus `--memory` per item 2.
- Modify: `tests/unit/test_infra_ci_parity.py`. Add a main-service case asserting that Pulumi and ci.yml agree on memory, cpu, max-instances, min-instances (0) and startup-probe path.
- Modify: `pyproject.toml` (`version = "0.17.0"`).
- Modify: `docs/ARCHITECTURE.md` (catalog.db, startup), `docs/API.md` (v2, feedback, GET progress, `library=`), `docs/README.md` (status), `docs/TESTING.md` (catalog fixture).
- Modify: workspace `docs/MUSIC-METADATA-ACCESS.md`. Add one line under "Other useful tables" that `catalog.db` exists, with its GCS path.
- Andrew to-do list, which goes in the PR description:
  - `pulumi up` on the infra items above;
  - run the first catalog build with `gcloud run jobs execute mb-refresh --region us-central1 --args=catalog` (via `/gcp-admin`), otherwise it lands on the next Sunday run;
  - authorise `https://decide.nomadkaraoke.com` on the web OAuth client (needed in Part D).

- [ ] **Step 1: Run** the full decide check (Global Constraints) and `poetry run pytest tests/unit/test_infra_ci_parity.py -q`. Expected: PASS.
- [ ] **Step 2: Size check.**
  - Run `poetry run python -m karaoke_decide.etl.musicbrainz_refresh catalog --no-publish --workdir /tmp/cat`. Add `--no-publish` and `--workdir` to the `catalog` subcommand for this. It runs against prod BigQuery with the read-only ADC.
  - Record the songs count, coverage and file sizes.
  - Expected: < 150 MB raw and < 50 MB gzipped. If not, drop `in_kn=0` rows below 5,000 listeners and rebuild.
  - Read-only ADC can run queries. If it gets a 403, stop and ask Andrew for `/gcp-admin`.
- [ ] **Step 3: Commit, then** `/coderabbit` → `/pr` (with the Andrew to-do list) → merge → wait for deploy.
- [ ] **Step 4: Verify prod before the catalog exists.**
  - `curl https://decide.nomadkaraoke.com/api/ready` gives `catalog:false`.
  - v2 with a gen token gives 503 `warming_up`.
  - v1 categorized still gives 200.
  - Search `?library=karafun` gives 200.
- [ ] **Step 5: After Andrew has run the catalog job.**
  - `/api/ready` gives `catalog:true`.
  - Call v2 10 times. Record p50 from `curl -w '%{time_total}'` and from the Cloud Run request latency logs. Expected: < 500 ms warm.
  - Cold start: after ≥ 20 min idle (or a new revision), read the `Default STARTUP TCP probe succeeded` / `/api/ready` first-200 timestamp minus the container start timestamp in Cloud Run logs, for 3 samples. Expected: < 10 s. Record before (35–45 s) and after in the session record.

---

## Part C: decide local stack and test API (PR 3 with Part D, decide v0.18.0)

### Task C1: test API

**Files:**
- Create: `backend/api/routes/test_support.py`
- Modify: `backend/main.py` (`create_app`: `if settings.decide_test_api and not settings.is_production: app.include_router(test_support.router, prefix="/api/test")`), `karaoke_decide/core/config.py` (`decide_test_api: bool = False`, env `DECIDE_TEST_API`)
- Test: `backend/tests/test_test_support.py`

**Interfaces:**
- Consumes: `AuthService.resolve_gen_user`, `SongFeedbackService`, `QuizService` field names.
- Produces:
  - `POST /api/test/profile/reset {email}` → 204. Deletes the profile doc, `user_songs`, `user_artists`, `user_hidden_songs` and `quiz_progress` for that email's decide user.
  - `POST /api/test/profile/seed` → 200 `{user_id}`. Body:
    `{email, quiz_completed: bool = true, genres: list[str] = [], decades: list[str] = [], energy: "chill"|"medium"|"high"|None, artists: [{name, affinity: "occasionally"|"like"|"love"}] = [], loved: list[str] = [], hidden: list[str] = []}`
    Writes the same fields `submit_quiz` writes; songs and artists are given as song_keys and names.
  - `GET /api/test/profile?email=` → `{user_id, genres, decades, energy, artists, loved, hidden, quiz_completed}`.
  - No auth: the router mounts only with the flag on, outside production.

- [ ] **Step 1: Write the failing tests.**
  - `test_not_mounted_by_default` (404)
  - `test_not_mounted_in_production_even_with_flag`
  - `test_seed_then_read`
  - `test_reset_clears`
  - `test_seeded_profile_drives_v2`: seed persona A → v2 includes `artists_you_love`.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_test_support.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(test): decide test API for local-stack seeding`.

### Task C2: `scripts/local-stack.sh` (main API plus search, on gen's emulator)

**Files:**
- Create: `scripts/local-stack.sh` (`up|down|status|logs|env`)
- Modify: `scripts/search-local-stack.sh` (a thin wrapper: `exec scripts/local-stack.sh "$@" --search-only`, so existing callers keep working), `Makefile` (`stack-up`, `stack-down`), `docs/TESTING.md` (§ Local stack; keep § Search local stack pointing here)

**Interfaces:**
- Produces:
  - **Ports:** main API on `:8030` (`DECIDE_LOCAL_PORT`) and search on `:8020` (`SEARCH_LOCAL_PORT`).
  - **State:** `.local-stack/` with `song-index/`, `catalog/`, `api.pid`, `api.log`, `search.pid` and `search.log`.
  - **Firestore emulator:** if `127.0.0.1:8080` isn't listening, `up` runs `scripts/start-emulators.sh` and says so. It normally comes from gen's local stack.
  - **Main API env:**
    - `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `GOOGLE_CLOUD_PROJECT=test-project`, `ENVIRONMENT=development`
    - `JWT_SECRET=local-stack-jwt`, `DECIDE_TEST_API=1`, `BIGQUERY_DISABLED=1`
    - `CATALOG_LOCAL_DIR=.local-stack/catalog` (built by `python -m karaoke_decide.catalog.fixtures build`)
    - `SONG_INDEX_LOCAL_DIR=.local-stack/song-index`
    - `uvicorn backend.main:app --host 127.0.0.1 --port 8030`
  - **Readiness:** polls `/api/ready` until `catalog:true`, at most 60 tries.
  - `env` prints the `EXPO_PUBLIC_DECIDE_API_URL` / `EXPO_PUBLIC_DECIDE_SEARCH_URL` lines for the mobile app.

- [ ] **Step 1: Run** `scripts/local-stack.sh up` with gen's local stack already up (`cd ../karaoke-gen && scripts/local-stack.sh up`). Expected: both ready.
- [ ] **Step 2: Smoke test.**
  - Get a gen token: `curl -s -XPOST 127.0.0.1:8010/api/users/auth/google -d '{"id_token":"fake:e2e-c2@example.com"}' -H 'content-type: application/json' | jq -r .session_token`.
  - `curl -H "Authorization: Bearer $T" 127.0.0.1:8030/api/auth/me` gives 200.
  - `POST /api/test/profile/seed` (persona A), then v2 gives sections.
  - `curl '127.0.0.1:8020/api/search/popular?library=karafun'` gives 200.
- [ ] **Step 3: Run** `scripts/search-local-stack.sh up` alone (gen not running). Expected: the search stack comes up on `:8020` exactly as before.
- [ ] **Step 4: Commit** `feat(dev): decide local stack runs the main API on gen's Firestore emulator`.

---

## Part D: decide web on gen sign-in and v2 (PR 3)

### Task D1: gen sign-in on decide web

**Files:**
- Create: `frontend/src/lib/genAuth.ts`, `frontend/src/components/GoogleSignInButton.tsx`
- Modify: `frontend/src/lib/constants.ts`:
  - add `GEN_API_URL = process.env.NEXT_PUBLIC_GEN_API_URL || "https://api.nomadkaraoke.com"`;
  - add `GUEST_TOKEN_KEY = "karaoke_decide_guest_token"`;
  - read `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- Modify: `frontend/src/app/[locale]/login/page.tsx`. It becomes two steps (email → code), shows the Google button only when the client id is set, and adds a `?next=` redirect.
- Modify: `frontend/src/contexts/AuthContext.tsx`:
  - `login(token)` as now;
  - `logout()` calls `genAuth.logout()` and then `clearAuthToken()`;
  - drop `startGuestSession`, `requestUpgrade` and `isGuest`-only paths.
- Modify: `frontend/src/lib/api.ts:6-20`. Fix `getCurrentLocale()` to accept all 33 locales (survey of the web found it matches only `en|es|de`). Use the `routing.locales` list.
- Modify: `frontend/messages/en.json` `auth.*`. Add `enterCode, codeSentTo, verifyCode, invalidCode, resendCode, continueWithGoogle, signInToGetPicks`, and remove the magic-link-only keys that are no longer used. Then run translate for all locales.
- Modify: `.github/workflows/deploy-frontend.yml` (`NEXT_PUBLIC_GEN_API_URL` stays unset, so the default applies; `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is left unset until Andrew authorises the origin)
- Test: `frontend/e2e/gen-signin.spec.ts`

**Interfaces:**
- Produces `genAuth`, with requests going straight to gen (gen CORS is `*`):
  - `sendCode(email: string, locale: string): Promise<void>` → `POST {GEN_API_URL}/api/users/auth/send-code {email, locale}`
  - `verifyCode(email: string, code: string): Promise<string>` → `POST /verify-code {email, code}`, returns `session_token`
  - `googleSignIn(idToken: string): Promise<string>` → `POST /api/users/auth/google {id_token}`
  - `logout(token: string): Promise<void>` → `POST /api/users/auth/logout` (bearer)
- Code input: 6 digits (gen `CODE_LENGTH = 6`), testIDs `login-email`, `login-send-code`, `login-code`, `login-verify`, `login-google`.

- [ ] **Step 1: Write the failing Playwright test** `gen-signin.spec.ts`. It is skipped unless `GEN_STACK_URL` is set, and runs against the gen + decide local stacks with `NEXT_PUBLIC_API_URL=http://127.0.0.1:8030 NEXT_PUBLIC_GEN_API_URL=http://127.0.0.1:8010 npm run dev`.
  - Enter the email and send the code; read it from `GET {GEN_STACK_URL}/api/test/emails?to=<email>` (helper `e2e/utils/genStack.ts`); verify.
  - Expected: redirected to `/my-songs`, `localStorage["karaoke_decide_token"]` has no dot, and `/api/auth/me` gives 200 through the app.
  - `logout` revokes the token (gen `/api/users/me` with it gives 401).
  - Update `auth.spec.ts` for the new login page copy.
- [ ] **Step 2: Run** `GEN_STACK_URL=http://127.0.0.1:8010 npx playwright test e2e/gen-signin.spec.ts --project=chromium`. Expected: FAIL.
- [ ] **Step 3: Implement.** The Google button loads `https://accounts.google.com/gsi/client` only when the client id is set.
- [ ] **Step 4: Run** the same command plus `npm run type-check && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): sign in with your Nomad Karaoke (gen) account`.

### Task D2: remove guests; claim a guest profile on sign-in

**Files:**
- Modify: `frontend/src/app/[locale]/page.tsx:45-62` (Get started → `/login?next=/quiz` when signed out)
- Modify: `frontend/src/app/[locale]/quiz/page.tsx`:
  - L320-332: remove the guest auto-start and wrap the page in `ProtectedPage`;
  - remove step 6 (collect email, L1267-1370), so Finish goes to `/recommendations`.
- Modify: `frontend/src/components/Navigation.tsx` (drop guest labels), `frontend/src/components/UpgradePrompt.tsx` (link to `/login`), and delete `PostQuizEmailModal.tsx` (unused).
- Modify: `frontend/src/contexts/AuthContext.tsx`.
  - Before storing a new gen token, if the existing stored token is dotted **and** `getMe()` says `is_guest`, move it to `GUEST_TOKEN_KEY`.
  - After the gen sign-in, if `GUEST_TOKEN_KEY` exists, call `api.auth.claimGuest(guestToken)`.
  - On 200, 400 or 404, remove `GUEST_TOKEN_KEY`. On 5xx, keep it and retry on the next `checkAuth`.
- Modify: `frontend/src/lib/api.ts` (add `auth.claimGuest(guest_token)`; remove `createGuestSession`, `upgradeGuest`, `collectEmail`)
- Modify: `frontend/messages/*.json` (remove the dead keys `quiz.almostThere…`, `home.failedToStart`, `nav.guest*`; add `auth.importedGuestData` "We moved your quiz answers and songs to your account.")
- Test: `frontend/e2e/claim-guest.spec.ts`, `frontend/e2e/onboarding-flow.spec.ts` (update)

- [ ] **Step 1: Write the failing tests.**
  - `claim-guest.spec.ts` (mocked with `page.route`):
    - put a dotted guest token in localStorage; `**/api/auth/me` returns `is_guest: true` for it;
    - sign in through mocked gen routes;
    - expect `POST **/api/auth/claim-guest` with body `{guest_token}`, then the toast, and `GUEST_TOKEN_KEY` removed.
  - `onboarding-flow.spec.ts`: "Get started" while signed out lands on `/login`.
- [ ] **Step 2: Run** `npx playwright test e2e/claim-guest.spec.ts e2e/onboarding-flow.spec.ts --project=chromium`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus type-check, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): sign-in required for quiz and picks; guests can claim their data`.

### Task D3: recommendations page on v2

**Files:**
- Modify: `frontend/src/lib/api.ts`. Add `my.getRecommendationsV2(params: RecV2Params): Promise<RecommendationsV2>` with types copied from Task B9's models into `frontend/src/types/index.ts`.
- Modify: `frontend/src/app/[locale]/recommendations/page.tsx`. Keep its layout and map the existing controls to v2 params:
  - `karaokeFilter` all/karaoke/generate → `has_karaoke` any/yes/make;
  - `popularityFilter`: hidden-gems → `popularity_max=29`, somewhat-known → `popularity=30&popularity_max=49`, popular → `popularity=50&popularity_max=69`, chart-toppers → `popularity=70`;
  - `durationFilter` → `duration`;
  - `excludeExplicit` → `explicit=exclude`;
  - `classicsOnly` → `classic=true`.

  New controls: a Sort select (`best, popular, newest, oldest, shortest, az`) and a Library select (`any, community, karafun`, with the info line "KaraFun / Karaoke Version catalogue"). Render `sections` generically: title from `t(title_key, title_params)`, subtitle from `t(reason_key)`. Show the 503 `warming_up` state ("Getting your picks ready…" with retry) and a "Load more" button for the flat section's `next_cursor`.
- Modify: `frontend/src/components/RecommendationCard.tsx` (reason chip from `reason_type` and `reason_artist`; Community / KaraFun badges)
- Modify: `frontend/messages/en.json`. Add `recommendations.sort*`, `recommendations.library*`, `recs.section.<id>.title|reason` for every section id plus `because` and `all`, and `recs.reason.<reason_type>`. Translate all locales.
- Test: `frontend/e2e/recommendations.spec.ts` (rewrite the stale mocks)

- [ ] **Step 1: Write the failing tests** (mocked v2):
  - each control produces the expected query string on the request (6 cases, including `popularity_max=29` for hidden gems);
  - sections render in response order;
  - `because` shows "Because you like Muse";
  - a 503 shows warming and retries;
  - "Load more" appends.
- [ ] **Step 2: Run** `npx playwright test e2e/recommendations.spec.ts --project=chromium`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then type-check, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): recommendations page on v2 — every filter works, plus sort and library`.

### Task D4: ship PR 3

**Files:**
- Modify: `pyproject.toml` (`version = "0.18.0"`), `docs/README.md`, `docs/TESTING.md` (Playwright against the local stacks), `docs/API.md` (test API)
- [ ] **Step 1: Run** the full decide check, `python scripts/validate-translations.py --keys-only`, and the Playwright specs from D1–D3. Expected: PASS.
- [ ] **Step 2:** `/coderabbit` → `/pr` → merge → wait for the frontend and backend deploys.
- [ ] **Step 3: Verify on prod.**
  - On https://decide.nomadkaraoke.com, sign in with an email code (Andrew's test inbox or Playwright testmail). This lands on My Songs.
  - Recommendations render v2 sections, and changing each control changes the list.
  - Remind Andrew of the Google origin to-do. Once it's done, set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in `deploy-frontend.yml` in a follow-up commit.

---

## Part E: mobile Discover core (PR 4, nomad-mobile)

Before starting, message Tonight (nomadkaraoke-a7) with the list of shared files this part touches (Global Constraints), and pull `origin/main`. Prereq: PRs 1–3 are merged and deployed, so the prod OpenAPI has v2. For local runs, `DECIDE_DIR` points at the decide worktree.

### Task E1: `@nomad/core` library module and offline library reader

**Files:**
- Create: `packages/core/src/library/index.ts`
- Modify: `packages/core/src/search/offline.ts` (add `offlineSongLibraries`; `OfflineGroup` gains `libraries: string[]`, filled by `offlineSongGroup`, `searchAvailabilityOffline` and `popularOffline`), `packages/core/src/search/types.ts:43-60`, `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/library/__tests__/library.test.ts`, `packages/core/src/search/__tests__/offlineLibraries.test.ts`

**Interfaces (Produces, exactly as spec §7.2):**

```ts
export type LibraryFilter = 'any' | 'community' | 'karafun';
export interface LibraryTagged { libraries?: readonly string[]; versions?: readonly { kind: 'community' | 'commercial'; brand_code?: string }[]; }
export function matchesLibrary(song: LibraryTagged, filter: LibraryFilter): boolean;
export function songLibraries(song: LibraryTagged): Set<'community' | 'karafun'>;
export const LIBRARY_FILTERS: readonly LibraryFilter[]; // ['any','community','karafun']
export const KARAFUN_LIBRARY_CODE = 'KV';
```

- `offlineSongLibraries(db: SqlReader, songKeys: readonly string[]): Map<string, string[]>` runs one `SELECT song_key, library_code FROM song_libraries WHERE song_key IN (…)`, chunked by 500.
- Semantics:
  - `karafun` is true when `libraries` includes `KV` or any version has `brand_code === 'KV'`.
  - `community` is true when any version has `kind === 'community'`, or `libraries` contains a code whose `libraries.kind` is community. The offline reader passes versions, so this works without the `libraries` table.
  - `any` is always true.

- [ ] **Step 1: Write the failing tests.**
  - The truth table: {KV library only, KV version only, community version, commercial non-KV, empty} × 3 filters.
  - `songLibraries` returns both tags for a song with a KV version and a community version.
  - `offlineSongLibraries` on `search/__fixtures__/offline_fixture.db` (better-sqlite3 wrapper as in `offlineSearch.test.ts:10-14`): the Muse "Starlight" key returns its codes.
  - `popularOffline` groups carry `libraries`.
- [ ] **Step 2: Run** `pnpm jest packages/core`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm jest packages/core --coverage`. Expected: PASS, with ≥ 90% on `library/`.
- [ ] **Step 5: Commit** `feat(core): shared library filter (any/community/karafun) + offline song_libraries reader`.

### Task E2: `@nomad/core` discover logic

**Files:**
- Create: `packages/core/src/discover/{index.ts,filters.ts,quiz.ts,reasons.ts,snapshot.ts}`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/discover/__tests__/{filters,quiz,reasons,snapshot}.test.ts`

**Interfaces (Produces):**
- **`filters.ts`:**
  - `type RecSort = 'best'|'popular'|'newest'|'oldest'|'shortest'|'az'`
  - `type Mood = 'happy'|'chill'|'sad'|'intense'`
  - `interface RecFilters { genre: string[]; mood: Mood[]; energy: 'low'|'mid'|'high'|null; decade: string[]; popularity: number|null; leadGender: 'male'|'female'|'mixed'|null; duration: 'short'|'medium'|'long'|null; classic: boolean; explicit: 'include'|'exclude'; hasKaraoke: 'any'|'yes'|'make'; sort: RecSort }`. Library is **not** here; it comes from `useLibraryFilter` and is merged at query time.
  - `DEFAULT_REC_FILTERS`
  - `GENRE_IDS` (the same 22 ids as decide B1; `other` is labelled "Something else")
  - `DECADES = ['1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s']`
  - `toRecQuery(f: RecFilters, library: LibraryFilter): Record<string, string | string[]>`. It produces snake_case keys and omits defaults.
  - `activeFilterCount(f: RecFilters): number`. Sort doesn't count.
  - `filtersKey(f: RecFilters, library: LibraryFilter): string`. Stable: keys sorted, arrays sorted.
- **`quiz.ts`:**
  - `type Affinity = 'like'|'love'`
  - `interface QuizArtistPick { name: string; mbid?: string; affinity: Affinity; reason?: string }`
  - `interface QuizDraft { step: 1|2|3|4; genres: string[]; decades: string[]; energy: 'chill'|'medium'|'high'|null; artists: QuizArtistPick[]; songs: {songKey: string; artist: string; title: string}[] }`
  - `EMPTY_QUIZ`
  - `toggle(list: string[], v: string): string[]`
  - `cycleAffinity(d: QuizDraft, name: string, mbid?: string): QuizDraft`: not picked → like → love → not picked.
  - `canAdvance(d): boolean`: step 1 needs ≥ 1 genre; the other steps always pass.
  - `toSubmitRequest(d)`: `{genres, decade_preferences, energy_preference, artist_affinities: [{artist_name, affinity}], manual_artists: [{artist_name, mbid}], known_song_ids: []}`. Loved songs are sent separately via `loveSong`.
  - `toProgressRequest(d)`: `step` maps to decide's 1–5 range as is.
  - `fromProgress(p: unknown): QuizDraft | null`
- **`reasons.ts`:** `reasonKey(reasonType: string): string` gives `discover.reason.<type>`, with the fallback `discover.reason.crowd_pleaser`. `sectionTitle(section): {key: string; params: Record<string,string>}` maps decide's `title_key` (`recs.section.x.title`) to the app key `discover.section.x`.
- **`snapshot.ts`:** `RECS_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600 * 1000`, `isFresh(savedAt: number, now: number): boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `toRecQuery(DEFAULT_REC_FILTERS, 'any')` gives `{}`.
  - Every field round-trips to its snake_case key, e.g. `leadGender: 'female'` → `lead_gender: 'female'`, `hasKaraoke: 'make'` → `has_karaoke: 'make'`, `library: 'karafun'` → `library: 'karafun'`.
  - `filtersKey` is stable under array order.
  - The `cycleAffinity` cycle.
  - `canAdvance` on step 1 with an empty draft is false.
  - `toSubmitRequest` shape.
  - `fromProgress(garbage)` is null.
  - `isFresh` at the 7-day boundary.
- [ ] **Step 2: Run** `pnpm jest packages/core`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm jest packages/core --coverage`. Expected: PASS, with ≥ 90% on `discover/`.
- [ ] **Step 5: Commit** `feat(core): discover filters, quiz draft and reason mapping`.

### Task E3: `@nomad/api-decide`: snapshots, search URL split, discover facades

**Files:**
- Modify: `scripts/fetch-openapi.mjs:14` (`decide` honours `DECIDE_OPENAPI_URL`)
- Modify: `openapi/decide.json` and `openapi/decide-search.json` (`pnpm gen:api` against prod after PRs 2–3 deploy, or `DECIDE_OPENAPI_URL=http://127.0.0.1:8030/openapi.json DECIDE_SEARCH_OPENAPI_URL=http://127.0.0.1:8020/openapi.json`); the generated clients
- Modify: `packages/api-decide/src/configure.ts` (`ClientDeps.searchBaseUrl?: string`; the search client uses it, defaulting to `baseUrl`)
- Create: `packages/api-decide/src/discover.ts`
- Modify: `packages/api-decide/src/index.ts`. `searchSongs` and `popularSongs` accept `library?: LibraryFilter` (send it only when it isn't `'any'`). Re-export the discover facades.
- Test: `packages/api-decide/src/__tests__/discover.test.ts`, `configure.test.ts` (additions), `search.test.ts` (additions)

**Interfaces (Produces):**
- `getRecommendationsV2(query: Record<string, string | string[]>, cursor?: string): Promise<RecommendationsV2Response>`
- `isWarmingUp(e: unknown): boolean`: `ApiError` with status 503 and detail `warming_up`.
- `hideSong(songKey, meta?: {artist: string; title: string})`, `unhideSong(songKey)`, `loveSong(songKey, meta?)`, `unloveSong(songKey)`. Each URL-encodes the key with `encodeURIComponent`.
- `listHiddenSongs()`, `listLovedSongs(): Promise<FeedbackSong[]>`
- `getQuizProgress(): Promise<unknown | null>` (204 → null), `saveQuizProgress(body)`, `submitQuiz(body)`, `getQuizStatus()`
- `smartQuizArtists(body: {genres; decades; manual_artists; exclude; count})`, `searchArtists(q: string, limit = 10)` (`GET /api/catalog/artists`)
- `getPreferences()`, `updatePreferences(body: {genres?; decades?; energy_preference?})`
- `listMyArtists()` (`GET /api/my/data/artists`), `removeMyArtist(name)` (`DELETE /api/my/data/artists/{name}`)

- [ ] **Step 1: Write the failing tests** (mock fetch).
  - `hideSong encodes the key`: `hideSong('ac/dc|back in black')` calls a URL ending `/api/my/songs/ac%2Fdc%7Cback%20in%20black/hide`.
  - `searchBaseUrl routes search to the search host`: the search client hits `searchBaseUrl` and the main client hits `baseUrl`.
  - `isWarmingUp` returns true on 503 `warming_up`.
  - `getQuizProgress 204 → null`.
  - `popularSongs(30, 'karafun')` sends `library=karafun`; `'any'` sends no param.
- [ ] **Step 2: Run** `pnpm jest packages/api-decide`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `pnpm gen:api:offline`. Expected: no drift.
- [ ] **Step 4: Run** `pnpm jest packages/api-decide && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api-decide): v2 recommendations, feedback, quiz facades; separate search base URL`.

### Task E4: app wiring (token, stale on 401, search library)

**Files:**
- Modify: `apps/mobile/src/config.ts`. Add `DECIDE_SEARCH_URL = process.env.EXPO_PUBLIC_DECIDE_SEARCH_URL ?? DECIDE_API_URL`.
- Modify: `apps/mobile/src/api/setup.ts:21`. `configureDecide({ baseUrl: DECIDE_API_URL, searchBaseUrl: DECIDE_SEARCH_URL, getToken: () => useAuth.getState().getToken(), …, onUnauthorized: () => useDiscoverStale.getState().markStale() })`.
- Create: `apps/mobile/src/discover/staleStore.ts`. `useDiscoverStale` is a zustand store with `{stale: boolean; markStale(): void; clear(): void}`.
- Modify: `apps/mobile/src/find/useSearch.ts`. Read `useLibraryFilter` (Task E5), pass `library` to `searchSongs` and `popularSongs`, filter offline groups with `matchesLibrary`, and include `library` in the query key and cache key.
- Test: `apps/mobile/src/__tests__/decideAuth.test.ts`, `apps/mobile/src/__tests__/searchLibrary.test.tsx`

**Interfaces:**
- Consumes: Tasks E1, E3, E5 (`useLibraryFilter`).
- Produces: `useDiscoverStale`.

- [ ] **Step 1: Write the failing tests.**
  - `decide requests carry the gen token`: with a signed-in session, a decide facade call sends `Authorization: Bearer <gen token>`.
  - `decide 401 does not sign out`: a decide call returns 401 → `useAuth.getState().state.status === 'signedIn'` and `useDiscoverStale.getState().stale === true`.
  - `search sends library and filters offline`: `useLibraryFilter` set to `karafun` → `popularSongs` is called with `'karafun'`; offline groups without KV are dropped.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t "decide|library"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm jest apps/mobile`. Expected: PASS (existing search tests updated for the new key).
- [ ] **Step 5: Commit** `feat(mobile): decide uses the gen token; a decide 401 marks Discover stale, never signs out`.

### Task E5: library filter UI and `@nomad/ui` Chip

**Files:**
- Create: `packages/ui/src/Chip.tsx`. `Chip({label, selected, onPress, testID, accessibilityHint?})` is a `Pressable` pill using the gen tokens; `ChipRow({children, testID})` is a horizontal ScrollView. Export both from `packages/ui/src/index.ts`. This is a **shared file**: tell Tonight.
- Create: `apps/mobile/src/find/library/{store.ts,LibraryFilterPicker.tsx,LibraryBadge.tsx,index.ts}`
- Modify: `packages/i18n/messages/en.json`. Add `discover.libraryAny` "Any", `discover.libraryCommunity` "Community", `discover.libraryKarafun` "KaraFun", `discover.libraryInfo` "KaraFun / Karaoke Version catalogue", `discover.libraryLabel` "Venue library".
- Test: `apps/mobile/src/__tests__/libraryFilter.test.tsx`, `packages/ui/src/__tests__/Chip.test.tsx`

**Interfaces (Produces):**
- `useLibraryFilter`: a zustand store `{filter: LibraryFilter; set(f: LibraryFilter): void}`, persisted by hand to `appStorage` under key `discover.library.v1` (the `make/intentStore.ts` pattern: validate on load, remove on garbage).
- `LibraryFilterPicker()` renders a `ChipRow` of `LIBRARY_FILTERS` with testIDs `library-filter-<value>` and an info line under KaraFun.
- `LibraryBadge({song: LibraryTagged})` renders "Community" and/or "KaraFun" pills (`library-badge-community`, `library-badge-karafun`).

- [ ] **Step 1: Write the failing tests.**
  - Tapping `library-filter-karafun` persists: a remount reads `karafun`.
  - A garbage MMKV value falls back to `any`.
  - The badge renders both tags for a song with a KV version and a community version, and none for `{}`.
  - `Chip` exposes `accessibilityState.selected`.
- [ ] **Step 2: Run** `pnpm jest -t "library|Chip"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): venue library filter picker, badges and persisted choice`.

### Task E6: Discover screen states, sections and song feedback

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/discover.tsx` (composition only; logic in `src/discover/`) — **shared tab file**: tell Tonight
- Create:
  - `apps/mobile/src/discover/useRecommendations.ts`
  - `apps/mobile/src/discover/useSongFeedback.ts`
  - `apps/mobile/src/discover/components/{SignInCard,QuizCard,RecSection,RecSongRow,SongMenuSheet,ImproveCard,PicksState}.tsx`
- Modify: `packages/i18n/messages/en.json` (`discover.*` keys below)
- Test: `apps/mobile/src/__tests__/discoverRecs.test.tsx`

**Interfaces:**
- Consumes: Tasks E2–E5, `openSignIn` (`auth/signInUi.ts:14`), the existing `openSong(songKey)` pattern (`/song/[id]` with `id = song_key`; the spec's `/song/[song_key]` is this route), and the `makeIdentified` pattern for the Make section.
- Produces:
  - `useRecommendations(filters: RecFilters)`: a TanStack `useInfiniteQuery`.
    - Key: `['recs', filtersKey(filters, library)]`.
    - `enabled` only when signed in.
    - `retry`: none on 503 (the screen polls every 15 s while warming).
    - Returns `{data, status, warming, error, refetch, fetchNextPage, hasNextPage}`.
    - It also invalidates when `useDiscoverStale.stale` flips back.
  - `useSongFeedback()` returns `{hide(song), love(song), undoHide(song)}`. `hide` removes the song from cached pages optimistically, shows an undo toast, and rolls back on error.
- Screen, top to bottom:
  1. Search field and Describe it (unchanged).
  2. `LibraryFilterPicker`.
  3. With a query: the existing outcomes, unchanged.
  4. Without a query, one of:
     - **signed out:** `SignInCard` (`discover-signin-card`; button `discover-signin` → `openSignIn('/discover')`) above the popular list;
     - **signed in and `has_profile === false`:** `QuizCard` (`discover-quiz-card`; button `discover-quiz-start` → `router.push('/discover/quiz')`) above the popular list;
     - **signed in with a profile:** the `FilterBar` (Task E7) plus sections.

  Sections:
  - Each section header is `rec-section-<id>`.
  - Rows are `rec-row-<sectionId>-<i>`, with the title, artist, reason chip (`reasonKey`) and `LibraryBadge`.
  - Each row's ⋯ button is `rec-menu-<sectionId>-<i>`. It opens `SongMenuSheet` with `song-menu-hide` (Not for me) and `song-menu-love` (Love it).
  - Tapping a row opens the song page. In the `make_it` section, tapping opens the Make flow instead.
  - Pull to refresh.
  - `ImproveCard` (`discover-improve-card`, "Add artists and songs you love" → `/discover/quiz?step=3`) comes last.

  States:
  - **warming:** `discover-picks-warming` ("Getting your picks ready…").
  - **error:** `discover-picks-error` with retry button `discover-picks-retry`.
  - **empty with active filters:** `discover-picks-empty` with `discover-picks-clear` ("No picks match these filters" / "Clear filters").
- New `en.json` keys under `discover.`:
  - `signInForPicks`, `signInForPicksBody`, `quizCardTitle` ("Get your picks in 30 seconds"), `quizCardStart`
  - `picksWarming`, `picksError`, `picksRetry`, `picksEmpty`, `picksClear`
  - `improveTitle` ("Improve your picks"), `improveArtists` ("Add artists and songs you love")
  - `menuNotForMe`, `menuLoveIt`, `hiddenToast`, `undo`
  - `reason.known_song` ("You know this"), `reason.known_artist` ("You like {artist}"), `reason.similar_artist` ("Like {artist}"), `reason.genre_match`, `reason.decade_match`, `reason.crowd_pleaser` ("Crowd pleaser"), `reason.make_it` ("No karaoke version yet")
  - `section.songs_you_know`, `section.artists_you_love`, `section.because` ("Because you like {artist}"), `section.crowd_pleasers`, `section.make_it`, `section.all`, plus a `…Reason` line for each

- [ ] **Step 1: Write the failing tests** (`renderRouter(appRoutes(), {initialUrl: '/discover'})`, `@nomad/api-decide` mocked):
  - `signed out shows sign-in card and popular list`
  - `signed in without profile shows quiz card`
  - `signed in renders sections in order with reason chips and badges`
  - `warming shows getting-ready and polls`
  - `recs error shows retry; search still renders` (search input works and popular list shows)
  - `empty state offers clear filters`
  - `Not for me removes the row and undo restores it` (`hideSong` and `unhideSong` called with the song_key)
  - `make_it row opens the make flow`
  - `typing a query hides recommendations`
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t discoverRecs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm jest apps/mobile && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Verify on a running app.**
  - Run the iOS simulator with `EXPO_PUBLIC_DECIDE_API_URL=http://127.0.0.1:8030 EXPO_PUBLIC_DECIDE_SEARCH_URL=http://127.0.0.1:8020` against the local stacks, and a profile seeded via the Task C1 test API.
  - Take a screenshot with `xcrun simctl io booted screenshot /tmp/discover.png`.
- [ ] **Step 6: Commit** `feat(mobile): Discover recommendations with sections, reasons and Not for me / Love it`.

### Task E7: filter bar and sheets

**Files:**
- Create:
  - `apps/mobile/src/discover/filtersStore.ts`: `useRecFilters`, a zustand store `{filters: RecFilters; set(patch: Partial<RecFilters>): void; clear(): void}`, persisted to `appStorage` key `discover.filters.v1`
  - `apps/mobile/src/discover/components/FilterBar.tsx`
  - `apps/mobile/src/discover/components/sheets/{SortSheet,GenreSheet,DecadeSheet,MoodSheet,EnergySheet,MoreSheet}.tsx`
- Modify: `packages/i18n/messages/en.json` (`discover.filter.*`: chip labels, every sort, genre (21 + "Something else"), decade, mood, energy, lead gender, duration and karaoke-status label; "Classics only", "Hide explicit", "Apply", "Clear")
- Test: `apps/mobile/src/__tests__/discoverFilters.test.tsx`

**Interfaces:**
- Consumes: `@nomad/ui` `Sheet` (`{visible, onClose, title, testID, closeLabel, children}`; `Pressable` only inside it), `Chip`, Task E2 types.
- Produces:
  - **FilterBar:** chips `filter-chip-sort`, `filter-chip-genre`, `filter-chip-decade`, `filter-chip-mood`, `filter-chip-energy` and `filter-chip-more`, each showing a selected count.
  - **Sheets:** `filter-sheet-<name>`, with options `filter-opt-<name>-<value>` and `filter-apply-<name>`.
  - **More** holds popularity (Any / Popular 50+ / Chart toppers 70+), lead singer, duration, Classics only, Hide explicit, and karaoke status (Any / Has karaoke / Make it).
  - Applying sets the store, and the query key change refetches.

- [ ] **Step 1: Write the failing tests.**
  - Opening `filter-chip-genre`, picking `filter-opt-genre-rock` and tapping apply → `getRecommendationsV2` is called with `genre: ['rock']`.
  - Sort sheet `newest` → `sort: 'newest'`, and the screen renders a single `rec-section-all`.
  - More → `filter-opt-more-explicit-exclude` → `explicit: 'exclude'`.
  - Every option in every sheet maps to a query param (a table test over `toRecQuery` output, so no control does nothing).
  - Clear resets to defaults.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t discoverFilters`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): Discover filter bar and sheets`.

### Task E8: quiz

**Files:**
- Create: `apps/mobile/src/app/discover/quiz.tsx`. Declare it in `apps/mobile/src/app/_layout.tsx` as a `Stack.Screen` with `presentation: 'modal'`. If Expo Router reports a clash with `(tabs)/discover`, use `/quiz`. Add it to `src/test-utils/routes.ts`.
- Create: `apps/mobile/src/discover/quizStore.ts`, `apps/mobile/src/discover/quiz/{GenreStep,DecadeEnergyStep,ArtistStep,SongStep}.tsx`
- Modify: `packages/i18n/messages/en.json` (`quiz.*`)
- Test: `apps/mobile/src/__tests__/quiz.test.tsx`

**Interfaces:**
- Consumes: Task E2 `QuizDraft` helpers, Task E3 facades, the existing `useSearch` and `SongCard` for step 4.
- Produces `useQuizDraft`, a zustand store wrapping `QuizDraft`. It loads from `getQuizProgress()` on open (resuming); otherwise it falls back to MMKV `discover.quiz.v1`. It autosaves with a 1 s debounced `saveQuizProgress` on change. The route param `step` opens that step.

Steps:
1. **Genres:** chips `quiz-genre-<id>` for the 22 ids. `quiz-next` is disabled until ≥ 1 genre is picked. This step has no skip.
2. **Decades and energy:** `quiz-decade-<d>` and `quiz-energy-<chill|medium|high>` (Chill / Mixed / Big energy). `quiz-skip` is available. Leaving this step starts the `smartQuizArtists` prefetch.
3. **Artists:**
   - The search box is `quiz-artist-search` (debounced `searchArtists`); results are `quiz-artist-result-<i>`.
   - The suggestion grid is `quiz-artist-suggestion-<i>`, each with a "why" line from `suggestion_reason.display_text`.
   - Tapping cycles like → love → off; the love state shows a heart.
   - Each pick refreshes suggestions (`exclude` = shown names; already shown artists are never removed).
   - Free text can never be added.
4. **Songs you love (optional):** the existing search; tapping a result toggles it (`quiz-song-<i>`).

Finish (`quiz-finish`, sticky):
- `submitQuiz(toSubmitRequest(d))`, then `loveSong` for each song;
- invalidate `['recs']`;
- `router.dismissTo('/discover')`.

Signed out: the route calls `openSignIn('/discover/quiz')`.

- [ ] **Step 1: Write the failing tests.**
  - `next is disabled without a genre`
  - `resumes from saved progress at step 3`
  - `artist tap cycles like/love/off`
  - `suggestions prefetch when leaving step 2` (`smartQuizArtists` called before step 3 renders)
  - `finish submits, loves songs and returns to Discover`
  - `autosave debounced`: 3 quick changes give 1 `saveQuizProgress`.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t quiz`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): native quiz with resume, smart suggestions and loved songs`.

### Task E9: Me → "Your music profile"

**Files:**
- Create: `apps/mobile/src/app/me/music-profile.tsx`, `apps/mobile/src/discover/profile/{useMusicProfile.ts,ProfileSection.tsx}`
- Modify: `apps/mobile/src/app/(tabs)/me.tsx` (a `me-music-profile` row, shown only when signed in) — **shared tab file**
- Modify: `apps/mobile/src/test-utils/routes.ts`, `packages/i18n/messages/en.json` (`account.musicProfile*`)
- Test: `apps/mobile/src/__tests__/musicProfile.test.tsx`

**Interfaces:**
- Consumes: `getPreferences`, `updatePreferences`, `listMyArtists`, `removeMyArtist`, `listLovedSongs`, `unloveSong`, `listHiddenSongs`, `unhideSong`.
- Produces a screen `profile-screen` with these sections:
  - **Quiz answers:** genres, decades and energy. `profile-edit-genres` → `/discover/quiz?step=1` and `profile-edit-decades` → `?step=2`.
  - **Artists you love:** `profile-artist-remove-<i>`.
  - **Songs you love:** `profile-loved-remove-<i>`.
  - **Hidden songs:** `profile-hidden-unhide-<i>`.
  - A placeholder comment marks where 3b adds services and 3c adds range. There is no "Connect your music" UI.
  - Every mutation invalidates `['recs']` and `['musicProfile']`.

- [ ] **Step 1: Write the failing tests.**
  - It renders all four sections from the mocks.
  - Unhide calls `unhideSong(key)` and removes the row.
  - Removing an artist calls `removeMyArtist(name)`.
  - Edit genres opens the quiz at step 1.
  - Signed out, the Me row is hidden.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t musicProfile`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): Your music profile (quiz answers, artists, loved and hidden songs)`.

### Task E10: offline last picks

**Files:**
- Create: `apps/mobile/src/discover/recsSnapshot.ts`
- Modify: `apps/mobile/src/discover/useRecommendations.ts`, `apps/mobile/src/discover/components/PicksState.tsx`
- Test: `apps/mobile/src/__tests__/recsOffline.test.tsx`

**Interfaces:**
- Produces a hand-rolled MMKV snapshot, so no new dependency (spec §8.4 allowed either option):
  - `saveRecsSnapshot(key: string, data: RecommendationsV2Response, now = Date.now()): void`. It stores the first page only under `discover.recs.v1` as `{key, savedAt, data}`, holding only the last filter key.
  - `loadRecsSnapshot(now = Date.now()): {key: string; savedAt: number; data: RecommendationsV2Response} | null`. Returns null when the snapshot is older than `RECS_SNAPSHOT_MAX_AGE_MS` or doesn't validate.
- In `useRecommendations`, when `useOffline()` is true or the query fails with a network error, it serves the snapshot and sets `offlineSnapshot: true`.
- The banner `discover-offline-picks` reads "Offline: showing your last picks". The library filter is still applied to the snapshot rows client-side with `matchesLibrary` (`karaoke` flags map to `versions`/`libraries`).
- Song feedback actions are disabled while offline.

- [ ] **Step 1: Write the failing tests.**
  - A success saves the snapshot.
  - Offline shows the banner and the snapshot sections.
  - An 8-day-old snapshot gives the offline empty state, not stale picks.
  - The library filter `karafun` drops snapshot rows without `karaoke.karafun`.
  - A garbage MMKV value returns null.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t recsOffline`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): offline Discover shows your last picks (≤ 7 days)`.

### Task E11: i18n, docs and the Phase 0 spec pointer

**Files:**
- Modify: `packages/i18n/messages/*.json` (`env -u GEMINI_API_KEY pnpm i18n:translate`, via `scripts/gcp-admin` if gcloud auth has lapsed; see mobile CLAUDE.md)
- Modify: `docs/superpowers/specs/2026-10-14-mobile-phase0-design.md:158-163`. Replace the `exchange-gen-session` text with a short note: superseded, decide accepts gen session tokens directly (Phase 3a spec §4).
- Modify: `CLAUDE.md`:
  - status line (Phase 3a);
  - Workspace (`src/discover`, `src/find/library`, core `library/` + `discover/`);
  - Rule 5 (decide now gets the gen token; a decide 401 marks Discover stale);
  - E2E (decide main stack `:8030`, `EXPO_PUBLIC_DECIDE_SEARCH_URL`);
  - remove the "Deferred" bullets about the library filter and decide recommendations.
- Modify: `docs/VISION.md` (Phase 3 status: 3a done).

- [ ] **Step 1: Run** `pnpm i18n:check`. Expected: PASS, with all 33 locales complete.
- [ ] **Step 2: Run** `pnpm test:coverage && pnpm typecheck && pnpm lint`. Expected: PASS, with `packages/*` ≥ 70%.
- [ ] **Step 3: Commit** `docs+i18n: Phase 3a Discover core in 33 languages`.

### Task E12: Maestro flows and screenshot review

**Files:**
- Modify: `maestro/scripts/stack.js` — **shared**. Add `ACTION: decide-seed` (POST `${DECIDE_STACK}/api/test/profile/seed` with `EMAIL` and `PROFILE` JSON) and `ACTION: decide-reset`. `DECIDE_STACK` defaults to `http://127.0.0.1:8030`.
- Modify: `scripts/e2e-local.sh` — **shared**:
  - start decide with `scripts/local-stack.sh up`, not `search-local-stack.sh`; `DECIDE_DIR` defaults to `../karaoke-decide`, `../karaoke-decide-phase3-discover` while unmerged;
  - add `adb reverse tcp:8030`;
  - Metro env: `EXPO_PUBLIC_DECIDE_API_URL=http://127.0.0.1:8030 EXPO_PUBLIC_DECIDE_SEARCH_URL=http://127.0.0.1:8020`;
  - set `DISCOVER_SHOTS=docs/screenshots/phase3a/$PLATFORM`.
- Create: `maestro/flows/discover-1-signin-card.yaml`, `discover-2-quiz.yaml`, `discover-3-filters.yaml`, `discover-4-hide.yaml`, `discover-5-profile.yaml`, `discover-6-offline.yaml` (tagged `force-offline`), `maestro/common/seed-decide-profile.yaml`
- Create: `docs/screenshots/phase3a/{ios,android}/`

Flows (each uses its own `e2e-discover<n>-<ms>@example.com` user via `stack.js setup`):
- **discover-1:** signed out → `discover-signin-card` is visible → screenshot → tap sign in → fake Google → back on Discover → `discover-quiz-card` is visible.
- **discover-2:** sign in → `discover-quiz-start` → `quiz-genre-rock` → next → `quiz-decade-2000s`, `quiz-energy-high` → next → tap `quiz-artist-suggestion-0` twice (love) → next → `quiz-finish` → `rec-section-artists_you_love` or `rec-section-crowd_pleasers` is visible → screenshots at each step.
- **discover-3:** `decide-seed` persona A → note `rec-row-*-0` text → tap `library-filter-karafun` → list changes and rows show `library-badge-karafun` → `filter-chip-decade` → `filter-opt-decade-1980s` → apply → the first row text changes.
- **discover-4:** seeded → read row 0's title → `rec-menu-<section>-0` → `song-menu-hide` → that title is no longer visible.
- **discover-5:** seeded with `genres:["pop"]` → Me → `me-music-profile` → `profile-edit-genres` → deselect pop, select metal → finish → Discover → the first section's row text differs from before.
- **discover-6** (force-offline group): runs after the online run has cached picks for the user. The flow seeds and loads online first, then the suite restarts Metro with `EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1`, so this flow only asserts `discover-offline-picks` and the rows. If cross-group state is fragile, split it into `discover-6a` (online warm-up, untagged) and `discover-6b` (tagged).

- [ ] **Step 1: Run** `scripts/e2e-local.sh --platform ios discover`. Expected: 6/6 pass. Fix and re-run until green.
- [ ] **Step 2: Run** `scripts/e2e-local.sh --platform android discover` (never at the same time as iOS). Expected: 6/6 pass.
- [ ] **Step 3: Run** the full suites on both platforms (`scripts/e2e-local.sh --platform ios`, then android). Expected: there are no regressions in make, search or review.
- [ ] **Step 4: Screenshot UX review.**
  - Open every PNG under `docs/screenshots/phase3a/` and check clipping, contrast (the app is dark-only), truncated chips, sheet heights and RTL.
  - Run `scripts/e2e-local.sh --platform ios --locale ar --screen long-title`, plus a Discover screen tour if needed: create `maestro/screens/discover-tour.yaml` (signed in, seeded, open each sheet).
  - Fix what's found and re-shoot.
- [ ] **Step 5: Commit** `test(e2e): Discover flows 1-6 on iOS and Android + Phase 3a screenshots`.

### Task E13: release APK, Tonight hand-off, PR

**Files:**
- Modify: workspace `docs/sessions/2026-Q4/<date>-mobile-phase3a-discover.md` (via `/wrap`)

- [ ] **Step 1: Build the release APK** against prod.
  - Run `cd apps/mobile && rm -rf android/app/build && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew -p android assembleRelease`, with prod env (no `EXPO_PUBLIC_*` local overrides).
  - Grep the bundle for a new string (e.g. "Get your picks in 30 seconds") to rule out a stale bundle.
  - Copy it to `~/Downloads/nomad-karaoke-phase3a-release.apk`.
- [ ] **Step 2: Prod check on the emulator with the release APK.**
  - Sign in with a real email code: Discover shows the quiz card.
  - Run the quiz: the sections render.
  - Apply the KaraFun filter and one sheet filter.
  - Not for me removes a song.
  - Airplane mode shows the last picks.
  - Record the results in the session notes.
- [ ] **Step 3: Message Tonight (nomadkaraoke-a7)** with the final names:
  - `@nomad/core`: `LibraryFilter`, `LibraryTagged`, `matchesLibrary`, `songLibraries`, `LIBRARY_FILTERS`, `KARAFUN_LIBRARY_CODE`, `offlineSongLibraries`, `OfflineGroup.libraries`;
  - app: `apps/mobile/src/find/library/{useLibraryFilter, LibraryFilterPicker, LibraryBadge}`;
  - `@nomad/ui` `Chip`/`ChipRow`;
  - search `library=` on `searchSongs`/`popularSongs`.

  Agree the merge order for the shared files.
- [ ] **Step 4:** `/test-review` → `/docs-review` → `/coderabbit` → `/pr` → merge.
- [ ] **Step 5:** Hand Andrew the APK path for his phone test, and close the backlog item with `/backlog-finish` once he confirms.
