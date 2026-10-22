# Mobile Phase 3b "Discover: your music data" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in singer feed decide their real music taste from the phone. The quick routes take seconds: a screenshot of their music app, or a public playlist link. The rich routes take longer: a Spotify or Apple data export parsed on the phone, ListenBrainz (polled daily), or Last.fm. Recommendations then refresh from that data.

**Architecture:**
- **decide imports:** decide (`karaoke-decide`) gets one ingest service. Every import route goes through it: screenshot (Gemini Flash via the AI Studio key), the Spotify playlist embed, Spotify/Apple export aggregates, and the existing YouTube Music, Last.fm and ListenBrainz syncs. It bulk-upserts `user_songs` / `user_artists` and keeps a per-source summary doc.
- **decide ListenBrainz:** MetaBrainz OAuth (dark behind a flag), an upload-export proxy, and a daily OIDC-verified poller.
- **decide fakes:** a `DECIDE_FAKE_EXTERNALS=1` mode serves fake ListenBrainz, MetaBrainz, Spotify embed, Last.fm and Gemini from the decide local stack.
- **mobile parsing:** export zips/CSVs are streamed on the phone (`fflate`) into aggregates by pure-TS parsers in `@nomad/core`.
- **mobile app:** a Connect hub and one screen per route under `src/discover/connect/`, file intake (document picker, Android share intent), local reminders and an offline upload queue.

