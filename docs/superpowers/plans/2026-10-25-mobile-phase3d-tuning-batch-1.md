# Phase 3d tuning batch 1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to work through this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal.** Fix what Andrew's first real session (2026-10-25, Pixel) showed:
- singers can hear their own recordings, stop one counting, or delete it;
- Me shows the mic-test result and the latest session result side by side;
- falsetto is detected (live and in the quiz), labelled and kept out of chest range and comfort;
- session comfort comes from the songs rated comfortable;
- a typical singer gets a confident type within 3–5 songs;
- "Songs that suit you" are songs they like.

**Spec.** nomad-mobile `docs/superpowers/specs/2026-10-22-mobile-phase3d-voice-session-design.md` (§10a/§10b override earlier sections; this batch adds §10c, Task M0). Earlier plan: `docs/superpowers/plans/2026-10-22-mobile-phase3d-voice-session.md`. Names come from decide `origin/main` `c0fe1fe` (v0.30.0) and mobile `a6c1446`.

**Andrew's words (verbatim, 2026-10-25):**
- "we probably need to add a way for users to hear their own recordings and optionally delete them from being counted by the system if they choose."
- "i agree with showing both results on Me, but I also think we need to try and figure out how to better suggest songs such that we can achieve a higher level of confidence after only 3-5 songs sung; that's already a huge ask which most users won't do unless they're really nerdy about singing."
- "my vocal range may be wider than usual, and I did go into falsetto for at least one of those songs (fake plastic trees) - that might be something we need to ask or factor in properly?"
- "perhaps we could make the app detect a probably falsetto note during the voice session process and offer the user a button to confirm in the moment while they're singing? eg. "Potential falsetto detected: confirm?""
- On the clips: "all of those clips 01-08 are all examples of me going into falsetto to hit the high note."

## What the code says

1. **Pitch evidence carries almost no type information.** `model.likelihood_pitch` only checks that held notes fit inside `full(h)`, with saturating sigmoids. MIDI 49–59 is equally possible for bass, baritone and tenor. p10/p50/p90 only choose the sung octave (`sung_octave`). This is the main reason four songs left the result at low confidence.
2. **Falsetto went into the evidence.** The A4 (69) falsetto notes went into `held_high` and the percentiles, pushing the full and comfort estimates up.
3. **The mic prior uses only the type** (`_PRIOR_WEIGHTS["mic"] = (4, 2, 1)`), not the measured comfort centre. The mic test's low "Bass" pulls toward bass at 4×.
4. **Selection barely uses taste:** `choose_next` scores `eig * know + 0.03 * pref`.
5. **"Songs that suit you" ignore taste:** `_suited` uses recs v2 `sort="fit"`, which orders by fit bucket, then score, then popularity (hence Miley Cyrus, Bad Bunny, Pitbull).
6. **The session overwrites the mic result:** `decide_users.voice_profile` is one field, so a saved session erases the mic result. Me cannot show both.
7. **Recordings:**
   - Only the admin stream exists (`GET /api/admin/voice/recordings/{id}/audio`).
   - Mobile admin debug already downloads with the bearer token, then plays (`useRecordingPlayback` in `voiceSession/debug/useVoiceDebug.ts`).
   - The upload queue deletes the local file after a successful upload. During the quiz the take is still local (`sessionStore.take`), so quiz-time replay can use the local file when consent is on.
8. **Deletion registry:** Phase 6's `backend/services/user_deletion.py` (`USER_DATA_STORES`, `NOT_USER_DATA`, `VOICE_ERASED`, `erase_voice_data`, guard test `backend/tests/test_user_data_registry_guard.py`) is on `origin/main` (#193).
   - This plan adds **no new collections**. New data lives on `voice_attempts` and `voice_sessions` (erased by `erase_voice_data`) and on `decide_users` (deleted last).
   - Any task that adds a collection must register it in `USER_DATA_STORES` and `VOICE_ERASED` in the same commit.
9. **Stale local clone:** `karaoke-decide` is at v0.20.4. Fetch, and branch from `origin/main`.
10. **Phase 4 reorder:** Phase 4 is reordering `apps/mobile/src/app/me/music-profile.tsx`. This plan changes only the inside of `VoiceProfileSection` / `RecordingsSection`, never `music-profile.tsx`.
11. **Mobile PR #20** (comfort widened to 11 keys around its centre, `MIN_COMFORT_KEYS`): the E simulation models the mic prior with that band.

## PR boundaries and order

| # | Repo | PR | Tasks | Depends on |
|---|------|----|-------|-----------|
| 1 | decide | "Your voice data" v0.31.0 | A1–A7 | — |
| 2 | decide | "Converge in 3–5 songs" v0.32.0 | E1–E6, D1 | E1 first (baseline) |
| 3 | mobile | "Recordings and both results on Me" | M0–M4 | decide PR 1 deployed |
| 4 | decide | "Falsetto" v0.33.0 | C1–C4 | PR 1 (PATCH + summary models); rebase on PR 2 |
| 5 | mobile | "Falsetto and setup background" | M5–M11 | decide PR 4 deployed |

**Parallel work:**
- Day one: E1 (pure Python, sim only) and A1–A7 can run in separate worktrees. On mobile, M2 and M5 need no new API.
- PR 2 and PR 4 overlap only in `backend/models/voice_session.py` and `voice_session_service.result()`, so land PR 2 first.
- Mobile PR 5 can build against decide PR 4's generated types and merges after that PR is deployed.

## Global constraints

- **i18n.** No JSX string literals. New keys go under `voiceSession.*` (session and recordings), `fit.*` (Me voice cards) and `voice.*` (mic test).
  - Translate all 33 locales with `env -u GEMINI_API_KEY pnpm run i18n:translate`, through `scripts/gcp-admin` if gcloud has lapsed.
  - Check plain-answer keys (yes/no) read as plain answers.
  - `pnpm i18n:check` must pass.
  - Note names and titles go through `isolate()`.
- **testIDs.**
  - Every interactive element has one, prefixed `vs-` (session, recordings) or `voice-` (mic test, Me voice cards).
  - Per-row IDs use the session index and attempt `n` (`vs-rec-<i>-<n>-play`), never raw ids containing `:`.
- **Maestro.**
  - Each mobile task lists the flows it adds or updates.
  - Seed through decide `/api/test/voice/*` (extended in A7).
  - No real lyrics and no real audio; the fake mic plays synthetic tones.
- **Deletion registry.**
  - No new collection without `USER_DATA_STORES` + `VOICE_ERASED`.
  - Add assertions to `backend/tests/test_user_deletion.py` for each new field.
  - Update decide `docs/ARCHITECTURE.md` § Personal data.
