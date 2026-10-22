# Mobile Phase 3d "Discover: voice session" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided ~30-minute at-home session in the app: the singer tries 5–10 adaptively chosen songs from a ~1,000-song analysed pool (community karaoke versions on YouTube), answers a short quiz after each (optionally recorded), and leaves with a confident voice type and songs that suit it. Tuned on Andrew first, then opened to everyone; users with rich history can ask for their own songs to be analysed overnight.

**Architecture:**
- **Pool pipeline (decide + flacfetch + gen).** A `voice-pool-select` job picks a stratified pool from `catalog.db` + `availability.db` (community versions) + BigQuery (Spotify ids). An hourly `voice-pool-fetch` job downloads original audio through flacfetch's Spotify provider under a **rolling 24 h listening budget enforced inside flacfetch**, batches the files into a GCS manifest and starts a new gen GPU job `voice-pool-separate-job` (gen's image, separate-only), then starts `voice-pool-analyse` (decide's 3c `vocal-analysis` image), which computes markers, writes BigQuery `song_voice_analysis` + 3c `song_vocal_range_sources` (`pool_measured`), and publishes a small **`voice.db`** that the main API hot-reloads.
- **Session (decide).** Pure Python voice model: a posterior over 30 hypotheses (6 voice types × register shift −2…+2), evidence from quiz answers and on-device pitch summaries, weighted by context; next song by expected information gain with warm-up ordering; stopping rule from spec §10a. Firestore `voice_sessions`, `voice_attempts`, `voice_recordings`; recordings in a private bucket.
- **App (nomad-mobile).** `/discover/voice-session` modal: setup → pick card → player (embedded YouTube iframe, or link-out + local notification, chosen by a device spike) → quiz → result. Recording reuses 3c's `PitchSource` stream for both live pitch and the stored file. A hidden admin debug screen shows markers next to Andrew's answers.
- **Tuning.** Andrew's sheet imported as labels; an agreement metric on held-out songs gates opening to everyone.

**Tech Stack:**
- decide: Python 3.11, FastAPI (+ `python-multipart`), Firestore, BigQuery (jobs only), GCS, SQLite, `librosa` (3c `vocal-analysis` group, jobs only), `google-cloud-run` 0.15.0, httpx, Pulumi.
- flacfetch: Python 3.10+, FastAPI, SQLite (stdlib).
- gen: the existing GPU image (`us-east4-docker.pkg.dev/nomadkaraoke/karaoke-backend-gpu/karaoke-backend`), `audio-separator` `Separator` with the `instrumental_clean` ensemble preset, Pulumi.
- mobile: Expo SDK 57, `expo-audio` 57 (`useAudioStream`, maybe `useAudioRecorder`), `react-native-webview` (+ `react-native-youtube-iframe` if the spike picks it), `expo-notifications` (local only), 3c `pitchy` pipeline, TanStack Query, Zustand + MMKV, use-intl, jest-expo, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-22-mobile-phase3d-voice-session-design.md` (read §10a and §10b first: they override earlier sections). Also read:
- 3c spec + plan (`specs/2026-10-21-mobile-phase3c-vocal-range-design.md`, `plans/2026-10-21-mobile-phase3c-vocal-range.md`): every 3c name below comes from that plan.
- 3a plan (`plans/2026-10-21-mobile-phase3a-discover-core.md`): catalog.db, `CatalogReader`, recs v2 (`UserContextV2`, `build_context`, `weights.py`), test API, Discover components.
- survey `specs/2026-10-21-mobile-phase3-discover-survey.md` §8, §12, §13.

**Prerequisites (do not start without them):** 3a merged (decide v0.18.x is on main; the mobile 3a PR merged) and **3c merged and deployed** (decide `karaoke_decide/vocal_range/*`, `/api/my/voice`, `Dockerfile.vocal-analysis`; mobile `packages/core/src/voice/*`, `apps/mobile/src/voice/*`, `PianoStrip`, fake mic). 3b is optional. If merged code differs from the names here, follow the code and note it in the ledger.

**3a/3c seams used (from their plans):**
- decide: `karaoke_decide/catalog/{keys.py (artist_key, song_key), reader.py (CatalogReader), schema.py}`; `backend/services/catalog_store.py` (`get_catalog_store`, `CatalogUnavailable`, 503 `warming_up`); `backend/services/recs_v2/{context.py (UserContextV2, build_context), weights.py, scoring.py, service.py}`; `backend/services/song_feedback_service.py` (`SongFeedbackService.love`, `feedback_doc_id`, `HIDDEN_COLLECTION`); `backend/api/routes/test_support.py`; `scripts/local-stack.sh`; `availability.db` table `versions(song_key, brand_code, brand_name, kind, youtube_url, rank)` attached as `av`.
- decide 3c: `karaoke_decide/vocal_range/{notes.py (VOICE_TYPES, midi_to_name), fit.py (fit_song, SongVocalRange, UserVoiceRange), pitch.py (analyze_vocals, PitchStats), ultrastar.py (parse_ultrastar), merge.py (SourceRow, merge_songs)}`; `backend/services/voice_profile_service.py` (`VoiceProfileService`), `backend/api/routes/voice.py` (`VoiceProfileIn`); `Dockerfile.vocal-analysis`, image `karaoke-decide-vocal:<sha>`.
- mobile 3c: `@nomad/core` `voice/*` (`PitchFrame`, `VoicedFrame`, `gateFrames`, `noiseFloor`, `findHeldNotes`, `HeldNote`, `VOICE_TYPES`, `VoiceType`, `midiToName`, `fitSong`); `apps/mobile/src/voice/{pitchSource.ts (PitchSource, PcmBuffer, VoiceSection), framer.ts (createFramer), usePitchSource.ts, voiceStore.ts (useVoiceStore, LocalVoiceProfile), useVoiceProfile.ts, VoiceProfileSection.tsx, FitBadge.tsx}`; `@nomad/ui` `PianoStrip`; `ImproveCard` (`discover-improve-voice`); `config.ts` `FAKE_MIC`, `isLocalUrl`; fake mic `baritone-scale.wav` with `FAKE_MIC_SECTIONS`.

**Repos and worktrees:**
- decide `/Users/andrew/Projects/nomadkaraoke/karaoke-decide-phase3-discover` (new branch per PR from `origin/main`).
- mobile `/Users/andrew/Projects/nomadkaraoke/nomad-mobile-phase3-discover`.
- gen: create a worktree (`/startnomad gen voice-pool-separate`); never edit the main clone.
- flacfetch: create a worktree (`/startnomad flacfetch spotify-budget`).

**PR boundaries (order):**
1. flacfetch PR (Task A1) → **Andrew deploys on flacup**.
2. gen PR (Task A5) → **Andrew runs `pulumi up` in gen `infrastructure/` before merge** (gen CI updates the new job's image).
3. decide PR "voice pool" (Tasks A2–A4, A6–A8) → **Andrew `pulumi up` in decide**, then the selection run.
4. decide PR "voice session" (Tasks B1, B2, C1–C6, E1).
5. mobile PR (Tasks B3, D1–D8) → release APK for Andrew's tuning sessions (Part E).
6. decide + mobile PRs "personal pool" (F1, F2) and "open to everyone" (G1).

## Global Constraints

- **Spotify budget (flacfetch, spec §10b):** rolling 24 h window. Batch budget `FLACFETCH_SPOTIFY_BATCH_BUDGET_S = 43200` (12 h). Hard cap for all Spotify audio `86400`; batch is refused when `total_24h + d > 86400 − 7200` (interactive reserve 2 h). At most **2 batch downloads in flight**; a batch start needs ≥ 30 s since the previous batch start; batch is refused while any interactive Spotify download is queued or running. Interactive (gen customer) downloads are never refused, only counted. The ledger survives restarts.
- **Spacing (fetch job):** sleep `uniform(45, 180)` s between batch submissions (`random.Random` seeded from the run id). Each fetched file is deleted from flacup after upload (`delete_local_after_upload`). Private trackers and YouTube downloads are never used for the pool.
- **Pool:** target 1,000 songs, minimum 600; ~1 week backfill (≈ 190 songs/day at 12 h). Song eligibility: ≥ 1 community version in `av.versions` with a YouTube id; catalog `popularity ≥ 60` (lowered in steps of 5 down to 45 until ≥ 3 × target candidates); Spotify duration 120–420 s; ≤ 2 songs per artist.
- **GCS layout (gen bucket `karaoke-gen-storage-nomadkaraoke`, prefix `voice-pool/`; gen's retention and lifecycle rules only touch `jobs/`, `uploads/`, `temp/`):** `voice-pool/audio/<pool_id>/original.flac`, `voice-pool/stems/<pool_id>/vocals.flac`, `voice-pool/manifests/<run>.jsonl`, `voice-pool/manifests/<run>.results/part-<task>.jsonl`. `pool_id = sha1(song_key)[:16]`. Note: the 3c plan calls this bucket `karaoke-gen-storage`; the real name is `karaoke-gen-storage-nomadkaraoke`.
- **decide data bucket:** `gs://nomadkaraoke-musicbrainz-data/voice/<run>/voice.db.gz` and `voice/latest.json` (`{run, sha256, songs, analysed, built_at}`), written last; keep 3 runs.
- **Recordings:** bucket `nomadkaraoke-voice-recordings` (private, uniform access, public-access prevention enforced, versioning off, no lifecycle). Object `voice-recordings/<user_id>/<session_id>/<n>.<ext>`. Content types `audio/mp4` (AAC-LC mono 48 kbps 44.1 kHz) or `audio/wav` (PCM16 mono 16 kHz, fallback). Max 20 MB. Kept until the user deletes them or their account (no expiry). Uploaded only with session consent `record = true`. The on-device pitch summary is sent with the attempt even when audio isn't.
- **Thresholds (spec §10a):** done when the top type posterior ≥ **0.75**, or an adjacent pair ≥ **0.85** ("between X and Y"), and both comfortable bounds moved ≤ **2** semitones over the last 2 attempts, and ≥ 3 attempts carry range evidence. Also done on Finish, on "Getting tired" twice, at 12 attempts, or with no candidates. Sign-off: ≥ **80%** agreement with Andrew's good/no on ≥ **30** held-out songs, plus his OK.
- **Personal pool:** eligible = bought credits at least once (gen `gen_users/{email}`: `total_spent > 0` or any `credit_transactions[].reason == "purchase"`) **or** Σ `user_songs.playcount` ≥ 1,000 **or** ≥ 200 `user_songs` with `playcount ≥ 1`. Cap 20 songs / 30 days per user; admins exempt. Global budget guard default **$20/month** of estimated cost; `EST_COST_PER_SONG_USD = 0.012` (recalibrate from billing after the shared run). Personal songs queue behind the shared pool. Analysed personal songs join the shared pool with `source = 'personal'` and no user id on the shared row.
- **Feedback granularity:** overall range only ("Your highest held note was G4"). No song-position feedback.
- **YouTube:** official iframe player only (WebView); never download YouTube streams. Non-embeddable versions are skipped unless no alternative exists. Link-out fallback opens YouTube and schedules a local notification "Done singing? Tap to rate it and get your next song".
- **Privacy:** sign-in required; recordings never public; `DELETE /api/voice/recordings` removes every object and row; account deletion (Phase 6 `DELETE /api/users/me`) must call `VoiceRecordingService.delete_all_for_user`. Request models touching user audio use `extra="forbid"`.
- **Infra:** Claude's GCP credentials are read-only. Pulumi changes are written for Andrew (`/gcp-admin`). Jobs degrade gracefully until applied (WARNING, never ERROR). ERROR only for real failures, one per run (workspace #alerts rule). Zero AI spend in GCP; this phase uses no LLM.
- **Data movement:** nothing bulk through Andrew's Mac. Andrew's sheet is read through the Google Drive connector (no scraping).
- **Tests:** synthetic tones and invented lyrics only; never real lyrics in fixtures, commits or tool output.
- **Mobile rules:** no JSX string literals (keys under `voiceSession.*`, translated to 33 locales with `env -u GEMINI_API_KEY pnpm i18n:translate`, `pnpm i18n:check`); `testID` on every interactive element, prefix `vs-`; Skia only in `packages/ui`; native deps via `npx expo install`; tests never under `src/app`; RTL via `isolate()` for note names and titles.
- **Coordination:** message Phase 5 Tonight before merging shared files: `packages/i18n/messages/*`, `packages/core/src/index.ts`, `packages/ui`, `apps/mobile/package.json` + lockfile, `app.json`/`app.config.ts` (expo-notifications plugin), `(tabs)/*`, `_layout.tsx`, `maestro/scripts/stack.js`, `scripts/e2e-local.sh`.
- **Versions:** decide bumps `[tool.poetry] version` (minor) once per PR; flacfetch bumps minor; gen bumps patch. Coverage: decide unit ≥ 70% / backend ≥ 60%; mobile `packages/*` ≥ 70% (`voice/session/` ≥ 90%).

## Review Focus

1. **A version stops playing mid-session** (removed, region-blocked, embedding disabled: player errors 100/101/150/152/153). Expected: the app reports `not_embeddable`, decide marks the version, and the next pick uses the song's next version or the link-out path; the session never dead-ends. Tests: Task C3 `test_not_embeddable_skip_marks_version_and_offers_alternative`, Task D3 `embed error 150 calls onUnplayable`.
2. **The app is backgrounded or killed during a song** (link-out to YouTube, a phone call, the OS reclaiming memory). Expected: reopening (or tapping the notification) within 6 h returns to the quiz for the current song; the session id survives in MMKV. Tests: Task D5 `restores to quiz after relaunch`, `notification tap opens the quiz`.
3. **Recording upload fails, consent is withdrawn, or "Delete my recordings" runs while uploads are queued.** Expected: the attempt is saved first (no audio needed); uploads retry from a persisted queue; turning recording off drops queued files for that session; delete clears the queue before calling the API. Tests: Task D4 `queue survives restart and retries`, `consent off drops queued`, `delete clears queue first`; Task C4 `test_upload_rejected_without_consent`.
4. **No usable evidence** (every song skipped "don't know", answers that contradict each other, or only "Barely knew it"). Expected: the posterior stays a valid distribution (no NaN), `next` returns `done: no_candidates` when candidates run out, and the result is a low-confidence partial result, never a 500. Tests: Task C1 `test_contradictory_answers_keep_valid_posterior`, Task C2 `test_no_candidates_done`, Task C3 `test_result_with_zero_attempts_is_partial`.
5. **Budget edge cases** (window boundary, flacfetch restart mid-download, a failed capture, clock jump). Expected: the 24 h total never exceeds the cap; a restart reloads the ledger; a download that failed before capture releases its reservation; one that captured counts its captured seconds. Tests: Task A1 `test_ledger_survives_restart`, `test_window_boundary`, `test_failed_before_capture_releases`.

---

## Part A: Pool selection and analysis pipeline (data, no UI)

### Task A1: flacfetch Spotify listening budget and batch priority (flacfetch)

**Files:**
- Create: `flacfetch/api/services/spotify_budget.py`, `flacfetch/api/routes/spotify.py`
- Modify: `flacfetch/api/models.py` (`DownloadByIdRequest`: `priority: Literal["interactive","batch"] = "interactive"`, `expected_duration_s: Optional[int] = Field(None, gt=0, le=1200)`, `delete_local_after_upload: bool = False`; new `SpotifyBudgetResponse`), `flacfetch/api/routes/download.py` (batch gate), `flacfetch/api/services/download_manager.py` (ledger reserve/settle around Spotify downloads; delete after upload), `flacfetch/api/main.py` (router), `deploy/provision.sh` (`Environment=FLACFETCH_SPOTIFY_LEDGER=/var/lib/flacfetch/spotify_ledger.sqlite`), `docs/` API doc, `pyproject.toml` (0.34.0)
- Test: `tests/test_spotify_budget.py`, additions to `tests/test_api_routes.py`

**Interfaces:**
- Produces:
  - `@dataclass BudgetConfig(batch_budget_s=43200, hard_cap_s=86400, interactive_reserve_s=7200, max_batch_in_flight=2, min_batch_gap_s=30, window_s=86400)`, from env `FLACFETCH_SPOTIFY_BATCH_BUDGET_S` etc.
  - `class SpotifyLedger(path: str, now: Callable[[], float] = time.time)`: SQLite table `entries(download_id TEXT PK, priority TEXT, started_at REAL, reserved_s REAL, captured_s REAL NULL, state TEXT)` with states `reserved|done|released`.
    - `reserve(download_id, priority, seconds) -> None`, `settle(download_id, captured_s: float) -> None`, `release(download_id) -> None`.
    - `usage(now=None) -> Usage(total_s, batch_s, batch_in_flight, interactive_in_flight, last_batch_start)`; an entry counts `captured_s` when settled, else `reserved_s`, when `started_at > now − window_s`. `reserved` entries older than 2 h are settled as `reserved_s` on read (crash safety).
  - `check_batch(usage: Usage, seconds: float, cfg: BudgetConfig, now: float) -> tuple[bool, str | None, int]` returning `(ok, code, retry_after_s)`; codes `spotify_budget`, `batch_busy`, `interactive_active`, `batch_gap`.
  - `POST /download-by-id` with `priority="batch"` and `source_name="Spotify"`: requires `expected_duration_s` (400 otherwise); on refusal 429 `{"detail": {"code", "retry_after_s"}}` with `Retry-After`. Interactive Spotify downloads reserve `expected_duration_s or 300` and settle with captured seconds.
  - `GET /spotify/budget` (API key) → `SpotifyBudgetResponse{window_s, total_s, batch_s, batch_budget_s, hard_cap_s, batch_in_flight, interactive_in_flight, batch_allowed_now: bool, retry_after_s: int}`.
  - Captured seconds = PCM bytes / (44100 × 4) measured by `SpotifyDownloader` (expose `last_captured_s` on the result or return it alongside the path; failures before any PCM → `release`).
  - `delete_local_after_upload=True` removes the local file (and empty parent dir) after a successful GCS upload; batch defaults it to True.

- [ ] **Step 1: Write the failing tests** (`tests/test_spotify_budget.py`, tmp-path SQLite, injected clock):
  - `test_batch_allowed_under_budget` (usage 0 → ok for 240 s);
  - `test_batch_refused_over_budget` (batch_s 43000 + 240 → `spotify_budget`, retry_after = seconds until enough entries age out);
  - `test_hard_cap_counts_interactive` (interactive 75000 + batch 4000 + 240 > 79200 → refused);
  - `test_batch_busy_at_two_in_flight`, `test_interactive_active_blocks_batch`, `test_batch_gap_30s`;
  - `test_window_boundary` (an entry at exactly `now − 86400` no longer counts);
  - `test_ledger_survives_restart` (new `SpotifyLedger` on the same path sees prior usage);
  - `test_failed_before_capture_releases`, `test_captured_seconds_replace_reservation`, `test_stale_reserved_settles_after_2h`;
  - routes (`tests/test_api_routes.py`): `test_batch_requires_expected_duration`, `test_batch_429_shape`, `test_budget_endpoint`, `test_interactive_never_refused`, `test_delete_local_after_upload` (mock GCS upload; file gone).
- [ ] **Step 2: Run** `pytest tests/test_spotify_budget.py tests/test_api_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The ledger uses one `sqlite3` connection per call with `isolation_level=None` + `BEGIN IMMEDIATE` around check-and-reserve, so two concurrent batch requests cannot both pass.
- [ ] **Step 4: Run** the full suite `pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Spotify listening budget (rolling 24 h) + batch priority for download-by-id (v0.34.0)`, then `/coderabbit` → `/pr` → merge.
- [ ] **Step 6 (Andrew): deploy on flacup** — pull + `pip install -e .[api,spotify]` + restart the API unit (memory `project_flacfetch_freeleech_tokens`: flacup deploy = pull + pip -e + restart), add `FLACFETCH_SPOTIFY_LEDGER` to the unit (`deploy/provision.sh` re-run does this). Verify: `curl -H "X-API-Key: …" $FLACFETCH_URL/spotify/budget` returns `batch_allowed_now: true`.

### Task A2: Pool models and the stratified sampler (decide, pure)

**Files:**
- Create: `karaoke_decide/voice_pool/__init__.py`, `karaoke_decide/voice_pool/models.py`, `karaoke_decide/voice_pool/strata.py`
- Test: `tests/unit/voice_pool/test_strata.py`

**Interfaces:**
- Produces:
  - `pool_id(song_key: str) -> str` = `sha1(song_key.encode()).hexdigest()[:16]`.
  - `@dataclass(frozen=True) PoolCandidate(song_key, artist, title, artist_key, popularity: int, lead_gender: str | None, decade: str | None, energy: float | None, duet: bool, vr_p50: float | None, vr_span: float | None, vr_tier: str | None, has_ultrastar: bool, spotify_id: str | None, duration_ms: int | None, versions: tuple[Version, ...])`.
  - `@dataclass(frozen=True) Version(video_id: str, brand_code: str, brand_name: str, rank: int, embeddable: bool | None)`.
  - `DIMENSIONS: dict[str, Callable[[PoolCandidate], str]]` with values:
    - `gender`: `male|female|mixed|unknown`, targets 0.45/0.40/0.10/0.05;
    - `register`: from `vr_p50` relative to the gender's centre (male 57, female 64, else 60): `low` (< −3), `mid`, `high` (> +3), `unknown`; targets 0.3/0.3/0.3/0.1;
    - `span`: `vr_span` `narrow` (< 10), `mid` (10–15), `wide` (> 15), `unknown`; targets 0.3/0.3/0.3/0.1;
    - `decade`: `pre1980|1980s|1990s|2000s|2010s+|unknown`; targets 0.18 each for the five known, 0.10 unknown;
    - `energy`: catalog `energy_band` `low|mid|high|unknown`; targets 0.3/0.35/0.3/0.05;
    - `duet`: `solo|duet`; targets 0.9/0.1.
  - `stratum_label(c) -> str` = `"gender=…|register=…|span=…|decade=…|energy=…|duet=…"`.
  - `select_pool(cands: list[PoolCandidate], n: int, *, max_per_artist: int = 2, pre_cap: int = 8000) -> list[tuple[PoolCandidate, str]]` (candidate, stratum).
  - `@dataclass CoverageReport(target: int, picked: int, per_dimension: dict[str, dict[str, tuple[int, int]]], empty_values: list[str], below_minimum: bool)`; `coverage(picked, n) -> CoverageReport` (`(target_count, actual)` per value; `empty_values` lists `dim=value` with target > 0 and actual 0; `below_minimum = picked < 600`).
- **Algorithm** (greedy marginal balancing; not determined by the tests):

```
priority(c) = c.popularity/100 + 0.3*c.has_ultrastar + 0.2*(c.vr_tier == 'measured')
cands = top pre_cap by priority, ties song_key asc
target[d][v] = TARGET_SHARES[d][v] * n ; count[d][v] = 0
while len(picked) < n and cands:
    best = argmax over c of  sum_d max(0, target[d][v_d(c)] - count[d][v_d(c)]) / target[d][v_d(c)]  + 0.5*priority(c)
           (skip c whose artist already has max_per_artist picks; ties song_key asc)
    pick best; count[d][v_d(best)] += 1 for every d; remove best
```

- [ ] **Step 1: Write the failing tests:**
  - `test_pool_id_stable` (`pool_id("x") == sha1("x")[:16]`);
  - `test_select_hits_gender_targets` (5,000 synthetic candidates, n=200 → male 90 ± 5, female 80 ± 5);
  - `test_max_two_per_artist`;
  - `test_prefers_ultrastar_when_strata_equal` (two identical candidates but one `has_ultrastar` → that one first);
  - `test_coverage_lists_empty_values` (no duets in input → `"duet=duet"` in `empty_values`);
  - `test_below_minimum_flag` (500 eligible → `below_minimum`);
  - `test_deterministic` (same input twice → same picks).
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_pool/test_strata.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-pool): stratified pool sampler + coverage report`.

### Task A3: Selection job: candidates, version choice, embeddability probe, queue

**Files:**
- Create: `karaoke_decide/voice_pool/select.py`, `karaoke_decide/voice_pool/versions.py`, `karaoke_decide/voice_pool/queue.py`, `karaoke_decide/voice_pool/cli.py` (`python -m karaoke_decide.voice_pool <select|fetch|analyse|publish|status>`; `__main__.py`)
- Test: `tests/unit/voice_pool/test_select.py`, `tests/unit/voice_pool/test_versions.py`, `tests/unit/voice_pool/test_queue.py`

**Interfaces:**
- Consumes: Task A2; 3a `CatalogReader` (catalog.db + `av` attached), catalog `songs` facets and 3c `vr_*` columns; 3c BigQuery `song_vocal_range_sources` (source `ultrastar`).
- Produces:
  - `versions.youtube_id(url: str) -> str | None` (handles `youtu.be/<id>`, `watch?v=`, `embed/`, extra params).
  - `versions.probe_embeddable(client: httpx.Client, video_id: str) -> bool | None`: `GET https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json`; 200 → True, 401/403 → False (embedding disabled), 404 → False (removed), other/timeout → None (unknown). 1 request/s max.
  - `versions.choose_versions(versions: list[Version], stats: dict[str, VersionStats] | None = None) -> list[Version]`: ordered best first: `embeddable is not False`, then score = `0.6*rank_prior + 0.4*quality`, `rank_prior = 1/(1+rank)`, `quality = (good+1)/(good+not_great+0.5*early_exit+2)` (default 0.5 without stats); ties brand priority `NOMAD` first, then `availability.COMMUNITY_BRANDS` order.
  - `@dataclass VersionStats(good: int = 0, not_great: int = 0, early_exit: int = 0, plays: int = 0, embeddable: bool | None = None)` (Firestore `voice_version_stats/{video_id}`, written by Task C5).
  - `select.load_candidates(reader, bq, *, min_pop: int = 60) -> list[PoolCandidate]`: songs with `in_kn=1` and a community version in `av.versions` (kind `community`, `youtube_url` not null); Spotify id and duration from BigQuery `SPOTIFY_FOR_KN_SQL` (one track per `karaoke_id` by Spotify popularity, the same `QUALIFY ROW_NUMBER()` rule as 3a `SONG_FACETS_SQL`, filtered with `UNNEST(@kn_ids)`; `maximum_bytes_billed` = 3a `MAX_BYTES_CATALOG`); `has_ultrastar` from `song_vocal_range_sources`. Lowers `min_pop` by 5 down to 45 until ≥ 3 × target.
  - `queue.FETCH_COLLECTION = "voice_pool_fetch"`; doc id `pool_id`; fields `{song_key, artist, title, spotify_id, duration_ms, source: 'shared'|'andrew_sheet'|'personal', priority: int (andrew_sheet 0, shared 1, personal 2), batch_ids: list[str], status, attempts: int, flacfetch_id, audio_gcs, vocals_gcs, manifest_run, error, added_at, updated_at, stratum}`.
  - `STATUSES = ('queued','downloading','fetched','separating','separated','analysed','failed')`; `queue.enqueue(fs, items) -> int` (skips existing ids, returns added); `queue.next_queued(fs, limit) -> list[dict]` (query `status == 'queued'`, sort `(priority, added_at)` in Python; no composite index).
  - BigQuery `karaoke_decide.voice_pool_songs` (WRITE_APPEND per run): `song_key, pool_id, artist, title, source, stratum, spotify_id, duration_ms, video_id, brand_code, selection_run, added_at`.
  - `select.run_select(reader, bq, fs, http, *, n: int = 1000, run: str, dry_run: bool) -> dict` (summary = `CoverageReport` as dict + `candidates`, `probed`, `non_embeddable`, `enqueued`); writes `gs://nomadkaraoke-musicbrainz-data/voice/selection/<run>/coverage.json`. A song whose every version probes False is dropped and replaced by the next candidate.
  - CLI: `select --n 1000 [--dry-run]`.

- [ ] **Step 1: Write the failing tests:**
  - `test_youtube_id_forms` (short, watch, embed, with `&t=`; garbage → None);
  - `test_probe_maps_status_codes` (`httpx.MockTransport`: 200/401/404/500);
  - `test_choose_versions_prefers_embeddable_then_quality`;
  - `test_load_candidates_requires_community_version` (3a fixture catalog + search fixture availability.db; songs without a community version absent);
  - `test_min_pop_steps_down` (tiny fixture → steps to 45);
  - `test_select_replaces_all_non_embeddable` (fake probe returns False for one song → replaced; summary counts it);
  - `test_enqueue_skips_existing`, `test_next_queued_orders_priority_then_age` (fake Firestore dict as in 3a tests);
  - `test_bq_query_has_byte_cap`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_pool -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS. Also `poetry run python -m karaoke_decide.voice_pool select --n 200 --dry-run` against the local stack fixtures prints a coverage report.
- [ ] **Step 5: Commit** `feat(voice-pool): selection job (community versions, oEmbed probe, Spotify ids, fetch queue)`.

### Task A4: Fetch scheduler job (flacfetch client, budget-aware loop, separation hand-off)

**Files:**
- Create: `karaoke_decide/voice_pool/flacfetch_client.py`, `karaoke_decide/voice_pool/fetch.py`, `karaoke_decide/voice_pool/separate.py`
- Test: `tests/unit/voice_pool/test_fetch.py`, `tests/unit/voice_pool/test_separate.py`

**Interfaces:**
- Consumes: Task A1 API, Task A3 queue, Task A5 job contract.
- Produces:
  - `FlacfetchClient(base_url: str, api_key: str, http: httpx.Client)`: `budget() -> dict`, `start_batch(spotify_id: str, duration_s: int, gcs_dir: str, filename: str) -> str | Refused` (`POST /download-by-id` with `source_name="Spotify"`, `source_id=spotify_id`, `download_url=f"https://open.spotify.com/track/{spotify_id}"`, `upload_to_gcs=True`, `gcs_path=gcs_dir`, `output_filename="original"`, `priority="batch"`, `expected_duration_s`, `delete_local_after_upload=True`), `status(download_id) -> dict`. `Refused(code, retry_after_s)`.
  - `fetch.run_fetch(fs, ff: FlacfetchClient, runner: JobRunner, gcs, *, run: str, deadline_s: float = 3300, rng: random.Random, sleep=time.sleep, now=time.time) -> dict`:
    1. poll every `downloading` item (`complete` → `fetched` with `audio_gcs`; `failed` → `attempts += 1`, back to `queued` if attempts < 3 else `failed`);
    2. while time remains and `ff.budget()["batch_allowed_now"]`: take the next queued item, `start_batch`, mark `downloading`; on `Refused` stop submitting this run (log INFO with code); `sleep(rng.uniform(45, 180))` between submissions;
    3. if ≥ 25 items are `fetched`, or the oldest `fetched` is > 6 h old: `separate.submit_batch(...)`;
    4. collect separation results (`separate.collect_results`) → `separated` / back to `fetched` with `attempts += 1`;
    5. if any `separated` and no `voice-pool-analyse` execution is running: `runner.run("voice-pool-analyse", region="us-central1", args=["analyse"])`.
    Returns `{polled, submitted, refused_code, fetched, separating, separated, analyse_started}`.
  - `separate.write_manifest(gcs, run: str, items: list[dict]) -> str` (JSONL lines `{"id": pool_id, "audio": "gs://…/original.flac"}` → `gs://karaoke-gen-storage-nomadkaraoke/voice-pool/manifests/<run>.jsonl`).
  - `separate.submit_batch(fs, gcs, runner, items, run) -> str`: writes the manifest, marks items `separating` with `manifest_run`, runs gen's job `projects/nomadkaraoke/locations/us-east4/jobs/voice-pool-separate-job` with container args override `["python","-m","backend.workers.voice_pool_separate_worker","--manifest", uri]` and `task_count = min(4, ceil(len/25))`.
  - `separate.collect_results(fs, gcs, run) -> tuple[int, int]` reads `<run>.results/part-*.jsonl` lines `{"id","ok","vocals","seconds","error"}`; items in a run older than 3 h with no result go back to `fetched`.
  - `JobRunner` protocol: `run(job: str, region: str, args: list[str] | None = None, task_count: int | None = None) -> str` and `is_running(job, region) -> bool`; the real one wraps `google.cloud.run_v2.JobsClient` (`run_job` with `RunJobRequest.Overrides`), the test one records calls.
  - Settings: `FLACFETCH_API_URL`, `FLACFETCH_API_KEY` (Secret Manager `flacfetch-api-url` / `flacfetch-api-key`).
  - CLI: `fetch` (scheduled hourly), `status` (prints queue counts per status and the budget).
- [ ] **Step 1: Write the failing tests:**
  - `test_submits_until_refused` (fake flacfetch allows 2 then 429 `spotify_budget` → 2 submitted, `refused_code`);
  - `test_spacing_uses_rng_between_submissions` (recorded sleeps all in [45, 180]);
  - `test_stops_at_deadline`;
  - `test_complete_download_marks_fetched`, `test_failed_three_times_marks_failed`;
  - `test_separation_submitted_at_25_or_6h`;
  - `test_manifest_lines_and_task_count`;
  - `test_results_mark_separated_and_stale_run_requeues`;
  - `test_analyse_started_once_when_separated`;
  - `test_budget_endpoint_unreachable_is_warning_not_error` (caplog: no ERROR).
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_pool/test_fetch.py tests/unit/voice_pool/test_separate.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-pool): hourly fetch scheduler under flacfetch's Spotify budget + separation hand-off`.

### Task A5: gen batch separate-only GPU job (gen)

**Files:**
- Create: `backend/workers/voice_pool_separate_worker.py`
- Modify: `infrastructure/modules/cloud_run.py` (`create_voice_pool_separate_job(service_account)`), `infrastructure/__main__.py` (create it; `cloudrunv2.JobIamMember` `roles/run.invoker` for `serviceAccount:voice-pool@nomadkaraoke.iam.gserviceaccount.com`), `.github/workflows/ci.yml` (update the job image only if `gcloud run jobs describe voice-pool-separate-job --region us-east4` succeeds, else `::warning::`), `pyproject.toml` (patch bump), `docs/ARCHITECTURE.md` (one paragraph under Audio Separation)
- Test: `backend/tests/test_voice_pool_separate_worker.py`

**Interfaces:**
- Consumes: Task A4 manifest contract.
- Produces:
  - `python -m backend.workers.voice_pool_separate_worker --manifest gs://…/<run>.jsonl`.
  - `shard(lines: list[dict], index: int, count: int) -> list[dict]` (`i % count == index` over manifest order).
  - `vocals_path_from_outputs(paths: list[str]) -> str | None` (the file whose name contains `_(Vocals)_`; not `(Instrumental)`/`(No Vocal)`).
  - `run_manifest(storage, separator_factory, manifest_uri: str, index: int, count: int) -> list[dict]`: one `Separator` per task (`separator_factory()` = `Separator(model_file_dir=os.environ["MODEL_DIR"], output_format="FLAC", output_dir=tmp, ensemble_preset="instrumental_clean", **_separator_kwargs())` + `load_model()`, reused for every song); per line: skip if `voice-pool/stems/<id>/vocals.flac` exists (result `ok`, `"seconds": 0`), else download → `separate` → upload vocals → delete temp files; failures recorded per line, never abort the task. Writes `<run>.results/part-<index>.jsonl` at the end and after every 10 songs.
  - Pulumi job `voice-pool-separate-job`: us-east4, image `us-east4-docker.pkg.dev/nomadkaraoke/karaoke-backend-gpu/karaoke-backend:latest`, 4 CPU / 16 GiB / 1 × `nvidia-l4`, `MODEL_DIR=/models`, `GCS_BUCKET_NAME`, `GOOGLE_CLOUD_PROJECT`, `ENVIRONMENT=production`, timeout 21600 s, `max_retries=0`, `task_count=1` default (overridden per run), `gpu_zonal_redundancy_disabled=True`, the existing audio worker SA. No Firestore and no gen job state touched.
- [ ] **Step 1: Write the failing tests:** `test_shard_complete_and_disjoint`, `test_vocals_path_from_outputs` (preset-name trap: `"x_(Vocals)_preset_instrumental_clean.flac"` vs `"x_(Instrumental)_preset_instrumental_clean.flac"`), `test_run_manifest_skips_existing_and_records_failures` (fake storage, fake separator raising on one id), `test_results_written_every_10`.
- [ ] **Step 2: Run** `pytest backend/tests/test_voice_pool_separate_worker.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement**, then the Pulumi resources and the CI guard.
- [ ] **Step 4: Run** `pytest backend/tests/test_voice_pool_separate_worker.py -q && pytest tests/unit -q -k infra`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): voice-pool separate-only GPU job (manifest in, vocals out) + Pulumi`; `/coderabbit` → `/pr`.
- [ ] **Step 6 (Andrew): `pulumi up` in gen `infrastructure/` before merging** (the CI guard tolerates a missing job, but the first image update needs it). Then merge. Smoke (Claude, read-only check): after the first decide fetch run, `gcloud run jobs executions list --job voice-pool-separate-job --region us-east4` shows a succeeded execution and `vocals.flac` objects exist.

### Task A6: Per-song analysis markers (decide, pure + librosa)

**Files:**
- Create: `karaoke_decide/voice_analysis/__init__.py`, `karaoke_decide/voice_analysis/markers.py`, `karaoke_decide/voice_analysis/held.py`
- Test: `tests/unit/voice_analysis/test_markers.py`, `tests/unit/voice_analysis/test_held.py` (`pytest.importorskip("librosa")` only where audio is synthesised)

**Interfaces:**
- Consumes: 3c `analyze_vocals` rules (pyin 16 kHz, fmin 65, fmax 1100, frame 1024, hop 320, `voiced_prob ≥ 0.5`, energy gating P95 − 25 dB), 3c `parse_ultrastar` / `note_stats`.
- Produces:
  - `ANALYSIS_VERSION = 1`.
  - `@dataclass VocalFrames(t: np.ndarray, midi: np.ndarray, rms_db: np.ndarray)` (voiced, gated frames) and `vocal_frames(y, sr) -> VocalFrames` (shares 3c's pyin settings; refactor 3c `analyze_vocals` to call it so the numbers agree).
  - `held.held_notes(f: VocalFrames, min_hold_s=0.5, tol_cents=50, max_gap_s=0.1, median_window_s=0.2) -> list[tuple[float, float, float]]` (start, end, midi): the same rules as 3c TS `findHeldNotes` (rolling median, run grouping).
  - `@dataclass SongMarkers` with fields: `low, high, p10, p50, p90` (P5/P95/P10/P50/P90), `voiced_s`, `secs_above: dict[int, float]` for MIDI 64, 67, 69, 72, 76, `secs_below: dict[int, float]` for 45, 48, 52, `octave_split_male: bool`, `octave_split_female: bool`, `section_jump: float | None`, `sustained_high_count: int`, `sustained_high_s: float`, `longest_held_s: float`, `high_loudness_db: float | None`, `syllables_per_s: float | None`, `density_source: Literal['ultrastar','onsets']`, `longest_phrase_s: float`, `intro_s: float`, `key: int | None`, `mode: int | None`, `key_changes: int`.
  - `compute_markers(f: VocalFrames, *, sections: list[Section] | None, track: TrackAnalysis | None, ultrastar: UltraStarSong | None) -> SongMarkers`. `Section(start, duration, loudness, key, key_confidence)` and `TrackAnalysis(key, mode, key_confidence)` mirror BigQuery `spotify_audio_analysis_sections` / `_tracks`.
- **Pinned rules:**
  - Octave split per register R (male comfort 48–64, female comfort 55–72): `cost(o) = outside(p10+o, p90+o, R)`; split when `min(cost(0), cost(−12), cost(+12)) ≥ 2` and the best lower octave is too low while the best higher octave is too high (the sheet's "too low if you sing it low, too high if high").
  - `section_jump` = median MIDI of the two loudest sections (by Spotify `loudness`) minus the median of the remaining sections that have ≥ 3 s voiced; None without sections.
  - Sustained high = held notes with `midi ≥ p90 − 1`; `high_loudness_db` = mean `rms_db` of frames ≥ p90 minus mean of frames in P25–P75.
  - `syllables_per_s` = UltraStar `:`+`*` notes / sung seconds when an UltraStar file is matched, else voiced-segment onsets per voiced second (`density_source='onsets'`).
  - `longest_phrase_s` = longest run of voiced frames with gaps < 0.3 s; `intro_s` = time of the first voiced frame (vocals stem), capped by the first Spotify section boundary with loudness within 6 dB of the track median when sections exist.
  - `key_changes` = number of section-to-section key changes where both `key_confidence ≥ 0.5`.
- [ ] **Step 1: Write the failing tests** (synthetic frames, no real audio except one librosa smoke):
  - `test_range_percentiles`; `test_secs_above_thresholds`;
  - `test_octave_split_male_detects_between_octaves` (p10 58, p90 70 → male split True; p10 50, p90 60 → False);
  - `test_section_jump_from_loud_sections`;
  - `test_sustained_high_and_longest_held`;
  - `test_density_prefers_ultrastar` (fixture UltraStar from 3c with invented lyrics);
  - `test_longest_phrase_breaks_on_300ms_gap`; `test_intro_seconds`;
  - `test_key_changes_need_confidence`;
  - `test_held_notes_match_ts_rules` (vibrato ±40 cents counts; 0.4 s does not; same cases as 3c Task 1);
  - `test_vocal_frames_matches_analyze_vocals` (librosa: a 5-harmonic stepped tone gives the same P10/P90 as 3c `analyze_vocals` within 0.01).
- [ ] **Step 2: Run** `poetry install --with vocal-analysis && poetry run pytest tests/unit/voice_analysis -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `poetry run pytest tests/unit/vocal_range -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-analysis): per-song vocal markers (range, octave split, sections, sustained highs, density, intro)`.

### Task A7: Analyse job and `voice.db` publish

**Files:**
- Create: `karaoke_decide/voice_analysis/analyse.py`, `karaoke_decide/voice_pool/voicedb.py`, `karaoke_decide/voice_pool/fixtures.py`
- Modify: `karaoke_decide/vocal_range/merge.py` (3c: `SourceRow.source` gains `'pool_measured'`; precedence `gen_measured > pool_measured > nomad_measured > ultrastar > gemini`, tier `measured`), `karaoke_decide/etl/vocal_range_refresh.py` (3c: read `voice/analysis/*.csv` into sources as `pool_measured`)
- Test: `tests/unit/voice_analysis/test_analyse.py`, `tests/unit/voice_pool/test_voicedb.py`, addition to `tests/unit/vocal_range/test_merge.py` (`test_pool_measured_precedence`)

**Interfaces:**
- Consumes: Tasks A3–A6; 3c `parse_ultrastar` + the GCS zip `vocal-range/ultrastar/usdb_20250204.zip`.
- Produces:
  - `analyse.run_analyse(fs, gcs, bq, *, run: str, limit: int | None, task_index: int, task_count: int) -> dict`: for `separated` items in this task's shard: download vocals → `vocal_frames` → sections/track from BigQuery (one query per batch of ≤ 200 Spotify ids, byte-capped) → UltraStar match by `song_key(artist, title)` → `compute_markers` → mark `analysed`.
  - BigQuery `karaoke_decide.song_voice_analysis` (WRITE_APPEND; latest row per `(song_key, analysis_version)` wins in readers): the `SongMarkers` fields (dicts as JSON strings) + `song_key, pool_id, analysis_version, analysed_at, energy, valence, duration_ms`.
  - CSV `gs://nomadkaraoke-musicbrainz-data/voice/analysis/<run>-<task>.csv` in the 3c measured-CSV columns (`source_id,artist,title,lead_part,low_midi,high_midi,p10,p50,p90,voiced_seconds`; `source_id = pool_id`, `lead_part = "all"`) for the 3c refresh.
  - `voicedb.build_voice_db(pool_rows, analysis_rows, version_stats, dest: Path, run: str) -> dict` with tables:
    - `meta(key PK, value)` (`schema=1`, `run`, `built_at`, `analysis_version`);
    - `pool(song_key PK, pool_id, artist, title, artist_key, source, stratum, spotify_id, duration_ms, popularity, lead_gender)`;
    - `versions(song_key, video_id, brand_code, brand_name, rank, embeddable INT NULL, quality REAL, PK(song_key, video_id))`;
    - `analysis(song_key PK, analysis_version, low, high, p10, p50, p90, voiced_s, secs_above_json, secs_below_json, octave_split_male INT, octave_split_female INT, section_jump, sustained_high_count, sustained_high_s, longest_held_s, high_loudness_db, syllables_per_s, density_source, longest_phrase_s, intro_s, key, mode, key_changes, energy, valence)`.
  - `voicedb.publish_voice_db(bucket, path, stats, run)`: gzip (mtime 0) → `voice/<run>/voice.db.gz`; `voice/latest.json` last; keep 3 runs. Called at the end of every analyse run, and by `cli publish`.
  - `fixtures.build(dest: Path) -> Path` + CLI `python -m karaoke_decide.voice_pool.fixtures build <dir>`: a `voice.db` over the 3a fixture catalog songs with invented ranges spanning bass…soprano (≥ 40 songs, ≥ 6 per type centre, each with one fake video id `FIXTURE<n>` and Muse "Starlight" at a baritone centre), used by the local stack and Maestro.
- [ ] **Step 1: Write the failing tests:** `test_shard_and_mark_analysed` (FakeGCS, fake BQ, `vocal_frames` patched), `test_missing_vocals_marks_failed_with_warning`, `test_csv_rows_for_vocal_range_refresh`, `test_build_voice_db_tables_and_meta`, `test_pointer_written_last_and_prune_three`, `test_fixture_db_covers_six_types`, `test_pool_measured_precedence`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_analysis tests/unit/voice_pool tests/unit/vocal_range -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-analysis): analyse job → song_voice_analysis + pool_measured ranges + voice.db`.

### Task A8: Infra, CI and shipping the pool pipeline

**Files:**
- Modify: decide `infrastructure/__main__.py`, `.github/workflows/ci.yml`, `tests/unit/test_infra_ci_parity.py`, `pyproject.toml` (minor bump; `python-multipart`), `docs/DATA-CATALOG.md` (`voice_pool_songs`, `song_voice_analysis`), `docs/ARCHITECTURE.md` (voice pool pipeline diagram: select → fetch (flacfetch budget) → gen separate → analyse → voice.db), `docs/VOICE-POOL.md` (create: runbook — status command, budget, re-running analysis after an `ANALYSIS_VERSION` bump, cost)

**Interfaces (Pulumi, for Andrew):**
- SA `voice-pool`: `roles/datastore.user`; `roles/bigquery.jobUser` + `roles/bigquery.dataEditor` on dataset `karaoke_decide`; `roles/storage.objectAdmin` on `karaoke-gen-storage-nomadkaraoke` with condition prefix `voice-pool/`; `roles/storage.objectAdmin` on `nomadkaraoke-musicbrainz-data` with condition prefix `voice/`; `roles/storage.objectViewer` on `nomadkaraoke-musicbrainz-data` (catalog, vocal-range) and `nomadkaraoke-kn-data` (availability); `roles/secretmanager.secretAccessor` on `flacfetch-api-key`, `flacfetch-api-url`; `roles/run.invoker` on `voice-pool-analyse`.
- Jobs (us-central1, `max_retries 0`): `voice-pool-select` (main image, 2 CPU / 4 GiB, 3600 s, on demand); `voice-pool-fetch` (main image, 1 CPU / 1 GiB, 3300 s, Cloud Scheduler `7 * * * *` UTC, paused until Andrew resumes it); `voice-pool-analyse` (`karaoke-decide-vocal` image, 4 CPU / 8 GiB, 21600 s, on demand, `task_count 1`).
- Bucket `nomadkaraoke-voice-recordings` (Global Constraints) and `roles/storage.objectAdmin` on it for the main API SA. Main API env: `VOICE_DATA_BUCKET=nomadkaraoke-musicbrainz-data`, `VOICE_RECORDINGS_BUCKET=nomadkaraoke-voice-recordings`, `ADMIN_TOKENS` from secret `admin-tokens` (Task B1).
- CI: build/push as today; `gcloud run jobs update` for the three jobs only when they exist (`::warning::` otherwise).

- [ ] **Step 1: Write** the resources; extend `test_infra_ci_parity.py` for the three jobs. Run `poetry run pytest tests/unit/test_infra_ci_parity.py -q`. Expected: PASS.
- [ ] **Step 2: Run** `poetry run pytest tests/unit -q && poetry run ruff check . && poetry run mypy karaoke_decide backend --ignore-missing-imports`. Expected: PASS.
- [ ] **Step 3:** `/test-review` → `/docs-review` → `/coderabbit` → `/pr` (decide "voice pool") → merge.
- [ ] **Step 4 (Andrew):** `pulumi up` in decide `infrastructure/` via `/gcp-admin`.
- [ ] **Step 5 (Claude, after Andrew):** `gcloud run jobs execute voice-pool-select --args=select,--n,1000` (Andrew's `/gcp-admin` if execute is denied); copy `coverage.json` into the session record; if `below_minimum` or empty strata, record them and stop for Andrew's call. Then Andrew resumes the `voice-pool-fetch` scheduler.
- [ ] **Step 6: Monitor day 1** (read-only): `python -m karaoke_decide.voice_pool status` (via the job's logs) and `GET /spotify/budget` every few hours: batch_s ≤ 43200, no 24 h total over the cap, separation + analyse executions succeed, `voice/latest.json` appears. Record songs/day, measured seconds per separation and per analysis (for `EST_COST_PER_SONG_USD`) in the ledger.

---

## Part B: Andrew's labels and the debug view

### Task B1: Sheet labels: note parser, admin access, import endpoint

**Files:**
- Create: `karaoke_decide/voice_session/__init__.py`, `karaoke_decide/voice_session/labels.py`, `backend/api/routes/admin_voice.py`, `scripts/voice/import_sheet.py`
- Modify: `backend/api/deps.py` (`AdminAccess`), `backend/api/routes/__init__.py` (`/admin/voice`), `karaoke_decide/core/config.py` (`admin_tokens: list[str]` from `ADMIN_TOKENS`, comma-separated)
- Test: `tests/unit/voice_session/test_labels.py`, `backend/tests/test_admin_voice_labels.py`

**Interfaces:**
- Produces:
  - `LabelTag = Literal['needs_warmup','good_if_warm','mood_only','octave_split','section_octave_jump','key_change','needs_practice','no_intro','version_good']`.
  - `parse_good(value: str) -> Literal['yes','no','maybe'] | None` (`y`, `yes`, `good`, `✓`, `✔`, `1` → yes; `n`, `no`, `x`, `✗`, `0` → no; other non-empty → maybe; empty → None).
  - `parse_note(note: str) -> set[LabelTag]` (case-insensitive regex table): `warm-?up|warmed up` → needs_warmup; `if warm` → good_if_warm; `flamboyant|in the mood|mood` → mood_only; `too low if .* too high` → octave_split; `octave is mixed|verse and chorus` → section_octave_jump; `lower octave|raise the key|key` → key_change; `practi[cs]e` → needs_practice; `no intro|comes in immediately` → no_intro; `version is great|version is good` → version_good.
  - `@dataclass SheetRow(artist, title, duet: bool | None, good: str | None, sung: bool | None, notes: str)`; `rows_from_csv(text: str) -> list[SheetRow]` (header names `Artist, Title, Duet?, good?, Sung?, Notes`, matched case-insensitively).
  - Firestore `voice_labels/{user_id}:{sha1(song_key)[:24]}` = `{user_id, song_key, artist, title, duet, good, sung, notes, tags: list[str], source: 'sheet', imported_at}`.
  - `AdminAccess` dependency: an admin decide user, or header `X-Admin-Token` in `settings.admin_tokens` (constant-time compare); otherwise 403.
  - `POST /api/admin/voice/labels/import` body `{email: str, rows: list[SheetRow], enqueue: bool = true}` → `{imported, matched, unmatched: list[{artist, title}], enqueued}`. Matching: `song_key(artist, title)` present in catalog.db; unmatched rows are still stored with `song_key = song_key(artist, title)` and `matched: false`. With `enqueue`, matched songs with a community version join the fetch queue as `source = 'andrew_sheet'`, priority 0.
  - `scripts/voice/import_sheet.py --csv PATH --email EMAIL --api URL` reads `ADMIN_TOKEN` from env and posts in batches of 200.
- [ ] **Step 1: Write the failing tests:** `test_parse_good_variants`, `test_parse_note_examples` (each quoted note from spec §1 maps to its tag; "Funbox version is great" → version_good), `test_rows_from_csv_header_case`, `test_import_requires_admin` (403 for a plain user; 200 with `X-Admin-Token`), `test_import_matches_and_enqueues`, `test_import_is_idempotent`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_session/test_labels.py backend/tests/test_admin_voice_labels.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice): Andrew's sheet labels (note tags) + admin import with token access`.

### Task B2: `VoiceDataStore` and admin debug endpoints

**Files:**
- Create: `backend/services/voice_data_store.py`
- Modify: `backend/main.py` (load in the lifespan after the catalog store, never blocking startup), `backend/api/routes/admin_voice.py`, `karaoke_decide/core/config.py` (`voice_data_bucket`, `voice_local_dir`, `voice_refresh_s = 600`)
- Test: `backend/tests/test_voice_data_store.py`, `backend/tests/test_admin_voice_debug.py`

**Interfaces:**
- Consumes: Task A7 voice.db; Task B1 labels; Task C3/C4 attempts and recordings (read when present).
- Produces:
  - `VoiceDataStore`: `status: Literal['ready','warming_up']`, `run: str | None`, `load(settings)` (local dir wins; else pointer → download → sha256 check; never raises), `maybe_refresh(now)` (re-reads `voice/latest.json` at most every `voice_refresh_s`, swaps atomically when `run` changes; called by a background asyncio task), `require() -> VoiceReader` (raises `VoiceDataUnavailable` → 503 `warming_up`).
  - `VoiceReader(path)`: thread-local read-only connections; `song(song_key) -> PoolSong | None`; `analysis(song_key) -> SongAnalysis | None`; `versions(song_key) -> list[Version]`; `pool_keys() -> list[str]`; `pool_songs(keys: Sequence[str]) -> list[PoolSong]`.
  - `PoolSong(song_key, artist, title, artist_key, stratum, source, duration_ms, popularity, lead_gender)`; `SongAnalysis` = the voice.db `analysis` columns as a frozen dataclass.
  - `get_voice_data_store()` singleton.
  - Admin (all `AdminAccess`):
    - `GET /api/admin/voice/coverage` → `{run, songs, analysed, per_stratum_dimension: {...}, queue: {status: count}, budget: <flacfetch /spotify/budget or null>}`.
    - `GET /api/admin/voice/users/{email}/songs` → list of `{song_key, artist, title, markers: SongAnalysis | null, label: {good, tags, notes} | null, attempts: [{session_id, at, quiz, context, pitch, recording_id}], prediction: {good: bool, p: float} | null}` (prediction from Task E1 once present; null before).
    - `GET /api/admin/voice/recordings/{recording_id}/audio` → streams the object with its content type.
- [ ] **Step 1: Write the failing tests:** `test_startup_without_voice_db_is_warming`, `test_local_dir_loads_fixture` (Task A7 fixture), `test_refresh_swaps_on_new_run` (fake GCS pointer change), `test_corrupt_sha_keeps_previous`, `test_admin_songs_joins_markers_labels_attempts`, `test_admin_audio_streams`, `test_admin_endpoints_403_for_users`.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_voice_data_store.py backend/tests/test_admin_voice_debug.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice): voice.db store with hot refresh + admin debug endpoints`.

### Task B3: Hidden debug screen (mobile)

**Files:**
- Create: `apps/mobile/src/app/me/voice-debug.tsx` (route), `apps/mobile/src/voiceSession/debug/VoiceDebugScreen.tsx`, `apps/mobile/src/voiceSession/debug/useVoiceDebug.ts`
- Modify: `apps/mobile/src/test-utils/routes.ts`, `apps/mobile/src/app/me/music-profile.tsx` (row `vs-debug-open`, only when `flags.is_admin`)
- Test: `apps/mobile/src/__tests__/voiceDebug.test.tsx`

**Interfaces:**
- Consumes: Task D2 facades `getVoiceFlags()`, `adminVoiceSongs(email)`, `adminRecordingUrl(id)`; `expo-audio` `useAudioPlayer` for playback (with the decide token header via a downloaded temp file: `File.downloadFileAsync` with headers, then play).
- Produces: screen `vs-debug` listing songs (FlashList via `@nomad/ui` `List`): title/artist, label chip (good yes/no/maybe + tags), markers line (`low–high` as note names, P10–P90, octave split, sustained highs, density, intro s), attempts (feel/position/difficulty, context chips), prediction (`p`), play buttons `vs-debug-play-<i>-<n>`. Admin copy is still i18n'd (`voiceSession.debug.*`), but only English translation quality matters.
- [ ] **Step 1: Write the failing tests:** renders rows from mocked data; hidden for non-admin; play downloads then plays.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t voiceDebug`. Expected: FAIL.
- [ ] **Step 3: Implement** (after Task D2 lands on the branch).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): hidden voice debug screen for admins`.

### Task B4: Import Andrew's sheet and first marker review (with Andrew)

- [ ] **Step 1 (Claude):** read the sheet `1VtInjcGXAtpNr7vnTjjl8KSMfnid-HepxEag5yRL8P4`, tab "Andrew", with the Google Drive connector (`read_file_content`); write it as CSV to the scratchpad (not committed: personal data). Record row count and the distinct `good?` values seen; adjust `parse_good` if needed (re-run Task B1 tests).
- [ ] **Step 2 (needs Andrew's gcloud auth for the secret):** `ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=admin-tokens | cut -d, -f1) poetry run python scripts/voice/import_sheet.py --csv <scratchpad csv> --email <Andrew's gen email> --api <decide prod API base URL from decide CLAUDE.md>`. Record imported/matched/unmatched/enqueued in the ledger; unmatched rows go to the session record for Andrew to eyeball.
- [ ] **Step 3:** after his songs are analysed (they are priority 0 in the fetch queue), Andrew opens the debug screen (release APK from Part D, or a dev build) and reviews markers on songs he knows. Record his comments verbatim in the ledger; each marker he calls useless or wrong becomes a tuning item for Part E.

---

## Part C: Session backend (behind an admin flag)

### Task C1: Voice model: hypotheses, likelihoods and evidence weighting (pure)

**Files:**
- Create: `karaoke_decide/voice_session/model.py`, `karaoke_decide/voice_session/weights.py`
- Test: `tests/unit/voice_session/test_model.py`, `tests/unit/voice_session/test_weights.py`

**Interfaces:**
- Consumes: 3c `VOICE_TYPES` (bass 40–64, baritone 45–69, tenor 48–72, alto 53–77, mezzo 57–81, soprano 60–84).
- Produces:
  - `Hyp = tuple[str, int]`; `HYPOTHESES: list[Hyp]` = types × shifts (−2…+2), 30 items; `comfort(h) = (lo+5+s, hi−5+s)`, `full(h) = (lo+s, hi+s)`.
  - `@dataclass(frozen=True) SongDemand(low, high, p10, p50, p90: float)`.
  - `@dataclass(frozen=True) Context(posture: Literal['standing','sitting','lying'], warmth: Literal['cold','bit_warm','warm'], headphones: bool)`.
  - `@dataclass(frozen=True) Quiz(feel, position: Literal['too_low','comfortable','too_high','both_ends'], difficulty: Literal['easy','stretch','couldnt'] | None, knew: Literal['well','partly','barely'] | None, would_sing, would_work_if: frozenset[str], voice_now: Literal['fresh','warm','tired'] | None, version_quality, version_issues: frozenset[str], tags: frozenset[str])`.
  - `@dataclass(frozen=True) PitchSummary(voiced_s, held_count, held_low, held_high, p10, p50, p90: float)`.
  - `@dataclass(frozen=True) Evidence(song: SongDemand, quiz: Quiz, ctx: Context, pitch: PitchSummary | None, stopped_early: bool)`.
  - `class Posterior`: `log_p: dict[Hyp, float]`; `uniform()`, `from_profile(profile: VoiceProfileOut | None)` (mic: weights 4 for the type, 2 for `voice_type_between`/adjacent types, 1 others; self: 3/1.5/1; register-only self profiles: 2 for types whose centre lies in the register band; shifts uniform); `update(ev: Evidence) -> Posterior` (new object); `type_marginal() -> dict[str, float]`; `comfort_estimate() -> tuple[float, float]` (posterior mean of comfort bounds); `full_estimate()`.
  - `likelihood_position(h, song, answer, sung_octave: int | None) -> float`, `likelihood_difficulty(h, song, answer, sung_octave) -> float`, `likelihood_pitch(h, pitch) -> float`, `sung_octave(song, pitch) -> int | None` (o ∈ {−12, 0, 12} minimising `|pitch.p50 − (song.p50 + o)|`; None without pitch or `voiced_s < 20`).
  - `weights.evidence_weight(ev: Evidence, kind: Literal['quiz','pitch']) -> float` and the constant table `W_QUIZ = 1.0`, `W_PITCH_HEADPHONES = 1.5`, `W_PITCH_OPEN = 0.6`, `K_KNEW = {'well': 1.0, 'partly': 0.7, 'barely': 0.3, None: 0.8}`, `K_WARM_MISS = {'cold': 0.5, 'bit_warm': 0.8, 'warm': 1.0}`, `K_TIRED_MISS = 0.5`, `K_POSTURE_MISS = {'standing': 1.0, 'sitting': 0.9, 'lying': 0.7}`, `K_CONDITIONAL_MISS = 0.3` (would_work_if ∩ {`warmer`, `practice`}), `K_EARLY_MISS = 0.7`, `EPS_POSITION = 0.15`, `EPS_DIFFICULTY = 0.2`, `TEMP = 1.5`.
- **Likelihoods and weighting** (not determined by tests alone):

```
σ = logistic
demand(h, song, o):  d_high = song.p90+o − comfort_hi(h);  d_low = comfort_lo(h) − (song.p10+o)
                     x_high = song.high+o − full_hi(h);    x_low = full_lo(h) − (song.low+o)
octave used: o = sung_octave if known, else argmin over o in (0, −12, 12) of max(d_low, d_high) + (0 if o == 0 else 0.5)
position:  H = σ((d_high−1)/TEMP), L = σ((d_low−1)/TEMP)
           raw = {too_high: H(1−L), too_low: L(1−H), both_ends: HL, comfortable: (1−H)(1−L)}
           P = (1−EPS_POSITION)·raw[a]/Σraw + EPS_POSITION/4
difficulty: X = σ((max(x_high, x_low) − 0.5)/1.0), D = σ((max(d_high, d_low) − 0.5)/1.0)
           raw = {couldnt: X, stretch: D(1−X), easy: (1−D)(1−X)}; P = (1−EPS_DIFFICULTY)·raw[a]/Σraw + EPS_DIFFICULTY/3
pitch (voiced_s ≥ 20, held_count ≥ 2): P = σ((full_hi(h) − held_high + 1)/1.0) · σ((held_low − full_lo(h) + 1)/1.0)
                                       (a held note is an achieved note: it bounds the range, it is never a "miss")

miss = position != 'comfortable' or difficulty == 'couldnt'
w_quiz  = W_QUIZ · K_KNEW[knew] · (K_WARM_MISS[warmth] · (K_TIRED_MISS if voice_now == 'tired' else 1)
                                   · K_POSTURE_MISS[posture] · (K_CONDITIONAL_MISS if would_work_if ∩ {warmer, practice} else 1)
                                   · (K_EARLY_MISS if stopped_early else 1)  if miss else 1)
w_pitch = (W_PITCH_HEADPHONES if headphones else W_PITCH_OPEN) · K_KNEW[knew]
log_p[h] += w_quiz·(log P_position + log P_difficulty (if answered)) + w_pitch·log P_pitch (if usable)
then renormalise with log-sum-exp
```

- [ ] **Step 1: Write the failing tests:**
  - `test_thirty_hypotheses_and_bounds` (`comfort(('baritone', 0)) == (50, 64)`);
  - `test_comfortable_answers_concentrate_on_truth` (5 comfortable songs centred at 57 → baritone top);
  - `test_too_high_moves_mass_down`;
  - `test_cold_miss_counts_half` (`evidence_weight` = 0.5 for a cold "too high" with knew `well`, standing, no conditions);
  - `test_cold_success_not_discounted` (cold + comfortable → 1.0);
  - `test_barely_knew_discounts_everything` (0.3 on both kinds);
  - `test_conditional_warmer_turns_no_into_demand` (0.3);
  - `test_tired_and_lying_compound` (cold+tired+lying miss = 0.5·0.5·0.7);
  - `test_pitch_weight_headphones_vs_open` (1.5 vs 0.6);
  - `test_held_note_above_type_range_penalises_type` (held_high 74 → bass mass < 0.05);
  - `test_octave_choice_for_female_song_by_male_singer` (song p10 64, p90 76; baritone answers comfortable → posterior stays baritone because o = −12 fits);
  - `test_contradictory_answers_keep_valid_posterior` (alternating too_high/too_low on the same song ×10 → probabilities finite, sum 1 ± 1e−9) (Review Focus 4);
  - `test_from_profile_mic_prior`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_session/test_model.py tests/unit/voice_session/test_weights.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-session): voice model posterior + context-weighted evidence`.

### Task C2: Next-song selection, stopping rule, simulated users (pure)

**Files:**
- Create: `karaoke_decide/voice_session/select.py`, `karaoke_decide/voice_session/stopping.py`, `karaoke_decide/voice_session/simulate.py`
- Test: `tests/unit/voice_session/test_select.py`, `tests/unit/voice_session/test_stopping.py`, `tests/unit/voice_session/test_simulate.py`

**Interfaces:**
- Consumes: Task C1.
- Produces:
  - `@dataclass(frozen=True) CandidateSong(song_key, artist_key, demand: SongDemand, stratum: str, know: float, pref: float, popularity: int, loved: bool)`. `know`: 1.0 song in `UserContextV2.known_songs` or loved; 0.7 artist in `ctx.artists`; 0.4 otherwise; 0.2 when the session has ≥ 2 `dont_know` skips for that artist. `pref` = 3a artist weight (0–1).
  - `@dataclass SessionState(posterior: Posterior, warmth, attempts: int, range_attempts: int, tired_count: int, done_keys: set[str], recent_strata: list[str], comfort_history: list[tuple[float, float]])`.
  - `eig(posterior, song: SongDemand) -> float` (expected reduction of the **type-marginal** entropy from the Q2 answer, using `likelihood_position` with the octave rule and no pitch).
  - `expected_stretch(posterior, song) -> float` = Σ_h P(h)·max(d_high, d_low).
  - `@dataclass NextPick(song_key, reason_type: Literal['comfortable_start','upper_range','lower_range','loved','known','explore'], score: float)`.
  - `choose_next(state, cands: list[CandidateSong]) -> NextPick | None`.
  - `stopping.check(state) -> DoneReason | None`, `DoneReason = Literal['confident','tired','max_attempts','no_candidates']` (`no_candidates` is set by the caller when `choose_next` returns None); `MAX_ATTEMPTS = 12`, `TOP_THRESHOLD = 0.75`, `PAIR_THRESHOLD = 0.85`, `STABLE_SEMITONES = 2`, `MIN_RANGE_ATTEMPTS = 3`.
  - `stopping.summary(state) -> ResultSummary(voice_type, between: str | None, top_p: float, pair_p: float, confidence_label: Literal['low','medium','high'], comfort: (int, int), full: (int, int), improve_hint: Literal['sing_higher_warm','sing_lower','more_songs'] | None)`; `high` when the top threshold is met, `medium` for the pair threshold, else `low`; hint `sing_higher_warm` when the upper comfort bound's posterior sd > 2 and the user was never "warm", `sing_lower` when the lower bound's sd > 2, else `more_songs` when not done.
  - `simulate.simulate(true_h: Hyp, pool: list[CandidateSong], rng, *, noise=0.15, p_knew=(0.6, 0.3, 0.1), warmth_path=('cold','bit_warm','warm')) -> SimResult(attempts, done_reason, summary)`; `simulate.synthetic_pool(rng, n=300)` (p50 uniform 45–76, span 8–20, low/high = p10 − 3 / p90 + 3).
- **Selection** (not determined by tests alone):

```
eligible = cands not in done_keys
if warmth == 'cold': eligible = [c for c in eligible if expected_stretch(c) <= (1 if attempts < 2 else 3)]
if attempts == 0:
    pool = top 20 of eligible by know·(0.5 + popularity/200), ties song_key
    pick = argmin expected_stretch over pool                  → reason 'comfortable_start'
else:
    pre = top 300 of eligible by know·(0.5 + popularity/200)
    score(c) = eig(c)·know(c) + 0.03·pref(c) − 0.05·[c.stratum in recent_strata[-2:]]
    pick = argmax score, ties song_key
    (lo, hi) = posterior.comfort_estimate()
    reason = 'upper_range' if c.p90 > hi + 1 else 'lower_range' if c.p10 < lo − 1
             else 'loved' if c.loved else 'known' if know == 1.0 else 'explore'
return None if no eligible
```

- [ ] **Step 1: Write the failing tests:**
  - `test_first_pick_is_comfortable_middle`;
  - `test_cold_blocks_stretch_songs` (attempts 0–1 exclude stretch > 1; later ≤ 3);
  - `test_eig_prefers_discriminating_song` (song at the baritone/tenor boundary beats one squarely inside both);
  - `test_avoids_last_two_strata`;
  - `test_unknown_artist_downweighted_after_two_dont_know`;
  - `test_no_candidates_done` (all done → None) (Review Focus 4);
  - `test_stop_confident_top_075_and_stable`, `test_stop_pair_085_reports_between`, `test_not_stable_keeps_going`, `test_tired_twice_stops`, `test_max_attempts_12`;
  - `test_simulated_users_converge` (200 users, seeded rng, every type × shift: ≥ 80% end `confident` within 10 attempts; final type equal or adjacent ≥ 90%; exact ≥ 70%). Mark `@pytest.mark.slow` if > 20 s; it still runs in CI.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_session -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** If the simulation thresholds fail, tune only `weights.py` constants and `TEMP`, record each change as a ledger "Ruling:", and never loosen the test thresholds without Andrew.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-session): information-gain song choice, warm-up ordering, stopping rule, simulated users`.

### Task C3: Session service and routes

**Files:**
- Create: `backend/services/voice_session_service.py`, `backend/api/routes/voice_session.py`, `backend/api/models/voice_session.py` (or inline models, matching decide's convention)
- Modify: `backend/api/routes/__init__.py` (`router.include_router(voice_session_router, prefix="/voice", tags=["voice-session"])`), `backend/api/deps.py` (`VoiceSessionServiceDep`), `karaoke_decide/core/config.py` (`voice_session_open: bool = False`, env `VOICE_SESSION_OPEN`)
- Test: `backend/tests/test_voice_session_routes.py`

**Interfaces:**
- Consumes: Tasks B2, C1, C2; 3a `build_context`, `SongFeedbackService.hidden_keys`; 3c `VoiceProfileService.get`.
- **Models** (`extra="forbid"` on every request model):
  - `SessionSetup{posture, warmth, record: bool, headphones: bool, device: str | None (≤ 80)}`; `SessionPatch` (same fields optional).
  - `NextSongOut{kind: 'song', song_key, artist, title, duration_s: int | None, reason_type, version: {video_id, brand_code, brand_name}, alternatives: list[{video_id, brand_code, brand_name}] (≤ 2), song_range: {low, high, p10, p50, p90} | None}` or `{kind: 'done', reason: DoneReason}`.
  - `SkipIn{song_key, reason: 'dont_know'|'something_else'|'not_embeddable', video_id: str | None}`.
  - `QuizIn` mirrors C1 `Quiz` (snake_case; lists for the multi-selects; Q1 `feel` and Q2 `position` required).
  - `PitchSummaryIn{voiced_s, held_count, held_low, held_high, p10, p50, p90}` (MIDI floats 24–96).
  - `AttemptIn{song_key, video_id, started_at, ended_at, stopped_early: bool, quiz: QuizIn, pitch: PitchSummaryIn | None}` → `AttemptOut{attempt_id, n: int, done: bool, done_reason: DoneReason | None, top_p: float}`.
  - `ResultOut{voice_type, between, confidence_label, top_p, low, high, comfort_low, comfort_high, attempts, partial: bool, improve_hint, profile_saved: bool, suited: list[RecSong] (≤ 15), loved: list[{song_key, artist, title}]}`.
  - `VoiceFlagsOut{session_enabled: bool, is_admin: bool, voice_data: bool}`.
- **Endpoints** (signed-in users; `session_enabled = settings.voice_session_open or user.is_admin`, else 403 `voice_session_disabled`):
  - `GET /api/voice/flags`.
  - `POST /api/voice/sessions` → `{session_id, state: 'active'}`; any other active session of the user becomes `abandoned`.
  - `PATCH /api/voice/sessions/{id}` → 204 (mid-session chip).
  - `GET /api/voice/sessions/{id}/next` → `NextSongOut` (503 `warming_up` without voice.db). Candidates: voice.db pool songs with `analysis` and a version not marked unembeddable (Firestore `voice_version_stats.embeddable == False` overrides voice.db), minus hidden songs and songs done in this session; `know`/`pref` from `build_context`; version order from Task A3 `choose_versions` with live stats.
  - `POST /api/voice/sessions/{id}/skips` → 204; `not_embeddable` sets `voice_version_stats/{video_id}.embeddable = false` and does **not** mark the song done when an alternative exists (the next call returns the same song with the next version).
  - `POST /api/voice/sessions/{id}/attempts` → `AttemptOut`; the posterior is rebuilt from all attempts on each call (≤ 12; no stored posterior), so retries are idempotent by `(session_id, song_key, started_at)`.
  - `GET /api/voice/sessions/{id}/result` → `ResultOut`; works for any session state (zero attempts → `partial: true`, `confidence_label: 'low'`, type from the prior); marks the session `done`. `suited` = recs v2 with `singable=true, sort='fit'` (3c) for the saved/derived profile; `loved` = attempts with `feel == 'loved'`.
  - Firestore: `voice_sessions/{id}` `{user_id, setup, state, created_at, updated_at, tired_count, skips: [{song_key, reason, at}]}`; `voice_attempts/{session_id}:{n}` `{user_id, session_id, n, song_key, video_id, quiz, context (snapshot at attempt time), pitch, stopped_early, started_at, ended_at, recording_id: null}`.
  - Sessions are user-scoped: another user's id → 404.
- [ ] **Step 1: Write the failing tests** (fixture voice.db from Task A7, fake Firestore, 3a gen-token fixture):
  - `test_flags_admin_vs_user_vs_open`;
  - `test_disabled_for_non_admin_403`;
  - `test_create_abandons_previous`;
  - `test_next_first_is_comfortable_start`;
  - `test_skip_dont_know_excludes_song`;
  - `test_not_embeddable_skip_marks_version_and_offers_alternative` (Review Focus 1);
  - `test_attempt_updates_and_is_idempotent`;
  - `test_three_consistent_baritone_attempts_then_more_until_done` (scripted answers from a simulated baritone; `done_reason == 'confident'` within 10);
  - `test_tired_twice_done`;
  - `test_result_with_zero_attempts_is_partial` (Review Focus 4);
  - `test_other_users_session_404`;
  - `test_rejects_extra_fields_in_pitch`;
  - `test_next_503_without_voice_db`.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_voice_session_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** CPU work (context build, EIG over ≤ 300 candidates × 30 hypotheses) runs in `asyncio.to_thread`. Target `next` p50 < 300 ms on the fixture.
- [ ] **Step 4: Run** `poetry run pytest backend/tests -q --ignore=backend/tests/emulator`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): voice session endpoints (setup, next, skips, attempts, result) behind admin flag`.

### Task C4: Recordings: upload, delete, account-deletion hook

**Files:**
- Create: `backend/services/voice_recording_service.py`
- Modify: `backend/api/routes/voice_session.py`, `karaoke_decide/core/config.py` (`voice_recordings_bucket`, `voice_recordings_local_dir` for the local stack), decide `docs/ARCHITECTURE.md` (§ Personal data: the recordings deletion contract for Phase 6)
- Test: `backend/tests/test_voice_recordings.py`

**Interfaces:**
- Produces:
  - `POST /api/voice/recordings` multipart: `file` (≤ 20 MB; content type `audio/mp4` or `audio/wav`, else 415), form fields `session_id`, `attempt_n: int`, `duration_s: float`, `device: str | None` → 201 `{recording_id}`. 403 `recording_not_consented` unless the session's current `setup.record` is true. The object key is `voice-recordings/<user_id>/<session_id>/<n>.m4a|.wav`; metadata `{song_key, video_id, posture, warmth, headphones, device}` copied from the attempt; the attempt doc gets `recording_id`. Re-upload for the same attempt replaces the object.
  - Firestore `voice_recordings/{recording_id}` `{user_id, session_id, attempt_n, gcs_path, content_type, bytes, duration_s, created_at}`.
  - `DELETE /api/voice/recordings` → `{deleted: int}`: deletes every object under `voice-recordings/<user_id>/` and every doc, and clears `recording_id` on attempts.
  - `VoiceRecordingService.delete_all_for_user(user_id) -> int` (used by the route and documented for Phase 6 account deletion).
  - `GET /api/voice/recordings/count` → `{count}` (for Me).
- [ ] **Step 1: Write the failing tests:** `test_upload_rejected_without_consent` (Review Focus 3), `test_upload_wav_and_m4a_paths`, `test_upload_too_large_413`, `test_bad_type_415`, `test_reupload_replaces`, `test_delete_all_removes_objects_docs_and_links`, `test_other_users_session_403`.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_voice_recordings.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** (local-dir storage when `voice_recordings_local_dir` is set).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): private voice recordings (consent-gated upload, delete all)`.

### Task C5: Session outputs: voice profile, personal song labels, recs v2, version stats

**Files:**
- Modify: `backend/api/routes/voice.py` + `backend/services/voice_profile_service.py` (3c: `method` gains `'session'`; new optional `evidence_count: int | None`, `session_id: str | None`; validator: `session` requires `evidence_count ≥ 1`), `karaoke_decide/core/models.py` (`UserSong.source` gains `"voice_session"`; new optional fields `session_feel`, `session_would_sing`, `session_key_hint: Literal['down','up','octave'] | None`, `session_tags: list[str]`), `backend/services/voice_session_service.py`, `backend/services/recs_v2/{context.py, weights.py, scoring.py}`
- Test: `backend/tests/test_voice_session_outputs.py`, additions to `backend/tests/recs_v2/test_context.py` and `test_scoring.py`

**Interfaces:**
- Produces:
  - On `result`: save the profile (`PUT` semantics through `VoiceProfileService`) when `confidence_label != 'low'`, or when no profile exists, or the existing one is `method: 'self'`. Fields: `voice_type`, `voice_type_between`, `low_midi/high_midi/comfort_*` (rounded estimates), `confidence` = label, `method: 'session'`, `evidence_count = range_attempts`, `session_id`, `measured_at = now`. Returns `profile_saved`.
  - On each attempt: upsert `user_songs/{user_id}:sk:{sha1(song_key)[:24]}` (3a love doc id) with `source: 'voice_session'`, `times_sung += 1`, `last_sung_at`, `vocal_comfort` (`easy` → easy, `stretch` → challenging, `couldnt` → challenging, else comfortable), `session_feel`, `session_would_sing`, `session_key_hint` (Q5 `yes_other_key` or Q6 `other_key` → direction from `d_high > d_low` ? `down` : `up`; Q6 `other_octave` → `octave`), `session_tags`. `feel == 'loved'` also calls `SongFeedbackService.love`.
  - Version stats: `voice_version_stats/{video_id}` increments `plays`, `good`/`not_great` (Q8), `early_exit` (`stopped_early`), `issues.<chip>`.
  - recs v2: `weights.SONG_SESSION_YES = 1.0`, `SONG_SESSION_FINE = 0.6`, `SESSION_NO_PENALTY = 0.15`. `build_context` maps `voice_session` docs with `session_would_sing in ('yes','yes_other_key')` to `known_songs` at `SONG_SESSION_YES`, `feel == 'fine'` at `SONG_SESSION_FINE`, and `would_sing == 'no'` into a new `ctx.session_no: set[str]` (excluded from known songs). `score` subtracts `SESSION_NO_PENALTY` for songs in `session_no`.
- [ ] **Step 1: Write the failing tests:** `test_result_saves_profile_rules` (low + existing mic profile → not saved; medium → saved with `method: 'session'`), `test_profile_validator_session_needs_evidence`, `test_attempt_writes_user_song_fields`, `test_loved_calls_love`, `test_version_stats_increment`, `test_context_session_yes_is_known`, `test_session_no_penalised_not_known`.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_voice_session_outputs.py backend/tests/recs_v2 -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `poetry run pytest backend/tests tests/unit -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-session): profile from session, per-song labels into recs v2, version quality stats`.

### Task C6: Test API, local stack, ship the session backend

**Files:**
- Modify: `backend/api/routes/test_support.py` (3a/3c), `scripts/local-stack.sh` (build the Task A7 fixture voice.db into `.local-stack/voice/`; env `VOICE_LOCAL_DIR`, `VOICE_RECORDINGS_LOCAL_DIR=.local-stack/recordings`, `VOICE_SESSION_OPEN=1`), `docs/TESTING.md` (§ Voice session), `docs/API.md`, `pyproject.toml` (minor)
- Test: `backend/tests/test_test_support.py` (additions)

**Interfaces:**
- Produces: `GET /api/test/voice/sessions?email=` → `[{session_id, state, attempts, done_reason}]`; `GET /api/test/voice/recordings?email=` → `{count}`; `POST /api/test/voice/reset {email}` (deletes sessions, attempts, recordings, labels, voice_session user_songs). Mounted only with `DECIDE_TEST_API=1` outside production (3a rule).
- [ ] **Step 1: Write the failing tests:** `test_voice_test_api_not_mounted_by_default`, `test_voice_reset_clears_everything`.
- [ ] **Step 2: Run, implement, run** `poetry run pytest backend/tests/test_test_support.py -q`. Expected: PASS.
- [ ] **Step 3: Smoke the local stack:** `scripts/local-stack.sh up` with gen's stack up; get a gen token (3a Task C2 recipe); `POST /api/voice/sessions` → `GET …/next` returns a fixture song with `version.video_id` starting `FIXTURE`; post 3 attempts; `GET …/result` returns a type.
- [ ] **Step 4:** `/test-review` → `/docs-review` → `/coderabbit` → `/pr` (decide "voice session", includes B1, B2, C1–C6, E1) → merge → verify `GET /api/voice/flags` on prod (admin token user: `session_enabled: true`; another user: false).

---

## Part D: Mobile session UI

### Task D1: Device spike: embedded YouTube vs link-out, and recording while playing

Run this as early as convenient (it has no dependencies); its outcome fixes the defaults for D3 and D4.

**Files:**
- Create (throwaway branch `spike/3d-youtube`, not merged): a dev screen `apps/mobile/src/app/dev/yt-spike.tsx`
- Create (merged, on the main branch): `docs/superpowers/specs/2026-10-22-mobile-phase3d-spike-results.md`

- [ ] **Step 1:** `npx expo install react-native-webview react-native-youtube-iframe` on the spike branch.
- [ ] **Step 2:** Build three players on the spike screen with 5 community video ids (pick from `av.versions`, including one NOMAD and one known non-embeddable):
  - A: `react-native-youtube-iframe` defaults;
  - B: the same with `webViewProps={{ source: { baseUrl: 'https://nomadkaraoke.com' } }}` / `baseUrlOverride` so the iframe sends a referrer (the 2025 "Error 153" cause);
  - C: a WebView loading a tiny page we host (`https://nomadkaraoke.com/embed/yt.html?v=<id>` — a public-website PR if chosen) that uses the IFrame Player API and posts `ready/state/error` messages.
- [ ] **Step 3:** For each player on the Android emulator, iOS simulator and Andrew's Android phone (release-signed build): plays with sound, `onReady`/`onChangeState`/`onError` fire, fullscreen/landscape works, error code for the non-embeddable id.
- [ ] **Step 4:** With the best player playing, start 3c `useMicPitchSource` (`allowsRecording: true`): does the video's audio keep playing at normal volume through headphones and through the speaker (iOS earpiece routing trap), and do pitch frames arrive? Then also start `useAudioRecorder` (AAC 48 kbps mono 44.1 kHz) at the same time as the stream: both on iOS and Android?
- [ ] **Step 5:** Write the results doc: a table per platform; the chosen `PLAYER_MODE` default (`embed-iframe-lib` | `embed-hosted` | `linkout`) and `RECORDING_SINK` default (`aac-recorder` | `wav-stream`), with the reason. Commit `docs: Phase 3d device spike results` on the main branch.

### Task D2: Dependencies, decide client, core quiz and pitch summary

**Files:**
- Modify: `apps/mobile/package.json` (`npx expo install react-native-webview expo-notifications` + `react-native-youtube-iframe` if D1 chose it), `apps/mobile/app.json` (`expo-notifications` plugin, no remote push config), `jest.shared.js` (transform ignore for the new packages), `openapi/decide.json` + regenerated `packages/api-decide` (`DECIDE_OPENAPI_URL=http://127.0.0.1:8030/openapi.json node scripts/fetch-openapi.mjs decide && pnpm gen:api:offline`), `packages/core/src/index.ts`
- Create: `packages/api-decide/src/voiceSession.ts` (re-exported from `index.ts`), `packages/core/src/voice/session/{index.ts, quiz.ts, pitchSummary.ts, prefill.ts}`
- Test: `packages/api-decide/src/__tests__/voiceSession.test.ts`, `packages/core/src/voice/session/__tests__/{quiz,pitchSummary,prefill}.test.ts`

**Interfaces:**
- Produces (api-decide): `getVoiceFlags()`, `createVoiceSession(setup)`, `patchVoiceSession(id, patch)`, `nextVoiceSong(id)`, `skipVoiceSong(id, body)`, `postVoiceAttempt(id, body)`, `getVoiceResult(id)`, `uploadVoiceRecording({sessionId, attemptN, durationS, device, fileUri, contentType})` (multipart via `fetch` + `FormData` with `{uri, name, type}`), `deleteVoiceRecordings()`, `voiceRecordingCount()`, `adminVoiceSongs(email)`, `adminRecordingUrl(id)`, plus personal-pool facades added in Task F2.
- Produces (core `voice/session`):
  - `type QuizAnswers = { feel: 'loved'|'fine'|'not_for_me'|null; position: 'too_low'|'comfortable'|'too_high'|'both_ends'|null; difficulty; knew; wouldSing: 'yes'|'yes_other_key'|'no'|null; wouldWorkIf: ('warmer'|'other_key'|'other_octave'|'practice'|'fine')[]; voiceNow; versionQuality: 'good'|'not_great'|null; versionIssues: ('no_intro'|'wrong_lyrics'|'bad_sync'|'low_quality')[]; tags: ('fast_lyrics'|'long_gaps'|'needed_warmup'|'crowd_song'|'mood_only')[] }`, `EMPTY_QUIZ`.
  - `canSubmitQuiz(q): boolean` (feel and position set); `toggleWouldWorkIf(q, v)` (`fine` clears the others; any other clears `fine`); `toQuizIn(q)` (snake_case; nulls omitted).
  - `type PitchSummary = { voicedS; heldCount; heldLow; heldHigh; p10; p50; p90: number }`; `summarizeSongPitch(frames: VoicedFrame[], held: HeldNote[]): PitchSummary | null` (null when voiced < 10 s or fewer than 2 held notes; percentiles nearest-rank as 3c).
  - `prefillPosition(s: PitchSummary | null, song: {low; high; p10; p50; p90} | null): { highest: number; lowest: number; suggested: 'comfortable' | null } | null`: octave `o` = argmin over {−12, 0, 12} of `|s.p50 − (song.p50 + o)|`; `suggested = 'comfortable'` iff `s.heldHigh ≥ song.p90 + o − 1` and `s.heldLow ≤ song.p10 + o + 1`; `highest/lowest` = held notes.
- [ ] **Step 1: Write the failing tests:** quiz (`canSubmitQuiz` needs Q1+Q2; `fine` toggling; `toQuizIn` shape), pitch summary (synthetic frames from 3c `testSignals`: a 30 s line 50–62 → p10/p90; 8 s → null), prefill (song an octave above the singer → `o = −12`, comfortable suggested; missing top → null suggestion), facade tests (`uploadVoiceRecording` sends multipart with the four fields; `nextVoiceSong` 503 → `isWarmingUp`).
- [ ] **Step 2: Run** `pnpm jest packages/core packages/api-decide`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm jest packages && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core,api-decide): voice session quiz model, pitch summary, prefill, decide client`.

### Task D3: Player: embed, link-out with local notification, fake

**Files:**
- Create: `apps/mobile/src/voiceSession/player/{KaraokePlayer.tsx, YouTubeEmbed.tsx, LinkOutPlayer.tsx, FakePlayer.tsx, playerMode.ts, notifications.ts}`, `apps/mobile/src/media/youtube.ts` (shared with Tonight: `youtubeWatchUrl(id)`, `openYouTube(id)` via `Linking.openURL('vnd.youtube://watch?v=<id>')` falling back to the https URL)
- Modify: `apps/mobile/src/config.ts` (`FAKE_YT: boolean` = `EXPO_PUBLIC_FAKE_YT === '1'` only when `isLocalUrl(GEN_API_URL)`; `PLAYER_MODE` default from D1, overridable by `EXPO_PUBLIC_VS_PLAYER_MODE` in local builds)
- Test: `apps/mobile/src/voiceSession/__tests__/player.test.tsx`, `notifications.test.ts`, `apps/mobile/src/__tests__/config.test.ts` (extend)

**Interfaces:**
- Produces:
  - `type PlayerEvent = { kind: 'ready' } | { kind: 'playing' } | { kind: 'ended' } | { kind: 'unplayable'; code: number | string }`.
  - `KaraokePlayer({ videoId, durationS, mode, onEvent, testID })`: renders `YouTubeEmbed`, `LinkOutPlayer` or `FakePlayer` (`FAKE_YT` wins).
  - `YouTubeEmbed`: 16:9, `onError` codes 2/5/100/101/150/152/153 → `unplayable`.
  - `LinkOutPlayer`: a card with "Open in YouTube" (`vs-linkout-open`) → `openYouTube`, then `scheduleBackNotification(durationS)`; "I'm back" (`vs-linkout-back`) → `ended`. On `AppState` returning to `active` after opening: emits `ended` (the quiz shows) and cancels the notification.
  - `notifications.ts`: `ensureLocalPermission(): Promise<boolean>`, `scheduleBackNotification(durationS: number | null): Promise<string | null>` (trigger `durationS + 10` s, default 240 s; content `voiceSession.notify.title` "Done singing?" / `voiceSession.notify.body` "Tap to rate it and get your next song"; `data.url = '/discover/voice-session'`), `cancelBackNotification(id)`, and `useNotificationOpens()` (routes `data.url`, registered in `AppProviders`).
  - `FakePlayer`: shows `vs-fake-player` and emits `ready`, `playing`, then `ended` after 5 s (`EXPO_PUBLIC_FAKE_YT_SECONDS`, default 5).
- [ ] **Step 1: Write the failing tests:** `embed error 150 calls onUnplayable` (Review Focus 1, mocked iframe component), `linkout schedules notification at duration+10`, `returning to foreground ends and cancels`, `notification tap opens the quiz` (route push), `fake player ends after 5 s` (fake timers), `FAKE_YT ignored for non-local URLs`.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t "player|notifications|config"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): karaoke player (embedded YouTube, link-out with reminder, fake for E2E)`.

### Task D4: Song recorder and the upload queue

**Files:**
- Create: `apps/mobile/src/voiceSession/recording/{useSongRecorder.ts, wavSink.ts, aacSink.ts (only if D1 chose aac-recorder), recordingQueue.ts}`
- Modify: `apps/mobile/src/voice/useFakePitchSource.ts` (3c: `VoiceSection` gains `'song'`, which plays the `sing` section looped)
- Test: `apps/mobile/src/voiceSession/__tests__/{wavSink,useSongRecorder,recordingQueue}.test.ts`

**Interfaces:**
- Consumes: 3c `PitchSource`, `createFramer`, `gateFrames`, `findHeldNotes`; Task D2 `summarizeSongPitch`, `uploadVoiceRecording`.
- Produces:
  - `wavSink.createWavSink(dir: string): { push(b: PcmBuffer): void; finish(): Promise<{ uri: string; durationS: number; bytes: number }>; abort(): void }`: downsample to 16 kHz mono PCM16 (linear interpolation; the fake mic is already 16 kHz), write in ≥ 256 KiB appends with `expo-file-system` `File`, header fixed up in `finish`.
  - `useSongRecorder(source: PitchSource, opts: { record: boolean; floor: number }): { start(): Promise<void>; stop(): Promise<{ pitch: PitchSummary | null; file: { uri: string; durationS: number; contentType: 'audio/wav' | 'audio/mp4' } | null }>; livePitch: number | null }`: one stream feeds the framer (pitch) and, when `record`, the sink. `floor` = the noise floor measured on the setup screen.
  - `recordingQueue` (zustand + MMKV `voiceSession.uploads.v1`): items `{ id, sessionId, attemptN, uri, contentType, durationS, device, tries, nextAt }`; `enqueue`, `flush()` (on mount, foreground and after each attempt; backoff 30 s × 2^tries, max 6 h; drops items whose file is gone), `dropSession(sessionId)` (deletes files), `clearAll()` (deletes files).
- [ ] **Step 1: Write the failing tests:** `wav header and length` (1 s of 48 kHz float → 32,044 bytes), `recorder without consent writes no file but returns pitch`, `queue survives restart and retries` (re-create store from MMKV mock; failing upload then success), `consent off drops queued`, `delete clears queue first` (order of calls: `clearAll` before `deleteVoiceRecordings`) (Review Focus 3), `fake source song section loops`.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t "wavSink|useSongRecorder|recordingQueue"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): song recorder (pitch + WAV/AAC) and persisted upload queue`.

### Task D5: `useVoiceSession` state machine

**Files:**
- Create: `apps/mobile/src/voiceSession/useVoiceSession.ts`, `apps/mobile/src/voiceSession/sessionStore.ts`
- Test: `apps/mobile/src/voiceSession/__tests__/useVoiceSession.test.ts`

**Interfaces:**
- Consumes: Tasks D2–D4.
- Produces:
  - `type VsStep = 'intro' | 'setup' | 'warmup' | 'loading' | 'pick' | 'play' | 'quiz' | 'result' | 'disabled' | 'error'`.
  - `sessionStore` (zustand + MMKV `voiceSession.current.v1`): `{ sessionId, setup, floor, song: NextSongOut | null, step, attemptN, quiz: QuizAnswers, pitch: PitchSummary | null, playStartedAt, savedAt }`; restored when `savedAt` is < 6 h old, else cleared.
  - `useVoiceSession()` returns `{ step, setup, song, quiz, prefill, result, livePitch, begin(setup), startWarmup(), endWarmup(), pickKnow(), pickSkip(reason), onPlayer(e: PlayerEvent), stopEarly(), setAnswer(patch), submitQuiz(), finish(), patchContext(patch) }`.
  - Rules: `begin` → `createVoiceSession` → `loading` → `nextVoiceSong`; `kind: 'done'` → `result`. `pickKnow` → `play` (recorder starts on `playing`). `onPlayer(unplayable)` → `skipVoiceSong(not_embeddable)` → `loading`. `ended` or `stopEarly` → recorder stop → `quiz` with `prefill`. `submitQuiz` → `postVoiceAttempt` → enqueue recording (when a file exists) with the returned `n` → `flush()` → `done ? result : loading`. Q7 `voiceNow` also patches `setup.warmth` locally when `warm`. `finish` → `result` (`getVoiceResult`). A 403 `voice_session_disabled` → `disabled`. Network errors keep the step and show retry; nothing is lost (quiz answers stay in the store).
- [ ] **Step 1: Write the failing tests** (mocked api-decide, fake recorder, fake timers): `full three-song walk to result`, `unplayable skips to next version`, `quiz requires Q1 and Q2`, `attempt failure keeps answers and retries`, `restores to quiz after relaunch` (Review Focus 2), `stale session (> 6 h) starts fresh`, `disabled flag shows disabled`, `finish mid-play goes to result`.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t useVoiceSession`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): voice session state machine with resume`.

### Task D6: Session screens and entry points

**Files:**
- Create: `apps/mobile/src/app/discover/voice-session.tsx` (route; modal `Stack.Screen` in `_layout.tsx` next to `discover/voice`; listed in `src/test-utils/routes.ts`), `apps/mobile/src/voiceSession/screens/{SessionIntro,SetupScreen,WarmUp,PickCard,PlayScreen,QuizScreen,ResultScreen}.tsx`, `apps/mobile/src/voiceSession/ContextChip.tsx`
- Modify: `apps/mobile/src/discover/components/ImproveCard.tsx` (entry `vs-entry-discover` "Find your voice (30 min)", shown when `flags.session_enabled`), `apps/mobile/src/app/me/music-profile.tsx` (entry `vs-entry-me`), `packages/i18n/messages/en.json` (`voiceSession.*`)
- Test: `apps/mobile/src/__tests__/voiceSessionScreens.test.tsx`

**Interfaces and pinned copy (spec §4):**
- **Intro** `vs-intro`: "Find your voice", "Sing 5–10 songs you know, about 30 minutes. Best at home, with headphones." Buttons `vs-intro-start`, `vs-intro-close`. Signed out → `openSignIn('/discover/voice-session')`.
- **Setup** `vs-setup`: "How are you singing?" `vs-posture-standing|sitting|lying`; "Voice right now?" `vs-warmth-cold|bit_warm|warm` (labels "Cold", "A bit warmed up", "Fully warmed up"); "Record me singing?" `vs-record-yes|no` with the explanation "We keep the recording privately so we can measure your range more accurately and improve your picks later. Only you and our team can access it, and you can delete all your recordings any time in Me."; "Headphones?" `vs-headphones-yes|no` (no → "The backing track will leak into the mic, so recordings count for less."); the quiet second "Stay quiet for a second…" measures the noise floor (3c `noiseFloor`) after mic permission (3c permission states reused: blocked → "Microphone is off" with Open Settings; recording then forced off); `vs-setup-go`. Cold → offers `vs-warmup-start` / `vs-warmup-skip`.
- **WarmUp** `vs-warmup` (60 s): "Hum a comfortable note" (20 s) then "Slide up and down like a siren" (40 s); live `PianoStrip` ribbon (3c); `vs-warmup-done` → asks warmth again.
- **PickCard** `vs-pick`: title, artist (in `isolate()`), reason line (`voiceSession.reason.<reason_type>`: comfortable_start "An easy one to start", upper_range "Checks your upper range", lower_range "Checks your lower range", loved "A song you love", known "A song you know", explore "Something new to try"); `vs-pick-know` "I know this", `vs-pick-dont-know` "Skip, don't know it", `vs-pick-else` "Something else"; `vs-finish` "Finish" (from the 1st completed song on).
- **Play** `vs-play`: `KaraokePlayer`; when recording, a small recording dot and optional live ribbon toggle `vs-ribbon-toggle`; `vs-stop-early` "Stop early"; `ContextChip` `vs-context-chip` (posture + warmth; tap opens a sheet `vs-context-sheet` and calls `patchContext`).
- **Quiz** `vs-quiz` (one scroll screen; Q1–Q2 required, rest skippable): IDs `vs-q-feel-<v>`, `vs-q-position-<v>`, `vs-q-difficulty-<v>`, `vs-q-knew-<v>`, `vs-q-sing-<v>`, `vs-q-work-<v>`, `vs-q-voice-<v>`, `vs-q-version-<v>`, `vs-q-issue-<v>`, `vs-q-tag-<v>`; copy exactly spec §4.3 Q1–Q9. Prefill line `vs-prefill`: "Your highest held note was {high}, lowest {low}" (note names via 3c `midiToName`, `isolate()`d). `vs-quiz-next` (disabled until Q1+Q2).
- **Result** `vs-result`: `vs-result-type` ("Likely Baritone", "Between Baritone and Tenor", or with `confidence_label === 'low'`: "Probably Baritone, but we need more songs to be sure"); `vs-result-range` (`PianoStrip` with full range and comfortable band; "A2–E4, comfortable C3–C4"); `vs-result-confidence`; `vs-result-hint` (`improve_hint` copy: sing_higher_warm "Sing 2 more higher songs when you're warmed up", sing_lower "Try a couple of lower songs", more_songs "A few more songs would make this surer"); suited songs `vs-result-song-<i>` (tap → song page) and loved songs; `vs-result-done`; `vs-result-more` "Keep going" (when not `done`).
- **Disabled** step: "Coming soon" (hidden entry points make this rare).
- [ ] **Step 1: Write the failing tests** (`renderRouter`, mocked `useVoiceSession` per step and one integration through the real hook with mocked API): intro→setup→pick→play(fake)→quiz→result; quiz next disabled until Q1+Q2; prefill line shows note names; result low-confidence wording; entry card hidden when `session_enabled` false; RTL (`ar`) isolates titles and note names.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t voiceSessionScreens`. Expected: FAIL.
- [ ] **Step 3: Implement**, add keys, `env -u GEMINI_API_KEY pnpm i18n:translate`, `pnpm i18n:check`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. Simulator screenshots of each step (fake YT + fake mic Metro), checked against the copy.
- [ ] **Step 5: Commit** `feat(mobile): voice session screens (setup, warm-up, pick, play, quiz, result)`.

### Task D7: Me: recordings and session result

**Files:**
- Modify: `apps/mobile/src/voice/VoiceProfileSection.tsx` (3c: shows `method: 'session'` as "From your voice session ({n} songs)"), `apps/mobile/src/voice/voiceStore.ts` (3c `LocalVoiceProfile.method` adds `'session'`, `evidenceCount`, `sessionId`), `apps/mobile/src/app/me/music-profile.tsx`
- Create: `apps/mobile/src/voiceSession/RecordingsSection.tsx`
- Test: `apps/mobile/src/__tests__/voiceRecordingsSection.test.tsx`

**Interfaces:**
- Produces: `RecordingsSection` (`vs-recordings`): count ("{count} recordings kept privately"), `vs-recordings-delete` → confirm (`Alert`, raised after any sheet's `onDismiss`, per the iOS gotcha) → `recordingQueue.clearAll()` then `deleteVoiceRecordings()` → count 0; default-consent toggle `vs-record-default` (MMKV `voiceSession.recordDefault`, pre-fills setup). After a session result, `useVoiceProfile` is invalidated so Me shows the session profile.
- [ ] **Step 1–4:** tests `delete clears queue then calls API`, `count renders`, `session method label`; run `pnpm jest apps/mobile -t "voiceRecordingsSection|VoiceProfileSection"`; implement; PASS.
- [ ] **Step 5: Commit** `feat(mobile): Me — voice recordings (delete all) and session-based voice profile`.

### Task D8: Maestro flows, screenshots, release APK, PR

**Files:**
- Create: `maestro/flows/voice-session-1-full.yaml`, `voice-session-2-quiz-only.yaml`, `voice-session-3-delete-recordings.yaml`
- Modify: `maestro/scripts/stack.js` (`ACTION: voice-session-assert` → `GET /api/test/voice/sessions` (`EXPECT_DONE`, `EXPECT_ATTEMPTS`); `ACTION: voice-recordings-count` (`EXPECT_COUNT`); `ACTION: voice-reset`), `scripts/e2e-local.sh` (Metro env `EXPO_PUBLIC_FAKE_YT=1 EXPO_PUBLIC_FAKE_YT_SECONDS=5`; decide stack with the fixture voice.db), `CLAUDE.md` (E2E: fake YouTube player, voice-session flows; workspace map `src/voiceSession/`)

**Flows** (screenshots to `docs/screenshots/phase3d/<platform>/`):
- **voice-session-1-full:** sign in (3a common) → Discover → `vs-entry-discover` → `vs-intro-start` → standing, warm, record yes, headphones yes → `vs-setup-go` → 3 times: `vs-pick-know` → wait for `vs-quiz` (fake player 5 s; fake mic `song` section) → assert `vs-prefill` visible → answer Q1 loved/fine, Q2 comfortable (or as prefilled), Q3 easy → `vs-quiz-next`; then `vs-finish` → `vs-result-type` contains "Baritone" → `voice-session-assert EXPECT_ATTEMPTS=3` and `voice-recordings-count EXPECT_COUNT=3`.
- **voice-session-2-quiz-only:** record no; 2 songs; one `vs-pick-dont-know`; finish → result shows the low-confidence wording; `voice-recordings-count EXPECT_COUNT=0`.
- **voice-session-3-delete-recordings:** after a 1-song recorded session, Me → `vs-recordings-delete` → confirm → count text shows 0 → `voice-recordings-count EXPECT_COUNT=0`.

- [ ] **Step 1: Write the flows.**
- [ ] **Step 2: Run** `scripts/e2e-local.sh --platform ios voice-session` then `--platform android voice-session` (never concurrently). Expected: 3/3 each.
- [ ] **Step 3: Run** both full suites in turn. Expected: no regressions.
- [ ] **Step 4: Screenshot UX review** in en and ar on both platforms (setup copy length, quiz scroll, result keyboard strip); fix and re-shoot.
- [ ] **Step 5: Release APK** (Phase 3a E13 recipe) against prod → `~/Downloads/nomad-karaoke-phase3d-release.apk`; check the bundle has no active fake paths (`FAKE_YT`/`FAKE_MIC` null for prod URLs). Prod smoke on the emulator with Andrew's admin test account: one real session song through the chosen player mode, quiz, result.
- [ ] **Step 6:** message Tonight about shared files (list in Global Constraints, plus `src/media/youtube.ts` they can reuse), then `/test-review` → `/docs-review` → `/coderabbit` → `/pr` (mobile) → merge.

---

## Part E: Tuning with Andrew

### Task E1: Agreement metric and replay harness (decide)

**Files:**
- Create: `karaoke_decide/voice_session/predict.py`, `scripts/voice/agreement.py`
- Modify: `backend/api/routes/admin_voice.py` (`GET /api/admin/voice/agreement?email=`; `prediction` field in the songs endpoint)
- Test: `tests/unit/voice_session/test_predict.py`, `backend/tests/test_admin_voice_agreement.py`

**Interfaces:**
- Produces:
  - `PREDICT_WEIGHTS = {'fit': 1.0, 'octave_split': −0.8, 'sustained_high_over_comfort': −0.4, 'density_over_4': −0.3, 'intro_under_2s': −0.2, 'bias': 0.0}` (tunable; every change is a ledger "Ruling:").
  - `predict_good(profile: UserVoiceRange, a: SongAnalysis, lead_gender_of_user: str | None) -> tuple[bool, float]`: `fit` term = 1 / 0.6 / −0.2 / −1 for 3c buckets fits / fitsIn / stretch / outside (3c `fit_song` with tier `measured` from `a`); `octave_split` uses the user's register (male/female from the profile centre ≤ 58 / ≥ 62, else whichever is worse); `p = σ(Σ w·x)`; good when `p ≥ 0.5`.
  - `agreement(rows: list[(label_good: Literal['yes','no'], pred: bool)]) -> AgreementReport(n, agree, rate, confusion: {tp, fp, tn, fn})`.
  - `held_out(labels, attempts) -> list[str]`: labelled yes/no songs (maybe excluded) with analysis that the user has **not** attempted in any session.
  - `GET /api/admin/voice/agreement?email=` → `AgreementReport` + `per_marker` (mean contribution for agree vs disagree) + `ready_for_signoff: bool` (`n ≥ 30 and rate ≥ 0.80`).
  - `scripts/voice/agreement.py --email … --api … [--weights JSON]` prints the report and lets a tuning iteration try weights locally against exported rows (`--export rows.json` / `--rows rows.json`, no API) before committing them.
- [ ] **Step 1: Write the failing tests:** `test_fit_bucket_terms`, `test_octave_split_penalty_uses_user_register`, `test_agreement_counts_and_confusion`, `test_held_out_excludes_attempted_and_maybe`, `test_ready_for_signoff_thresholds` (29 rows at 100% → false; 30 at 80% → true; 30 at 79% → false).
- [ ] **Step 2: Run** `poetry run pytest tests/unit/voice_session/test_predict.py backend/tests/test_admin_voice_agreement.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice-session): good/no prediction + agreement metric for sign-off`.

### Task E2: Tuning loop (needs Andrew)

- [ ] **Step 1 (Andrew):** install `~/Downloads/nomad-karaoke-phase3d-release.apk`; run sessions as himself (admin account) at home: at least 3 sessions on different days, mixing warmth states, with recording on and headphones; review the debug screen afterwards.
- [ ] **Step 2 (Claude), per iteration:** read `GET /api/admin/voice/agreement` and the debug songs; list disagreements with their markers; change at most one group per iteration (marker computation → bump `ANALYSIS_VERSION` and re-run `voice-pool-analyse` over the pool with `--reanalyse`; evidence weights in `voice_session/weights.py`; `PREDICT_WEIGHTS`; selection constants); re-run `test_simulated_users_converge`; ship as a small decide PR; ledger line `Tuning N: agreement x% on n (was y%), change, Andrew's comment`.
- [ ] **Step 3:** stop when `ready_for_signoff` is true **and Andrew says the picks are right for him** (record his words verbatim). If agreement plateaus below 80% after 5 iterations, write the evidence up and ask Andrew whether to lower the bar, add a marker, or collect more labels.

---

## Part F: Personal pool and gate

### Task F1: Eligibility, cap, budget guard and batches (decide)

**Files:**
- Create: `backend/services/voice_pool_service.py`
- Modify: `backend/api/routes/voice_session.py`, `backend/api/routes/admin_voice.py` (`GET /api/admin/voice/costs`), `karaoke_decide/voice_pool/fetch.py` (resolve missing Spotify ids for `personal` items in the job; personal items only start when no `shared`/`andrew_sheet` item is queued), `karaoke_decide/core/config.py` (`voice_personal_cap = 20`, `voice_personal_window_days = 30`, `voice_monthly_budget_usd = 20.0`, `voice_est_cost_per_song_usd = 0.012`)
- Test: `backend/tests/test_voice_personal_pool.py`, addition to `tests/unit/voice_pool/test_fetch.py` (`test_personal_waits_for_shared`, `test_resolves_missing_spotify_ids`)

**Interfaces:**
- Produces:
  - `eligibility(user) -> Eligibility(eligible: bool, reason: Literal['paid','history','admin'] | Literal['not_eligible'], listens: int, songs_with_plays: int)`: admin → `admin`; gen `gen_users/{email.lower()}` (falling back to a query on `email`, as 3a's validator) with `total_spent > 0` or any `credit_transactions[].reason == "purchase"` → `paid`; else Σ `user_songs.playcount` ≥ 1000 or count(`playcount ≥ 1`) ≥ 200 → `history`.
  - `pick_personal_songs(ctx: UserContextV2, reader: CatalogReader, voice: VoiceReader, queued: set[str], n=20) -> list[str]`: known songs by weight (then `playcount`), with a community version in `av.versions`, not in voice.db and not queued.
  - `POST /api/voice/personal-pool` → 201 `{batch_id, songs, est_cost_usd}`; 403 `{reason: 'not_eligible'}`; 429 `{reason: 'cap', next_allowed_at}` (admins exempt); 503 `{reason: 'budget_paused'}` when this month's estimated personal spend + the batch would exceed `voice_monthly_budget_usd`; 409 `{reason: 'nothing_to_add'}` when no songs qualify.
  - `GET /api/voice/personal-pool` → `{eligible, reason, next_allowed_at, batches: [{batch_id, requested_at, total, ready, status: 'queued'|'running'|'done'}]}` (`ready` = items `analysed` and present in the current voice.db).
  - Firestore `voice_personal_batches/{id}` `{user_id, song_keys, requested_at, est_cost_usd, month: 'YYYY-MM'}`; queue items get `source: 'personal'`, priority 2, `batch_ids += [id]`. The BigQuery/voice.db rows carry `source = 'personal'` and no user id.
  - `GET /api/admin/voice/costs` → `{month, personal_batches, personal_songs, est_cost_usd, budget_usd, paused: bool, shared_songs_analysed, est_cost_per_song_usd}`.
- [ ] **Step 1: Write the failing tests:** `test_eligible_paid_by_total_spent`, `test_eligible_paid_by_purchase_txn`, `test_eligible_by_history_counts`, `test_not_eligible`, `test_cap_20_per_30_days_and_admin_exempt`, `test_budget_guard_pauses`, `test_picks_skip_pooled_and_queued`, `test_status_ready_counts`, `test_shared_row_has_no_user_id`.
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_voice_personal_pool.py tests/unit/voice_pool -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `poetry run pytest backend/tests tests/unit -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(voice): personal pool ("analyse my music") with eligibility, cap and monthly budget guard`; bump; `/coderabbit` → `/pr` → merge.

### Task F2: "Analyse my music" in the app

**Files:**
- Create: `apps/mobile/src/voiceSession/personal/AnalyseMyMusicCard.tsx`, `apps/mobile/src/voiceSession/personal/usePersonalPool.ts`
- Modify: `packages/api-decide/src/voiceSession.ts` (`requestPersonalPool()`, `getPersonalPool()`), `apps/mobile/src/app/me/music-profile.tsx`, `apps/mobile/src/voiceSession/screens/SessionIntro.tsx` (card under the intro when eligible), `packages/i18n/messages/en.json`
- Test: `apps/mobile/src/__tests__/analyseMyMusic.test.tsx`

**Interfaces:**
- Produces: card `vs-personal` (hidden when not eligible): "Analyse my music" — "We'll prepare up to 20 songs you listen to most, overnight." Button `vs-personal-request`; states: requested ("Preparing {total} of your songs…"), ready ("{ready} of your songs are ready — find your voice" → `/discover/voice-session`), cap ("You can ask again on {date}"), paused ("Busy right now, try again tomorrow"), nothing to add. Polls `getPersonalPool` on Me focus (no push until Phase 6).
- [ ] **Step 1–4:** tests for each state and the request call; run `pnpm jest apps/mobile -t analyseMyMusic`; implement; translate; PASS.
- [ ] **Step 5: Commit** `feat(mobile): Analyse my music (personal voice pool)`.

---

## Part G: Open to everyone

### Task G1: Flip the flag, docs, release

**Files:**
- Modify: decide `infrastructure/__main__.py` + CI deploy flags (`VOICE_SESSION_OPEN=true` on the main service), decide `docs/VISION.md`/`docs/ARCHITECTURE.md`, mobile `CLAUDE.md` (status, Phase 3d spec/plan links, `src/voiceSession/`, new gotchas), mobile `docs/VISION.md` (3d status)

- [ ] **Step 1:** precondition check: Task E2 signed off (ledger line with Andrew's words) and Task F1 merged. If not, stop.
- [ ] **Step 2:** set the flag (CI env or Pulumi; **Andrew applies** if Pulumi), deploy, verify `GET /api/voice/flags` → `session_enabled: true` for a non-admin test user on prod.
- [ ] **Step 3:** release APK `~/Downloads/nomad-karaoke-phase3d-release.apk` rebuilt from main; prod smoke with a non-admin account: entry visible, one song, result.
- [ ] **Step 4:** docs PRs; `/wrap` the session record with: pool coverage, songs/day achieved, budget peaks, measured cost per song (update `voice_est_cost_per_song_usd`), simulation results, each tuning iteration's agreement, Andrew's sign-off words. `/backlog-add` follow-ups: song-position feedback (aligning recordings with the community version), push "your songs are ready" (Phase 6), recordings in Phase 6 account deletion and privacy review, a gen audio-worker hook so new orders feed the pool, crowd calibration across voices from collected labels.

---

## Self-review notes (resolved gaps)

- **Where the budget lives:** spec §10b says "throttled" without a location. The ledger is in flacfetch, because gen's customer Spotify downloads go through the same account and only flacfetch sees both. Customers are never refused; batch keeps a 2 h reserve under the 24 h cap.
- **"2 downloads at a time":** flacfetch serialises Spotify captures (`_SPOTIFY_CAPTURE_LOCK`), so 2 in flight means one capturing and one queued; kept as the spec's value.
- **"Copied into catalog.db":** catalog.db is rebuilt weekly (~44 GiB BigQuery per build), while the pool grows daily during the backfill and overnight for personal pools. A separate small `voice.db` with a 10-minute hot refresh replaces that copy; BigQuery `song_voice_analysis` stays the source of record, and 3c's `song_vocal_range` still gets the measured ranges via `pool_measured`.
- **Separation:** gen's `audio-separator` Cloud Run *service* has been off since 2026-10-01 (3c Task 8 assumed it). 3d uses a new gen *job* on gen's GPU image instead (spec §10b), and only stage 1 (`instrumental_clean` → vocals).
- **Bucket name:** gen's bucket is `karaoke-gen-storage-nomadkaraoke` (3c plan wrote `karaoke-gen-storage`).
- **Recording format:** the AAC path depends on whether expo-audio's recorder runs alongside `useAudioStream`; the WAV-from-stream sink always works (and is what Maestro's fake mic exercises), so it is built regardless and the spike picks the default.
- **Admin access for the import script:** decide admin routes also accept gen's `admin-tokens` secret so the one-off import can run without a browser session.
- **Session labels:** spec §6.4 says "user_songs with sung-in-session…"; `UserSong` already has `times_sung`, `last_sung_at` and `vocal_comfort`, so the labels extend `user_songs` (source `voice_session`), and recs v2 treats "would not sing" as a penalty instead of a known song.