**Tech Stack:**
- decide: Python 3.12, FastAPI, Firestore, google-genai (Developer API), httpx, cryptography (Fernet), google-auth (OIDC), Pulumi.
- mobile: Expo SDK 57, Expo Router, TanStack Query, Zustand + MMKV, `fflate`, `expo-document-picker`, `expo-image-picker`, `expo-image-manipulator`, `expo-notifications`, a local Expo module for Android share intake, jest-expo + RNTL, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-21-mobile-phase3b-music-data-design.md`. It builds on `2026-10-21-mobile-phase3a-discover-core-design.md` (3a). Learnings are in `2026-10-21-mobile-phase3-discover-survey.md` §3 and §11. Read all three before Task 1.

**3a dependency:** this plan assumes 3a has shipped as its spec describes:
- decide accepts gen session tokens (`VerifiedUser` is a gen user);
- the main API loads `catalog.db`, and `TrackMatcher.batch_match_tracks` matches against it;
- `user_songs` writes carry `song_key`;
- decide's `scripts/local-stack.sh up` runs the main API on :8030, with the test API under `DECIDE_TEST_API=1`;
- the app sends the gen token to decide;
- `src/discover/` holds the Discover screens, including the "Improve your picks" card and the "Your music profile" screen.

Where this plan names a 3a symbol that the 3a plan (`docs/superpowers/plans/2026-10-21-mobile-phase3a-discover-core.md`, not written when this plan was) names differently, use 3a's name. The marked spots are: 3a's catalog lookup, 3a's test-API router file, 3a's recommendations query key, 3a's Discover section testIDs, and 3a's Maestro decide helper.

## Global Constraints

- **Worktrees.** decide work happens in a worktree made with `/startnomad decide phase3b music data`, branched after 3a's decide PRs merge. Mobile work branches after 3a's mobile PR merges. Tonight (session nomadkaraoke-a7) shares `apps/mobile/src/app/_layout.tsx`, `packages/i18n`, `packages/core/src/index.ts`, `package.json`/lockfile and `app.json`: message it before merging changes to them.
- **Gemini.** Use the AI Studio key only (`GEMINI_API_KEY` from Secret Manager `gemini-api-key`), through `karaoke_decide.services.gemini_client.get_genai_client`. Never use Vertex. On the API, screenshot import is enabled only when the `GEMINI_API_KEY` env var is non-empty (never the gcloud fallback) or fakes are on. Limit: 10 images per user per UTC day, ≤ 5 images per request, ≤ 4 MiB each.
- **Infra policy (3a spec §9.4).** Pulumi and secret changes are written in the PR and applied by Andrew (`/gcp-admin`). Code must degrade gracefully before they are applied:
  - the screenshot card is hidden;
  - the ListenBrainz OAuth button is hidden;
  - with no `DECIDE_TOKEN_KEY`, Spotify tokens stay as today.
  - `ci.yml` mounts the new secrets only when the repo variable `DECIDE_3B_SECRETS == '1'`, and MetaBrainz only when `DECIDE_METABRAINZ == '1'`.
- **Service values:**
  - **ListenBrainz:** API base `https://api.listenbrainz.org/1`. Auth header `Authorization: Token <token>`. Poll pages are `count=1000`, at most 25 LB requests/min across the run. A user is stale after 30 days with no new listens. The run budget is `lb_poll_budget_seconds = 1500`; Cloud Run's timeout is 1800 s.
  - **MetaBrainz OAuth:** base `https://metabrainz.org` (`/oauth2/authorize`, `/oauth2/token`; check `/.well-known/openid-configuration` before coding). Scopes `profile listenbrainz:submit-listens`, with PKCE S256. The callback is `{PUBLIC_API_BASE_URL}/api/services/listenbrainz/oauth/callback`, where prod `PUBLIC_API_BASE_URL` is `https://decide.nomadkaraoke.com`. `return_to` is `Literal["app","web"]`. The app return is `nomadkaraoke://services/listenbrainz?status=connected|error&reason=<code>`.
  - **Upload limit:** the proxied ListenBrainz upload is ≤ 30 MiB (Cloud Run's request cap is 32 MiB). Above that, the app links to `https://listenbrainz.org/settings/import/`.
- **Spotify export.** Uploads go in chunks of ≤ 20,000 tracks, `chunk_count` ≤ 50. On the phone: skip plays shorter than 30 000 ms, and skip podcasts, audiobooks and video. Ingest is idempotent per (user, kind, generated_at, chunk_index).
- **Spotify playlist embed.** It fetches `https://open.spotify.com/embed/playlist/{id}`, reads ≤ 100 tracks, and is best-effort. It uses the YouTube Music limits: 30 s cooldown and 20 imports/day. Error codes are stable: 400 / 404 / 422 / 429 / 503, never 502.
- **Reminders.** Local notifications fire at +5 days (Account data) and +25 days (Extended history). Notification permission is asked only when the user taps "Remind me".
- **Alerts.** The embed canary posts to #noise only. A Gemini quota-exhausted error logs at ERROR once per process. Everything else that is expected (LB 404, 429, private playlist) logs at WARNING or INFO.
- **Test data.** Synthetic fixtures only: invented usernames (`e2e-…`, `fixture-user`), song titles/artists from the decide fixture catalog, no lyrics, no real exports.
- **Mobile rules** (mobile CLAUDE.md):
  - no JSX string literals; keys go under `connect.*` in `packages/i18n/messages/en.json`, translated to 33 locales before the PR;
  - a `testID` on every interactive element, prefixed `connect-`;
  - native deps via `npx expo install`; read the SDK 57 docs (`npx ctx7@latest docs /websites/expo_dev_versions_unversioned "<q>"`) before using expo-notifications, expo-document-picker, expo-image-picker, expo-image-manipulator or the Expo Modules API;
  - tests never under `src/app`;
  - API clients never touch storage.
- **decide rules.** Bump `pyproject.toml` from 0.15.x to the next minor. Each new endpoint gets a row in `docs/API.md`. Run `make test` (unit ≥ 70%, backend ≥ 60%).
- **Retry policy** for mobile uploads on 5xx, 429 or network errors: 5, 15, 30, 60 s, honouring `Retry-After`. Any other 4xx is final.

## Review Focus

1. **A real export zip with unexpected entries or naming.** Examples: old `StreamingHistory0.json` names, `Streaming_History_Video_*`, a nested `Apple_Media_Services.zip`, an Apple CSV with renamed headers, a UTF-8 BOM. The parser must still find the music plays, or say "This doesn't look like a Spotify or Apple export". It must never crash or report zero silently. Tests in Task 15: `oldAccountNaming`, `skipsVideo`, `nestedAppleZip`, `appleHeaderAliases`, `bomCsv`.
2. **The same export imported twice, or Account then Extended from the same account.** Play counts must not double. Tests in Task 2 (`max` play mode) and Task 5 (`duplicate chunk is a no-op`).
3. **A Cloud Tasks retry while the first run is still alive, or after the instance died mid-Last.fm sync.** The sync must resume from the checkpoint without two runs writing at once. Test in Task 11: `fresh heartbeat returns 503`, `stale heartbeat resumes`.
4. **A forged request to `/internal/*` with `X-CloudTasks-*` headers on the public service.** It must get 403. Test in Task 9.
5. **The OAuth return or a share intent arriving while the app is cold-started or on another screen.** It must land on the right Connect screen, never "Unmatched Route". Tests in Task 23 (`nativeIntent services return`) and Task 24 (`shared zip routes to import-file`).

---

## Part A: decide imports API (repo `karaoke-decide`)

### Task 1: Settings, token cipher, capabilities endpoint, deps

**Files:**
- Modify: `backend/config.py` (BackendSettings)
- Create: `backend/services/token_cipher.py`
- Modify: `backend/api/routes/services.py` (capabilities route), `pyproject.toml`/`poetry.lock` (add `python-multipart`, `google-auth` as direct deps; bump version)
- Test: `backend/tests/test_token_cipher.py`, `backend/tests/test_services_capabilities.py`

**Interfaces:**
- Produces, BackendSettings fields with env names in brackets:
  - `listenbrainz_oauth_enabled: bool = False` (LISTENBRAINZ_OAUTH_ENABLED)
  - `metabrainz_client_id: str = ""`, `metabrainz_client_secret: str = ""`
  - `metabrainz_base_url: str = "https://metabrainz.org"`
  - `listenbrainz_api_base: str = "https://api.listenbrainz.org/1"`
  - `lastfm_api_base: str = "https://ws.audioscrobbler.com/2.0/"`
  - `spotify_embed_base: str = "https://open.spotify.com"`
  - `decide_token_key: str = ""` (DECIDE_TOKEN_KEY)
  - `decide_fake_externals: bool = False`
  - `inline_tasks: bool = False` (DECIDE_INLINE_TASKS)
  - `public_api_base_url: str = "https://decide.nomadkaraoke.com"`
  - `mobile_app_scheme: str = "nomadkaraoke"`
  - `screenshot_llm_model: str = "gemini-3.8-flash"`
  - `lb_poll_budget_seconds: int = 1500`
- Produces, BackendSettings properties:
  - `screenshot_import_enabled -> bool`: `bool(os.environ.get("GEMINI_API_KEY","").strip()) or decide_fake_externals`;
  - `listenbrainz_oauth_active -> bool`: flag and client id and secret and token key all set;
  - `internal_invoker_emails -> set[str]`: `{f"{google_cloud_project_number}-compute@developer.gserviceaccount.com"}`.
- Produces `TokenCipher(key: str | None)`:
  - `PREFIX = "enc:v1:"`;
  - `encrypt(value: str | None) -> str | None`: Fernet, None passes through; with no key it returns the value unchanged;
  - `decrypt(value: str | None) -> str | None`: values without PREFIX are returned as-is (legacy plaintext);
  - `enabled: bool`.
- Produces `get_token_cipher(settings) -> TokenCipher`.
- Produces `GET /api/services/capabilities` (no auth) → `Capabilities{screenshot_import: bool, listenbrainz_oauth: bool, listenbrainz_upload_max_bytes: int = 31457280}`.

- [ ] **Step 1: Write failing tests:**
  - `test_round_trip`: `decrypt(encrypt("tok")) == "tok"`, and `encrypt("tok").startswith("enc:v1:")`;
  - `test_legacy_plaintext_passthrough`: `decrypt("plain") == "plain"`;
  - `test_no_key_is_identity`;
  - `test_capabilities_default_off`: both false, with `GEMINI_API_KEY` unset via monkeypatch;
  - `test_capabilities_on`: with the env key set and all four LB settings set, both true.
- [ ] **Step 2:** `poetry run pytest backend/tests/test_token_cipher.py backend/tests/test_services_capabilities.py -v`. Expected: FAIL (import errors).
- [ ] **Step 3:** Implement the settings, cipher and route. `poetry add python-multipart google-auth`, then bump the version.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(services): 3b settings, token cipher, capabilities endpoint`.

### Task 2: Firestore batch helpers and `ImportIngestService`

**Files:**
- Modify: `backend/services/firestore_service.py`
- Create: `backend/services/import_ingest_service.py`
- Modify: `backend/api/deps.py` (`ImportIngestServiceDep`)
- Test: `backend/tests/test_import_ingest_service.py`, `backend/tests/test_firestore_service.py` (extend)

**Interfaces:**
- Consumes `TrackMatcher.batch_match_tracks(list[dict]) -> list[MatchedTrack]` (catalog.db-backed after 3a). Consumes `karaoke_decide.song_search.text_normalize.identity_normalize` and `song_key`.
- Produces FirestoreService batch helpers (if 3a already added equivalents, use those and skip):
  - `get_documents(collection, ids) -> dict[str, dict]`, reading in chunks of 300 via `get_all`;
  - `batch_write(collection, docs: dict[str, dict], merge=True) -> None`, in chunks of 500;
  - `batch_delete(collection, ids) -> None`.
- Produces `backend/services/import_ingest_service.py`:
  ```python
  ImportSource = Literal["screenshot","spotify_playlist","spotify_export","apple_export","youtube_music","listenbrainz","lastfm","spotify"]
  @dataclass
  class IngestTrack: artist: str; title: str; plays: int | None = None; ms_played: int | None = None; last_ts: int | None = None
  @dataclass
  class IngestArtist: name: str; plays: int | None = None; rank: int | None = None
  @dataclass
  class IngestResult: artists_added: int; songs_added: int; songs_updated: int; tracks_matched: int
  class ImportIngestService:
      IMPORTS_COLLECTION = "user_imports"   # doc id f"{user_id}:{source}"
      async def ingest(self, user_id: str, source: ImportSource, tracks: list[IngestTrack],
                       artists: list[IngestArtist] | None = None, play_mode: Literal["max","add"] = "max") -> IngestResult
      async def record_import(self, user_id: str, source: ImportSource, *, status: str,
                              result: IngestResult | None, extra: dict | None = None) -> None
      async def get_import(self, user_id: str, source: ImportSource) -> dict | None
      async def remove_source_data(self, user_id: str, source: ImportSource) -> tuple[int, int]  # (songs, artists)
  ```
- Semantics:
  - **user_songs** ids are the existing `f"{user_id}:{song_id}"` (matched song id, or the `"{source}:{norm_artist}:{norm_title}"` synthetic id), with `song_key` (3a field) set on writes.
  - **Existing docs:** `playcount` becomes `max(old, new)` in `max` mode and `old + new` in `add` mode. `source` is not changed; the new source is added to a `sources` array.
  - **New docs** have the same field set as `SyncService._upsert_user_songs`, plus `sources=[source]`.
  - **When `artists` is None,** artists are derived from tracks (plays summed per `identity_normalize(artist)`, top 1000 ranked).
  - **user_artists** ids are `f"{user_id}:{source}:{safe_name}"`, the pattern `_store_listenbrainz_artists` uses. Fields: `artist_name`, `artist_key=identity_normalize(name)`, `playcount`, `rank`, `source`.
  - **record_import** merges `{source, status, artists, songs, last_import_at, **extra}`.
  - **remove_source_data** deletes `user_songs` whose `source == X`, removes X from `sources` arrays elsewhere, deletes `user_artists` of that source, and deletes the `user_imports` doc.

- [ ] **Step 1: Write failing tests** (MagicMock Firestore + fake matcher returning one matched and one unmatched):
  - `test_ingest_creates_songs_and_derives_artists`: `songs_added == 2`, and artists = 1 with summed plays;
  - `test_max_mode_does_not_double`: ingest twice with plays 5, then playcount == 5;
  - `test_add_mode_accumulates`: 5 + 3 → 8;
  - `test_existing_doc_keeps_source_adds_sources`;
  - `test_batches_writes_in_chunks_of_500`: 1,200 tracks give 3 `batch_write` commits;
  - `test_remove_source_data_only_that_source`.
- [ ] **Step 2:** `poetry run pytest backend/tests/test_import_ingest_service.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement the helpers, then the service, then the dep.
- [ ] **Step 4:** Re-run, plus `poetry run pytest backend/tests/test_firestore_service.py -v`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(imports): bulk ingest service for every import source`.

### Task 3: Screenshot extract and confirm

**Files:**
- Create: `backend/services/screenshot_import_service.py`
- Modify: `backend/api/routes/services.py`
- Test: `backend/tests/test_screenshot_import.py`

**Interfaces:**
- Consumes `ImportIngestService.ingest/record_import` and `get_genai_client`.
- Consumes 3a's catalog accessor: `lookup_song_keys(keys: list[str]) -> set[str]` and `lookup_artist_keys(keys: list[str]) -> dict[str, str]` (key → display name). If 3a's accessor lacks them, add them there.
- Produces `ScreenshotExtractor` protocol: `async def extract(self, images: list[tuple[bytes, str]]) -> list[RawCandidate]`. Implementations: `GeminiScreenshotExtractor`, plus `FakeScreenshotExtractor` (Task 13). Factory: `get_screenshot_extractor(settings)`.
- Produces `ScreenshotImportService.extract(user_id, images) -> list[Candidate]` and `.confirm(user_id, items) -> IngestResult`.
- `Candidate{kind: Literal["artist","song"], artist: str, title: str | None, confidence: float, matched: bool, song_key: str | None}`.
- Routes:
  - `POST /api/services/screenshot/extract`: multipart `images` (1–5), each ≤ 4 MiB, `image/*`. Returns `{candidates: [Candidate]}`.
  - `POST /api/services/screenshot/confirm`: `{items: [{kind, artist, title?}]}` (≤ 200). Returns `ImportResultResponse{source, artists_added, songs_added, songs_updated, tracks_matched}`. Define this model here; later tasks reuse it.
- Errors:
  - 400 `no_images` / `too_many_images` / `not_an_image`;
  - 413 `image_too_large`;
  - 429 `daily_limit`;
  - 503 `screenshot_unavailable` when disabled, or on a Gemini error. On a quota error (`is_quota_or_billing_error`), log ERROR once per process with `quota_exhausted_message()`.
- Prompt (exact): "This is a screenshot of a music app. List the artists and songs visible on screen. Return JSON only: {\"items\":[{\"kind\":\"artist\"|\"song\",\"artist\":string,\"title\":string|null,\"confidence\":number}]}. Ignore playlist names, podcasts, UI labels and ads." Call it with `response_mime_type="application/json"`.
- Dedupe on `(kind, identity_normalize(artist), identity_normalize(title))`, keeping the highest confidence. Sort: matched first, then by confidence. The rate limit reserves N images atomically in `screenshot_imports/{user_id}` (`{day, count}`), and releases them when Gemini fails.

- [ ] **Step 1: Write failing tests** (extractor mocked):
  - `test_extract_dedupes_and_matches`: two images repeat Muse; one candidate, `matched=True`;
  - `test_unmatched_artist_kept`;
  - `test_rejects_six_images_400`, `test_rejects_5mb_413`;
  - `test_daily_limit_counts_images`: 2 requests × 5 images OK, the third 429;
  - `test_gemini_failure_releases_reservation`;
  - `test_disabled_returns_503`;
  - `test_confirm_saves_with_source_screenshot`: ingest is called with `source="screenshot"`, and the response counts match.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the service, Gemini extractor and routes.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(imports): screenshot import via Gemini Flash (AI Studio key)`.

### Task 4: Spotify public playlist via the embed page, plus canary

**Files:**
- Create: `karaoke_decide/services/spotify_embed.py`, `tests/fixtures/spotify_embed/playlist.html` (synthetic `__NEXT_DATA__` with fixture-catalog songs), `.github/workflows/spotify-embed-canary.yml`
- Modify: `backend/services/sync_service.py`:
  - generalise `_reserve_youtube_music_import` / `_release_…` to `_reserve_playlist_import(user_id, collection)` / `_release_playlist_import(user_id, collection, token)`;
  - add `import_spotify_playlist`.
- Modify: `backend/api/routes/services.py`
- Test: `tests/unit/test_spotify_embed.py`, `backend/tests/test_services_routes.py` (extend)

**Interfaces:**
- `parse_spotify_playlist_id(value: str) -> str` accepts:
  - `open.spotify.com/playlist/{id}` (with `?si=` or `/intl-xx/`);
  - `spotify:playlist:{id}`;
  - a bare 22-char base62 id;
  - a URL inside surrounding share text.

  Anything else raises `InvalidSpotifyPlaylistUrlError`.
- `parse_embed_html(html: str) -> SpotifyEmbedPlaylist(title: str, tracks: list[dict])`:
  - reads `<script id="__NEXT_DATA__">` → `props.pageProps.state.data.entity`: `name`, then `trackList[].title` / `.subtitle` (artists joined by ", "; the first one is used);
  - a missing path raises `SpotifyEmbedFormatChangedError`.
- `SpotifyEmbedClient(base: str).get_playlist(playlist_id, limit=100)`. Errors: 404 → `SpotifyPlaylistNotFoundError`; network/5xx → `SpotifyEmbedFetchError`.
- `SyncService.import_spotify_playlist(user_id, url, client=None) -> dict` (same keys as the YouTube Music import). It ingests via `ImportIngestService` with `source="spotify_playlist"`, then `record_import`. Collection `spotify_playlist_imports`.
- `POST /api/services/spotify-playlist/import {url}` → `{playlist_title, tracks_fetched, tracks_matched}`. Errors: 400 bad URL, 404 not found/private, 422 `SpotifyEmbedFormatChangedError`, 429, 503.
- `python -m karaoke_decide.services.spotify_embed canary 37i9dQZF1DXcBWIGoYBM5M` exits 1 with a reason when fewer than 10 tracks are parsed.
- Workflow: daily `0 7 * * *` plus `workflow_dispatch`. On failure it curls `secrets.DISCORD_NOISE_WEBHOOK_URL` with `{"content":"Spotify embed canary failed: <reason>. Playlist-link import is degraded (best-effort feature). Check karaoke_decide/services/spotify_embed.py parse_embed_html."}`.

- [ ] **Step 1: Write failing tests:**
  - `test_parse_id_variants` (5 inputs → same id);
  - `test_parse_embed_fixture`: title and N tracks; first artist only;
  - `test_format_changed_raises`;
  - `test_limit_100`;
  - route `test_spotify_playlist_maps_errors` (each exception → its code);
  - `test_spotify_playlist_shares_cooldown_logic`: a second call within 30 s gives 429.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the YouTube Music route behaviour unchanged (its tests must still pass).
- [ ] **Step 4:** `poetry run pytest tests/unit/test_spotify_embed.py backend/tests/test_services_routes.py -v`. Expected: PASS.
- [ ] **Step 5:** Set the repo secret. If `NOMAD_DISCORD_NOISE_WEBHOOK_URL` is in the workspace env, run `gh secret set DISCORD_NOISE_WEBHOOK_URL --body "$NOMAD_DISCORD_NOISE_WEBHOOK_URL"`; otherwise add it to Andrew's to-do list (Task 14).
- [ ] **Step 6:** Commit: `feat(imports): Spotify public playlist via embed page (best-effort) + #noise canary`.

### Task 5: Spotify and Apple export ingestion

**Files:**
- Create: `backend/api/routes/imports_export.py`, included from `services.py`'s router
- Test: `backend/tests/test_export_ingest_routes.py`

**Interfaces:**
- Models:
  - `ExportTrack{artist: str(1..300), title: str(1..300), ms_played: int≥0, plays: int≥1, first_ts: int, last_ts: int}`;
  - `ExportRef{artist, title}`;
  - `ExportPlaylist{name: str(≤200), tracks: list[ExportRef](≤10000)}`;
  - `SpotifyExportRequest{kind: Literal["account","extended"], generated_at: date, chunk_index: int≥0, chunk_count: int 1..50, tracks: ≤20000, liked: ≤20000, playlists: ≤500}`;
  - `AppleExportRequest` = the same without `kind`, `liked` and `playlists`.
- Routes (VerifiedUser):
  - `POST /api/services/spotify-export` → `ImportResultResponse & {duplicate: bool, chunks_done: int, chunk_count: int}`;
  - `POST /api/services/apple-export` → the same.
- **Ingest:** tracks → `IngestTrack(plays, ms_played, last_ts)`, `play_mode="max"`. Liked and playlist tracks become `IngestTrack(plays=None)`. Artists are derived.
- **Idempotency:** `user_imports/{user_id}:spotify_export.exports["{kind}:{generated_at}"] = {chunk_count, chunks_done: [int], result totals}`, read and updated in one `transform_document_atomically`. A seen chunk_index returns the stored totals with `duplicate=true` and skips the ingest.
- **Status:** `importing` until `len(chunks_done) == chunk_count`, then `ok`.
- **Errors:** 422 on validation; `chunk_index ≥ chunk_count` → 400 `bad_chunk`.

- [ ] **Step 1: Write failing tests:**
  - `test_spotify_export_ingests_chunk`;
  - `test_duplicate_chunk_is_noop` (ingest is called once across two identical posts);
  - `test_status_importing_until_last_chunk`;
  - `test_account_then_extended_no_double_count` (max mode reaches ingest);
  - `test_apple_export_source_apple_export`;
  - `test_rejects_20001_tracks_422`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(imports): Spotify/Apple export aggregate ingestion (idempotent chunks)`.

### Task 6: Source summaries, the existing list's new fields, remove-data

**Files:**
- Modify: `backend/api/routes/services.py`, `backend/services/music_service_service.py`
- Test: `backend/tests/test_services_summary.py`

**Interfaces:**
- `SourceSummary`:
  - `source: str`, `connected: bool`, `username: str | None`;
  - `artists: int`, `songs: int`, `last_import_at: str | None`;
  - `status: Literal["ok","needs_reconnect","importing","stale","error"]`;
  - `auth: Literal["username","oauth"] | None`;
  - `pending_listenbrainz_import: {id: str, status: str} | None`.
- `GET /api/services/summary` (VerifiedUser) → `{sources: [SourceSummary], capabilities: Capabilities}`. Its rows are:
  - every `music_services` connection, with counts from `count_documents` on `user_artists`/`user_songs` filtered by source;
  - every `user_imports` doc.
- `GET /api/services` (the existing list; decide web relies on its shape) keeps its fields and gains `artists`, `songs`, `last_import_at`, `status`.
- Status mapping, first match wins:
  - `sync_status=="syncing"` or import `importing` → `importing`;
  - `error_code=="needs_reconnect"` → `needs_reconnect`;
  - `lb_stale` → `stale`;
  - `sync_status=="error"` → `error`;
  - else `ok`.
- `DELETE /api/services/sources/{source}/data` (source must be an `ImportSource`, else 400) → `{removed_songs, removed_artists}`. It also deletes the `music_services` doc when one exists. Extend the existing `DELETE /{service_type}` allowlist to `("spotify","lastfm","listenbrainz")` unchanged.

- [ ] **Step 1: Write failing tests:**
  - `test_summary_merges_connections_and_imports`;
  - `test_status_mapping_table` (parametrized over the five rules);
  - `test_list_services_has_new_fields`;
  - `test_remove_data_unknown_source_400`;
  - `test_remove_data_deletes_connection`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(services): per-source summaries and remove-data`.

## Part B: ListenBrainz

### Task 7: MetaBrainz OAuth (dark), encrypted tokens, Worker redirect fix

**Files:**
- Create: `karaoke_decide/services/metabrainz_oauth.py`
- Modify:
  - `karaoke_decide/services/listenbrainz.py`: `API_BASE` from settings; `get_listens` clamp 100 → 1000; add `validate_token`;
  - `backend/services/music_service_service.py`: `create_oauth_state(..., extra: dict | None = None)`, with `verify_oauth_state` returning the extra fields; store LB OAuth; encrypt and decrypt all tokens through `TokenCipher`, Spotify included;
  - `backend/api/routes/services.py`;
  - `infrastructure/cloudflare-worker/api-proxy.js`: `redirect: "manual"`, so 302s to `nomadkaraoke://` pass through.
- Test: `backend/tests/test_listenbrainz_oauth.py`, `tests/unit/test_metabrainz_oauth.py`, `tests/unit/test_api_proxy_worker.py` (extend: the backend request uses `redirect: "manual"`)

**Interfaces:**
- `MetaBrainzOAuth(settings)`:
  - `authorize_url(state, code_challenge) -> str`, built with `urllib.parse.urlencode(..., quote_via=quote)`;
  - `async exchange_code(code, code_verifier) -> dict`, client secret via HTTP basic;
  - `async refresh(refresh_token) -> dict`; raises `MetaBrainzInvalidGrantError` on `{"error":"invalid_grant"}`.
- `ListenBrainzClient.validate_token(token) -> str`: `GET /1/validate-token` with `Authorization: Token …` → `user_name`. A non-valid token raises `ExternalServiceError`.
- `MusicServiceService`:
  - `create_listenbrainz_oauth_service(user_id, tokens: dict, username: str) -> MusicService`, storing `auth="oauth"` with encrypted tokens;
  - `get_listenbrainz_token(service) -> str`: refreshes when within 5 min of expiry; invalid_grant sets `sync_status="error"`, `error_code="needs_reconnect"`.
- Routes:
  - `GET /api/services/listenbrainz/oauth/start?return_to=app|web` (VerifiedUser) → `{auth_url}`, or 404 `oauth_disabled` when `listenbrainz_oauth_active` is false. The state doc carries `return_to` and `code_verifier`.
  - `GET /api/services/listenbrainz/oauth/callback?code&state&error` (no auth). App target: a 302 to `nomadkaraoke://services/listenbrainz?status=connected` or `?status=error&reason=<code>`, with gen's tiny HTML body and `Cache-Control: no-store`. Web target: a 302 to `{frontend_url}/en/music-i-know?listenbrainz=<status>`.
  - Reason codes: `denied`, `missing_params`, `invalid_state`, `exchange_failed`, `validate_failed`. Never exception text.

- [ ] **Step 1: Check the endpoints.** Run `curl -s https://metabrainz.org/.well-known/openid-configuration | jq '{authorization_endpoint,token_endpoint}'` and adjust the paths if they differ.
- [ ] **Step 2: Write failing tests** (respx-style httpx mock, or monkeypatched clients):
  - `test_start_disabled_404`;
  - `test_start_builds_pkce_url`: has `code_challenge_method=S256`, the scope is encoded, `redirect_uri` is the public callback;
  - `test_callback_app_redirects_to_scheme`: `Location` starts with `nomadkaraoke://services/listenbrainz?status=connected`;
  - `test_callback_error_uses_reason_code` (no exception text in `Location`);
  - `test_callback_invalid_state`;
  - `test_tokens_encrypted_at_rest`: the stored `access_token` starts with `enc:v1:`;
  - `test_spotify_tokens_read_legacy_plaintext`;
  - `test_refresh_invalid_grant_marks_needs_reconnect`.
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run them. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(listenbrainz): MetaBrainz OAuth behind LISTENBRAINZ_OAUTH_ENABLED; encrypted service tokens`.

### Task 8: Upload a Spotify export to ListenBrainz on the user's behalf

**Files:**
- Modify: `karaoke_decide/services/listenbrainz.py`, `backend/api/routes/services.py`
- Test: `backend/tests/test_listenbrainz_upload.py`

**Interfaces:**
- `ListenBrainzClient`:
  - `submit_import(token, data: bytes, filename: str) -> str`: `POST /1/import-listens/`, multipart `file`, `service=spotify`, returns the import id;
  - `get_import_status(token, import_id) -> dict`, with a `status` string;
  - a 429 raises `ListenBrainzRateLimitedError(retry_after: float)` from `X-RateLimit-Reset-In`.
- `POST /api/services/listenbrainz/upload-export`: multipart `file`, `application/zip`, ≤ 31,457,280 bytes.
  - Returns `{import_id, status}` and stores `lb_pending_import={id, status, submitted_at}` on the LB `music_services` doc.
  - Errors: 409 `not_oauth_connected`; 409 `import_in_progress` (a pending import that is not terminal); 413 `too_large`; 400 `not_a_zip` (bad magic bytes); 503 on an LB error.
  - The listens are not ingested here: the phone already sent the aggregates (Task 5). This only feeds ListenBrainz.

- [ ] **Step 1: Write failing tests:**
  - `test_upload_requires_oauth_409`;
  - `test_upload_too_large_413`;
  - `test_upload_not_zip_400`;
  - `test_upload_stores_pending_import`;
  - `test_second_upload_while_pending_409`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(listenbrainz): proxy Spotify export upload to ListenBrainz import-listens`.

### Task 9: OIDC verification for `/internal/*`

**Files:**
- Create: `backend/api/internal_auth.py`
- Modify: `backend/api/routes/internal.py` (replace `verify_cloud_tasks_request`)
- Test: `backend/tests/test_internal_auth.py`

**Interfaces:**
- `async def verify_internal_request(request: Request, settings: BackendSettings) -> bool`:
  - non-production → True;
  - production → requires `Authorization: Bearer <jwt>`, verified by `google.oauth2.id_token.verify_oauth2_token(token, google.auth.transport.requests.Request(), audience=settings.cloud_run_url)` in `run_in_threadpool`, with `email_verified` true and `email in settings.internal_invoker_emails`;
  - any exception → False, logged at WARNING.
- `InternalCaller = Depends(...)`: raises 403 when the check fails. It is used by `/internal/sync/process` and by Task 10's poll route.

- [ ] **Step 1: Write failing tests** (with `verify_oauth2_token` patched):
  - `test_production_forged_cloudtasks_headers_403` (headers, no token);
  - `test_production_valid_token_ok`;
  - `test_wrong_email_403`;
  - `test_wrong_audience_403` (the verifier raises);
  - `test_development_allows`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement; delete the header-only check.
- [ ] **Step 4:** Run them, plus the existing internal tests. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(internal): verify Cloud Tasks/Scheduler OIDC tokens instead of headers`.

### Task 10: Daily ListenBrainz poller and stale status

**Files:**
- Create: `backend/services/listenbrainz_poller.py`
- Modify: `backend/api/routes/internal.py`
- Test: `backend/tests/test_listenbrainz_poller.py`

**Interfaces:**
- `ListenBrainzPoller(settings, firestore, music_service, ingest, client, clock=time.monotonic, sleep=asyncio.sleep)`:
  - `async def run(self, budget_seconds: int) -> PollReport`;
  - `PollReport{users_polled: int, listens_added: int, imports_checked: int, rate_limited: int, remaining: int}`.
- Order: LB `music_services` by `lb_last_polled_at` ascending (missing first).
- Per user:
  - **First poll** (no `lb_last_listen_ts`): backfill newest-first with `max_ts` paging, ≤ 20 pages of 1000. Ingest with `play_mode="max"`.
  - **Later polls:** `min_ts=lb_last_listen_ts`, pages of 1000 while full, ≤ 10 pages. Ingest with `play_mode="add"`.
  - Aggregate listens per `(identity_normalize(artist), identity_normalize(title))` before ingest.
  - Then write `lb_last_listen_ts` = the max `listened_at`, `lb_last_listen_at`, `lb_last_polled_at`.
  - Set `lb_stale = (now - (lb_last_listen_at or connected_at)) > 30 days`.
  - If `lb_pending_import` is not terminal, call `get_import_status` and store it (token via `get_listenbrainz_token`).
- **Rate:** a `RateGate(per_minute=25)` before every LB call. On a 429, sleep `retry_after` once and retry; a second 429 skips the user (`rate_limited += 1`). Stop at the budget and report `remaining`.
- `POST /internal/listenbrainz/poll` (`InternalCaller`) → `PollReport`, with the budget from `settings.lb_poll_budget_seconds`. It logs one INFO summary line.

- [ ] **Step 1: Write failing tests** (fake LB client with listens and timestamps; fake clock):
  - `test_first_poll_backfills_max_mode_and_sets_cursor`;
  - `test_incremental_poll_adds_plays`;
  - `test_pagination_until_short_page`;
  - `test_429_backoff_then_skip`;
  - `test_rate_gate_25_per_minute` (31 calls take ≥ 60 s of fake time);
  - `test_stale_after_30_days_and_cleared_on_new_listens`;
  - `test_budget_stops_and_reports_remaining`;
  - `test_pending_import_status_updated`;
  - route `test_poll_requires_internal_caller`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(listenbrainz): daily poller folds new listens into the profile; stale status`.

## Part C: sync fixes

### Task 11: Last.fm resume on retry

**Files:**
- Modify: `backend/api/routes/internal.py` (`process_sync_task`), `backend/api/routes/services.py` (`trigger_sync`, `get_sync_status`), `backend/models/sync_job.py` (`resume_count: int = 0`)
- Test: `backend/tests/test_sync_resume.py`

**Interfaces:**
- **`process_sync_task`:**
  - `IN_PROGRESS` with `updated_at` older than `STALE_JOB_THRESHOLD_SECONDS` (300) → resume: `resume_count += 1`, run `sync_all_services_with_progress`. The Last.fm scrobble sync already continues from `oldest_scrobble_timestamp`.
  - `IN_PROGRESS` with a fresh heartbeat → HTTP 503 `in_progress`, so Cloud Tasks retries later.
  - `COMPLETED` / `FAILED` → 200 no-op.
  - An exception with `resume_count < 5` → status back to `PENDING`, `error` set, 500, so Cloud Tasks retries. At 5 resumes → `FAILED` and 200.
- **`get_sync_status`:** a stale in-progress job reports `status="stalled"` (no longer `failed`).
- **`POST /sync`:** with a stalled job present, re-enqueue that `job_id` and return it. No new job.

- [ ] **Step 1: Write failing tests:**
  - `test_fresh_heartbeat_returns_503`;
  - `test_stale_heartbeat_resumes`;
  - `test_exception_requeues_until_five_then_failed`;
  - `test_status_reports_stalled`;
  - `test_trigger_sync_reuses_stalled_job`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them, plus `test_sync_service.py`. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(sync): retried Cloud Tasks resume Last.fm from the checkpoint`.

### Task 12: Spotify `invalid_grant`, URL encoding, error codes

**Files:**
- Modify: `karaoke_decide/services/spotify.py` (`get_auth_url` via `urlencode(quote_via=quote)`; `refresh_token` raises `SpotifyInvalidGrantError` on a 400 `{"error":"invalid_grant"}`), `backend/services/music_service_service.py` (marks `needs_reconnect`), `backend/api/routes/services.py` (callback `message=` values become codes)
- Test: `tests/unit/test_spotify.py`, `backend/tests/test_services_routes.py` (extend)

**Interfaces:**
- Callback codes: `denied` (`error=access_denied`), `spotify_error` (any other `error`), `missing_params`, `invalid_state`, `exchange_failed`. The decide web error page already receives `missing_params` / `invalid_state`. Add en strings for the new codes in `frontend/messages/en.json` under the existing Spotify error namespace, translated with `scripts/translate.py`.

- [ ] **Step 1: Write failing tests:**
  - `test_auth_url_encodes_scope_and_redirect` (spaces as `%20`, `:` and `/` encoded in `redirect_uri`);
  - `test_refresh_invalid_grant_raises`;
  - `test_invalid_grant_sets_needs_reconnect`;
  - `test_callback_exception_redirects_with_code_not_text`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement and translate.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `fix(spotify): invalid_grant → needs_reconnect, encoded authorize URL, coded errors`.

## Part D: local-stack fakes

### Task 13: `DECIDE_FAKE_EXTERNALS` and inline tasks

**Files:**
- Create:
  - `backend/fakes/__init__.py`, `backend/fakes/state.py` (an in-memory `FakeState` with knobs and seeded users; `reset()`);
  - `backend/fakes/listenbrainz.py`, `backend/fakes/metabrainz.py`, `backend/fakes/spotify_embed.py`, `backend/fakes/lastfm.py`, `backend/fakes/gemini.py` (`FakeScreenshotExtractor`).
- Modify:
  - `backend/main.py`: mount `/fake` when `decide_fake_externals`; refuse to start with the flag in production;
  - `backend/services/cloud_tasks_service.py`: `inline_tasks` → `asyncio.get_running_loop().create_task(<POST to {public_api_base_url}/internal/sync/process>)`;
  - `karaoke_decide/services/lastfm.py` (`API_BASE` from settings);
  - 3a's test-API router (assumed `backend/api/routes/test_api.py`): add the fake seeding routes;
  - `scripts/local-stack.sh`: export the fake env;
  - `docs/TESTING.md` (§ Local stack: fakes).
- Test: `backend/tests/test_fakes.py`

**Interfaces:**
- **Fake routes** (all under `/fake`):
  - `listenbrainz/1/user/{u}/listen-count`, `…/listens` (honours `min_ts`, `max_ts`, `count`), `listenbrainz/1/stats/user/{u}/artists|recordings`, `listenbrainz/1/validate-token`, `listenbrainz/1/import-listens/` (POST) and `/{id}/` (GET; completes on the second status check);
  - `metabrainz/oauth2/authorize`: a 302 to `redirect_uri?code=fake-<n>&state=…`, or `error=access_denied` when knob `metabrainz=deny`;
  - `metabrainz/oauth2/token`: verifies the PKCE S256 verifier against the stored challenge;
  - `spotify/embed/playlist/{id}`: the fixture HTML for `fixtureplaylist00000001`, 404 for others, a changed shape when knob `spotify_embed=changed`;
  - `lastfm/2.0/?method=user.getinfo|user.gettoptracks|user.gettopartists|user.getlovedtracks|user.getrecenttracks`.
- **`FakeScreenshotExtractor`** always returns:
  - artist "Muse" (0.95);
  - song "Adele" / "Hello" (0.9);
  - artist "The Invented Band" (0.6, unmatched in the fixture catalog).

  With knob `screenshot=fail` it raises (→ 503).
- **Test API** (`DECIDE_TEST_API=1` only):
  - `PUT /api/test/fake-externals` `{knobs}` resets state and sets knobs;
  - `POST /api/test/fake-listenbrainz/users` `{username, listens: [{artist,title,listened_at}]}`;
  - `POST /api/test/fake-lastfm/users` `{username, top_tracks: [{artist,title,playcount}], top_artists: [{name,playcount}]}`.
- **`scripts/local-stack.sh` env:**
  - `DECIDE_FAKE_EXTERNALS=1`, `DECIDE_INLINE_TASKS=1`;
  - `PUBLIC_API_BASE_URL=http://127.0.0.1:8030`;
  - `LISTENBRAINZ_API_BASE=http://127.0.0.1:8030/fake/listenbrainz/1`;
  - `METABRAINZ_BASE_URL=http://127.0.0.1:8030/fake/metabrainz`;
  - `SPOTIFY_EMBED_BASE=http://127.0.0.1:8030/fake/spotify`;
  - `LASTFM_API_BASE=http://127.0.0.1:8030/fake/lastfm/2.0/`;
  - `LISTENBRAINZ_OAUTH_ENABLED=1`, `METABRAINZ_CLIENT_ID=fake`, `METABRAINZ_CLIENT_SECRET=fake`;
  - `DECIDE_TOKEN_KEY=<a fixed test Fernet key committed in the script, labelled test-only>`.

- [ ] **Step 1: Write failing tests** (TestClient with the flag on):
  - `test_fake_lb_listens_respect_min_ts`;
  - `test_fake_oauth_round_trip_connects_user` (start → follow the authorize 302 → callback → service stored with `auth=oauth`);
  - `test_fake_embed_import_end_to_end`;
  - `test_fake_lastfm_sync_inline_task_completes` (`POST /sync`; the job reaches `completed`);
  - `test_flag_refused_in_production`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Then `scripts/local-stack.sh up` and `curl -s 127.0.0.1:8030/api/services/capabilities` must show both capabilities `true`.
- [ ] **Step 5:** Commit: `test(local-stack): DECIDE_FAKE_EXTERNALS fakes for LB, MetaBrainz, Spotify embed, Last.fm, Gemini`.

### Task 14: Pulumi, CI, docs, ship the decide PR

**Files:**
- Modify: `infrastructure/__main__.py`, `.github/workflows/ci.yml`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/README.md`
- Create: `docs/archive/2026-10-21-phase3b-music-data.md` (Andrew to-do list, copied into the PR body)
- Test: `tests/unit/test_infra_ci_parity.py` (extend)

**Interfaces / exact values:**
- **Pulumi `gcp.secretmanager.Secret("decide-token-key", secret_id="decide-token-key", replication auto)`.** It has no version: Andrew adds one with `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())" | gcloud secrets versions add decide-token-key --data-file=- --project=nomadkaraoke`.
- **`REQUIRED_SECRETS`** += `"gemini-api-key"`, `"decide-token-key"`.
- **MetaBrainz secrets:** `metabrainz-client-id` and `metabrainz-client-secret` get accessor bindings only when `pulumi.Config().get_bool("metabrainzOAuth")`.
- **`gcp.cloudscheduler.Job("listenbrainz-poll-scheduler")`:**
  - name `listenbrainz-poll-daily`, schedule `"30 6 * * *"` UTC, `attempt_deadline="1800s"`;
  - `http_target` POST to `https://karaoke-decide-718638054799.us-central1.run.app/internal/listenbrainz/poll`;
  - `oidc_token={service_account_email: f"{PROJECT_NUMBER}-compute@developer.gserviceaccount.com", audience: "https://karaoke-decide-718638054799.us-central1.run.app"}`.
- **Scheduler service agent:** confirm with read-only `gcloud projects get-iam-policy` that `service-{PROJECT_NUMBER}@gcp-sa-cloudscheduler.iam.gserviceaccount.com` has `roles/cloudscheduler.serviceAgent`. Add `roles/iam.serviceAccountTokenCreator` on the compute SA only if it is missing.
- **ci.yml** main deploy: build `SECRETS` in a shell step. Base: today's list. If `vars.DECIDE_3B_SECRETS == '1'`, append `,GEMINI_API_KEY=gemini-api-key:latest,DECIDE_TOKEN_KEY=decide-token-key:latest`. If `vars.DECIDE_METABRAINZ == '1'`, append `,METABRAINZ_CLIENT_ID=metabrainz-client-id:latest,METABRAINZ_CLIENT_SECRET=metabrainz-client-secret:latest` and add env `LISTENBRAINZ_OAUTH_ENABLED=true`. Add env `PUBLIC_API_BASE_URL=https://decide.nomadkaraoke.com`.
- **Parity test:** `test_main_service_secrets_have_pulumi_access`. Every secret name that ci.yml can mount for the main service appears in `REQUIRED_SECRETS`, or in the metabrainz-gated block.
- **Andrew to-dos** (archive doc + PR body):
  - `pulumi up` (decide-token-key secret, IAM, scheduler, Worker redirect fix);
  - add the token-key version;
  - `gh variable set DECIDE_3B_SECRETS --body 1`, then re-run deploy;
  - spec §8 items 1–3;
  - the noise-webhook repo secret, if Task 4 couldn't set it.

- [ ] **Step 1:** Write the parity test. Run it. Expected: FAIL.
- [ ] **Step 2:** Make the infra and CI edits. Run `poetry run pytest tests/unit/test_infra_ci_parity.py -v`. Expected: PASS.
- [ ] **Step 3:** Run `make test` and `cd infrastructure && pulumi preview --stack prod` (read-only; if it 403s, note it for Andrew). Expected: tests pass with coverage gates.
- [ ] **Step 4:** Update the docs. Then run `/coderabbit`, `/pr` and merge. Verify on prod:
  - `curl https://decide.nomadkaraoke.com/api/services/capabilities` returns `{"screenshot_import":false,…}` until the infra is applied;
  - the YouTube Music import still works.

  After Andrew applies the infra, re-check `screenshot_import:true`, and check the first scheduler run in Cloud Run logs (`listenbrainz poll` INFO line).
- [ ] **Step 5:** Commit: `infra: 3b secrets, LB poll scheduler, Worker manual redirects (applied by Andrew)`.

## Part E: mobile (repo `nomad-mobile`)

### Task 15: `@nomad/core` import parsers

**Files:**
- Create in `packages/core/src/imports/`:
  - `types.ts`, `zip.ts`, `spotify.ts`, `apple.ts`, `upload.ts`, `playlistUrl.ts`, `index.ts`;
  - `__fixtures__/buildExport.ts` (synthetic zips via `fflate.zipSync`; songs/artists from the decide fixture catalog: Adele/Hello, Muse/Starlight, The Strokes/Machu Picchu, Elton John/Rocket Man).
- Modify: `packages/core/package.json` (dependency `fflate`, latest 0.8.x), `packages/core/src/index.ts` (`export * from './imports'`)
- Test: `packages/core/src/imports/__tests__/{zip,spotify,apple,upload,playlistUrl}.test.ts`

**Interfaces:**
```ts
export type ExportKind = 'spotify-account' | 'spotify-extended' | 'apple';
export interface ListenAggregate { artist: string; title: string; ms_played: number; plays: number; first_ts: number; last_ts: number }
export interface ExportRef { artist: string; title: string }
export interface ExportSummary { kind: ExportKind; generatedAt: string /* YYYY-MM-DD, max play date */;
  tracks: ListenAggregate[]; liked: ExportRef[]; playlists: { name: string; tracks: ExportRef[] }[];
  skipped: { podcasts: number; short: number; malformed: number } }