- **Alert hygiene.**
  - Expected conditions log at WARNING, not ERROR: recording object already gone, a `gcs_path` outside the bucket, a recompute that yields no evidence, an upload refused because the recording was deleted, an unparsable stored summary.
  - User errors are 4xx with a `detail` code and no log.
- **Privacy.**
  - Every new endpoint is user-scoped: another user's id is **404**, never 403.
  - Request models use `extra="forbid"`.
  - Recordings stream only to their owner; admin playback is unchanged.
  - Every destructive action has a confirm, and "Don't count" can be undone.
  - Takes still waiting to upload show as "Uploading…".
- **Old apps.** Every API change is additive: new request fields are optional and new response fields have defaults.
- **Versions.** decide `pyproject.toml` goes 0.31.0 → 0.32.0 → 0.33.0, one bump per PR. Mobile has no version bump.
- **Tests.**
  - decide:
    - `poetry run pytest tests/unit -q`
    - `poetry run pytest backend/tests -q --ignore=backend/tests/emulator`
    - `poetry run ruff check .`
    - mypy as configured
  - mobile: `pnpm test`, `pnpm typecheck`, `pnpm lint`; coverage of `packages/core/src/voice/session` ≥ 90%.
- **API client.** After each decide PR is on the local stack, run `pnpm --filter @nomad/api-decide generate`, then add wrappers in `packages/api-decide/src/voiceSession.ts` / `voice.ts`.
- **Coordination.**
  - Before merging, message Phase 4 (nomadkaraoke-36: Me) and Phase 6 (nomadkaraoke-14: `user_deletion.py`, ARCHITECTURE.md) about the shared files: `packages/i18n/messages/*`, `packages/core/src/index.ts`, `apps/mobile/src/voice/VoiceProfileSection.tsx`, `backend/services/user_deletion.py`.
  - Rebase on Phase 4 when it merges.

## Defaults for the open questions (Andrew can change them; execution doesn't block)

1. **Replay without "Record me".** Default: nothing is kept without consent. The catch-up row shows the note and time ("A4 at 2:31") with no ▶. A flag `KEEP_LOCAL_TAKE_WITHOUT_CONSENT` can change this later.
2. **What "Don't count this one" removes.** Default: only the voice evidence. The model skips the attempt, and the result and profile are recomputed. The `user_songs` taste labels stay.
3. **Live falsetto chip threshold.** Default: a held note ≥ 0.6 s that is ≥ 4 semitones above the running chest comfort top.
   - The offset is 3 if setup says "uses falsetto: yes" and 5 if "no".
   - No chip until a reference exists: a saved profile, or a session comfort estimate with `sd_high ≤ 3`.
   - At most one chip per 20 s, shown for 5 s.

**Assumption:** Andrew's true type is **baritone**. His A#2–A#4 (46–70) matches baritone's 45–69, and the E-part replay gate is built on it.

---

## Part A: decide PR 1 "Your voice data" (v0.31.0)

Worktree from `origin/main`: `karaoke-decide-voice-data-control`.

### Task A1: Session history endpoint
**Files.** Modify `backend/models/voice_session.py`, `backend/api/routes/voice_session.py`, `backend/services/voice_session_service.py`, `docs/API.md`. Test `backend/tests/test_voice_session_routes.py`.

**Produces.**
- `GET /api/voice/history` (`CurrentUser`; not flag-gated, like `/recordings/count`) returns `VoiceHistoryOut{sessions: list[HistorySessionOut]}`, newest first, at most `HISTORY_LIMIT = 20`.
- `HistorySessionOut{session_id, created_at, state: SessionStateName, result: SessionResultSummaryOut | None, attempts: list[HistoryAttemptOut]}`
- `HistoryAttemptOut{attempt_id, n, song_key, artist, title, sung_at: datetime | None, feel, position, excluded: bool = False, recording: HistoryRecordingOut | None, falsetto_notes: int = 0}`
- `HistoryRecordingOut{recording_id, duration_s, content_type, bytes}`
- `VoiceSessionService.history(user)`:
  - queries `voice_sessions` / `voice_attempts` / `voice_recordings` with `user_id ==`, sorts in Python (no composite index), and joins on `recording_id` / `{session}:{n}`;
  - omits sessions with no attempts.

**Steps.**
- [ ] Failing tests:
  - `test_history_lists_sessions_newest_first_with_attempts_and_recordings`
  - `test_history_is_user_scoped`
  - `test_history_open_when_session_flag_off`
  - `test_history_omits_empty_sessions`
  - `test_history_caps_at_20`
- [ ] Run `poetry run pytest backend/tests/test_voice_session_routes.py -q -k history` → FAIL.
- [ ] Implement → PASS.
- [ ] Commit `feat(voice): GET /api/voice/history lists your sessions, songs and recordings`.

### Task A2: User-scoped recording playback
**Files.**
- Modify `backend/services/voice_recording_service.py`: move `_object_name` and the chunked open out of `admin_voice.py` into `recording_object_name(gcs_path, bucket_name)` and `open_recording(bucket, name)`.
- Modify `backend/api/routes/admin_voice.py` to use them, with behaviour unchanged.
- Modify `backend/api/routes/voice_session.py`.
- Test `backend/tests/test_voice_recordings.py`, `backend/tests/test_admin_voice_debug.py`.

**Produces.** `GET /api/voice/recordings/{recording_id}/audio` (`CurrentUser`) returns a `StreamingResponse` with the stored `content_type`.
- **404 `recording_not_found`** when the doc is missing, belongs to another user, or its object is missing.
- A `gcs_path` outside `voice-recordings/<own user_id>/` is also a 404, with a WARNING log.
- No Range support: the app downloads, then plays.

**Steps.**
- [ ] Failing tests:
  - `test_user_streams_own_recording`
  - `test_other_users_recording_is_404`
  - `test_missing_object_is_404`
  - `test_path_outside_user_prefix_is_404_and_warns`
  - `test_admin_audio_unchanged`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): stream your own recording (GET /api/voice/recordings/{id}/audio)`.

### Task A3: Delete one recording
**Files.** Modify `backend/services/voice_recording_service.py`, `backend/api/routes/voice_session.py`, `docs/API.md`, `docs/ARCHITECTURE.md` (§ Personal data). Test `backend/tests/test_voice_recordings.py`, `backend/tests/test_user_deletion.py`.

**Produces.** `DELETE /api/voice/recordings/{recording_id}` (`CurrentUser`) → 204.
- It is a 404 when the recording isn't the user's.
- A repeat delete is 204, recognised through the `recording_deleted_at` attempt marker.
- `VoiceRecordingService.delete_one(user_id, recording_id)` runs in this order:
  1. set `voice_attempts/{id}.recording_deleted_at = now`;
  2. delete the blob (404-tolerant);
  3. delete the doc;
  4. set the attempt's `recording_id = None`.
- `upload()` refuses an attempt with `recording_deleted_at` → 409 `recording_deleted` (`RecordingDeletedError`). It re-checks the marker after `put()`, like the purge check, so an in-flight retry can't resurrect the recording.

**Steps.**
- [ ] Failing tests:
  - `test_delete_one_erases_object_doc_and_link`
  - `test_delete_one_other_user_404`
  - `test_delete_one_is_idempotent`
  - `test_upload_after_delete_one_is_409_recording_deleted`
  - `test_upload_in_flight_during_delete_one_undoes_itself`
  - `test_erase_voice_data_removes_recording_deleted_marker`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): delete one recording (real GCS erasure); refuse late re-uploads`.

