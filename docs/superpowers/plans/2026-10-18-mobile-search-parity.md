# Mobile search parity (Phase 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make decide the app's single cloud song-search backend. It runs kjbox's song identification plus community/commercial availability, served by a scale-to-zero service kept warm by pings. The app gets an opt-in offline index, and its Discover search and make flow are brought to parity with the kjbox singer UI and gen web.

**Architecture:**
- **Part A (karaoke-decide):** vendors kjbox's matcher and normaliser. A daily Cloud Run job builds three SQLite indexes (`song_id.db`, `availability.db`, `offline.db`) from the existing kn-data-sync exports. Each build is gated by evals and published by deploying a new revision of a separate `karaoke-decide-search` service (4 GiB, min 0, 60 s uptime ping).
- **Part B (karaoke-gen):** lets decide call the existing Gemini free-text resolve with its own partner secret, and fakes the judge and resolve on the local stack.
- **Part C (nomad-mobile):** ports the matcher to TypeScript, parity-tested over a fixture index. It queries the offline index and the cloud together, renders the four approved search outcomes, and ports gen's two-phase judge, pick-screen and YouTube-fallback rules into the make flow.

**Tech Stack:**
- decide: Python 3.12, FastAPI, SQLite FTS5, rapidfuzz, Pulumi (GCP Cloud Run service/job, Scheduler, Monitoring uptime check, Cloudflare Worker).
- gen: FastAPI.
- mobile: Expo SDK 57, expo-sqlite, TanStack Query, Zustand, jest + better-sqlite3 (tests only), Maestro.

**Spec:** `docs/superpowers/specs/2026-10-18-mobile-search-parity-design.md` (nomad-mobile). Section numbers below (§n) refer to it, and appendix learnings are cited as A-numbers.

**Worktrees:**
- decide: `/Users/andrew/Projects/nomadkaraoke/karaoke-decide-search-parity`
- mobile: `/Users/andrew/Projects/nomadkaraoke/nomad-mobile-search-parity`
- gen: create `/startnomad gen decide partner resolve` when Part B starts.

## Global Constraints

- **No new always-on cost.** The search service is `min-instances 0`, `cpu_idle: true`, 1 vCPU, 4 GiB. The main decide service stays at 1 GiB / min 0. Added GCP cost target: ≤ $2/mo.
- **Cloud Run settings go in BOTH Pulumi `infrastructure/__main__.py` and the CI deploy step.** CI flags override Pulumi.
- Claude's GCP access is read-only. Secret creation and `pulumi up` are **Andrew steps**: write the exact commands, then stop and ask.
- **Gemini is never called from decide or the app.** It is called only through gen `POST /api/kjbox/catalog/resolve`.
- **Banned sources:** karaokenerds.com, the live MusicBrainz API, and bulk data through the Mac. Indexes are built and evaluated in GCP.
- **Vendored kjbox files** start with `# Vendored from kjbox kj-controller/<path> @ <commit sha>; keep in step (parity tests in tests/unit/song_search/).`
- **Versions:**
  - `NORMALIZER_VERSION = 3`;
  - `SEARCH_INDEX_VERSION = "3.1"`;
  - song-id `SCHEMA_VERSION = 3`, copied as-is;
  - new `OFFLINE_SCHEMA_VERSION = 1`.
- **Matcher thresholds stay identical to kjbox:** confident score ≥ 0.80, margin ≥ 0.06, q_cov ≥ 0.80; candidates score ≥ 0.62, q_cov ≥ 0.70. The offline matcher adds `OFFLINE_MARGIN_BONUS = 0.03` to the margin.
- **Song identity:** `song_key(artist, title) = identity_normalize(artist) + "|" + identity_normalize(title)`.
- **Mobile:**
  - every user-facing string goes in `packages/i18n/messages/en.json` and is translated for 33 locales (`pnpm i18n:translate`);
  - a `testID` on every interactive element;
  - FlashList only through `@nomad/ui`;
  - API clients never touch storage;
  - native deps are added only via `npx expo install`.