export class ExportZipReader { constructor(onEntry: (name: string, data: Uint8Array) => void, want: (name: string) => boolean);
  push(chunk: Uint8Array, final: boolean): void }            // nested *.zip entries are re-read recursively
export class ExportAggregator { addEntry(name: string, data: Uint8Array): void; addCsvText(text: string, final: boolean): void;
  summary(): ExportSummary | null }                            // null = not a Spotify/Apple export
export const wantExportEntry: (name: string) => boolean;
export interface ExportUploadChunk { endpoint: 'spotify-export' | 'apple-export'; body: Record<string, unknown> } // snake_case = decide API (Task 5)
export function toUploadChunks(s: ExportSummary, maxTracks?: number /* 20000 */): ExportUploadChunk[];
export function classifyPlaylistUrl(text: string): { service: 'spotify' | 'youtube_music'; url: string } | null;
export const MIN_PLAY_MS = 30_000;
```
- **Entry rules:**
  - `StreamingHistory_music_*.json` or legacy `StreamingHistory\d+.json` → account (`endTime`, `artistName`, `trackName`, `msPlayed`);
  - `StreamingHistory_podcast_*` → skipped;
  - `Streaming_History_Audio_*.json` → extended (`ts`, `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`; a null track counts as a podcast);
  - `Streaming_History_Video_*` → skipped;
  - `YourLibrary.json` `tracks[]{artist,track}` → liked;
  - `Playlist*.json` `playlists[]{name, items[].track{trackName, artistName}}`.
- **Apple CSV** (header aliases): artist ∈ {`Artist Name`, `Container Artist Name`}, title ∈ {`Song Name`, `Content Name`}, duration ∈ {`Play Duration Milliseconds`}, time ∈ {`Event Start Timestamp`, `Event End Timestamp`}. Fallback: `Track Description` split on the first `" - "`. Strip the BOM, and handle quoted commas and newlines. Text decoding uses fflate's `DecodeUTF8`.
- Aggregates are keyed by `identityNormalize(artist) + '\u0000' + identityNormalize(title)` (existing core function). The first-seen display strings are kept. The kind is extended if any audio file was seen.
- `toUploadChunks` sorts by plays descending. Liked and playlists go in chunk 0 only. Apple bodies omit `kind`/`liked`/`playlists`.

- [ ] **Step 1: Write failing tests** (fixtures built in-test):
  - `extendedSkipsPodcastsAndShort`;
  - `accountAggregatesPlays`;
  - `oldAccountNaming`;
  - `skipsVideo`;
  - `likedAndPlaylists`;
  - `generatedAtIsMaxPlayDate`;
  - `nestedAppleZip`;
  - `appleHeaderAliases`;
  - `bomCsv`;
  - `notAnExportReturnsNull`;
  - `chunkedPushEqualsWholePush` (feeding 7-byte chunks gives the same summary);
  - `toUploadChunks splits 45,001 tracks into 3`, with liked only in chunk 0;
  - `classifyPlaylistUrl` table (Spotify URL, Spotify inside share text, `music.youtube.com/playlist?list=`, `youtube.com/playlist?list=`, junk → null).
- [ ] **Step 2:** `pnpm jest packages/core/src/imports`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it with `--coverage`. Expected: PASS, with ≥ 90% lines for `imports/`.
- [ ] **Step 5:** Commit: `feat(core): on-phone Spotify/Apple export parsers (fflate, streaming)`.

### Task 16: api-decide snapshot and facades

**Files:**
- Modify: `openapi/decide.json` (refresh from the decide local stack: `curl -s 127.0.0.1:8030/openapi.json > openapi/decide.json`, with 3b's decide branch running), `packages/api-decide/src/index.ts`, regenerated `packages/api-decide/src/client/*`
- Test: `packages/api-decide/src/__tests__/imports.test.ts`

**Interfaces** (facades over the generated ops; `RNFile = { uri: string; name: string; type: string }`):
```ts
getServicesSummary(): Promise<ServicesSummaryResponse>
getServiceCapabilities(): Promise<Capabilities>
extractScreenshots(files: RNFile[]): Promise<ScreenshotExtractResponse>
confirmScreenshotItems(items: { kind: 'artist' | 'song'; artist: string; title?: string | null }[]): Promise<ImportResultResponse>
importSpotifyPlaylist(url: string): Promise<SpotifyPlaylistImportResponse>
importYouTubeMusicPlaylist(url: string): Promise<YouTubeMusicImportResponse>
uploadExportChunk(chunk: ExportUploadChunk): Promise<ExportIngestResponse>
connectListenBrainz(username: string), connectLastfm(username: string): Promise<ConnectedServiceResponse>
startListenBrainzOAuth(): Promise<{ auth_url: string }>          // return_to=app
uploadExportToListenBrainz(file: RNFile): Promise<{ import_id: string; status: string }>
removeSourceData(source: string): Promise<{ removed_songs: number; removed_artists: number }>
disconnectService(type: 'lastfm' | 'listenbrainz'): Promise<void>
triggerSync(): Promise<SyncJobStartResponse>
```
- Multipart facades build an RN `FormData` (`append('images', file as never)`). They pass it with a per-request `bodySerializer: (b) => b`, and drop `Content-Type` so fetch sets the boundary.

- [ ] **Step 1: Write failing tests** (fetch mocked as in `search.test.ts`):
  - `extractScreenshots sends FormData with N images`;
  - `uploadExportChunk posts to chunk.endpoint`;
  - `startListenBrainzOAuth passes return_to=app`;
  - `errors surface status codes as ApiError`.
- [ ] **Step 2:** `pnpm jest packages/api-decide`. Expected: FAIL.
- [ ] **Step 3:** Refresh the snapshot, then run `pnpm gen:api:offline` and implement the facades.
- [ ] **Step 4:** `pnpm jest packages/api-decide && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api-decide): 3b imports, services summary and ListenBrainz facades`.

### Task 17: File reading, upload queue, summary hooks

**Files:**
- Create in `apps/mobile/src/discover/connect/`: `readExport.ts`, `importQueue.ts`, `queries.ts`, `importErrors.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` (mount `useImportQueueRunner()`; message Tonight first)
- Test: `apps/mobile/src/__tests__/connect/{readExport,importQueue,queries}.test.ts`

**Interfaces:**
```ts
// readExport.ts: 256 KiB File.open().readBytes slices → ExportZipReader/ExportAggregator; awaits a macrotask every 4 slices
export async function readExportFile(uri: string, opts: { onProgress?: (read: number, total: number) => void; signal?: AbortSignal }): Promise<ExportSummary>
export class NotAnExportError extends Error {}
// importQueue.ts: zustand persisted in MMKV ('connect.importQueue'); payloads written to Paths.document/imports/<id>.json
export interface PendingUpload { id: string; chunk: ExportUploadChunk; attempts: number; nextAt: number; label: 'spotify' | 'apple' }
export const useImportQueue: UseBoundStore<…>  // { pending, enqueue(chunks: ExportUploadChunk[], label), remove(id) }
export function useImportQueueRunner(): void    // flushes in order when online (useOffline) and signed in; retry 5/15/30/60 s, Retry-After; other 4xx → drop + lastError
// queries.ts
export const SERVICES_SUMMARY_KEY = ['decide', 'services-summary'] as const;
export function useServicesSummary(): UseQueryResult<ServicesSummaryResponse>
export function useCapabilities(): UseQueryResult<Capabilities>   // staleTime 1 h; on error → both false
export function useInvalidateAfterImport(): () => void            // invalidates SERVICES_SUMMARY_KEY + 3a's recommendations query key
// importErrors.ts: ApiError status/detail → i18n key under connect.errors.* (badUrl, notFound, private, likedPrivate, unparseable, rateLimited, unavailable, tooLarge, notAnExport, generic)
export function importErrorKey(e: unknown, route: 'screenshot' | 'playlist' | 'export' | 'listenbrainz' | 'lastfm'): string
```

- [ ] **Step 1: Write failing tests:**
  - `readExportFile streams a 3 MB synthetic zip in ≥ 12 slices and matches the core summary` (mock `expo-file-system` `File`);
  - `abort stops reading`;
  - queue: `offline keeps pending`, `online flushes in order`, `503 retries with backoff`, `400 drops and sets lastError`, `survives restart (MMKV)`;
  - `useCapabilities falls back to false on error`;
  - `importErrorKey` table.
- [ ] **Step 2:** `pnpm jest apps/mobile/src/__tests__/connect`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): on-phone export reader, offline upload queue, summary hooks`.

### Task 18: Connect hub, entry points, profile Connected section

**Files:**
- Create:
  - routes `apps/mobile/src/app/discover/connect/_layout.tsx` and `index.tsx`;
  - components in `src/discover/connect/`: `ConnectHub.tsx`, `ConnectCard.tsx`, `ConnectedSources.tsx`, `ImportResult.tsx`.
- Modify:
  - 3a's "Improve your picks" card: add a "Connect your music" card → `/discover/connect`, plus the stale nudge when any source is `stale`;
  - 3a's music profile screen: render `<ConnectedSources />` under a "Connected" header with "Add more".
- Test: `apps/mobile/src/__tests__/connect/connectHub.test.tsx`, `connectedSources.test.tsx`

**Interfaces:**
- Cards in order, each with testID `connect-card-<id>`; ids `screenshot | playlist | spotify-export | listenbrainz | lastfm | apple`. `screenshot` is hidden when `capabilities.screenshot_import` is false. Each card has a title plus a one-line "what you get · how long". Exact en copy:
  - Screenshot: "Screenshot your music app" · "Artists in seconds"
  - Playlist: "Paste a playlist link" · "Spotify or YouTube Music · seconds"
  - Spotify export: "Your Spotify history" · "Your whole listening history · takes Spotify 5–30 days"
  - ListenBrainz: "ListenBrainz" · "Keeps your picks fresh as you listen"
  - Last.fm: "Last.fm" · "Your scrobbles · a few minutes"
  - Apple: "Apple Music" · "Your play history · takes Apple a few days"
- `ConnectedSources` rows `connected-row-<source>` show the name, status chip, "{artists} artists · {songs} songs", and the last import (relative). Actions:
  - `connected-remove-<source>`: confirm Alert → `removeSourceData`;
  - `connected-reconnect-<source>` when `needs_reconnect`;
  - a "Connect Spotify to ListenBrainz so new listens arrive" link when `stale`.
- `ImportResult` copy: "Added {artists, plural, one {# artist} other {# artists}} and {songs, plural, one {# song} other {# songs}} you know".
- Offline: the hub shows the cards; actions needing a network show "You're offline" (existing `useOffline`).

- [ ] **Step 1: Write failing tests:**
  - `hides screenshot card when capability off`;
  - `card order and copy`;
  - `stale source shows nudge`;
  - `remove confirms then calls removeSourceData and invalidates`;
  - `needs_reconnect shows reconnect`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement and add the en keys.
- [ ] **Step 4:** Run them, plus `pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): Connect your music hub and Connected sources`.

### Task 19: Screenshot import screen

**Files:**
- Create: `apps/mobile/src/app/discover/connect/screenshot.tsx`, `src/discover/connect/ScreenshotImport.tsx`
- Modify: `apps/mobile/package.json` (`npx expo install expo-image-picker expo-image-manipulator`), `app.json` (expo-image-picker plugin, `photosPermission`: "Allow $(PRODUCT_NAME) to read the screenshots you pick of your music app.", camera off)
- Test: `apps/mobile/src/__tests__/connect/screenshotImport.test.tsx`

**Interfaces:**
- Flow: pick (`launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 })`) → resize each to width ≤ 1290 px, JPEG 0.8 (image-manipulator) → `extractScreenshots` → a confirm list. All checkboxes start on; testIDs `connect-shot-item-<i>`, `connect-shot-confirm`. Unmatched artists get the "Not in our karaoke catalog yet" hint. Confirm → `confirmScreenshotItems` → `ImportResult` → invalidate.
- States: `picking | reading | confirm | saving | done | error`, with a progress line "Reading your screenshots…". Errors come from `importErrorKey(e,'screenshot')`. A 429 says "You've used today's 10 screenshots. Try again tomorrow."

- [ ] **Step 1: Write failing tests** (picker, manipulator and facades mocked):
  - `cancel picking returns to idle`;
  - `extract then confirm sends only checked items`;
  - `429 shows the daily-limit copy`;
  - `resizes before upload`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): screenshot import`.

### Task 20: Playlist link screen

**Files:**
- Create: `apps/mobile/src/app/discover/connect/playlist.tsx`, `src/discover/connect/PlaylistImport.tsx`
- Test: `apps/mobile/src/__tests__/connect/playlistImport.test.tsx`

**Interfaces:**
- A text field `connect-playlist-input` and a paste button `connect-playlist-paste` (expo-clipboard). Submitting `connect-playlist-submit` routes through `classifyPlaylistUrl`: Spotify → `importSpotifyPlaylist`, YouTube Music → `importYouTubeMusicPlaylist`, null → an inline "That isn't a Spotify or YouTube Music playlist link".
- The result is `ImportResult`, plus "{matched} of {fetched} have karaoke versions".
- A collapsible "How do I share my Liked Music?" holds the YouTube Music hint, ported from decide's `youtubeMusicImport.howTo*` strings. A 422 on YouTube Music shows `likedPrivate`. A 422 on Spotify shows "We couldn't read that playlist right now. Try a YouTube Music link or a screenshot instead."

- [ ] **Step 1: Write failing tests:**
  - `routes spotify vs youtube`;
  - `junk shows inline error and no request`;
  - `paste fills field`;
  - `spotify 422 copy`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): playlist link import (Spotify embed + YouTube Music)`.

### Task 21: Spotify export guide, reminders, file import screen

**Files:**
- Create:
  - `apps/mobile/src/app/discover/connect/spotify-export.tsx`, `apps/mobile/src/app/discover/connect/import-file.tsx` (`?file=<uri>&name=`);
  - `src/discover/connect/SpotifyExportGuide.tsx`, `src/discover/connect/ImportFile.tsx`, `src/discover/connect/reminders.ts`.
- Modify:
  - `apps/mobile/package.json` (`npx expo install expo-notifications expo-document-picker`);
  - `app.json` (expo-notifications plugin);
  - `app.config.ts`: strip `aps-environment` from iOS entitlements if prebuild adds it (local notifications don't need it), like `withoutAppleSignIn`;
  - `_layout.tsx` (`useReminderTapRouting()`).
- Test: `apps/mobile/src/__tests__/connect/{spotifyExport,importFile,reminders}.test.tsx`, `appConfig.test.ts` (extend: no `aps-environment`)

**Interfaces:**
- Guide, 3 steps:
  1. "Request your data at spotify.com/account/privacy. Tick Account data (ready in about 5 days) and Extended streaming history (up to 30 days): Extended has your whole history." Button `connect-spotify-open` → `WebBrowser.openBrowserAsync('https://www.spotify.com/account/privacy/')`.
  2. "We'll remind you when it should be ready." Button `connect-spotify-remind` → `scheduleExportReminders()`.
  3. "When Spotify's email arrives, download the zip, then Share → Nomad Karaoke (Android), or come back here and pick the file." Button `connect-spotify-pick` → `DocumentPicker.getDocumentAsync({ type: ['application/zip','text/csv','text/comma-separated-values'], copyToCacheDirectory: true })` → `/discover/connect/import-file?file=…`.
- `reminders.ts`:
  - `REMINDER_DAYS = { account: 5, extended: 25 }`;
  - `scheduleExportReminders(now = Date.now()): Promise<'scheduled' | 'denied'>`: asks permission, creates Android channel `reminders`, cancels earlier ids, schedules two DATE triggers, stores ids in MMKV `connect.spotifyReminders`. Content: "Your Spotify data may be ready" / "Open the email from Spotify, then share the zip with Nomad Karaoke." with `data.url = '/discover/connect/spotify-export'`;
  - `cancelExportReminder(kind: 'account' | 'extended')`;
  - `useReminderTapRouting()`: `getLastNotificationResponseAsync` + `addNotificationResponseReceivedListener` → `router.push(data.url)`.
- `ImportFile`:
  - `readExportFile` with a progress bar (`connect-import-progress`);
  - the summary preview "{tracks} songs from {kind}";
  - `toUploadChunks` → `useImportQueue.enqueue`;
  - "Waiting for connection" while offline;
  - `ImportResult` when the queue drains for this import.
  - A successful account import cancels the 5-day reminder; an extended one cancels both.
  - When `summary.kind === 'spotify-extended'` and the LB summary row has `auth === 'oauth'`: the checkbox `connect-lb-also` "Also add it to ListenBrainz so new listens keep flowing" → `uploadExportToListenBrainz`. If the file is larger than `capabilities.listenbrainz_upload_max_bytes`, the checkbox is replaced by the link "Too big to send from the app: upload it on listenbrainz.org" (`https://listenbrainz.org/settings/import/`).
  - `NotAnExportError` → "This doesn't look like a Spotify or Apple data export."

- [ ] **Step 1: Write failing tests:**
  - `remind asks permission only on tap`;
  - `schedules +5d and +25d and replaces earlier ids`;
  - `denied permission shows settings hint`;
  - `tap routing pushes data.url`;
  - `import-file parses, enqueues, shows waiting offline`;
  - `extended + oauth shows LB checkbox`;
  - `oversize shows LB link not checkbox`;
  - `extended import cancels both reminders`;
  - `not an export copy`;
  - `appConfig has no aps-environment`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Then `cd apps/mobile && npx expo prebuild --clean --no-install` and check that `ios/*/*.entitlements` has no `aps-environment`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): Spotify export guide, local reminders, on-phone import`.