### Task A4: "Don't count this one" with recompute
**Files.** Modify `backend/services/voice_session_service.py` (`rebuild_state`, `set_excluded`, `recompute_result`), `backend/models/voice_session.py`, `backend/api/routes/voice_session.py`, `backend/services/voice_session_outputs.py`. Test `backend/tests/test_voice_session_routes.py`.

**Interfaces.**
- **Stored fields.** `voice_attempts.excluded: bool` (absent = false) and `excluded_at`.
- **`rebuild_state`.** An excluded attempt:
  - doesn't update the posterior;
  - doesn't count in `range_attempts` or `tired_count`;
  - adds nothing to `comfort_history`;
  - still counts in `done_keys` and `attempts`.
- **`PATCH /api/voice/attempts/{attempt_id}`** (`CurrentUser`), body `AttemptPatchIn{excluded: bool}` (`extra="forbid"`), returns `AttemptPatchOut{attempt_id, excluded, result: SessionResultSummaryOut | None, profile: Literal["unchanged", "updated", "reverted_to_mic", "removed"]}`. 404 if the attempt isn't the user's.
- **`recompute_result(user_id, session_id)`** rebuilds the state and rewrites `voice_sessions.result_summary`. If the current profile is `method == "session"` with this `session_id`, it also re-derives the profile:
  - evidence remains → save it without the `should_save` gate (`updated`);
  - no evidence, and a `voice_profile_mic` exists → restore the mic copy (`reverted_to_mic`);
  - otherwise → delete the profile (`removed`).
  - All three cases log at INFO.
- `user_songs` is untouched.

**Steps.**
- [ ] Failing tests:
  - `test_excluded_attempt_ignored_by_posterior`
  - `test_excluded_attempt_still_blocks_reoffer`
  - `test_exclude_recomputes_summary`
  - `test_exclude_updates_saved_session_profile`
  - `test_exclude_last_evidence_reverts_to_mic_profile`
  - `test_exclude_last_evidence_without_mic_removes_profile`
  - `test_unexclude_restores`
  - `test_exclude_other_user_404`
  - `test_exclude_on_active_session_changes_next_pick_state`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): "don't count this one": excluded attempts leave the model; result and profile recomputed`.

### Task A5: Store both results; Me reads them; adopt a session result
**Files.** Modify `backend/services/voice_profile_service.py`, `backend/api/routes/voice.py`, `backend/services/voice_session_service.py` (`result`, `_save_profile`), `backend/models/voice_session.py`, `docs/API.md`. Test `backend/tests/test_voice_routes.py`, `backend/tests/test_voice_session_routes.py`, `backend/tests/test_user_deletion.py`.

**Interfaces.**
- **`SessionResultSummaryOut{session_id, voice_type, between, confidence_label, top_p, low, high, comfort_low, comfort_high, attempts, evidence_attempts, profile_saved, computed_at}`.** PR 2 adds `comfort_source: Literal["measured","model"] = "model"` and PR 4 adds `falsetto_high: int | None = None`.
- **`voice_sessions.result_summary`** is written by every `result()` (finish, refetch, abandoned) and by `recompute_result`.
- **`decide_users.voice_profile_mic`**:
  - `VoiceProfileService.put` writes it whenever `method == "mic"`;
  - `get_mic(user_id)` reads it;
  - `delete()` clears both fields.
- **`GET /api/my/voice`.** `VoiceProfileResponse` gains `mic: VoiceProfileOut | None = None` and `latest_session: SessionResultSummaryOut | None = None`, which is the newest session (by `updated_at`) with a `result_summary` and at least one non-excluded attempt that has evidence.
- **`POST /api/voice/sessions/{session_id}/adopt`** (`SessionUser`) → `VoiceProfileOut`. It saves the session's derived profile even at low confidence and sets `profile_saved: true` in `result_summary`.
  - 409 `no_evidence` when there is nothing to save.
  - 404 when the session isn't the user's.
- No new collection.

**Steps.**
- [ ] Failing tests:
  - `test_mic_put_keeps_mic_copy`
  - `test_session_save_keeps_mic_copy`
  - `test_get_voice_returns_mic_and_latest_session`
  - `test_latest_session_present_when_low_confidence_not_saved`
  - `test_delete_voice_clears_mic_copy`
  - `test_adopt_low_confidence_session_saves_profile`
  - `test_adopt_without_evidence_409`
  - `test_result_summary_written_on_finish_and_refetch`
  - `test_account_deletion_erases_mic_copy_and_summaries`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): keep the mic result beside the session result; GET /api/my/voice returns both; adopt a session result`.

### Task A6: "Songs that suit you" ranked by taste
**Files.** Modify `backend/services/voice_session_service.py` (`_suited`). Test `backend/tests/test_voice_session_routes.py`.

**Interface.**
- `_suited` calls `recommend(user, RecFilters(singable=True), sort="best", profile=profile)`.
- It flattens the sections in order, dedupes by `song_key`, and stops at `SUITED_LIMIT`.
- If that gives fewer than `SUITED_MIN_TASTE = 5` songs, it tops up from `sort="fit"`.
- `ResultOut.suited` keeps its shape.

**Steps.**
- [ ] Failing tests: `test_suited_prefers_known_artists_over_popular_unknown`, `test_suited_tops_up_with_fit_when_no_taste`.
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `fix(voice): songs that suit you are ranked by your taste (recs best + singable), fit only as top-up`.

### Task A7: Test API seeding, docs, version
**Files.** Modify `backend/api/routes/test_support.py`, `docs/API.md`, `docs/TESTING.md`, `pyproject.toml` (0.31.0). Test: the test-support test file.

**Interface.** `POST /api/test/voice/seed-history` `{email, sessions: [{state, result_summary?, attempts: [{song_key, artist, title, quiz, pitch?, recording: bool}]}]}`.
- It creates sessions and attempts, plus a short synthetic WAV in the local recordings bucket when `recording` is true.
- It sits behind the existing test-support gate.