- **Copy reused from gen** (port gen's translations where the key text matches):
  - "Tidied to {name} · keep what I typed"
  - "Corrected to {name} — you typed {typed} · Undo"
  - "Figuring out which song you mean…"
- **Coverage:** decide unit ≥ 70% and backend ≥ 60%; mobile packages ≥ 70%.
- **Test jobs:** never create real gen jobs for popular songs. Use `scripts/karaoke-candidates/output/candidates.csv` and ask Andrew first.

## Review Focus

1. **Queries the matcher has never seen:** empty after cleanup ("karaoke"), one character, emoji only, 200+ characters, RTL/CJK text. Expected: `{status: "none"}` and an empty group list, never a 500 or a JS throw. Pinned in Task A2 (Python) and Task C1 (TS).
2. **The offline index is missing, half-downloaded or corrupt** (sha mismatch, truncated file, schema newer than the app understands). Expected: the app keeps the previous file or reports "no offline list", and search falls back to the cloud. It must never crash or show an empty result as if it were real. Pinned in Task C3.
3. **Cold start or decide unreachable while online.** Expected: Discover shows offline results if downloaded, plus "Warming up…", or the Phase 1 "can't reach search" state, then swaps to cloud results when they arrive. A late cloud response for an older query must not overwrite a newer one. Pinned in Task C4.
4. **A version with no YouTube URL (disc or library only), and a song with 50+ versions.** Expected: the row says "in a library or on disc" without a link, and the list shows the best N with "Show all". Pinned in Task A3 (API caps) and Task C5 (render).
5. **The user edits the pre-filled artist/title, then the judge returns a correction.** Expected: the edited field is never overwritten, and "Undo" restores exactly what was showing before the correction. Pinned in Task C7.

---

## Part A — karaoke-decide (`karaoke-decide-search-parity`)

### Task A0: Cost gate — verify the ping trick costs ~$0

**Files:**
- Create: `docs/archive/2026-10-18-search-service-cost-check.md` (decide repo)

- [ ] **Step 1: Read gen's backend billing.** Query the billing export (read-only `claude-readonly` ADC) for Cloud Run service `karaoke-gen-backend` for 2026-10-05 → today.
  - Pass if idle and "min instance" SKUs are ≈ $0, with cost only on request-time SKUs.
  - Also list decide's current Cloud Run cost per day.
- [ ] **Step 2: Write the numbers into the archive doc.** Include a cost estimate for the search service: 4 GiB × expected request-seconds, plus the daily build job (2 vCPU / 8 GiB × ~600 s).
- [ ] **Step 3: Gate.** If idle cost is not ≈ $0, STOP and report to Andrew before any other Part A task.
- [ ] **Step 4: Commit** `docs: search service cost check`.

### Task A1: Vendor the normaliser, fuzzy matcher and brand ranking

**Files:**
- Create: `karaoke_decide/song_search/__init__.py`
- Create: `karaoke_decide/song_search/text_normalize.py`, vendored from `kjbox/kj-controller/text_normalize.py`
- Create: `karaoke_decide/song_search/fuzzy_match.py`, vendored from `fuzzy_match.py`
- Create: `karaoke_decide/song_search/version_priority.py`, vendored from `version_priority.py` (registries, `resolve_brand`, `canonical_brand_for_match`, `rank_version`, `annotate_versions`)
- Create: `karaoke_decide/song_search/brand_names.py`, vendored from `karaoke-gen/backend/services/kn_brand_names.py`
- Create: `tests/unit/song_search/test_text_normalize.py`, `test_fuzzy_match.py`, `test_version_priority.py`, ported from kjbox's tests for these modules (find them with `grep -l "text_normalize\|fuzzy_match\|version_priority" kjbox/kj-controller/tests/*.py`)
- Modify: `pyproject.toml` (add `rapidfuzz` if absent; version `0.14.0` → `0.15.0`)

**Interfaces:**
- Produces:
  - `normalize(text: str) -> str`, `identity_normalize(text: str) -> str`
  - `index_text(artist: str, title: str) -> str`, `fts_match_query(text: str) -> str`
  - `group_key(artist, title) -> str`, `result_group_key(artist, title) -> str`
  - `song_key(artist: str, title: str) -> str` (new; see Global Constraints)
  - `fuzzy_match.score(query: str, candidate: str) -> float | None`
  - `version_priority.rank_version(version: dict) -> int`
  - `brand_names.brand_name(code: str) -> str` (falls back to the code)

- [ ] **Step 1: Copy kjbox's tests for these modules, changing only import paths.** Add these tests:
  - `test_song_key_strips_feat_clause`: `song_key("Zedd feat. Hayley Williams", "Stay the Night") == "zedd|stay the night"`.
  - `test_index_text_keeps_featured_names_per_field` (A55/A56): `"hayley" in index_text("Zedd feat. Hayley Williams", "Stay the Night")`, and `"zedd"` is not the whole output.
  - `test_and_ampersand_equal` (A60): `normalize("Simon & Garfunkel") == normalize("Simon and Garfunkel")`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/song_search -q`. Expected: FAIL with ModuleNotFoundError.
- [ ] **Step 3: Vendor the modules** with the header from Global Constraints. Add `song_key`. Remove kjbox-only imports (Flask, config). Keep the constants byte-identical.
- [ ] **Step 4: Run tests.** Expected: PASS. Then `poetry run ruff check karaoke_decide/song_search && poetry run mypy karaoke_decide/song_search`.
- [ ] **Step 5: Commit** `feat(song_search): vendor kjbox normaliser, fuzzy match, brand ranking`.

### Task A2: Vendor the song-id builder, matcher, identify-kind and eval

**Files:**
- Create: `karaoke_decide/song_search/build_song_id.py`, vendored from `kjbox/kj-controller/scripts/build_song_id_db.py` (`build`, `_fold_title`, `SCHEMA_VERSION = 3`)
- Create: `karaoke_decide/song_search/identify.py`, vendored from `song_identify.py` (`SongIdentifier`, `song_norm`, `_same_song`, `_word_sim`, all module constants)
- Create: `karaoke_decide/song_search/identify_kind.py`, from `kjbox/kj-controller/sing.py` `_identify_kind` (lines ~758–785)
- Create: `karaoke_decide/song_search/eval.py`, from `scripts/song_id_eval.py`
- Create: `tests/fixtures/song_search/song_id_eval.jsonl`, `song_id_synthetic.jsonl` (copied)
- Create: `tests/fixtures/song_search/songs_fixture.tsv`: about 400 hand-picked rows in the 4-column export format (`artist\ttitle\tpopularity\tkaraoke`). They cover:
  - every eval-set answer used in the tests;
  - the §1 examples: Starlight/Muse, Machu Picchu/The Strokes plus Evaluna Montaner and Camilo, Buy Me Presents/Sabrina Carpenter, Baby by Justin Bieber, Brandy and Ashanti, Die Young/Kesha;
  - same-title rivals.
- Create: `tests/unit/song_search/test_identify.py`, `test_build_song_id.py`, `test_identify_kind.py`

**Interfaces:**
- Consumes: Task A1 normalisers.
- Produces:
  - `build_song_id.build(tsv_paths: list[Path], out_path: Path, run: str) -> dict` returns `{songs, words, built_at, run}`.
  - `SongIdentifier(db_path: str | Path, *, margin_bonus: float = 0.0)` with `.identify(query: str, limit: int = 5) -> dict`. The result is `{status: "confident"|"candidates"|"none", best: {artist, title, score, popularity, karaoke, detail} | None, candidates: list[...]}`. `margin_bonus` adds to the 0.06 margin and is used by the offline matcher.
  - `identify_kind(query: str, artist: str, title: str) -> Literal["same","cosmetic","completed","content"]`
  - `eval.run_eval(identifier: SongIdentifier, cases: list[dict]) -> dict` returns `{total, auto, wrong_auto, candidates, none, wrong: list[dict]}`.

- [ ] **Step 1: Write the tests.** `test_identify.py` builds the fixture index once into `tmp_path` (module-scoped fixture `fixture_identifier`) and asserts:
  - `identify("starlite muse")["status"] == "confident"` and best is `("Muse", "Starlight")`.
  - `identify("Starlight Muse")` is confident, best is Muse/Starlight (A11, the INBOX case).
  - `identify("machu picchu strokes")["best"]["artist"] == "The Strokes"`.
  - `identify("baby")["status"] == "candidates"` (A21).
  - `identify("die young")["best"]["artist"] == "Kesha"`.
  - Review Focus 1: for each of `["", " ", "karaoke", "x", "🎤🎤", "a"*250, "שיר", "歌"]`, `identify(q)["status"] == "none"` and nothing raises.
  - `margin_bonus`: a fixture query that is confident by a 0.06–0.09 margin becomes `"candidates"` with `margin_bonus=0.03`. Pick a pair from the fixture so this holds; assert both statuses.

  `test_identify_kind.py` ports kjbox's cases. `test_build_song_id.py` asserts `meta.schema_version == 3`, `meta.normalizer_version == 3`, the song count after merge, and that the `_fold_title` merge keeps the karaoke spelling (A36).
- [ ] **Step 2: Run** `poetry run pytest tests/unit/song_search -q`. Expected: FAIL (modules missing).
- [ ] **Step 3: Vendor the modules.**
  - Add the `margin_bonus` kwarg, applied only where the margin threshold is compared.
  - Make `identify` return `none` for queries that are empty after cleanup or longer than 200 characters (truncate to 200 first).
  - Replace kjbox's `default_db_path(config)` with an explicit path.
- [ ] **Step 4: Run the tests.** Expected: PASS. Also run `python -m karaoke_decide.song_search.eval --db <tmp fixture db> --cases tests/fixtures/song_search/song_id_eval.jsonl` locally, only to smoke-test the CLI (fixture coverage is partial; don't compare numbers here).
- [ ] **Step 5: Commit** `feat(song_search): vendor song-id builder, matcher, identify kind, eval`.

### Task A3: Availability index (KN full + community), search and grouping

**Files:**
- Create: `karaoke_decide/song_search/availability.py`
- Create: `tests/fixtures/song_search/kn_full_fixture.json` (bare list `{Artist, Title, Brands}`), `kn_community_fixture.json` (`{"Items":[{Artist, Title, Brand, Watch}]}`). Both cover the A2 fixture songs, including Starlight with ≥2 community and ≥2 commercial brands, and one song with 55 versions.
- Create: `tests/unit/song_search/test_availability.py`

**Interfaces:**
- Consumes: A1 (`normalize`, `index_text`, `fts_match_query`, `result_group_key`, `song_key`, `fuzzy_match.score`, `rank_version`, `brand_name`) and A2's `song_id.db` (for `pop` per `song_key`).
- Produces:
  - `build_availability_db(full_json_gz: Path, community_json_gz: Path, song_id_db: Path | None, out_path: Path, run: str) -> dict`.
  - Schema:
    - `songs(song_key PK, artist, title, pop, version_count)`
    - `versions(song_key, brand_code, brand_name, kind TEXT CHECK(kind IN ('community','commercial')), youtube_url NULL, rank INT)`
    - `songs_fts` (FTS5 over `index_text`, unicode61 remove_diacritics 2)
    - `songs_trigram` (FTS5 trigram)
    - `libraries(code PK, name, kind, source)` and `song_libraries(song_key, library_code)`
    - `meta`
  - `class AvailabilityIndex(db_path)` with:
    - `.search(query: str, limit: int = 60) -> list[dict]`
    - `.song(key: str) -> dict | None`
    - `.popular(limit: int = 30) -> list[dict]`
  - Group dict: `{song_key, artist, title, pop, version_count, versions: [{brand_code, brand_name, kind, youtube_url, rank}]}`.

- [ ] **Step 1: Write the tests.**
  - `test_merge_dedupes_community_codes_in_full_brands` (A72): a brand that appears both as a community row and in a full-row `Brands` list yields one community version with its URL.
  - `test_disc_only_commercial_has_no_url`: a commercial version has `youtube_url is None` and `kind == "commercial"`.
  - `test_versions_sorted_by_rank`: community listed brands come before commercial ones (A81).
  - `test_search_token_and_any_order`: `search("muse starlight")[0]["title"] == "Starlight"` (A69).
  - `test_search_typo_needs_every_word` (A64/A65): `search("queen bohemian")` returns only "Bohemian Rhapsody" groups by Queen, not every Queen song.
  - `test_joined_word` (A61): `search("acdc")` finds an "AC-DC" fixture row.
  - `test_group_relevance_title_equals_query_first` (A79).
  - `test_limit_clamped`: `search("a", limit=-1)` returns ≤ 60 groups (A77).
  - `test_many_versions_cap`: `.song(key)` for the 55-version song returns all 55, sorted by rank. The API caps display (A5).
  - `test_libraries_seeded_from_brands`: `libraries` contains the registry brands with `source == "kn_brand"`, and `song_libraries` links Starlight to its brands.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Group relevance and the playable concept are ported from kjbox `routes._group_relevance` / `_group_search_results`, minus local-file and Divebar parts. Here, "playable" = has a `youtube_url`.
  - The FTS → trigram fuzzy fallback ladder follows `catalog_mirror._search_source` / `_fuzzy_search`: `ORDER BY rank`, a candidate cap of 250, and the precision gate via `fuzzy_match.score`.
  - The KN merge follows `karaoke_nerds._merge_full_catalog`.
  - Vendor the ported functions with the header.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(song_search): availability index with community/commercial versions`.

### Task A4: Offline index (karaoke songs + rivals) and dual eval

**Files:**
- Create: `karaoke_decide/song_search/offline.py`
- Modify: `karaoke_decide/song_search/eval.py` (add `dual_eval`)
- Create: `tests/unit/song_search/test_offline.py`

**Interfaces:**
- Consumes: A2 `song_id.db` and `SongIdentifier`; A3 `availability.db`.
- Produces:
  - `build_offline_db(song_id_db: Path, availability_db: Path, out_path: Path, run: str) -> dict` returns `{songs, rivals, versions, bytes}`.
  - Schema: the song-id schema (`songs`, `songs_fts`, `artists`, `artists_fts`, `vocab`, `meta`) holding karaoke songs (`karaoke=1`) plus rivals (`karaoke=0`); plus A3's `versions`, `libraries` and `song_libraries` tables; plus a `song_key` column on `songs`. `meta.offline_schema_version = 1`.
  - Readable by the unchanged `SongIdentifier`.
  - `select_rivals(song_id_db: Path, karaoke_title_norms: set[str], *, min_pop: int = 30, per_title_cap: int = 10) -> list[tuple]`. My call on the rule: non-karaoke songs whose `song_norm(title)` equals a karaoke song's title norm, with pop ≥ 30, the top 10 per title by pop. Plus the artists table rows those songs need.
  - `eval.dual_eval(cloud: SongIdentifier, offline: SongIdentifier, cases: list[dict]) -> dict` returns `{total, confident_disagree, offline_downgraded, disagreements: list[dict]}`. `offline` is constructed with `margin_bonus=OFFLINE_MARGIN_BONUS`.

- [ ] **Step 1: Write the tests.** Build the A2 and A3 fixtures, then the offline db.
  - `test_offline_has_only_karaoke_songs_and_rivals`
  - `test_rival_blocks_false_confidence`: for "baby" the offline identifier (bonus 0.03) returns `candidates`, as the cloud does, because the rivals are present. Without rivals (build with `select_rivals` stubbed to `[]`) the test documents that it would be confident. Assert both.
  - `test_rival_never_produces_versions`: `versions` has no rows for rival `song_key`s.
  - `test_dual_eval_counts`: over the fixture eval cases, `dual_eval(...)["confident_disagree"] == 0`.
  - `test_meta_versions`: `offline_schema_version == 1` and `normalizer_version == 3`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `select_rivals`, `build_offline_db` (reusing `build_song_id.build` on a filtered row stream) and `dual_eval`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Emit the parity fixtures for mobile.** Create `scripts/emit_search_parity_fixtures.py`. It writes `tests/fixtures/song_search/offline_fixture.db` (offline db from the fixtures) and `tests/fixtures/song_search/parity.json`: `[{q, identify, kind, groups}]` for every eval case plus the Review Focus 1 inputs, computed with `margin_bonus=0.03`. Add `test_parity_fixture_is_fresh`, which regenerates into tmp and diffs against the committed file.
- [ ] **Step 6: Commit** `feat(song_search): offline index with rivals, dual eval, mobile parity fixtures`.

### Task A5: Search service API

**Files:**
- Create: `backend/search/__init__.py`, `backend/search/app.py` (FastAPI `search_app`, routes under `/api/search`), `backend/search/models.py`, `backend/search/service.py`, `backend/search/ratelimit.py`, `backend/search/events.py`, `backend/search/index_loader.py`
- Create: `backend/tests/search/test_search_api.py`, `test_ratelimit.py`, `test_index_loader.py`
- Modify: `Dockerfile` (no CMD change; the service overrides the command to `uvicorn backend.search.app:search_app --host 0.0.0.0 --port 8000`)

**Interfaces:**
- Consumes: A2 `SongIdentifier` and `identify_kind`; A3 `AvailabilityIndex`.
- Produces these HTTP endpoints. The response models are named exactly as below because the mobile client is generated from them.
  - `GET /api/search?q=&limit=20` → `SearchResponse{identification: Identification, groups: list[SongGroup], index: IndexInfo, sid: str}`
    - `Identification{status, kind: str | None, best: SongRef | None, candidates: list[SongRef]}`
    - `SongRef{artist, title, song_key, popularity, karaoke: bool}`
    - `SongGroup{song_key, artist, title, version_count, versions: list[Version]}` (versions capped at 12 in this response)
    - `Version{brand_code, brand_name, kind, youtube_url: str | None, rank}`
    - `IndexInfo{run, built_at}`
  - `GET /api/search/popular?limit=30` → `list[SongGroup]`
  - `GET /api/search/song?key=` → `SongDetail{song: SongRef, versions: list[Version]}` (all versions); 404 if unknown.
  - `GET /api/search/resolve?q=` → `ResolveResponse` (Task A6)
  - `POST /api/search/event` with `SearchEvent{sid, type, data: dict}` → 204
  - `GET /api/search/offline-index` → `OfflineIndexManifest{run, schema: int, normalizer: int, url, bytes, sha256}`
  - `GET /api/search/health` → `{ok: true}` (must not touch the index)
- `SearchService.search(q, limit)`:
  - identify and availability for `q` run in a thread pool together;
  - when confident, it also runs availability for `f"{best.artist} {best.title}"` and merges by `song_key`, with the identified song's group first;
  - `kind = identify_kind(q, best.artist, best.title)`.
- `index_loader.load(run: str, bucket: str, dest_dir: Path) -> IndexPaths`: downloads `song_id.db` and `availability.db` for `SONG_INDEX_RUN` at startup, verifies sha256 from `latest.json` / `<run>/manifest.json`, and opens them read-only. `SONG_INDEX_LOCAL_DIR` skips the download (local stack).

- [ ] **Step 1: Write API tests** with TestClient, the fixture dbs and `SONG_INDEX_LOCAL_DIR`:
  - `/api/search?q=starlite muse` → confident, `kind == "content"`, first group is Starlight with versions of both kinds.
  - `q=machu picchu strokes` → confident, `best.karaoke is False`, and no group has `song_key` equal to the best's.
  - `q=baby` → candidates, with up to 5.
  - Review Focus 1 inputs → 200 and `status == "none"`.
  - `limit=-5` clamps.
  - `/health` doesn't touch the index (with a broken index dir, health is still 200).
  - `/song?key=unknown` → 404.
  - Event POST → 204, and one structured log record is emitted (caplog) with `type`, `sid` and `device` fields.
- [ ] **Step 2: Write rate-limit tests:** 120 requests per device per 5 min and 1500 per IP. Device from header `X-Device-Id`, IP from `CF-Connecting-IP` else the client host. The 121st request → 429.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement.** Logging uses `logging.getLogger("search_events")` with JSON `extra`; Cloud Run ships it to Cloud Logging. `/api/search` and `/api/search/resolve` also log one `search` / `resolve` line each, with `sid`, `q`, `status`, `kind`, `group_count` and `ms`. Logging failures are swallowed (A102).
- [ ] **Step 5: Run the tests.** Expected: PASS. Then run the backend coverage command from decide `CLAUDE.md` (`make test-backend`).
- [ ] **Step 6: Commit** `feat(search): search service API`.

### Task A6: Gemini fallback proxy (decide side)

**Files:**
- Create: `backend/search/resolve.py`
- Create: `backend/tests/search/test_resolve.py`
- Modify: `backend/search/app.py` (wire `GET /api/search/resolve`)

**Interfaces:**
- Consumes: gen `POST {GEN_API_URL}/api/kjbox/catalog/resolve` with header `X-Partner-Secret: <DECIDE_GEN_PARTNER_SECRET>` (Task B1) and body `{query}`. It returns `{kind, confident, typed_artist, typed_title, canonical_artist, canonical_title, alternatives, engine, reason}`.
- Produces: `ResolveResponse` with optional fields `corrected: SongRef | None`, `kind`, `typed: str | None`, `groups: list[SongGroup]`, `split: {artist, title} | None`, `alternatives: list[SongRef]`. This is the kjbox `search_resolve` mapping (A54): a confident cosmetic/content verdict → `corrected` + `groups` from availability for the canonical artist/title; ambiguous → `alternatives`; none → `split`; otherwise empty.

- [ ] **Step 1: Write the tests,** with gen mocked by `respx` or `httpx.MockTransport`:
  - a confident content verdict maps to `corrected` and `groups`;
  - ambiguous maps to `alternatives`;
  - gen 5xx, timeout or 429 → 200 `{}`;
  - `reason == "unavailable"` is not cached; others are cached by `" ".join(q.split()).casefold()` (500 entries, LRU);
  - per-device 20 / 5 min and per-IP 200 / 5 min → the 21st request returns 429.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** with an async httpx client and a 12 s timeout.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(search): resolve fallback via gen`.

### Task A7: Index build job

**Files:**
- Create: `karaoke_decide/etl/song_index_build.py` (`python -m karaoke_decide.etl.song_index_build run`)
- Create: `tests/unit/etl/test_song_index_build.py`

**Interfaces:**
- Consumes: `gs://nomadkaraoke-kn-data/song-id/latest.json` (`{run, shards[]}`), `full/full-data-latest.json.gz`, `community/community-data-latest.json.gz`; A2/A3/A4 builders; A2 `run_eval` and A4 `dual_eval`.
- Produces, under `gs://nomadkaraoke-kn-data/song-index/<run>-<token>/`, where `<token>` is 16 random hex characters (the unguessable path, §7.1):
  - `song_id.db`
  - `availability.db`
  - `offline.db.gz`
  - `manifest.json`: `{run, token, schema, normalizer, offline_schema, files: {name: {bytes, sha256}}, eval: {...}, dual_eval: {...}}`
  - plus `song-index/latest.json` → `{run, token}`

  The previous 3 runs are kept and older ones deleted. After publishing, it calls the Cloud Run Admin API to update service `karaoke-decide-search` env `SONG_INDEX_RUN=<run>-<token>`, which creates a new revision.
- `build_and_publish(*, storage, run_admin, workdir: Path, force: bool = False) -> dict`. Returns early with `{skipped: true}` when `latest.json`'s source run plus schema/normalizer versions are unchanged and `force` is false.

- [ ] **Step 1: Write the tests,** with fake storage and admin objects and the fixture inputs:
  - the unchanged source → skipped, with no deploy call;
  - a new run → the files are uploaded, the manifest sha256s match the bytes, and `latest.json` is written **after** the files;
  - the deploy is called once with the new env value;
  - eval gate: when `wrong_auto` rises by more than 1 over the previous manifest's eval, or the `auto` rate drops by more than 2 points, nothing is published and the job logs ERROR and returns `{published: false}`;
  - dual-eval gate: `confident_disagree / total > DUAL_EVAL_MAX_DISAGREE` (start at 0.01; Task A10 calibrates it) → not published.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `google-cloud-storage` and `google-cloud-run` (`ServicesClient.update_service`). Build in `workdir` on local disk; the job's memory is 8 GiB.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(etl): song-index-build job with eval gates`.

### Task A8: decide local stack for search

**Files:**
- Create: `scripts/search-local-stack.sh` (`up|down|status`). It builds the fixture indexes into `.local-stack/song-index/` via a small Python entry `python -m karaoke_decide.song_search.fixtures build <dir>`, then runs `uvicorn backend.search.app:search_app --port 8020` with `SONG_INDEX_LOCAL_DIR`, `GEN_API_URL=${GEN_API_URL:-http://127.0.0.1:8010}` and `DECIDE_GEN_PARTNER_SECRET=local-stack-secret`.
  - The offline manifest URL points at `http://127.0.0.1:8020/api/search/_local/offline.db.gz`, a route only mounted when `SONG_INDEX_LOCAL_DIR` is set.
- Create: `karaoke_decide/song_search/fixtures.py`
- Modify: `docs/TESTING.md` (§ "Search local stack"), `Makefile` (`search-stack-up`)
- Test: `backend/tests/search/test_local_routes.py` (`_local` route absent unless the env is set)

- [ ] **Step 1: Write `test_local_routes.py`** (route mounted iff `SONG_INDEX_LOCAL_DIR`). Run it: FAIL.
- [ ] **Step 2: Implement** the script, fixtures entry and route. Run the test: PASS.
- [ ] **Step 3: Smoke test.** `scripts/search-local-stack.sh up && curl -s 'http://127.0.0.1:8020/api/search?q=starlite%20muse' | jq .identification.status` → `"confident"`. Then `down`.
- [ ] **Step 4: Commit** `feat(search): local stack with fixture index`.

### Task A9: Infra and CI (Pulumi + deploy), with Andrew steps

**Files:**
- Modify: `infrastructure/__main__.py`
  - A Cloud Run v2 service `karaoke-decide-search`:
    - `min_instance_count 0`, `max 3`, `cpu 1`, `memory 4Gi`, `cpu_idle True`, `startup_cpu_boost True`, concurrency 80;
    - command `uvicorn backend.search.app:search_app …`;
    - startup probe HTTP `/api/search/health`, timeout 240 s;
    - env `SONG_INDEX_RUN` (ignore_changes; the job owns it), `SONG_INDEX_BUCKET=nomadkaraoke-kn-data`, `GEN_API_URL=https://api.nomadkaraoke.com`;
    - secret env `DECIDE_GEN_PARTNER_SECRET` from Secret Manager `decide-gen-partner-secret`;
    - unauthenticated invoker.
  - SA `song-search` with bucket read and secret accessor.
  - Job `song-index-build`: 2 vCPU / 8 GiB, timeout 3600 s, max_retries 0, SA `song-index-build` with bucket objectAdmin on `nomadkaraoke-kn-data` and `run.developer` on the search service.
  - Scheduler `song-index-build-daily` at 13:30 UTC (after kn-data-sync), the same pattern as `mb-refresh`.
  - Uptime check `search-health-uptime` on `/api/search/health`, period 60 s, gen's `modules/monitoring.py` pattern.
  - The Cloudflare Worker routes `/api/search*` to the search service URL.
- Modify: `infrastructure/cloudflare-worker/api-proxy.js`
  - `/api/search*` → `SEARCH_BACKEND_URL`.
  - Add a cached passthrough `/offline-index/<run-token>/offline.db.gz` → `https://storage.googleapis.com/nomadkaraoke-kn-data/song-index/<run-token>/offline.db.gz` with `cf: {cacheEverything: true, cacheTtl: 604800}`.
  - The worker only fetches that exact pattern (no listing), and the job sets object ACL public-read on that one object only.
  - The manifest URL uses `https://decide.nomadkaraoke.com/offline-index/<run-token>/offline.db.gz`.
- Modify: `.github/workflows/ci.yml`. In deploy-backend, add `gcloud run deploy karaoke-decide-search` with flags matching Pulumi exactly (`--memory 4Gi --cpu 1 --min-instances 0 --max-instances 3 --concurrency 80 --cpu-throttling --command … --update-secrets DECIDE_GEN_PARTNER_SECRET=decide-gen-partner-secret:latest`), and `gcloud run jobs update song-index-build --image …:${sha}`. Do not pass `SONG_INDEX_RUN`; deploys keep the job-set value.
- Create: `tests/unit/test_infra_ci_parity.py`. It parses both files and asserts that memory, cpu, min/max instances and concurrency for `karaoke-decide-search` match (anti-drift, A123).
- Modify: `docs/ARCHITECTURE.md`, `docs/API.md` (search service + endpoints), `docs/README.md` status.

- [ ] **Step 1: Write `test_infra_ci_parity.py`.** Run it: FAIL.
- [ ] **Step 2: Implement the Pulumi, Worker and CI changes.** Run the test: PASS. Then `cd infrastructure && pulumi preview` (read-only; if preview needs write auth, skip and note it).
- [ ] **Step 3: Andrew step (stop and ask).** Hand Andrew:
  ```
  gcloud auth login admin@nomadkaraoke.com
  openssl rand -hex 32 | gcloud secrets create decide-gen-partner-secret --project=nomadkaraoke --data-file=-
  cd karaoke-decide-search-parity/infrastructure && GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) pulumi up
  ```
  Also the gen side's secret binding from Task B1. Wait for confirmation.
- [ ] **Step 4: Commit** `feat(infra): search service, index build job, uptime ping, worker routes`.

### Task A10: Full-index build and eval in GCP (verification gate)

- [ ] **Step 1: Run the job once with the full data.** After Task A9 is applied and the image is deployed from the PR branch (or `main` after merge): `gcloud run jobs execute song-index-build --wait --args=run,--force` (Andrew runs it if Claude's credentials can't execute).
- [ ] **Step 2: Read the manifest's `eval`.** It must reproduce kjbox: labelled set ~98/123 auto, **0 wrong**. Read `dual_eval`: record `confident_disagree` and `offline_downgraded`, and set `DUAL_EVAL_MAX_DISAGREE` to the measured value plus a small margin, ≤ 0.01. Record `offline.db.gz` bytes.
- [ ] **Step 3: Measure the service.** Check cold-start time (Cloud Run logs, revision start → ready), warm p50/p95 for the §1 queries (10 runs each via `curl -w %{time_total}` against decide.nomadkaraoke.com), and memory peak (Cloud Run metrics). Write all of this into the decide PR description and `docs/archive/2026-10-18-search-service-cost-check.md`.
- [ ] **Step 4: Gate.** Do not start Part C's prod check until eval wrong-auto is 0 and warm p95 is < 500 ms.

## Part B — karaoke-gen (new worktree)

### Task B1: Second partner secret for catalog/resolve + local-stack fakes

**Files:**
- Modify: `backend/api/routes/kjbox.py`. Add `require_resolve_partner(x_kjbox_secret: Optional[str] = Header(None), x_partner_secret: Optional[str] = Header(None)) -> str`, which accepts `settings.kjbox_partner_secret` or `settings.decide_partner_secret`; use it on `catalog_resolve` only. Per-partner budgets: kjbox keeps 120/min; decide gets its own 60/min bucket (my call, so kjbox nights are never starved).
- Modify: `backend/config.py` (`decide_partner_secret` from env `DECIDE_GEN_PARTNER_SECRET`)
- Modify: `backend/services/fake_workers/config.py`. Add `FakeConfig.judge_kind: str = "none"`, one of `none|cosmetic|content|ambiguous`, plus `judge_canonical_artist: str = ""` and `judge_canonical_title: str = ""`.
- Modify: `backend/services/match_judge/__init__.py` (or wherever `judge_match` and `resolve_and_tidy` are entered). When `fake_workers.enabled()`, return the fake verdict from `get_fake_config(email=user_email)`, with no Gemini.
- Modify: infra (Pulumi in gen) or deploy flags to mount secret `decide-gen-partner-secret` as `DECIDE_GEN_PARTNER_SECRET`, in both places. Andrew applies it.
- Test: `backend/tests/test_kjbox_resolve_partner.py`, `backend/tests/test_fake_match_judge.py`

- [ ] **Step 1: Write the tests.**
  - kjbox secret → 200; decide secret → 200; wrong → 403; neither configured → 503.
  - The decide bucket exhausts independently: the 61st decide call/min → 429 while kjbox calls still succeed.
  - With `FAKE_WORKERS=1` and `judge_kind="content"`, `POST /api/catalog/match-judge` returns `kind=="content"` with the canonical values. `judge_kind="none"` → `kind=="none"`. FAKE off → the real path (mocked) is called.
- [ ] **Step 2: Run them** (gen's test command per its `CLAUDE.md`). Expected: FAIL.
- [ ] **Step 3: Implement.** Bump gen's version per gen convention. Update gen `docs/API.md` and `docs/TESTING.md` § Local stack (fake judge knobs).
- [ ] **Step 4: Run them.** Expected: PASS. Then gen `/coderabbit` → `/pr` → merge → deploy (gen's `/shipit` flow). Do this before Part C's Maestro work needs the fakes.
- [ ] **Step 5: Commit** `feat(kjbox): decide partner secret for catalog resolve; fake judge for local stack`.

## Part C — nomad-mobile (`nomad-mobile-search-parity`)

### Task C1: TS normaliser + matcher port with parity tests

**Files:**
- Create: `packages/core/src/search/normalize.ts` (port of A1 `normalize`, `identity_normalize`, `fts_match_query`, `song_key`, plus `song_norm`; start from kjbox `static/text_normalize.js`)
- Create: `packages/core/src/search/identify.ts` (port of A2 `SongIdentifier.identify` over a `SqlReader`)
- Create: `packages/core/src/search/kind.ts` (`identifyKind`), `packages/core/src/search/sameSong.ts` (kjbox `sameSong`/`_songKey`/`_credits`)
- Create: `packages/core/src/search/types.ts`
- Create: `packages/core/src/search/__fixtures__/offline_fixture.db`, `parity.json`, copied by `scripts/sync-search-fixtures.mjs` from `${DECIDE_DIR:-../karaoke-decide-search-parity}/tests/fixtures/song_search/`
- Create: `packages/core/src/search/__tests__/parity.test.ts`, `normalize.test.ts`, `sameSong.test.ts`
- Modify: `packages/core/src/index.ts` (exports), `packages/core/package.json` (devDependency `better-sqlite3` for tests only)

**Interfaces:**
- Produces:
  - `type SqlReader = { all<T>(sql: string, params?: unknown[]): T[] }` (sync; expo-sqlite `getAllSync` and better-sqlite3 both fit)
  - `type IdentifyResult = { status: 'confident'|'candidates'|'none'; best: SongRef | null; candidates: SongRef[] }`
  - `type SongRef = { artist: string; title: string; songKey: string; popularity: number; karaoke: boolean }`
  - `identify(db: SqlReader, query: string, opts?: { limit?: number; marginBonus?: number }) -> IdentifyResult`
  - `identifyKind(query: string, artist: string, title: string) -> 'same'|'cosmetic'|'completed'|'content'`
  - `normalize`, `identityNormalize`, `songKey(artist, title)`, `sameSong(a: {artist,title}, b: {artist,title}) -> boolean`
  - `OFFLINE_MARGIN_BONUS = 0.03`

- [ ] **Step 1: Write the tests.**
  - `parity.test.ts` opens `offline_fixture.db` with better-sqlite3 and, for every `parity.json` entry, expects `identify(db, q, {marginBonus: OFFLINE_MARGIN_BONUS})` to deep-equal the Python `identify` (status, best artist/title/songKey, candidate order; scores compared to 1e-6) and `identifyKind` to equal `kind`.
  - Review Focus 1 inputs are in `parity.json` and must not throw.
  - `normalize.test.ts` mirrors A1's three named tests.
- [ ] **Step 2: Run** `pnpm --filter @nomad/core test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Put the rapidfuzz-equivalent functions (WRatio, token_set_ratio, Levenshtein) in `packages/core/src/search/fuzz.ts`. Port the exact rapidfuzz algorithms, not an approximation; the parity test catches drift.
- [ ] **Step 4: Run.** Expected: PASS, and coverage ≥ 70% (`pnpm test:coverage`).
- [ ] **Step 5: Commit** `feat(core): TS song matcher with Python parity fixtures`.

### Task C2: decide client regeneration and facades

**Files:**
- Modify: `scripts/fetch-openapi.mjs` (add a `decide-search` source: the `karaoke-decide-search` run.app `/openapi.json`, overridable by `DECIDE_SEARCH_OPENAPI_URL` for the local stack)
- Modify: `openapi/decide.json` (or a new `openapi/decide-search.json` merged into `packages/api-decide`; the builder picks one, keeping one package)
- Modify: `packages/api-decide/src/index.ts`
- Test: `packages/api-decide/src/__tests__/search.test.ts`

**Interfaces:**
- Consumes: the Task A5 endpoints and models.
- Produces:
  - `searchSongs(q: string, opts?: {limit?: number, signal?: AbortSignal}) -> Promise<SearchResponse>` (replaces the old `searchSongs`)
  - `popularSongs(limit?: number) -> Promise<SongGroup[]>`
  - `getSongDetail(key: string) -> Promise<SongDetail>`
  - `resolveQuery(q: string) -> Promise<ResolveResponse>`
  - `getOfflineIndexManifest() -> Promise<OfflineIndexManifest>`
  - `logSearchEvent(e: {sid: string; type: string; data?: Record<string, unknown>}) -> Promise<void>` (never throws)
  - `pingSearch() -> Promise<boolean>`
  - `configureClient` gains `getDeviceId: () => string`, sent as the `X-Device-Id` header.

- [ ] **Step 1: Write facade tests** with a mocked fetch: paths, the `X-Device-Id` header, `logSearchEvent` swallowing errors, and `pingSearch` returning false on network error.
- [ ] **Step 2: Run them.** FAIL. **Step 3:** run `pnpm gen:api` against the deployed service (or the local stack via env), then implement the facades. **Step 4:** run again: PASS, plus `pnpm gen:api:offline` produces no diff.
- [ ] **Step 5: Commit** `feat(api-decide): search service client`.

### Task C3: Offline index manager (opt-in download, verify, swap, reader)

**Files:**
- Add deps: `cd apps/mobile && npx expo install expo-sqlite @react-native-community/netinfo`. `expo-file-system` is already present.
- Create: `apps/mobile/src/offline/offlineIndexStore.ts` (Zustand, persisted in MMKV: `{status: 'none'|'downloading'|'ready'|'error', run, bytes, downloadedAt, progress}`)
- Create: `apps/mobile/src/offline/offlineIndex.ts`:
  - `downloadOfflineIndex()`, `removeOfflineIndex()`, `maybeRefreshOfflineIndex()` (weekly, unmetered only, or schema/normalizer change);
  - `openOfflineReader(): SqlReader | null`.
- Create: `apps/mobile/src/offline/__tests__/offlineIndex.test.ts`
- Create: `apps/mobile/src/device/deviceId.ts` (random UUID in MMKV)

**Interfaces:**
- Consumes: C2 `getOfflineIndexManifest`; C1 `SqlReader`.
- Produces: `useOfflineIndex()` hook → `{status, downloadedAt, bytes, progress, download(), remove()}`; `openOfflineReader()` as above; `getDeviceId(): string`.

- [ ] **Step 1: FTS5 check on a device.** Add a temporary dev screen or a jest-expo device test that runs `CREATE VIRTUAL TABLE t USING fts5(x)` via expo-sqlite on the iOS simulator and the Android emulator. If FTS5 is missing on either, STOP and tell Andrew (spec §7.1 fallback). Remove the probe afterwards.
- [ ] **Step 2: Write the tests,** with expo-file-system and expo-sqlite mocked:
  - Download writes to `offline/<run>.db.gz.part`, gunzips to `offline/<run>.db.part`, and verifies the sha256 against the manifest.
  - A mismatch deletes the part files, keeps the old file and sets `status 'error'` (Review Focus 2).
  - Success renames atomically to `offline/current.db`, then deletes the previous one.
  - A truncated gzip → error, and the old file stays.
  - A manifest `schema` greater than the supported `OFFLINE_SCHEMA_VERSION` (1) → `status 'none'` with no download, and the reader returns null.
  - `openOfflineReader()` returns null when the file is missing or fails `PRAGMA integrity_check` (quick).
  - `maybeRefreshOfflineIndex` doesn't download on a metered connection, or when less than 7 days old with the same schema.
  - `remove()` deletes the file and resets the store.
- [ ] **Step 3: Run them.** FAIL. **Step 4:** implement (gunzip via `pako`, or a stream API if present; the builder picks). **Step 5:** run: PASS.
- [ ] **Step 6: Commit** `feat(mobile): opt-in offline song index`.

### Task C4: Search orchestration hook

**Files:**
- Create: `apps/mobile/src/find/useSearch.ts` (replaces `useSongSearch.ts`; delete the old file and update its imports)
- Create: `apps/mobile/src/find/searchSession.ts` (sid generation and renewal after a pick; `logEvent(type, data)`)
- Create: `apps/mobile/src/find/useSearchWarmup.ts` (`pingSearch` on app launch and foreground)
- Test: `apps/mobile/src/find/__tests__/useSearch.test.tsx`

**Interfaces:**
- Consumes: C1 `identify`, `identifyKind`, `OFFLINE_MARGIN_BONUS`; C2 facades; C3 `openOfflineReader`.
- Produces: `useSearch(query: string) -> SearchState`, where `SearchState = { source: 'cloud'|'offline'|'none'; loading: boolean; warmingUp: boolean; offline: boolean; identification: Identification | null; groups: SongGroup[]; resolve: ResolveResponse | null; error: 'unreachable' | null }`.

**Rules:**
- 300 ms debounce; a minimum of 2 characters (shorter queries show popular songs).
- Each query increments a generation counter, and only the latest generation may set state (Review Focus 3).
- Offline results (if a reader exists) render immediately; the cloud result replaces them on arrival.
- No cloud answer within 1.5 s while online → `warmingUp: true` until it arrives or 30 s pass. Then `error: 'unreachable'`, with offline results kept if present.
- Resolve fallback: when cloud `identification.status === 'none'` and `groups.length === 0`, call `resolveQuery` once for that generation (A47).
- Offline groups are built by reading `versions` for the identified `songKey`, plus a token search over `songs` with `karaoke=1`. The builder may add a small `searchAvailabilityOffline(db, q)` in `packages/core` with its own test.
- Naming: the generated decide types are snake_case (`song_key`) and `@nomad/core` types are camelCase (`songKey`). `useSearch` maps both into the generated (snake_case) shapes, so the UI handles one shape.
- `useSearchWarmup`: test that `pingSearch` is called on mount and on each AppState `active` transition, at most once per 60 s.

- [ ] **Step 1: Write the tests** with `renderHook` and fake timers:
  - Type "sta" then "starlite muse": the result for "sta" arriving late is ignored.
  - Offline-first then cloud replace.
  - The cloud never answers → `warmingUp` at 1.5 s, then `error 'unreachable'` at 30 s, with offline results still shown.
  - `none` with no groups → `resolveQuery` called exactly once.
  - Under 2 characters → the popular list.
- [ ] **Step 2: Run them.** FAIL. **Step 3:** implement. **Step 4:** run: PASS.
- [ ] **Step 5: Commit** `feat(mobile): search orchestration (offline + cloud + resolve)`.

### Task C5: Discover UI — four outcomes, offline banner, describe link

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/discover.tsx`
- Create, in `apps/mobile/src/find/components/`:
  - `SongCard.tsx` (the "song you mean" card, with tidied/corrected copy, Undo, Not it?)
  - `VersionList.tsx` (Community/Commercial pills, brand name, YouTube or "in a library or on disc"; shows the best 5 plus "Show all N")
  - `MissingCard.tsx` ("No karaoke version yet · Make it →")
  - `WhichOne.tsx` (≤4 chips plus "More…")
  - `MakeBar.tsx` (sticky "Not seeing your song? Make it")
  - `OfflineBanner.tsx` ("Offline · searching songs saved on this phone (updated N days ago)", with the download button when there's no list)
  - `SimilarList.tsx` ("Other songs with similar names", ≤3 plus "Show N more")
- Create: `apps/mobile/src/find/__tests__/discover.test.tsx`
- Modify: `packages/i18n/messages/en.json` (new `discover.*` keys)

**Interfaces:**
- Consumes: C4 `useSearch`; C1 `sameSong`.
- Produces: `testID`s used by Maestro:
  - `song-card`, `song-card-undo`, `song-card-not-it`;
  - `version-row-<i>`, `versions-show-all`;
  - `missing-card`, `missing-card-make`;
  - `which-one-chip-<i>`;
  - `make-bar`;
  - `offline-banner`, `offline-download`;
  - `similar-row-<i>`, `describe-link`.

**Rules** (spec §4.1):
- Missing card: identification is confident, no group is `sameSong` with it, and `best.karaoke === false`.
- Make bar: only when not confident.
- Taps are ignored for 300 ms after results re-render (A98).
- Undo shows the typed-query results and logs `keep_typed`.
- Not it? opens the candidates and logs `not_it`.
- Every outcome logs `make_offer_shown` / `make_offer_tap` with `where` (`missing_card`|`make_bar`|`song_page`).
- `describe-link` ("Can't remember the name? Describe it") opens a text field. Submitting it calls `resolveQuery(text)` directly, regardless of local results, and renders the corrected song card or the alternatives. It logs `describe_submit`.

- [ ] **Step 1: Write the tests,** one per outcome with mocked `useSearch` states (confident with versions, confident missing, candidates, offline):
  - assert the testIDs are present or absent per the rules above;
  - Review Focus 4: a disc-only version shows the library/disc label without a link; a 55-version group shows 5 rows plus `versions-show-all`;
  - the 300 ms tap guard;
  - Undo calls `logEvent('keep_typed')`.
- [ ] **Step 2: Run them.** FAIL. **Step 3:** implement, add the strings, run `pnpm i18n:translate`. **Step 4:** run the tests, `pnpm lint`, `pnpm typecheck`, `pnpm i18n:check`: all PASS.
- [ ] **Step 5: Commit** `feat(mobile): Discover search outcomes`.

### Task C6: Song page versions, canonical make intent, offline controls in Me

**Files:**
- Modify: `apps/mobile/src/app/song/[id].tsx` (the route param becomes a `song_key`, URI-encoded; `new` keeps the free-text form)
- Modify: `apps/mobile/src/make/intentStore.ts`
- Modify: `apps/mobile/src/app/(tabs)/me.tsx` (offline song list section: size, updated date, Download / Remove; testIDs `me-offline-download`, `me-offline-remove`)
- Test: `apps/mobile/src/app/song/__tests__/song.test.tsx`, `apps/mobile/src/make/__tests__/intentStore.test.ts`, `apps/mobile/src/app/(tabs)/__tests__/me-offline.test.tsx`

**Interfaces:**
- Consumes: C2 `getSongDetail`; C3 `useOfflineIndex` (song detail is read offline from `versions` when there's no connection); C5 `VersionList`.
- Produces: `MakeIntent = { artist: string; title: string; canonicalArtist?: string; canonicalTitle?: string; songKey?: string; source: 'identified'|'typed'; editedFields: ('artist'|'title')[]; createdAt: number }`. Free-text "Make any song" pre-fills from the current identification and adds a field to `editedFields` on the user's first edit. A later pre-fill never touches edited fields (A95).

- [ ] **Step 1: Write the tests.**
  - The song page renders VersionList from `getSongDetail`.
  - Make it stores `source:'identified'` with the canonical values.
  - Pre-fill, then edit title, then a new identification: the title is unchanged and the artist is updated (Review Focus 5, intent half).
  - Me offline: Download calls `download()` and Remove calls `remove()`, and the size and date render.
- [ ] **Step 2: Run them.** FAIL. **Step 3:** implement plus strings and translate. **Step 4:** run: PASS.
- [ ] **Step 5: Commit** `feat(mobile): song versions, canonical make intent, offline list controls`.

### Task C7: Make flow — two-phase judge, gate, Undo, community check

**Files:**
- Modify: `packages/api-gen/src/facades/make.ts`. Add:
  - `matchJudge(body: {artist, title, audio_confidence_tier?: 1|2|3, stage: 'fast'|'full'})`
  - `communityCheck({artist, title})`
  - `validateUrl(url)`

  These are typed from the generated client; check `docs/gen-untyped-endpoints.md` and add zod overrides if any is untyped.
- Create: `apps/mobile/src/make/useMatchJudge.ts`
- Modify: `apps/mobile/src/app/make/new.tsx`, `apps/mobile/src/make/useAudioSearch.ts`
- Test: `apps/mobile/src/make/__tests__/useMatchJudge.test.tsx`, `apps/mobile/src/app/make/__tests__/new-judge.test.tsx`

**Interfaces:**
- Consumes: C6 `MakeIntent`; `getSearchConfidence` from `@nomad/core` audioRank.
- Produces: `useMatchJudge(intent) -> { state: 'pending'|'settled'; applied: {artist, title} | null; verdict; kind; undo(): void; redo(): void; acceptAlternative(i: number): void; gateOpen: boolean }`.

**Rules** (A103/A104, from gen `AudioSourceStep.tsx` L180–330):
- `fast` fires on mount, in parallel with `searchAudio`. A confident cosmetic fast verdict applies immediately.
- `full` runs only if fast is null, `needs_ai`, or confident at tier ≥ 3.
- Applying a verdict: cosmetic → no re-search; content → re-search only if tier ≥ 3; ambiguous → "Did you mean"; accepting always re-searches.
- `gateOpen` stays false until settled or `JUDGE_GATE_TIMEOUT_MS`. Copy the value from gen's `AudioSourceStep.tsx`.
- Undo/redo swap metadata only and log `keep_typed` / `reapply_tidy`.
- `createJobFromSearch` and `createJobFromUrl` send the **applied** artist/title.
- `communityCheck` runs in parallel and is non-blocking. If `has_community`, show a line "A community karaoke version already exists" with a watch link (testID `community-exists`).

- [ ] **Step 1: Write the tests** (mocked facades):
  - fast cosmetic applies with no full call;
  - fast `needs_ai` → a full call;
  - content at tier 1 → no re-search; content at tier 3 → exactly one re-search;
  - ambiguous shows `did-you-mean-<i>`, and accepting re-searches;
  - the source buttons (`source-pick-*`) are disabled while pending and enabled at the timeout;
  - `create-from-search` receives the applied values;
  - Review Focus 5: the user edits the title field before the verdict arrives → the verdict doesn't overwrite it, and Undo restores the pre-verdict values exactly;
  - `community-exists` renders when `has_community`, and a community-check failure renders nothing.
- [ ] **Step 2: Run them.** FAIL. **Step 3:** implement plus strings and translate. **Step 4:** run: PASS.
- [ ] **Step 5: Commit** `feat(mobile): make-flow judge, gate and community check`.

### Task C8: Pick screen parity, YouTube fallback, error mapping

**Files:**
- Modify: `apps/mobile/src/make/SourcePicker.tsx`, `apps/mobile/src/make/sourceText.ts`, `apps/mobile/src/app/make/new.tsx`
- Modify: `packages/core/src/audioRank.ts` only if a helper for the "Title match / Wrong track?" decision is missing. Use the existing `checkFilenameMismatch`.
- Test: `apps/mobile/src/make/__tests__/SourcePicker.test.tsx`, `sourceText.test.ts`, `apps/mobile/src/app/make/__tests__/new-errors.test.tsx`

**Rules:**
- Rows show:
  - **Filename** = `target_file` (monospace; testID `source-filename-<i>`);
  - a "Title match" / "Wrong track?" badge, with matching rows sorted first;
  - `confidence.warnings`;
  - an availability badge High ≥ 50 / Medium ≥ 10 / Low seeders;
  - release details `[release_type/year/label/edition/media]`;
  - categories "+N more".
- **Spotify rows:** the display title is `target_file`, not `title` (A108).
- **YouTube box:** collapsed behind "Can't find your song?" (`youtube-toggle`) at tiers 1–2; expanded and placed first at tier 3 or with 0 results.
- **URL submit:** calls `validateUrl` first, and on `supported:false` shows `detail` inline (`youtube-invalid`). The YouTube-only regex goes; keep a basic `^https?://` check.
- **Error mapping on create:**
  - 400/403/422 whose detail matches `/youtube/i` and `/bot/i` → `youtube_blocked` (testID `error-youtube-blocked`);
  - 404 "Search expired" and 403 on create-from-search → search again with the expired note;
  - 402 → credits (unchanged);
  - anything else → `createFailed`.

- [ ] **Step 1: Write the tests:**
  - a Spotify result row shows the track (`target_file`), not the album;
  - the badge and sort order;
  - the availability thresholds 50/10;
  - YouTube collapsed at tier 1 and expanded at tier 3;
  - validate-url false → inline error with no create call;
  - a 422 "Sign in to confirm you're not a bot" detail → `error-youtube-blocked`;
  - 403 on create-from-search → one re-search.
- [ ] **Step 2: Run them.** FAIL. **Step 3:** implement plus strings and translate. **Step 4:** run: PASS.
- [ ] **Step 5: Commit** `feat(mobile): pick screen parity, YouTube fallback, error mapping`.

### Task C9: Maestro on iOS and Android + screenshot review

**Files:**
- Modify: `scripts/e2e-local.sh`. Also start decide's `scripts/search-local-stack.sh up` from `DECIDE_DIR` (default `../karaoke-decide-search-parity` until merged, then `../karaoke-decide`), with `adb reverse tcp:8020` on Android. Metro env adds `EXPO_PUBLIC_DECIDE_API_URL=http://127.0.0.1:8020`.
- Modify: `maestro/scripts/stack.js` (an `ACTION: judge` setting `judge_kind` and the canonical values per user)
- Create, in `maestro/flows/`:
  - `search-1-confident-versions.yaml`: "starlite muse" → `song-card`, ≥1 Community and ≥1 Commercial row.
  - `search-2-missing-make.yaml`: "machu picchu strokes" → `missing-card-make` → sign in → make. Assert via the stack's job record that the job artist/title is "The Strokes"/"Machu Picchu".
  - `search-3-which-one.yaml`: "baby" → `which-one-chip-0` → song card.
  - `search-4-offline.yaml`: download the fixture offline list from Me, then point the app at an unreachable search URL. Use a debug-only toggle `EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1` read in `config.ts` and honoured only for local hosts, like the fake-social flag. Then search "starlite muse" → `offline-banner` and `song-card`.
  - `make-10-judge-undo.yaml`: judge `content` → corrected line → Undo → the typed values are back → submit → the job has the typed values.
- Modify: existing flows that referenced the old Discover list (`smoke-discover`, `common/make-any.yaml`), so flows 1–9 still pass.

- [ ] **Step 1: Run on iOS:** `scripts/e2e-local.sh --platform ios`. All flows PASS. Screenshots go in `docs/screenshots/phase1b/ios/`.
- [ ] **Step 2: Run on Android** (never at the same time as iOS): `scripts/e2e-local.sh --platform android`. All PASS. Screenshots go in `docs/screenshots/phase1b/android/`.
- [ ] **Step 3: Screenshot UX review** of every changed screen on both platforms, plus `maestro/screens/long-title.yaml` in `ar`. Fix the issues found and re-run the affected flows.
- [ ] **Step 4: Commit** `test(mobile): Maestro search parity flows (iOS + Android)`.

### Task C10: Docs

**Files:**
- Modify: `docs/VISION.md` (spec §9: "Offline where possible" principle, the library-filter note, roadmap row "1b. Search parity", decide search as the single backend)
- Modify: `CLAUDE.md` (status, the decide search stack in § E2E, the new packages/folders, gotchas found)
- Modify: decide `docs/README.md` / `ARCHITECTURE.md` if not done in A9.

- [ ] **Step 1: Write the docs.** **Step 2:** commit `docs: VISION offline principle, search parity status`.

### Task D: Ship, prod check, billing follow-up

- [ ] **Step 1: Merge order.** Gen B1 → decide (A1–A9, CI deploy) → A10 gate → mobile (C1–C10). Each repo goes through `/test-review` → `/docs-review` → `/coderabbit` → `/pr`.
- [ ] **Step 2: Prod check.** Build a release APK pointed at prod. Search the §1 queries and check the outcomes match. Download the offline list on Wi-Fi, then search in airplane mode. Any real make must use a non-popular song from `candidates.csv`, after asking Andrew. Then hand the APK to Andrew.
- [ ] **Step 3: Backlog.** `/backlog-finish` for 4.1b when merged and verified. Write a memory and session record (`/wrap`).
- [ ] **Step 4: One week after launch.** Query billing for `karaoke-decide-search` plus `song-index-build`, and confirm ≤ $2/mo added. Append the result to `docs/archive/2026-10-18-search-service-cost-check.md`. If higher, tell Andrew with the numbers.