### Task 22: Apple Music export screen

**Files:**
- Create: `apps/mobile/src/app/discover/connect/apple.tsx`, `src/discover/connect/AppleExportGuide.tsx`
- Test: `apps/mobile/src/__tests__/connect/appleExport.test.tsx`

**Interfaces:**
- Guide copy:
  1. "Go to privacy.apple.com and sign in." (`connect-apple-open` → `https://privacy.apple.com/`)
  2. "Choose Request a copy of your data, tick Apple Media Services information, and submit. Apple emails you in a few days."
  3. "Download the files, then pick the zip or the Play Activity CSV here."

  The button `connect-apple-pick` uses the same picker → `import-file`. No reminder; Apple's timing isn't fixed.

- [ ] **Step 1: Write failing tests:**
  - `opens privacy.apple.com`;
  - `picked csv routes to import-file`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): Apple Music privacy-export import`.

### Task 23: ListenBrainz and Last.fm screens, OAuth return

**Files:**
- Create: `apps/mobile/src/app/discover/connect/listenbrainz.tsx`, `lastfm.tsx`, `src/discover/connect/ListenBrainzConnect.tsx`, `LastfmConnect.tsx`, `useListenBrainzOAuth.ts`
- Modify: `apps/mobile/src/app/+native-intent.tsx`
- Test: `apps/mobile/src/__tests__/connect/{listenbrainz,lastfm}.test.tsx`, `nativeIntent.test.ts` (extend)

**Interfaces:**
- `LB_RETURN_URL = 'nomadkaraoke://services/listenbrainz'`.
- `useListenBrainzOAuth()`:
  - `startListenBrainzOAuth()` → `WebBrowser.openAuthSessionAsync(auth_url, LB_RETURN_URL)`;
  - `status=connected` → invalidate the summary, then `triggerSync()`;
  - `status=error&reason=<code>` → `connect.lb.oauthError.<code>`;
  - `dismiss` → idle.
- ListenBrainz screen:
  - the "Sign in with ListenBrainz" button `connect-lb-oauth`, only when `capabilities.listenbrainz_oauth`;
  - username field `connect-lb-username` + `connect-lb-submit` → `connectListenBrainz` → `triggerSync()` → `ImportResult` when sync status completes (poll `GET /api/services/sync/status` every 2 s, ≤ 2 min);
  - "Don't have one? Create a free account" `connect-lb-signup` → in-app browser `https://listenbrainz.org/login/`, with the checklist "Create a MetaBrainz account · Verify your email · Come back and enter your username";
  - "Connect Spotify to ListenBrainz" `connect-lb-spotify-guide` → `https://listenbrainz.org/settings/music-services/details/`.