**Steps.**
- [ ] Failing test `test_seed_history_creates_playable_recording` → implement → `make test-unit test-backend lint` PASS.
- [ ] Commit `chore(test): seed voice history for Maestro (v0.31.0)`.
- [ ] `/coderabbit` → `/pr` → merge → deploy.

---

## Part E (+D): decide PR 2 "Converge in 3–5 songs" (v0.32.0)

Worktree: `karaoke-decide-voice-converge`. Start E1 on day one.

### Task E1: Simulation first: measure today's convergence (no weight changes)
**Files.**
- Modify `karaoke_decide/voice_session/simulate.py`.
- Create:
  - `karaoke_decide/voice_session/replay.py`
  - `scripts/voice/sim_report.py`
  - `scripts/voice/export_session_fixture.py`
  - `tests/unit/voice_session/fixtures/andrew_2026_10_25.json`
  - `docs/VOICE-SESSION-TUNING.md`
- Test `tests/unit/voice_session/test_simulate.py`, `test_replay.py`.

**Produces.**
- **`SimPrior = Literal["self_register", "uniform", "mic"]`.** `"mic"` simulates the 3c mic test:
  - measured comfort centre = true comfort centre + N(μ = −1.0, σ = 2.5), i.e. a low bias;
  - an 11-key band (PR #20's `MIN_COMFORT_KEYS`);
  - classified with the 3c centre rule, then passed to `Posterior.from_profile` as `method="mic"`.
- **`SimPitch = Literal["none", "headphones", "open"]`.** The simulated `PitchSummary` is taken at the sung octave:
  - percentiles: the song's percentiles clipped into the singer's chest range, plus N(0, σ) per value (σ = 0.7 headphones, 1.5 open);
  - held notes: clipped p90/p10 ± 1;
  - `voiced_s`: 60–180;
  - falsetto leak: with probability 0.3, a falsetto note at full top + 3 leaks into `held_high`.
- **`simulate(..., pitch: SimPitch = "none", budget: int | None = None)`.** `SimResult.trace: list[ResultSummary]` holds one summary per attempt.
- **`PopulationStats`** gains `exact_at`, `adjacent_at`, `confident_within` for k ∈ {3, 4, 5, 10}.
- **`replay.replay_attempts(prior_profile, attempts) -> list[ResultSummary]`** reuses the `rebuild_state` logic. The service's `_quiz` / `_pitch` / `_demand` move to `replay.py` (pure), and the service imports them.
- **`scripts/voice/export_session_fixture.py --email <e> --session <id>`** reads Firestore (read-only) and writes `{prior_profile, attempts: [{n, demand, quiz, pitch, context, stopped_early}]}`. `song_key` is replaced by `sha1[:10]`; no titles, artists or user ids.
- **`scripts/voice/sim_report.py`** prints a table of prior × pitch × k → exact / adjacent / confident (seed `20261025`, n = 300).

**Steps.**
- [ ] Failing tests:
  - `test_mic_prior_sim_is_deterministic`
  - `test_trace_has_one_summary_per_attempt`
  - `test_exact_at_k_uses_trace`
  - `test_simulated_pitch_respects_singer_range`
  - `test_replay_matches_service_rebuild_state`
- [ ] Run `poetry run pytest tests/unit/voice_session -q` → FAIL. Implement; the existing gates stay unchanged and passing.
- [ ] Export Andrew's 2026-10-25 session (session `06116d77726547f3a1650c448e804ccd`, user andrew.d.beveridge@gmail.com) to the fixture. Run `sim_report.py` and the replay.
- [ ] Record the baseline table and the replay trace (type, top_p, label and comfort after each song) in `docs/VOICE-SESSION-TUNING.md`, with a diagnosis.
- [ ] Commit `test(voice): simulate 3–5 song budgets with mic prior and pitch; replay Andrew's first session (baseline, no tuning)`.

### Task E2: Tessitura likelihood from comfortable songs' sung percentiles
**Files.** Modify `karaoke_decide/voice_session/model.py`, `weights.py`. Test `test_model.py`, `test_weights.py`.

**Interface.** `likelihood_tessitura(h, pitch, position, octave) -> float`.
- It applies only when `usable_pitch` holds and `position == "comfortable"`; otherwise it returns 1.0.
- Formula: `σ((c_hi − p90 + 1)/TESS_TEMP) · σ((p10 − c_lo + 1)/TESS_TEMP) · exp(−(p50 − centre(h))² / (2·TESS_SD²))`.
- The pitch is first shifted back by the sung octave.
- `Posterior.update` adds `w_tess · log(...)`.
- New constants: `W_TESSITURA`, `TESS_TEMP = 1.0`, `TESS_SD = 3.0`. Starting `W_PITCH_HEADPHONES` / `W_PITCH_OPEN` = 2.0 / 1.0, re-tuned in E5.

**Steps.**
- [ ] Failing tests:
  - `test_tessitura_separates_bass_baritone_tenor` (p10 49, p50 54, p90 59, comfortable → tenor ≥ 3× less likely)
  - `test_tessitura_neutral_when_not_comfortable`
  - `test_tessitura_neutral_without_usable_pitch`
  - `test_posterior_stays_valid_with_extreme_pitch`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice-model): comfortable songs' sung percentiles count as tessitura evidence`.

### Task E3: Mic test as a range-shaped prior, robust to a biased mic
**Files.** Modify `model.py` (`from_profile`, `_type_prior`), `weights.py`. Test `test_model.py`.

**Interface.**
- For `method in ("mic", "session")` with comfort present, the weight is `w(h) = PRIOR_FLOOR + (1 − PRIOR_FLOOR) · exp(−(centre(h) − (profile_centre + MIC_BIAS))² / (2·PRIOR_SD²))` over all 30 hypotheses.
- Starting values: `PRIOR_FLOOR = 0.25`, `PRIOR_SD = 3.0`, `MIC_BIAS = +1.0` for mic and 0 for session.
- `self` and register-only profiles are unchanged.
- `VoiceProfileLike` gains optional `comfort_low` / `comfort_high`, read with `getattr`.