- Last.fm screen: username `connect-lastfm-username` + `connect-lastfm-submit` → `connectLastfm` → `triggerSync()` → the same sync-status wait and result.
- `+native-intent.tsx`: `SERVICES_RETURN = /^nomadkaraoke:\/\/\/?services\/listenbrainz(?:[?#/]|$)/i`. Not initial → null (keep the screen; the auth session reads the URL). Initial → `/discover/connect/listenbrainz`.

- [ ] **Step 1: Write failing tests:**
  - `oauth button hidden when capability off`;
  - `oauth success invalidates and syncs`;
  - `oauth error shows coded copy`;
  - `username connect then sync result`;
  - `lastfm unknown user shows 422 copy`;
  - `nativeIntent services return keeps screen when warm`, `…opens LB screen when cold`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): ListenBrainz (username + OAuth) and Last.fm`.

### Task 24: Android share intent for zips/CSVs

**Files:**
- Create:
  - `apps/mobile/modules/share-intake/`: `expo-module.config.json` (android only), `android/src/main/java/com/nomadkaraoke/shareintake/ShareIntakeModule.kt`, `index.ts`;
  - `apps/mobile/plugins/withShareIntake.ts`;
  - `src/discover/connect/useSharedFileIntake.ts`.
- Modify: `app.config.ts` (apply the plugin), `_layout.tsx` (mount the hook; message Tonight)
- Test: `apps/mobile/src/__tests__/connect/sharedFileIntake.test.ts`, `appConfig.test.ts` (extend)

**Interfaces:**
- **Plugin:** adds to MainActivity an `<intent-filter>` with `android.intent.action.SEND`, category `DEFAULT`, and `<data android:mimeType>` × {`application/zip`, `application/x-zip-compressed`, `text/csv`, `text/comma-separated-values`}.
- **Kotlin module `ShareIntake`:**
  - `getInitialSharedFile(): {uri: string, name: string, mimeType: string} | null`: reads the launch intent's `EXTRA_STREAM`, copies the `content://` stream to `cacheDir/shared/<name>`, returns the `file://` uri, then clears the extra;
  - event `onSharedFile` with the same payload, from `OnNewIntent`.

  Check the Expo Modules API docs for `OnNewIntent` / activity listeners in SDK 57 before writing it. JS on iOS: the module is absent, so `index.ts` returns null and no-ops.
- **`useSharedFileIntake()`:** on the initial file or the event → `router.push({ pathname: '/discover/connect/import-file', params: { file: uri, name } })`. Signed out → `openSignIn` with that return path.

- [ ] **Step 1: Write failing tests:**
  - `shared zip routes to import-file` (module mocked);
  - `signed out goes through sign-in`;
  - `ios no-op`;
  - `appConfig adds SEND intent filter with four mime types` (run the plugin on a fixture manifest).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `npx expo run:android`, then `adb push` a synthetic zip and send `adb shell am start -a android.intent.action.SEND -t application/zip --eu android.intent.extra.STREAM content://…` (via the Files app share, or `am start` with a FileProvider uri). The import screen must open.
- [ ] **Step 4:** Run the tests, plus `pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(connect): Android Share → Nomad Karaoke for export zips`.

### Task 25: i18n, Maestro connect-1…5, fixtures

**Files:**
- Create:
  - `maestro/flows/connect-1-screenshot.yaml`, `connect-2-playlist.yaml`, `connect-3-spotify-export.yaml`, `connect-4-listenbrainz-username.yaml`, `connect-5-lastfm.yaml`;
  - `scripts/make-import-fixtures.ts`. It runs with plain `node` (type stripping) and writes the gitignored `maestro/fixtures/generated/spotify-extended.zip`. It imports `../packages/core/src/imports/__fixtures__/buildExport.ts` by explicit path, so `buildExport.ts` must import only `fflate`;
  - `maestro/scripts/push-fixtures.sh <ios|android>`.