**Steps.**
- [ ] Failing tests:
  - `test_mic_prior_peaks_at_shifted_centre`
  - `test_mic_prior_never_below_floor`
  - `test_wrong_mic_type_recoverable_in_3_songs`
  - `test_self_prior_unchanged`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice-model): mic/session prior centred on the measured comfort (bias-corrected, floored)`.

### Task E4: Selection separates the top two and prefers songs you know and like
**Files.** Modify `karaoke_decide/voice_session/select.py`, `weights.py`. Test `test_select.py`.

**Interface.**
- **`_separation(p, song)`.** Take the top-2 voice types A and B. Return the TV distance between `P(position | A)` and `P(position | B)` (each a posterior-weighted mixture over shifts), times `P(A) + P(B)`.
- **Score.** `like(c) · c.know · ((1 − SEP_WEIGHT)·EIG + SEP_WEIGHT·_separation) − stratum_penalty`:
  - `like(c) = LIKE_BASE + (1 − LIKE_BASE) · max(c.pref, 1.0 if c.loved else 0.0)`;
  - `SEP_WEIGHT = 0.5`, `LIKE_BASE = 0.6`;
  - `PREF_WEIGHT` is removed.
- `_familiarity` is multiplied by `like(c)`.
- The first song is unchanged, but its familiar pool is now taste-weighted.

**Steps.**
- [ ] Failing tests:
  - `test_separation_prefers_song_between_top_two_centres`
  - `test_equal_information_prefers_liked_known_song`
  - `test_loved_song_counts_as_liked`
  - `test_cold_filter_still_applies`
  - update existing cases only where scores change by design
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice-select): pick songs that split the top two voices, among songs you know and like`.

### Task D1: Session comfort from songs you rated comfortable
**Files.**
- Create `karaoke_decide/voice_session/comfort.py`.
- Modify:
  - `stopping.py` (`ResultSummary`, `summary`)
  - `backend/services/voice_session_service.py`
  - `backend/services/voice_session_outputs.py` (`session_profile`)
  - `backend/models/voice_session.py` (`ResultOut.comfort_source`, `SessionResultSummaryOut.comfort_source`)
- Test `test_comfort.py`, `test_stopping.py`, `backend/tests/test_voice_session_outputs.py`.

**Interface.**
- **`measured_comfort(evidence) -> tuple[float, float] | None`** returns the `voiced_s`-weighted means of p10 and p90 over attempts that are:
  - rated `quiz.position == "comfortable"`;
  - backed by `usable_pitch`;
  - known (`knew != "barely"`);
  - not excluded.
  - Pitch is shifted to the singer's own octave.
  - It needs ≥ `MEASURED_MIN_SONGS = 2` songs and ≥ `MEASURED_MIN_VOICED_S = 60` in total; otherwise it returns None.
- **`summary(state, done_reason, evidence=())`.** With a measured comfort it uses comfort = round(measured), clamped inside `post.full_estimate()`, and `comfort_source = "measured"`. Otherwise it uses the posterior mean and `"model"`.
- `SessionState` gains `evidence`, filled by `rebuild_state` and by the sim.

**Steps.**
- [ ] Failing tests:
  - `test_measured_comfort_weights_by_voiced_seconds`
  - `test_measured_needs_two_comfortable_songs`
  - `test_measured_ignores_too_high_and_barely`
  - `test_summary_uses_measured_and_clamps_to_full`
  - `test_session_profile_saves_measured_comfort`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): comfortable range measured from the songs you rated comfortable`.

### Task E5: Tune weights against the simulation, then gate
**Files.** Create `scripts/voice/sim_grid.py`. Modify `weights.py` and `docs/VOICE-SESSION-TUNING.md`. Test `test_simulate.py`, `test_replay.py`.

**Grid.** Coordinate-wise search over:
- `W_PITCH_HEADPHONES` {1.5, 2, 3}
- `W_TESSITURA` {1, 2, 3}
- `TESS_SD` {2.5, 3, 4}
- `PRIOR_SD` {2.5, 3, 4}
- `SEP_WEIGHT` {0.3, 0.5, 0.7}
- `LIKE_BASE` {0.5, 0.6, 0.8}

The objective is `exact_at[5]` (mic prior, headphones), with no regression of the existing gates.

**Gate tests.**
- **`test_converges_within_5_songs_mic_prior_with_pitch`** (seed `20261025`, n = 300):
  - mic prior with headphone pitch: `exact_at[5] ≥ 0.70`, `adjacent_at[5] ≥ 0.92`, `confident_within[5] ≥ 0.50`;
  - open-mic pitch: `exact_at[5] ≥ 0.60`.
- **`test_quiz_only_budget_report`** (uniform prior, no pitch) is not gated; it prints `exact_at[3..5]`.
- **`test_simulated_users_converge`** (existing) still passes.
- **`test_andrew_replay`**: the fixture with notes ≥ 69 relabelled as falsetto (`held_high` capped below 69, percentiles kept). After 4 songs it must give **baritone**, `confidence_label ∈ {medium, high}`, and comfort within ±2 of (49, 59).

**Steps.**
- [ ] Write the gates → FAIL.
- [ ] Run the grid, pick values, update `weights.py`, and record the before/after in the tuning doc. Tests → PASS.
- [ ] If 70% can't be reached without regressing the existing gates:
  - commit the best values;
  - mark the gate `xfail(strict=False)` with the measured number;
  - write the gap and the next levers in the tuning doc.
  - Never loosen existing gates silently.
- [ ] Commit `tune(voice): weights for 3–5 song convergence (exact@5 X%, Andrew replay: baritone/medium)`.

### Task E6: Service wiring, docs, version
- [ ] Failing test `test_result_reports_measured_comfort_source`.
- [ ] Pass `evidence` / `comfort_source` through `result()`, `recompute_result` and `result_summary`.
- [ ] Update `docs/API.md` and bump `pyproject.toml` to 0.32.0.
- [ ] Run `make test-unit test-backend lint`.
- [ ] Commit `feat(voice): result carries comfort source (v0.32.0)`.
- [ ] `/coderabbit` → `/pr` → merge → deploy.

---

## Part C: decide PR 4 "Falsetto" (v0.33.0)

### Task C1: Note labels on attempts; chest-only pitch
**Files.** Modify `backend/models/voice_session.py`, `backend/services/voice_session_service.py` (`add_attempt` stores the new fields; `history` counts `falsetto_notes`), `docs/API.md`. Test `backend/tests/test_voice_session_routes.py`.

**Produces.**
- **`NoteLabelIn(_Request){t_start: float (0..3600), t_end: float, midi: float, label: Literal["falsetto","full","unsure"], source: Literal["live","quiz"]}`**, with the validator `t_end ≥ t_start`.
- **`AttemptIn.note_labels`**: up to 40 labels.
- **`AttemptIn.pitch_all: PitchSummaryIn | None`**: the unfiltered summary.
- **Contract change:** `pitch` is now chest-only (falsetto spans removed by the app). Old apps send unfiltered `pitch` without labels, which is accepted.
- Both new fields are stored on `voice_attempts` and erased by `erase_voice_data`; assert this in `test_user_deletion.py`.

**Steps.**
- [ ] Failing tests:
  - `test_attempt_accepts_note_labels_and_pitch_all`
  - `test_note_labels_reject_extra_keys`
  - `test_note_labels_cap_40`
  - `test_history_counts_falsetto_notes`
  - `test_erase_voice_data_removes_labels`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): per-note falsetto labels on attempts; pitch is chest-only`.

### Task C2: Falsetto range and singing background in the profile and result
**Files.** Modify:
- `voice_profile_service.py`
- `voice_session_outputs.py`
- `stopping.py` (`ResultSummary.falsetto_high`)
- `voice_session_service.py`
- `models/voice_session.py`
- `recs_v2/service.py` (verify `RecVoice` ignores the new keys)

Test `test_voice_routes.py`, `test_voice_session_outputs.py`, `test_stopping.py`.

**Interface.**
- **`VoiceProfileIn`** gains `falsetto_high: int | None`, `falsetto_low: int | None`, `experience: Literal["none","some","trained"] | None` and `uses_falsetto: Literal["yes","sometimes","no","unsure"] | None`.
  - Validator: `falsetto_high ≥ low_midi`.
  - The public PUT accepts these for mic and self profiles.
- **`ResultSummary.falsetto_high`** = max midi of the non-excluded notes labelled `falsetto`.
- **`ResultOut.falsetto_high`** and **`SessionResultSummaryOut.falsetto_high`** carry it.
- `session_profile` copies `falsetto_high`, plus `experience` / `uses_falsetto` from setup.

**Steps.**
- [ ] Failing tests:
  - `test_profile_accepts_falsetto_and_background`
  - `test_session_result_reports_falsetto_high`
  - `test_excluded_attempt_falsetto_ignored`
  - `test_old_profile_without_fields_still_validates`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): falsetto range and singing background in the voice profile`.

### Task C3: Setup background questions and the comfort estimate for the live chip
**Files.** Modify `backend/models/voice_session.py` (`SessionSetup`, `SessionPatch`, `NextSongOut`), `voice_session_service.py` (`_offer`). Test `test_voice_session_routes.py`.

**Interface.**
- `SessionSetup` / `SessionPatch` gain optional `experience` and `uses_falsetto`, stored in `voice_sessions.setup`.
- **`NextSongOut.comfort_estimate: ComfortEstimateOut | None`**, where `ComfortEstimateOut{low, high, sd_high, source: Literal["measured","model","profile"]}`.
  - It uses the measured comfort when available, otherwise the posterior mean and SD (`stopping._comfort_sd`).
  - `"profile"` means 0 evidence attempts plus a prior profile that has comfort.

**Steps.**
- [ ] Failing tests:
  - `test_setup_accepts_background`
  - `test_next_song_carries_comfort_estimate`
  - `test_comfort_estimate_source_profile_on_first_song`
- [ ] Run → FAIL. Implement → PASS.
- [ ] Commit `feat(voice): setup asks singing background; next song carries the chest comfort estimate`.

### Task C4: Docs, version, ship
- [ ] Update `docs/API.md` and ARCHITECTURE.md § Personal data (note labels, `pitch_all`).
- [ ] Bump to 0.33.0 and run `make test-unit test-backend lint`.
- [ ] Commit, then `/coderabbit` → `/pr` → merge → deploy.

---

## Part M: mobile PR 3 "Recordings and both results on Me" (after decide PR 1 is deployed)

Worktree: `nomad-mobile-voice-me-recordings`. Rebase on PR #20 and on Phase 4; don't touch `music-profile.tsx`.

### Task M0: Spec addendum
- [ ] Add §10c to the 3d spec: the decisions, the open-question defaults and the gates from this plan, and copy this plan to `docs/superpowers/plans/2026-10-25-mobile-phase3d-tuning-batch-1.md`.
- [ ] Commit `docs(3d): §10c tuning batch 1`.

### Task M1: API client
**Files.** Modify `packages/api-decide/src/voiceSession.ts`, `voice.ts`, and the generated client. Test `packages/api-decide/src/__tests__/voiceSession.test.ts`.

**Produces.**
- `getVoiceHistory()`
- `voiceRecordingAudioUrl(id)`
- `deleteVoiceRecording(id)`
- `patchVoiceAttempt(attemptId, { excluded })`
- `adoptVoiceSession(sessionId)`
- `getVoiceProfiles()` (full response; `getVoiceProfile` stays)
- `VOICE_ERROR_CODES` gains `recording_deleted` and `no_evidence`.
- `isTerminalUploadError` is true for 409 `recording_deleted`.

**Steps.**
- [ ] Failing tests: `encodeURIComponent` of ids containing `:`, and `recording_deleted is terminal`.
- [ ] Implement → PASS.
- [ ] Commit `feat(api-decide): voice history, user playback, exclude, delete one, adopt`.

### Task M2: Shared playback hook (can start early)
**Files.** Create `apps/mobile/src/voiceSession/recording/useRecordingPlayback.ts`, moved from `debug/useVoiceDebug.ts`. Modify `debug/useVoiceDebug.ts` and `debug/VoiceDebugScreen.tsx`. Test `apps/mobile/src/voiceSession/__tests__/useRecordingPlayback.test.ts`.

**Interface.** `useRecordingPlayback(urlFor)` returns `{state, play(id, opts?: {fromS?, toS?, localUri?}), stop()}`.
- `localUri` plays a phone file without a download.
- `fromS` / `toS` seek and auto-stop.
- The temp-file deletion rules are unchanged.

**Steps.**
- [ ] Failing tests:
  - `downloads with bearer then plays`
  - `localUri skips download`
  - `stops at toS`
  - `deletes temp file on next play/unmount`
  - the debug screen tests still pass
- [ ] Implement → PASS.
- [ ] Commit `refactor(voice): shared recording playback hook (debug and Me)`.

### Task M3: "Your recordings" becomes a session/song list with ▶, Don't count, Delete
**Files.**
- Modify `apps/mobile/src/voiceSession/RecordingsSection.tsx` and `recording/recordingQueue.ts` (add `dropAttempt(sessionId, attemptN)`).
- Create:
  - `RecordingRow.tsx`
  - `useVoiceHistory.ts`, with query key `['voiceSession','history', email]`, invalidated by `onRecordingsUploaded`, by exclude/delete, and on focus
- i18n under `voiceSession.recordings.*`.
- Test `RecordingsSection.test.tsx`, `recordingQueue.test.ts`.

**Behaviour.**
- Sessions are grouped by date (`vs-rec-session-<i>`), each with a result chip.
- Each row `vs-rec-<i>-<n>` shows the title and artist (isolated) and its Counted / Not counted state, with these controls:
  - ▶ `vs-rec-<i>-<n>-play`, shown only when there is a recording;
  - `vs-rec-<i>-<n>-exclude`, a toggle with a confirm. It explains that the result is worked out again, then shows the server's `profile` outcome;
  - `vs-rec-<i>-<n>-delete`, with a confirm. It calls `dropAttempt` first, then `deleteVoiceRecording`.
- Takes still queued show "Uploading…" (`-pending`).
- The count, "Delete all" and the record-default switch stay unchanged.
- After an exclude, invalidate `VOICE_KEY` and `RECS_KEY`.

**Steps.**
- [ ] Failing tests:
  - `lists sessions and songs from history`
  - `play downloads and plays own recording`
  - `exclude confirms, patches, refetches voice and recs`
  - `delete confirms, drops queued take first, then calls API`
  - `pending upload row shown`
  - `failure shows error and keeps row`
- [ ] Implement, translate → PASS.
- [ ] Maestro: add `voice-session-4-me-recordings.yaml` (seed-history, then play, exclude and delete one) and update `voice-session-3-delete-recordings.yaml`.
- [ ] Commit `feat(me): your sessions and recordings: listen, don't count, delete one`.