- Modify:
  - 3a's Maestro decide helper (assumed `maestro/scripts/decide.js`): add ACTIONs `fake-externals` (resets knobs), `fake-lb-user` (USERNAME + fixture listens), `fake-lastfm-user`, `lb-poll` (`POST {DECIDE}/internal/listenbrainz/poll`), `source-counts` (EMAIL, SOURCE, MIN_SONGS → asserts the profile via 3a's test API);
  - `scripts/e2e-local.sh`: run `node scripts/make-import-fixtures.ts` + push-fixtures before `connect-*`;
  - `packages/i18n/messages/*.json`.
- Output: `docs/screenshots/phase3b/<platform>/*.png` (`${SHOTS3B}`)

**Interfaces / flow assertions:**
- **connect-1:** sign in, Discover → Improve → `connect-card-screenshot` → pick the fixture image (iOS Photos / Android Pictures; pushed by `push-fixtures.sh` via `xcrun simctl addmedia booted apps/mobile/assets/images/icon.png`, or `adb push … /sdcard/Pictures/` + a media-scan broadcast). Assert `Muse`, `Hello`, `The Invented Band` → confirm → "Added 2 artists and 1 song" → `source-counts SOURCE=screenshot MIN_SONGS=1`.
- **connect-2:** paste `https://open.spotify.com/playlist/fixtureplaylist00000001` → result visible → `source-counts spotify_playlist`.
- **connect-3:** `connect-card-spotify-export` → `connect-spotify-pick` → pick `spotify-extended.zip` (iOS Files "On My iPhone", copied into the DocumentsApp FileProvider storage by `push-fixtures.sh`; Android Downloads) → `connect-import-progress` → result → back to Discover → 3a's "Songs you know" section (assumed testID `rec-section-known`) contains "Starlight".
- **connect-4:** `fake-lb-user USERNAME=e2e-lb-<ms>` → type the username → connected row → `lb-poll` → pull to refresh → `connected-row-listenbrainz` shows "songs".
- **connect-5:** `fake-lastfm-user` → username → result (the inline task completes) → `connected-row-lastfm`.