### Task M4: Me shows the mic result and the latest session result
**Files.** Modify `apps/mobile/src/voice/VoiceProfileSection.tsx` and `useVoiceProfile.ts` (keep `mic` and `latestSession` from `getVoiceProfiles`). Create `VoiceResultCard.tsx`. i18n under `fit.profile*`. Test `VoiceProfileSection.test.tsx`.

**Behaviour.**
- **Two cards:**
  - `voice-card-mic` ("From your mic test"): type, range, comfort, date;
  - `voice-card-session` ("From your voice session"): type or "between", confidence, comfort, song count, date.
- **Active profile.** The card behind the active profile carries `voice-active-badge` ("Used for song fit").
- **Unsaved session.** It shows "Not saved as your voice: we need more songs to be sure", with `voice-session-adopt` ("Use this as my voice") → adopt, then refetch `VOICE_KEY` and `RECS_KEY`.
- With one source there is one card; with none, the current empty state.
- Redo, Remove and the `voice-section-*` testIDs stay.

**Steps.**
- [ ] Failing tests:
  - `shows mic and low-confidence session side by side`
  - `active badge on the profile's source`
  - `adopt saves and refetches`
  - `only mic`, `only session`, `none`
- [ ] Implement, translate → PASS.
- [ ] Maestro: add `voice-me-both-results.yaml`.
- [ ] Commit `feat(me): your voice shows the mic test and the latest session, with confidence; adopt a session result`.
- [ ] Rebase on Phase 4. Run the full tests and the Maestro flows.
- [ ] `/coderabbit` → `/pr` → merge. Build a release APK for Andrew.

---

## Part M (cont.): mobile PR 5 "Falsetto and setup background" (after decide PR 4 is deployed)

### Task M5: Pure falsetto core (can start on day one)
**Files.** Create `packages/core/src/voice/session/falsetto.ts` and `contour.ts`, plus exports. Test `__tests__/falsetto.test.ts`, `contour.test.ts`.

**Produces.**
- **Types:**
  - `NoteLabel = 'falsetto' | 'full' | 'unsure'`
  - `FalsettoCandidate = { tStart; tEnd; midi }`
  - `LabelledNote = FalsettoCandidate & { label; source: 'live' | 'quiz' }`
- **`falsettoOffset(usesFalsetto)`** → 3 for yes, 4 for sometimes, 5 for no, 4 for unsure or null.
- **`createFalsettoDetector({ chestTop: number | null; offset; minHoldS = 0.6; cooldownS = 20 })`** returns:
  - `push(note: HeldNote) → FalsettoCandidate | null`, a candidate when `note ≥ chestTop + offset`, held ≥ `minHoldS`, and the cooldown since the last shown chip has passed;
  - `all()`, every qualifying note, including the ones the cooldown suppressed.
- **`PitchContour = { t0; dt; midi: (number | null)[] }`** at 10 Hz, built by `contourFrom(frames)`.
- **`chestSummary(contour, held, labels) → PitchSummary | null`:**
  - drops `falsetto` spans (±0.2 s);
  - drops `unsure` notes from the held bounds only;
  - uses the same thresholds as `summarizeSongPitch`.
- **`toNoteLabelsIn(labels)`.**

**Steps.**
- [ ] Failing tests:
  - `candidate when held ≥ chestTop + offset for ≥ 0.6 s`
  - `cooldown 20 s between shown chips but all() keeps both`
  - `no chestTop → no candidates`
  - `chestSummary removes falsetto span from percentiles and held_high`
  - `unsure kept in percentiles, not in bounds`
  - `contour summary within 0.5 st of frame summary`
- [ ] Implement → PASS, with coverage ≥ 90%.
- [ ] Commit `feat(core): falsetto candidate detector and chest-only pitch summary`.

### Task M6: Recorder exposes live held notes, contour and take offset
**Files.** Modify `apps/mobile/src/voiceSession/recording/useSongRecorder.ts` and `sessionStore.ts`. Persist `contour`, `held`, `noteLabels`, `candidates` and `takeOffsetS`, including in `toStored` and in `FRESH_SONG` in `useVoiceSession.ts`. Test `useSongRecorder.test.ts`.

**Interface.**
- `SongRecorderOptions.onHeldNote?(n)`, fed by `createHeldNoteTracker`; each note is emitted once.
- `SongTake` gains `contour`, `held` and `takeOffsetS`: the stream time when the AAC recorder started (0 for WAV).

**Steps.**
- [ ] Failing tests:
  - `emits each held note once`
  - `take carries contour, held and takeOffsetS (aac starts after stream)`
  - `session store persists and restores contour/labels`
- [ ] Implement → PASS.
- [ ] Commit `feat(voice-session): recorder reports held notes live and keeps a compact contour`.

### Task M7: Live falsetto chip during play (never pauses the video)
**Files.**
- Create `apps/mobile/src/voiceSession/FalsettoChip.tsx`.
- Modify:
  - `screens/PlayScreen.tsx`
  - `useVoiceSession.ts`: a detector per song, plus `answerFalsetto(c, label)`. The chest top is chosen in this order:
    1. `song.comfort_estimate.high`, when `sd_high ≤ 3` or the estimate's source isn't `'model'`;
    2. otherwise the local `voiceStore` `comfortHigh`;
    3. otherwise null.
- i18n under `voiceSession.falsetto.*`.
- Test `FalsettoChip.test.tsx`, `useVoiceSession.test.ts`.

**Behaviour.**
- `vs-falsetto-chip` reads "High note: falsetto?" with the note name, and has `vs-falsetto-yes` / `vs-falsetto-no`.
- It auto-hides after 5 s; an unanswered candidate goes to the quiz.
- It uses `accessibilityLiveRegion="polite"`, never takes focus, and never calls the player.
- It never covers Stop early.
- Answers are stored with `source: 'live'`.

**Steps.**
- [ ] Failing tests:
  - `chip appears for a candidate and hides after 5 s`
  - `yes records live falsetto label`
  - `no chip without a chest reference`
  - `player never paused by chip`
  - `two candidates within 20 s show one chip`
- [ ] Implement, translate → PASS.
- [ ] Maestro: add a synthetic held high-tone section to the fake-mic generator and `FAKE_MIC_SECTIONS`. Update `voice-session-1-full.yaml` so the chip appears and gets a Yes.
- [ ] Commit `feat(voice-session): live "High note: falsetto?" chip while singing`.

### Task M8: Quiz catch-up with replay; chest-only summary and labels on submit
**Files.** Create `screens/FalsettoCatchUp.tsx`. Modify `screens/QuizScreen.tsx` and `useVoiceSession.ts`: `postAttempt` sends `pitch = toPitchIn(chestSummary(...))`, `pitch_all` and `note_labels`. i18n. Test `FalsettoCatchUp.test.tsx`, `useVoiceSession.test.ts`.

**Behaviour.**
- `vs-falsetto-catchup` sits at the top of the quiz when there are unanswered candidates. It shows at most 3 rows (`vs-falsetto-q-<k>`, highest first).
- Each row shows the note (isolated) and its `m:ss`, and has:
  - ▶ `vs-falsetto-q-<k>-play`, which replays the **local take** through `useRecordingPlayback.play(id, { localUri, fromS: tStart − takeOffsetS − 0.5, toS: tEnd − takeOffsetS + 0.5 })`;
  - Yes / No / Not sure.
- It is optional and never blocks submit.
- ▶ is hidden when there is no take (no consent) or the file is missing.
- Moment-level replay of an already uploaded take is out of scope; Me ▶ plays the whole take.

**Steps.**
- [ ] Failing tests:
  - `catch-up lists unanswered candidates, max 3`
  - `replay plays local take segment with offset`
  - `no ▶ without take`
  - `submit sends chest-only pitch, pitch_all and note_labels`
  - `submit without answering still works`
  - `restore after kill keeps labels`
- [ ] Implement, translate → PASS.
- [ ] Maestro: `voice-session-2-quiz-only.yaml` asserts the catch-up, taps "Not sure" and submits.
- [ ] Commit `feat(voice-session): quiz asks about missed high notes with replay; chest-only pitch sent`.

### Task M9: Setup asks about singing background
**Files.** Modify `screens/SetupScreen.tsx` and `setupOptions.ts`. Create `backgroundDefault.ts` (MMKV `voiceSession.background.v1`, cleared on sign-out next to `recordDefault`). i18n. Test `SetupScreen.test.tsx`.

**Behaviour.** An optional, collapsible "About your singing" block:
- experience: `vs-setup-experience-none|some|trained`;
- "Do you use falsetto or head voice?": `vs-setup-falsetto-yes|sometimes|no|unsure`.

The answers are prefilled from last time, sent in `SessionSetup`, and feed `falsettoOffset`.

**Steps.**
- [ ] Failing tests:
  - `background optional, sent when answered`
  - `prefilled from last session`
  - `cleared on sign-out`
- [ ] Implement, translate → PASS.
- [ ] Maestro: `common/voice-session-setup.yaml` taps one answer for each.
- [ ] Commit `feat(voice-session): optional singing background and falsetto question at setup`.

### Task M10: Mic test asks whether the top note was falsetto
**Files.**
- Modify `apps/mobile/src/voice/useVoiceTest.ts`: a new step `high-falsetto` after `high` commits, when there is a top held note.
- Modify `VoiceTestScreen.tsx` and `voiceStore.ts`: `profileFromResult(range, c, measuredAt, falsetto?)`, and `VoiceProfileInBody` gains `falsetto_high`.
- i18n under `voice.highFalsetto*`.
- Test `useVoiceTest.test.ts`, `voiceProfile.test.ts`.

**Behaviour.**
- The step asks "Was your top note falsetto or head voice (lighter, breathier)?" with `voice-high-falsetto-yes|no|unsure`, and can be skipped.
- On Yes:
  - `falsettoHigh = top`;
  - `highMidi` = the highest held note in the high step that is ≥ 2 semitones below the top. If there is none, use `top − 3`, clamped so that `comfortHigh ≤ highMidi`.
  - Comfort is recomputed (11 keys).
- The type is classified on the chest range only.
- The PUT sends `falsetto_high`. If decide answers 422 `extra_forbidden` (an old local stack), `sendPendingVoice` drops the field.

**Steps.**
- [ ] Failing tests:
  - `asks after high step when a top note exists`
  - `yes moves top to falsettoHigh and lowers highMidi`
  - `skip keeps today's behaviour`
  - `PUT body includes falsetto_high`
- [ ] Implement, translate → PASS.
- [ ] Maestro: `voice-1-test.yaml` taps "No".
- [ ] Commit `feat(voice-test): ask if the top note was falsetto; keep it out of the chest range`.

### Task M11: Result screen: falsetto, comfort source, adopt, taste copy
**Files.** Modify `screens/ResultScreen.tsx` and i18n. Test `ResultScreen.test.tsx`.

**Behaviour.**
- `vs-result-falsetto` ("Falsetto up to A4").
- `vs-result-comfort-source` ("Measured from the songs you found comfortable" / "Estimated").
- When the profile isn't saved: `vs-result-adopt` ("Use this as my voice").
- The suited heading becomes "Songs you like that suit you".

**Steps.**
- [ ] Failing tests: falsetto line, measured vs estimated copy, adopt when not saved.
- [ ] Implement, translate → PASS.
- [ ] Maestro: `common/voice-session-finish.yaml` asserts the comfort source.
- [ ] Commit `feat(voice-session): result shows falsetto range, how comfort was found, and adopt`.
- [ ] Run the full tests and every `voice-*` Maestro flow.
- [ ] `/coderabbit` → `/pr` → merge. Build a release APK for Andrew's second session.

---

## Acceptance gates (whole batch)

1. **Simulation (E5).** Mic prior with headphone pitch, seed `20261025`, n = 300:
   - exact type within 5 songs ≥ 70%;
   - adjacent type within 5 songs ≥ 92%;
   - confident stop within 5 songs ≥ 50%;
   - open-mic pitch: exact within 5 ≥ 60%.
   - The existing 10-song gates still pass.
   - Quiz-only and uniform-prior numbers are reported.
2. **Andrew replay (E5).** His four songs from 2026-10-25, with notes ≥ A4 labelled falsetto → baritone, at medium or high confidence, with comfort within ±2 of 49–59.
3. **Andrew's second session (manual).**
   - 3–5 songs reach medium or better;
   - Me shows both cards;
   - the falsetto chip fires on falsetto-range high notes and not on chest notes;
   - he can play, exclude and delete a take, and the result updates after an exclude.
4. **Privacy.**
   - Deleting one recording removes the GCS object.
   - Another user's ids give 404.
   - The registry guard and deletion tests are green.
   - No new collections.