- [ ] **Step 1:** Run `env -u GEMINI_API_KEY pnpm i18n:translate`, then `pnpm i18n:check`. Expected: no missing keys in 33 locales.
- [ ] **Step 2:** Write the flows and scripts, then run `scripts/e2e-local.sh --platform ios connect-`. Expected: 5/5 pass; screenshots in `docs/screenshots/phase3b/ios/`.
- [ ] **Step 3:** Run `scripts/e2e-local.sh --platform android connect-` (never at the same time as iOS). Expected: 5/5 pass.
- [ ] **Step 4:** Run the full suite once per platform (`scripts/e2e-local.sh --platform ios`), so 3a's and earlier flows still pass.
- [ ] **Step 5:** Commit: `test(e2e): Maestro connect-1…5 against the decide fakes; 33-locale strings`.

### Task 26: Screenshot UX review, release APK, docs, PR

**Files:**
- Create: `maestro/screens/connect-tour.yaml` (hub, each screen in every state: picking/confirm/error, guide steps, import progress, waiting-for-connection, LB stale nudge, needs-reconnect row), run in en and ar
- Modify:
  - `CLAUDE.md`: status line; `connect-*` flows; the decide main stack fakes; gotchas found (notification entitlement, share-intake module);
  - `docs/VISION.md` (3b status);
  - `../BACKLOG.md` via `/backlog-add`: MusicKit (Andrew's go), MetaBrainz `registration-requests` / `connect-services`, iOS share extension.

- [ ] **Step 1:** Run the tour: iOS en + ar, Android en. Review every shot for clipped text, touch targets < 44 pt, RTL mirroring and keyboard overlap. Fix the issues and re-run until clean; record them in the session record.
- [ ] **Step 2:** Build the release APK: `cd apps/mobile/android && ./gradlew assembleRelease`, with the same signing/env as `docs/sessions/2026-Q4/2026-10-19-mobile-search-parity.md`. Copy it to `~/Downloads/nomad-karaoke-phase3b-release.apk`. Install it on the emulator against prod and check:
  - the hub loads;
  - the screenshot card is hidden or shown per prod capabilities;
  - a public YouTube Music playlist imports;
  - a username ListenBrainz connect works with Andrew's account if he provides it, else skip.
- [ ] **Step 3:** Run `pnpm test:coverage && pnpm typecheck && pnpm lint && pnpm gen:api:offline`, with no drift. Then `/coderabbit`, then `/pr`. The PR body lists Andrew's to-dos from Task 14 and spec §8.
- [ ] **Step 4:** Commit: `docs(mobile): Phase 3b status, connect flows, screenshots`.

---

## Self-review notes (spec gaps found and how this plan resolves them)

- **The Cloudflare Worker follows redirects** (`redirect: "follow"`). Prod `decide.nomadkaraoke.com/api/*` goes through it, so the spec's LB callback on decide's domain would break the 302 to `nomadkaraoke://`. Task 7 switches the Worker to `redirect: "manual"`; Andrew applies it via Pulumi.
- **Mounting `gemini-api-key` in ci.yml** before the IAM binding exists would fail every deploy. Task 14 gates the new secret mounts on repo variables, flipped after `pulumi up`.
- **The proxied LB upload** can't exceed Cloud Run's 32 MiB request cap. The cap is 30 MiB, with a link to LB's own import page above it.
- **The app needs to know** whether to show the screenshot card and the LB OAuth button. Task 1 adds `GET /api/services/capabilities`. Per-source summaries come from a new `GET /api/services/summary`, because decide web relies on the existing list's shape (which still gains the four fields).
- **Imported historic listens predate the poller's `min_ts`.** The phone already ingests the zip (Task 5), so the LB upload only feeds ListenBrainz. The poller uses `max` mode for its first backfill and `add` only for new listens, so counts never double.
- **connect-5 needs a fake Last.fm,** and the local stack has no Cloud Tasks. Task 13 adds a fake Last.fm and `DECIDE_INLINE_TASKS`.
- **"Remove data"** (spec §5.1) had no endpoint. Task 6 adds `DELETE /api/services/sources/{source}/data`.
- **Apple's play-activity CSV headers** are unverified. The parser uses an alias table plus a `Track Description` fallback (Review Focus 1).
- **`expo-notifications` may add a push entitlement** that the dev and team signing can't use. Task 21 strips it.
