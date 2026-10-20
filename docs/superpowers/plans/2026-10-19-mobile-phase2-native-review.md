# Mobile Phase 2 — Native Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1's web-review bridge with a phone-first native lyrics and instrumental review. It runs on gen's existing review endpoints, and its logic lives in a platform-free `@nomad/review-core` that gen web can share later.

**Architecture:**
- **Pure logic:** `packages/review-core` holds the review model, edit operations, timing rules, Tap To Sync state machine, issues, recommendation and peaks. It is ported from gen `frontend/lib/lyrics-review` and `frontend/hooks/useManualSync.ts`, with parity tests.
- **API:** `packages/api-gen` gets zod overrides and review facades.
- **UI primitives:** `packages/ui` gets an interactive waveform, a list ref and a sheet.
- **App:** `apps/mobile/src/review/` holds the screens, store, audio hooks and the `/review/[id]` route.
- **Gen:** one PR adds local-stack knobs (fixtures, backing, late stems, auto-approval, complete failure) so Maestro can drive every state.

**Tech Stack:**
- Expo SDK 57 (RN 0.86), expo-audio (new), expo-video, Skia and FlashList via `@nomad/ui`
- Zustand + MMKV, TanStack Query, zod, use-intl
- jest-expo + RNTL, Maestro
- gen: FastAPI fake workers (Python, pytest)

**Spec:** `docs/superpowers/specs/2026-10-19-mobile-phase2-native-review-design.md` (read it and its Appendix A before every task)

## Global Constraints

- No JSX string literals: every user-facing string goes through `useTranslations()` with keys under `review.*` in `packages/i18n/messages/en.json`. All 33 locales are translated before the PR (`env -u GEMINI_API_KEY pnpm i18n:translate`, then `pnpm i18n:check`).
- Every interactive element gets a `testID`, prefixed `review-`.
- `@shopify/flash-list` and `@shopify/react-native-skia` are imported only inside `packages/ui`.
- `packages/review-core` imports nothing from `react`, `react-native`, `expo-*`, DOM or Node built-ins. It is type-checked with `lib: ["ES2022"]` and no `dom`, and needs ≥ 90% line coverage.
- API clients never touch storage. Drafts live in MMKV (`apps/mobile/src/storage.ts`) and never contain media URLs or tokens.
- Native deps are installed with `cd apps/mobile && npx expo install <pkg>`. Read the SDK 57 docs (`npx ctx7@latest docs /websites/expo_dev_versions_unversioned "<q>"`) before using expo-audio or expo-video APIs.
- Retry policy for transient errors (5xx, 429, network): 5, 15, 30, 60 s, honouring `Retry-After`. A 404 is final. Error copy never says "access denied".
- **Tap To Sync constants:**
  - lead-in 3 s;
  - clamp to the segment ±3 s, floor 0;
  - gap-fill cap 1.0 s;
  - overlap buffer 0.01 s;
  - stop at line end + 1 s unless holding.
- **Nudge steps:** 0.05 s for a word, 0.1 s for a line. Minimum word length 0.05 s.
- **Polls:**
  - stems: every 15 s for up to 10 min;
  - preview: every 3 s for up to 5 min, with the cold-encoder copy after 30 s;
  - encoder heartbeat: every 60 s.
- Finish is three calls: `POST /api/jobs/{id}/corrections` → `GET correction-data` → `POST /api/review/{id}/complete`. Send `is_duet ?? false`. Send `instrumental_selection` `auto` only when the backing verdict was confident and unchanged.
- Mobile CLAUDE.md gotchas apply. In particular, tests never go under `src/app`.

## Review Focus

1. **A correction doc with fields the app doesn't model** (replay, correction_steps, unknown future keys). It must round-trip unchanged. Test in Task 2: `toSubmission` preserves unknown keys.
2. **A segment whose words are all null-timed, or a word with `end < start`, from an older job.** It must render (no NaN, no crash), count as untimed and block Finish. Test in Task 2 and Task 11.
3. **The app is killed mid-edit, then reopened after gen's doc changed** (a different `audio_hash`). The draft must not be applied to a different audio. Test in Task 9.
4. **Double-tapping "Make my video", or a network drop between call 1 and call 3.** It must not submit twice; a retry resumes safely (calls are idempotent on gen). Test in Task 13.
5. **A Hebrew line inside an English song, or an English line in an RTL locale.** Direction comes from the line text, not the app locale. Test in Task 5 (`lineDirection`) and Task 10.

---

## Part A: gen local stack (repo `karaoke-gen`, its own worktree)

Create the worktree with `/startnomad gen mobile review fixtures` (branch `feat/sess-…-mobile-review-fixtures`). Follow gen CLAUDE.md (version bump in `pyproject.toml`, tests). Merge it before Part C's Maestro runs, or point `GEN_DIR` at the worktree.

### Task 1: Gen fake review fixtures and knobs

**Files:**
- Modify: `backend/services/fake_workers/config.py` (new `FakeConfig` fields plus validation)
- Modify: `backend/services/fake_workers/lyrics.py` (fixture builders)
- Modify: `backend/services/fake_workers/media.py` (envelope, audible backing variant)
- Modify: `backend/services/fake_workers/pipeline.py` (stems delay, auto_approval write)
- Modify: `backend/services/fake_workers/scenarios.py` (scenario `job_awaiting_review` honours the per-user `review_mode`)
- Modify: `backend/api/routes/review.py` (`/audio` dev-proxy branch → `_ranged_response`; complete-fail-once hook only when `FAKE_WORKERS=1`)
- Modify: `backend/api/routes/test_support.py` (`GET /api/test/jobs/{job_id}/review-result`)
- Modify: `docs/TESTING.md` § Local stack (document the knobs)
- Test: `backend/tests/fake_workers/test_review_fixtures.py`, plus the existing fake-worker tests

**Interfaces:**
- Produces new `FakeConfig` fields (per-user, defaults keep today's behaviour):
  - `review_fixture: str = "default"`: one of `default | corrections | duet | rtl | large`;
  - `backing_vocals: str = "silent"`: `silent | audible`;
  - `stems_delay_seconds: float = 0` (0–600);
  - `review_mode: str = "always_review"`: `always_review | auto`;
  - `auto_approval: str = "none"`: `none | lyrics_confident | backing_confident | both_unsure`;
  - `review_complete_fail_once: bool = False`.
- Produces `GET /api/test/jobs/{job_id}/review-result` → `{status, instrumental_selection, is_duet, lines: [{text, singer, words: [{text, start_time, end_time}]}]}`. It reads the corrected lyrics the review saved.

- [ ] **Step 1: Write failing tests** in `test_review_fixtures.py`:
  - `test_fixture_corrections_shape`: the built doc round-trips through `CorrectionResult.from_dict`. It has ≥ 1 word with `ai_corrected` and `original_text`, ≥ 1 `timing_estimated`, exactly one word with `start_time is None`, one word longer than 2 s, and `vocal_gaps.gaps[0].evidenced is True` with `synced_reference_lines`. `metadata.auto_approval.undo_info` holds the span.
  - `test_fixture_duet`: `is_duet is True`, and the segment singers include 1, 2 and 0.
  - `test_fixture_rtl`: every line has a Hebrew character and one line has an Arabic character (`؀-ۿ`).
  - `test_fixture_large`: 300 segments, ≥ 2,000 words, timings increasing.
  - `test_backing_audible_recommends_backing`: the real `_analyze_backing_vocals` on the audible stem gives `has_audible_content is True`.
  - `test_auto_approval_knob_writes_summary`: with `auto_approval="lyrics_confident"` and `review_mode="auto"`, `correction-data`'s `auto_approval.lyrics.confident is True`.
  - `test_stems_delay`: with `stems_delay_seconds=2`, the job reaches `awaiting_review` while `instrumental-urls` says `audio_complete: false`, then `true` after the delay.
  - `test_complete_fail_once`: the first `POST /review/{id}/complete` gives 503, the second 200.
  - `test_audio_range`: `GET /review/{id}/audio` with `Range: bytes=0-99` gives 206.
  - `test_review_result_endpoint`: returns the shape above after a complete.
- [ ] **Step 2: Run** `pytest backend/tests/fake_workers -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - **Fixtures:** extend `_segments` with fixture-specific line tables:
    - Hebrew lines (e.g. "שיר בדיקה קטן", plus one Arabic "أغنية للاختبار");
    - the duet singers cycle `[1, 2, 0]`;
    - `large` generates 300 lines of 6–8 words.
  - The `corrections` fixture copies the shape of gen's real `auto_approval.undo_info` (read `frontend/lib/lyrics-review/utils/autoCorrectApply.ts` `fromServerUndoInfo` for what it must contain).
  - **Media envelope:** ffmpeg `volume='0.3+0.7*abs(sin(t*PI/2))':eval=frame` on the vocal stem and `tremolo` on the mix.
  - **Audible backing:** a 440 Hz tone gated on the 10–20 s window.
  - **Stems delay:** the audio worker sleeps `stems_delay_seconds` before `upload_separation_results`, in a background thread so the lyrics and screens path can reach review first. Check the ordering in `pipeline.py`.
- [ ] **Step 4: Run** `pytest backend/tests/fake_workers backend/tests -q -k "fake or review or test_support"`. Expected: PASS.
- [ ] **Step 5: Smoke.** Run `scripts/local-stack.sh up`, then `curl` a scenario with each fixture. Check `correction-data` and play `instrumental-audio` with `afplay` to confirm the envelope is audible.
- [ ] **Step 6:** Bump the patch version, commit, then `/coderabbit` → `/pr` → merge → wait for deploy (gen CI deploys; the fake code is inert in prod because `FAKE_WORKERS` is unset).

---

## Part B: shared logic and API (repo `nomad-mobile`)

### Task 2: `@nomad/review-core`: types, doc model, sanitize, undo

**Files:**
- Create: `packages/review-core/{package.json,tsconfig.json,tsconfig.nodom.json,jest.config.js,babel.config.js}` (copy `packages/core`'s; `tsconfig.nodom.json` sets `"lib": ["ES2022"]`, `"types": []`)
- Create: `packages/review-core/src/{index.ts,types.ts,doc.ts,timing.ts,undo.ts}`
- Test: `packages/review-core/src/__tests__/{doc,timing,undo}.test.ts`
- Modify: root `package.json` typecheck. Add `"typecheck:review-core-nodom": "tsc -p packages/review-core/tsconfig.nodom.json --noEmit"` and chain it in CI's typecheck job (`.github/workflows/*`).

**Interfaces (Produces):**
- **`types.ts`:** port gen's `Word`, `LyricsSegment`, `SingerId`, `CorrectionData`, `InstrumentalOption`, `BackingVocalsAnalysis`, `VocalGap`, `VocalGapsResult` verbatim (gen `frontend/lib/lyrics-review/types.ts`). Add `[key: string]: unknown` index signatures on `CorrectionData` and `metadata`.
- **`doc.ts`:**
  - `type ReviewDoc = { readonly source: CorrectionData; readonly segments: readonly LyricsSegment[]; readonly isDuet: boolean }`
  - `fromCorrectionData(data: CorrectionData): ReviewDoc`: `segments = data.corrected_segments`, `isDuet = !!data.is_duet`.
  - `toSubmission(doc: ReviewDoc): CorrectionData`: `{...source, corrected_segments: segments, is_duet: isDuet}`.
  - `replaceSegment(doc, index, seg): ReviewDoc`: keeps the other segment object identities.
- **`timing.ts`:**
  - `sanitizeSegment(seg): LyricsSegment`: clamps each word's `end ≥ start`; recomputes segment start and end from the first and last timed word; leaves null-timed words null.
  - `countUntimedWords(segments): number`
  - `firstUntimed(segments): {segment: number; word: number} | null`
  - `clampSyncTime(t: number, segStart: number, segEnd: number): number`: ±3 s, floor 0, copied from gen `useManualSync.ts:35`.
- **`undo.ts`:** `class UndoStack<T> { constructor(limit = 100); push(state: T): void; undo(current: T): T | null; canUndo: boolean; clear(): void }`

- [ ] **Step 1: Write failing tests.**
  - **doc:**
    - `toSubmission(fromCorrectionData(fixture))` deep-equals the fixture with unknown keys `replay`, `foo` preserved;
    - `replaceSegment` keeps `segments[other] === before[other]`.
  - **timing:**
    - `sanitizeSegment` with a word `{start: 5, end: 4.9}` → end 5;
    - a segment with all-null words keeps null bounds, with no NaN;
    - `countUntimedWords` counts nulls only;
    - `clampSyncTime(0.5, 2, 4) === 0.5`, `clampSyncTime(-1, 1, 4) === 0`, `clampSyncTime(9, 2, 4) === 7`.
  - **undo:** 101 pushes → 100 undos available; `undo` returns states LIFO.
  - Fixture: copy a real-shaped doc into `src/__tests__/fixtures/correctionData.json` (from the gen local stack's `corrections` fixture after Task 1, or hand-built from types.ts).
- [ ] **Step 2: Run** `pnpm jest packages/review-core`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the signatures above. Register the package in `pnpm-workspace.yaml` (it uses `packages/*`, so already covered) and `pnpm install`.
- [ ] **Step 4: Run** `pnpm jest packages/review-core && pnpm typecheck && pnpm typecheck:review-core-nodom`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review-core): review doc model, timing sanitize, undo`.

### Task 3: review-core edit operations

**Files:**
- Create: `packages/review-core/src/edits.ts`, `packages/review-core/src/aiRevert.ts`
- Test: `packages/review-core/src/__tests__/{edits,aiRevert}.test.ts`

**Interfaces (Produces).** All are pure, return a new `ReviewDoc`, run `sanitizeSegment` on touched segments and keep the identity of untouched ones. `s` is a segment index and `w` a word index.
- **Words:**
  - `editWordText(doc, s, w, text)`: a text with spaces → `splitWord`; an empty text → `deleteWord`; updates `segment.text`.
  - `deleteWord(doc, s, w)`: deleting the last word deletes the segment.
  - `splitWord(doc, s, w, parts: string[])`: even timing split, `timing_estimated: true`, new ids `${id}_s${k}`.
  - `mergeWords(doc, s, w)`: merges w with w+1; start of w, end of w+1, text joined with a space.
- **Lines:**
  - `applyLineText(doc, s, text): {doc: ReviewDoc; estimated: number}`: an LCS diff on case-folded words keeps matched timings. Unmatched new words are spread evenly between their timed neighbours, marked `timing_estimated`. If there are no timed neighbours, they use the segment bounds.
  - `splitLine(doc, s, w)`: the new segment starts at word w.
  - `mergeLines(doc, s)`: merges s with s+1.
  - `insertLine(doc, afterS, text, start, end)`
  - `deleteLine(doc, s)`
- **Timing:**
  - `shiftLine(doc, s, delta)`: clamped so the line stays after the previous line's last end and before the next line's first start.
  - `setWordTiming(doc, s, w, {start?, end?})`:
    - clamps: start ≥ previous word's end (including the previous line's last word), end ≤ next word's start (including the next line's first word), end ≥ start + 0.05;
    - start ≥ 0 and end ≤ `audioDuration`, when `doc.source.metadata` or the analysis gives it.
- **Duet:**
  - `setLineSinger(doc, s, singer: SingerId)`
  - `setDuet(doc, on: boolean)`: turning it off strips the `singer` fields.
- **AI revert:** `revertAiSpan(doc, spanId): ReviewDoc`, ported from gen `autoCorrectApply.ts` (`fromServerUndoInfo` + `revertSuggestion`), using `source.metadata.auto_approval.undo_info[spanId]`. It returns the doc unchanged if the undo info is missing.

- [ ] **Step 1: Write failing tests**, one `describe` per operation. Port the cases from gen's `frontend/lib/lyrics-review/utils/__tests__/segmentOperations*.test.ts` and `autoCorrectApply*.test.ts`. Add:
  - `applyLineText` "the quick brown fox" → "the quik brown red fox": "the", "brown" and "fox" keep exact timings; "quik" and "red" are estimated, with `estimated === 2`;
  - `setWordTiming` can't cross the next line's first word;
  - `deleteWord` recomputes segment bounds (memory `project_delete_mode_segment_times`);
  - `setDuet(false)` strips singers.
- [ ] **Step 2: Run** `pnpm jest packages/review-core`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS, with coverage ≥ 90% for these files (`pnpm jest packages/review-core --coverage`).
- [ ] **Step 5: Commit.**

### Task 4: review-core Tap To Sync state machine

**Files:**
- Create: `packages/review-core/src/tapSync.ts`
- Test: `packages/review-core/src/__tests__/tapSync.test.ts`

**Interfaces (Produces):**
```ts
type TapSyncState = { segmentIndex: number; wordIndex: number; holding: boolean; done: boolean;
  synced: ReadonlySet<number>; segment: LyricsSegment };
createTapSync(doc: ReviewDoc, segmentIndex: number): TapSyncState
press(state, t: number): TapSyncState     // current word starts at clampSyncTime(t); previous word gap-fill (if it was a tap) applied
release(state, t: number, heldMs: number): TapSyncState // heldMs >= 250 → hold: end = t; else tap: end = gap-fill
shouldStop(state, t: number): boolean     // !holding && t > segEnd + 1
commitTapSync(doc, state): ReviewDoc      // replaces the segment (sanitized)
```
Behaviour comes from gen `useManualSync.ts`:
- A tap's end is `min(nextStart − 0.01, start + 1.0)`, where `nextStart` is used only if the next word is in `synced`. Otherwise it is `start + 1.0` capped by the original next start, and **never** corrected against a stale start.
- A hold keeps its release time.

- [ ] **Step 1: Write failing tests:**
  - a tap sequence at t = 10, 10.4, 10.9 gives starts 10, 10.4, 10.9, with the first two ends filled to 10.39 and 10.89;
  - a hold of 600 ms keeps its release time;
  - a press at t = 0.2 on a segment starting at 5 clamps to 2;
  - a stale next-word start of 10.2 does not truncate a tap at 10.0 (synced is empty);
  - `shouldStop` is false while holding;
  - after the last word, `done` is true;
  - `commitTapSync` gives no word with `end < start`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: review-core issues, gaps, recommendation, steps, direction, peaks, media URLs

**Files:**
- Create: `packages/review-core/src/{issues.ts,vocalGaps.ts,instrumental.ts,steps.ts,direction.ts,peaks.ts,media.ts}`
- Test: one test file per module

**Interfaces (Produces):**
- **`issues.ts`:**
  - `type IssueKind = 'untimed' | 'vocal_gap' | 'ai_corrected' | 'estimated' | 'long_word' | 'long_gap'`
  - `type Issue = { kind: IssueKind; segment: number; word?: number; time: number }`
  - `collectIssues(doc): Issue[]` is sorted by time. It returns one issue per AI span, not per word. Long means > 2 s.
- **`vocalGaps.ts`:**
  - `openVocalGaps(doc): VocalGap[]`: an evidenced or suspect gap stays open while no word overlaps it.
  - `insertGapLines(doc, gap): {doc; insertedAt: number}`: uses `synced_reference_lines` timings when present, else one empty line spanning the gap. Port it from gen `utils/missingLyrics.ts`.
- **`instrumental.ts`:**
  - `type InstrumentalChoice = 'clean' | 'with_backing'`
  - `recommendInstrumental(data: Pick<CorrectionData,'auto_approval'|'backing_vocals_analysis'>): {choice: InstrumentalChoice; confident: boolean}`. The chain and validation are as spec §4.4; an invalid value gives `{choice: 'clean', confident: false}`.
  - `stemsReady(options, audioComplete?: boolean): boolean`: when `audio_complete` is undefined, both stems present means ready.
- **`steps.ts`:**
  - `type ReviewStep = 'lyrics' | 'finish'`
  - `planSteps(data): {steps: ReviewStep[]; showChooser: boolean; chooserCollapsed: boolean}`, as spec §4.1.
- **`direction.ts`:** `lineDirection(text): 'ltr' | 'rtl'`, from the first strong character. The RTL ranges are Hebrew `֐-׿`, Arabic `؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿`.
- **`peaks.ts`:**
  - `decodePeaks(base64: string): Float32Array` (uint8 / 255);
  - `downsamplePeaks(peaks, buckets): number[]` (max per bucket, **fractional** stride `peaks.length / buckets`).
- **`media.ts`:** `mediaUrl(apiBase, path, token): string`. Accepts relative `/api/...` paths and `/instrumental-audio/{id}`-style paths (prefix `/api/review/{jobId}`); appends `token` with the right `?`/`&`.

- [ ] **Step 1: Write failing tests:**
  - issues order on the `corrections` fixture: untimed comes before the AI issues at a later time; sorting is by time with no kind priority. The kind order applies only to the bar's counter label, so test sorting by time.
  - `recommendInstrumental` covers resolved_selection, `review_needed`, no analysis with/without backing, and garbage.
  - `planSteps` covers lyrics confident → `['finish']`, custom instrumental → `showChooser` false, absent → both.
  - `lineDirection('שלום world') === 'rtl'`, `lineDirection('Hi שלום') === 'ltr'`, digits-first.
  - `downsamplePeaks` on 44,100 points into 400 buckets: bucket `i` covers `[i*110.25, (i+1)*110.25)` (no drift: the last bucket includes the final sample).
  - `mediaUrl` for both path styles and an existing query string.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm jest packages/review-core --coverage`. Expected: PASS, ≥ 90% lines.
- [ ] **Step 5: Commit.**

### Task 6: api-gen review overrides and facades

**Files:**
- Run: `pnpm gen:api` (refresh `openapi/gen.json` to current prod gen; commit the regenerated client)
- Create: `packages/api-gen/src/overrides/review.ts`, `packages/api-gen/src/facades/review.ts`
- Modify: `packages/api-gen/src/index.ts` (exports), `docs/gen-untyped-endpoints.md` (mark these as zod-overridden)
- Test: `packages/api-gen/src/__tests__/review.test.ts` (follow the existing facade tests' fetch-mock pattern)

**Interfaces (Produces).** Schemas use `.passthrough()`; `CorrectionDataSchema` checks only `corrected_segments` (array of segments with words) and leaves the rest loose. Facades:
```ts
startReview(jobId): Promise<void>
getCorrectionData(jobId): Promise<CorrectionData>          // type from @nomad/review-core
getInstrumentalUrls(jobId): Promise<{ options: InstrumentalOption[]; audioComplete?: boolean;
  backingAnalysis?: BackingVocalsAnalysis | null; autoApproval?: CorrectionData['auto_approval'] }>
getVocalsPeaks(jobId): Promise<{ status: 'ready'; peaks: string; rate: number } | { status: 'pending'; retryAfter: number }>
getWaveformData(jobId, numPoints = 800): Promise<{ amplitudes: number[]; duration: number }>
saveCorrections(jobId, data: CorrectionData, isDuet: boolean): Promise<void>   // POST /api/jobs/{id}/corrections {corrections:{...data, lines: data.corrected_segments}, is_duet}
completeReview(jobId, data: CorrectionData, selection: 'clean'|'with_backing'|'auto', isDuet: boolean): Promise<{ status: string }>
requestPreview(jobId, data: CorrectionData): Promise<{ status: 'success'|'generating'; previewHash: string }>
getPreviewStatus(jobId, hash): Promise<'ready'|'generating'|'error'>
previewVideoPath(jobId, hash): string
saveReviewSession(jobId, data: CorrectionData, editCount: number): Promise<void>  // trigger 'manual', summary {total_segments,total_words,corrections_made,changed_words:[]}
warmupEncoder(jobId): Promise<void>; encoderHeartbeat(jobId): Promise<void>       // never throw
reportClientEvent(type: 'lyrics_load_failed'|'waveform_slow'|'waveform_failed', detail: Record<string, unknown>): Promise<void> // never throw
```
Check the exact response field names against gen `review.py` (instrumental-urls, vocals-peaks, waveform-data, preview-video) and `jobs.py` (`start-review` body `StartReviewRequest`) before writing the schemas. The names above are what the app consumes; map them in the facade.

- [ ] **Step 1: Write failing tests:**
  - each facade parses a realistic body;
  - `getVocalsPeaks` maps a 202 with `Retry-After: 15` to `{status: 'pending', retryAfter: 15}`;
  - `getCorrectionData` keeps unknown keys;
  - `warmupEncoder` swallows a 500;
  - `saveCorrections` posts `lines`.
- [ ] **Step 2: Run** `pnpm jest packages/api-gen`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm jest packages/api-gen && pnpm gen:api:offline && git diff --exit-code packages/api-gen/src/client`. Expected: PASS, no drift.
- [ ] **Step 5: Commit.** Add the follow-up line to the workspace `BACKLOG.md` under gen ("response_model for review endpoints used by mobile: correction-data, instrumental-urls, vocals-peaks, waveform-data, preview-video, sessions, complete, corrections").

### Task 7: `@nomad/ui`: interactive waveform, List ref, Sheet

**Files:**
- Modify: `packages/ui/src/WaveformCanvas.tsx`, `packages/ui/src/List.tsx`, `packages/ui/src/index.ts`
- Create: `packages/ui/src/Sheet.tsx`
- Test: `packages/ui/src/__tests__/{WaveformCanvas,List,Sheet}.test.tsx`

**Interfaces (Produces):**
- **`WaveformCanvas`** gains:
  - `onSeek?: (fraction: number) => void`, from tap and horizontal pan (gesture-handler `Gesture.Tap` + `Gesture.Pan`, using `runOnJS`);
  - `markers?: {from: number; to: number; color: string}[]` (fractions);
  - `accessibilityLabel?: string`.

  It renders a single Skia `Path` for the bars (exported `buildBarsPath(peaks, w, h): string` SVG path, tested). `buildBars` stays exported.
- **`List`** becomes `forwardRef<ListHandle>`, with `type ListHandle = { scrollToIndex(index: number, opts?: {animated?: boolean; viewPosition?: number}): void }`. New props: `extraData?`, `getItemType?`, `onScrollBeginDrag?`.
- **`Sheet`:**
  - `({visible, onClose, title, testID, children, fullHeight?: boolean})`;
  - built on RN `Modal` (`animationType="slide"`, `transparent`) with a backdrop that closes on tap (`${testID}-backdrop`) and `KeyboardAvoidingView`;
  - no new dependency.

- [ ] **Step 1: Write failing tests:**
  - `buildBarsPath` for `[0.5, 1]` at 10×10 gives two rectangles (`M0 2.5h5v5h-5Z…`);
  - pressing the waveform (fire the `onSeek` test hook via `testID`) calls `onSeek` with x / width; mock the gesture-handler with its jest setup (`react-native-gesture-handler/jestSetup`);
  - the `List` ref's `scrollToIndex` delegates to FlashList (mock);
  - `Sheet` renders children when visible, and a backdrop press calls `onClose`.
- [ ] **Step 2: Run** `pnpm jest packages/ui`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `pnpm lint` (the Skia and FlashList import rule still passes).
- [ ] **Step 5: Commit.**

---

## Part C: the app (repo `nomad-mobile`, `apps/mobile/src/review/`)

### Task 8: expo-audio player hooks (plus the iOS Ogg check)

**Files:**
- Run: `cd apps/mobile && npx expo install expo-audio expo-haptics` (the plugin entry in `app.config.ts` if the docs require it; no recording, so no mic permission)
- Create: `apps/mobile/src/review/audio/useReviewPlayer.ts`, `apps/mobile/src/review/audio/useAbPlayers.ts`, `apps/mobile/src/review/audio/mediaSources.ts`
- Test: `apps/mobile/src/__tests__/review/audio.test.tsx` (mock `expo-audio`)

**Interfaces (Produces):**
```ts
type ReviewSource = 'vocals' | 'song';
useReviewPlayer(jobId: string, opts: { vocalsReady: boolean }): {
  play(): void; pause(): void; toggle(): void; seekTo(t: number): Promise<void>;
  setRate(r: 1 | 0.75 | 0.5): void; rate: number;
  source: ReviewSource; setSource(s: ReviewSource): void;   // vocals falls back to song while !vocalsReady
  playing: boolean; position: number; duration: number;      // position updated at updateInterval 33 ms
  now(): number;                                             // synchronous player.currentTime (Tap To Sync)
  playRange(from: number, to: number): void;                 // seek + play, auto-pause at `to`
  error: string | null }
useAbPlayers(jobId, options: InstrumentalOption[]): {
  active: InstrumentalChoice; setActive(c: InstrumentalChoice): void;  // switch audible stem at same position
  play(); pause(); seekTo(t); playing; position; duration; loading: boolean; error: string | null }
```
`mediaSources.ts` builds the URLs with `mediaUrl(GEN_API_URL, path, token)` (the token comes from the auth store, read in the app layer, not in api-gen). On a player error it calls `getInstrumentalUrls` again, at most 3 times.

The A/B lockstep:
- both players are created;
- the inactive one is `muted`;
- every 1 s, if `|a − b| > 0.25`, seek the muted one to the active one's position.

- [ ] **Step 1: Write failing tests** (mocked players):
  - `setSource('vocals')` while `!vocalsReady` keeps `song`;
  - `playRange` pauses at `to`;
  - in the A/B pair, `setActive('with_backing')` unmutes B and mutes A without seeking A;
  - a drift of 0.4 s triggers a re-seek;
  - an error triggers the URL refresh at most 3 times.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t audio`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Device check (Ogg on iOS).**
  1. Build the dev client: `PATH=/opt/homebrew/bin:$PATH npx expo run:ios`.
  2. Add a temporary `__DEV__` button, or use the review screen once Task 10 exists, to play `instrumental-audio` from the local stack.
  3. Expected: audio plays and seeking works.
  4. **If it fails:** stop, and add a gen task (Task 1b) adding `?format=m4a` to `instrumental-audio`, `audio/vocals` and `audio` (transcode AAC beside the OGG in `audio_transcoding_service.py`). `mediaSources.ts` then appends `format=m4a` when `Platform.OS === 'ios'`.
- [ ] **Step 6: Commit.**

### Task 9: review session store, loader, drafts, stems poll

**Files:**
- Create: `apps/mobile/src/review/store.ts` (Zustand, one store per mounted review via `createReviewStore`, provided by context)
- Create: `apps/mobile/src/review/useReviewLoader.ts`, `apps/mobile/src/review/useStemsPoll.ts`, `apps/mobile/src/review/useEncoderWarmup.ts`, `apps/mobile/src/review/drafts.ts`, `apps/mobile/src/review/retry.ts`
- Test: `apps/mobile/src/__tests__/review/{store,loader,drafts,stemsPoll}.test.ts(x)`

**Interfaces (Produces):**
```ts
type ReviewStore = { doc: ReviewDoc; undo: UndoStack<ReviewDoc>; editCount: number;
  selection: InstrumentalChoice | null; selectionTouched: boolean;
  apply(op: (d: ReviewDoc) => ReviewDoc): void;   // pushes undo, editCount++, schedules draft save (1 s debounce)
  undoLast(): void; discard(): void; setSelection(c): void; restoredFromDraft: boolean };
createReviewStore(jobId: string, data: CorrectionData): StoreApi<ReviewStore>
useReviewStore<T>(selector: (s: ReviewStore) => T): T
// drafts.ts (MMKV key `review-draft:${jobId}`)
type Draft = { v: 1; audioHash: string | null; segments: LyricsSegment[]; isDuet: boolean;
  selection: InstrumentalChoice | null; editCount: number; savedAt: number };
loadDraft(jobId, audioHash): Draft | null   // null if hash differs (then deletes it)
saveDraft(jobId, d: Draft): void; clearDraft(jobId): void
// useReviewLoader(jobId) → { status: 'loading'|'ready'|'error'; data?: CorrectionData; error?: 'network'|'not_found'|'server'; retry(): void }
//   startReview + getCorrectionData with retry.ts backoff [5,15,30,60]s, Retry-After honoured, 404 final;
//   reportClientEvent('lyrics_load_failed') at most once per 60 s.
// useStemsPoll(jobId, initial) → { options; audioComplete; ready: boolean; analysis; autoApproval } every 15 s up to 10 min while !ready
// useEncoderWarmup(jobId) → warmup on mount, heartbeat every 60 s, stops on unmount
```
- [ ] **Step 1: Write failing tests:**
  - `apply` pushes undo and `undoLast` restores;
  - the draft is saved after a 1 s debounce (fake timers) with no URL or token keys (assert the JSON contains no `http`);
  - `loadDraft` with a different `audioHash` returns null and deletes the draft (Review Focus #3);
  - the loader retries a 503 then succeeds; a 404 is final with no retry; a 429 with `Retry-After: 2` waits 2 s;
  - the stems poll stops when `ready`, and stops after 10 min;
  - the warmup heartbeat is cleared on unmount.
- [ ] **Step 2: Run** `pnpm jest apps/mobile -t review`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 10: `/review/[id]` route and the Lyrics step

**Files:**
- Create: `apps/mobile/src/app/review/[id].tsx` (thin: loader → `ReviewScreen`)
- Create: `apps/mobile/src/review/ReviewScreen.tsx` (steps header, step switch, overflow menu)
- Create: `apps/mobile/src/review/lyrics/LyricsStep.tsx`, `LineRow.tsx`, `WordPill.tsx`, `IssuesBar.tsx`, `PlayerBar.tsx`, `GapCallout.tsx`, `LineToolbar.tsx`
- Create: `apps/mobile/src/review/ReviewMenu.tsx` (Continue on web, Mark as duet, Discard my edits)
- Modify: `apps/mobile/src/app/_layout.tsx` (register the `review/[id]` stack screen, title from i18n)
- Modify: `packages/i18n/messages/en.json` (`review.*` keys)
- Test: `apps/mobile/src/__tests__/review/{ReviewScreen,LyricsStep,LineRow,IssuesBar,PlayerBar}.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–9.
- Produces: `ReviewScreen({jobId, data})`.
- **testIDs:**
  - `review-screen`, `review-step-lyrics`, `review-step-finish`, `review-undo`, `review-menu`, `review-menu-web`, `review-menu-duet`, `review-menu-discard`;
  - `review-issues-next`, `review-issues-prev`, `review-issues-label`;
  - `review-line-${i}`, `review-word-${i}-${j}`, `review-line-${i}-singer`;
  - `review-tool-play`, `review-tool-edit`, `review-tool-resync`, `review-tool-nudge`, `review-tool-more`, `review-tool-split`, `review-tool-merge`, `review-tool-insert`, `review-tool-delete`;
  - `review-player-play`, `review-player-back5`, `review-player-scrub`, `review-player-source`, `review-player-rate`, `review-player-follow`;
  - `review-gap-${k}-play`, `review-gap-${k}-insert`;
  - `review-lyrics-next`, `review-restored-discard`.

Behaviour is as spec §4.2:
- The list is `@nomad/ui` `List` with `extraData` = the active line, using `scrollToIndex` for follow and the issues bar.
- `LineRow` is `memo` on segment identity, the active flag and the selected flag.
- The active line and word come from `position` by binary search over segment starts (`review-core` helper `activeLine(segments, t)`; add it to `timing.ts` with a test).
- RTL rows use `flexDirection: 'row-reverse'` + `writingDirection: 'rtl'` from `lineDirection`.
- The "Lyrics look good" CTA is disabled while `countUntimedWords > 0`, with the label `review.lyrics.needTiming` `{count}`. Tapping it scrolls to `firstUntimed`.
- `planSteps` skips the lyrics step when lyrics are confident.

- [ ] **Step 1: Write failing tests** (RNTL, mocked audio and store from fixtures):
  - renders 300 lines (the `large` fixture) without rendering all rows (FlashList mock windowing; assert render under 1 s);
  - word decorations (AI purple via `accessibilityHint`/testID suffix `-ai`, `-est`, `-untimed`);
  - the issues bar steps in time order and its counter;
  - tapping a line selects it and calls `playRange(start − 0.5, end)`;
  - the CTA is disabled with an untimed word, and pressing it scrolls to it;
  - duet chips show only when `isDuet`, and a chip press cycles 1 → 2 → 0;
  - an RTL line gets `row-reverse`;
  - the restored-draft banner shows Discard, and Discard resets to server data;
  - the lyrics-confident data starts on Finish.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add en.json keys as needed (no other locales yet).
- [ ] **Step 4: Run** `pnpm jest apps/mobile -t review && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Device check.** Against the local stack (`review_fixture: corrections`), open the review on the iOS simulator and take a screenshot. Playback highlights words. Then commit.

### Task 11: Word sheet, Edit text sheet, Nudge sheet

**Files:**
- Create: `apps/mobile/src/review/sheets/WordSheet.tsx`, `EditLineSheet.tsx`, `NudgeSheet.tsx`, `apps/mobile/src/review/sheets/useRepeatPress.ts`
- Test: `apps/mobile/src/__tests__/review/{WordSheet,EditLineSheet,NudgeSheet}.test.tsx`

**testIDs:**
- word sheet: `review-word-sheet`, `review-word-input`, `review-word-save`, `review-word-delete`, `review-word-merge`, `review-word-start-minus`, `review-word-start-plus`, `review-word-end-minus`, `review-word-end-plus`, `review-word-revert-ai`;
- edit line sheet: `review-line-input`, `review-line-save`, `review-line-resync-now`;
- nudge sheet: `review-nudge-line-minus`, `review-nudge-line-plus`, `review-nudge-start-minus`, `review-nudge-start-plus`, `review-nudge-end-minus`, `review-nudge-end-plus`.

Behaviour is as spec §4.3. Every change goes through `store.apply` and then replays (word ± 0.3 s, or the line). Long-press repeats every 120 ms after 400 ms (`useRepeatPress`).

- [ ] **Step 1: Write failing tests:**
  - "teh" → "the" saves and keeps timing;
  - "rock and" splits into 2 estimated words;
  - an empty text deletes the word;
  - start+ is clamped at the next word, and end− at start + 0.05;
  - revert AI restores the original span (fixture undo_info);
  - an edit-line save with new words shows "Re-sync now?", which opens Tap To Sync;
  - nudging the line by +0.1 s moves every word by 0.1 and is clamped at the next line;
  - long-press repeat fires multiple applies (fake timers);
  - an untimed word shows "No timing yet" and offers Re-sync.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 12: Tap To Sync sheet

**Files:**
- Create: `apps/mobile/src/review/sync/TapSyncSheet.tsx`, `apps/mobile/src/review/sync/latency.ts` (`export const TAP_LATENCY_S = { ios: 0, android: 0 }` plus a comment on measuring it)
- Test: `apps/mobile/src/__tests__/review/TapSyncSheet.test.tsx`

**testIDs:** `review-sync-sheet`, `review-sync-pad`, `review-sync-rate`, `review-sync-restart`, `review-sync-done`, `review-sync-playback`, `review-sync-redo`, `review-sync-continue` (the "keep going" toggle), `review-sync-current-word`.

Behaviour is as spec §4.3:
- The pad uses gesture-handler `Gesture.LongPress().minDuration(0)` / `Gesture.Manual`. `onBegin` → `press(state, player.now() − latency)`; `onFinalize` → `release(state, now, heldMs)`.
- On each frame the sheet checks `shouldStop`.
- Haptics: `Haptics.selectionAsync()` on each press.
- "Done" commits through `commitTapSync` → `store.apply`.
- Delete and edit actions are hidden while the sheet is open (the toolbar isn't rendered under a modal anyway).

- [ ] **Step 1: Write failing tests** (a fake player `now()` clock):
  - open → `seekTo(max(0, start − 3))` and play;
  - press/release sequences produce the expected word timings in the store after Done;
  - a 600 ms hold keeps its release time;
  - Restart resets the state and re-seeks;
  - with "keep going", the next line loads after the last word;
  - closing without Done leaves the doc unchanged (no undo push).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Device check.** Re-sync a line on the Android emulator, play it back and confirm the highlight matches the taps by ear and eye. Note the perceived offset; if it is > 80 ms, set `TAP_LATENCY_S`. Then commit.

### Task 13: Finish step (chooser, preview, submit), Continue on web, job wiring

**Files:**
- Create: `apps/mobile/src/review/finish/FinishStep.tsx`, `InstrumentalChooser.tsx`, `BackingStrip.tsx`, `PreviewPanel.tsx`, `useSubmitReview.ts`, `usePreview.ts`
- Create: `apps/mobile/src/review/continueOnWeb.ts`
- Modify: `apps/mobile/src/jobs/JobCard.tsx` and `apps/mobile/src/app/job/[id].tsx` (the review action → `router.push('/review/' + id)`; keep `openReview` only for `chooseAudioOnWeb` / `finishOnWeb`; rename it `openWebHandoff`)
- Modify: `apps/mobile/src/jobs/openReview.ts` → `openWebHandoff.ts` (same behaviour)
- Test: `apps/mobile/src/__tests__/review/{FinishStep,InstrumentalChooser,PreviewPanel,useSubmitReview,continueOnWeb}.test.tsx`, plus updates to the JobCard tests

**testIDs:**
- chooser: `review-choice-clean`, `review-choice-with_backing`, `review-choice-play-clean`, `review-choice-play-with_backing`, `review-choice-change`, `review-ab-scrub`, `review-backing-strip`, `review-stems-pending`;
- preview: `review-preview-start`, `review-preview-player`, `review-preview-audio-song`, `review-preview-audio-instrumental`;
- finish: `review-finish-submit`, `review-finish-retry`, `review-finish-success`.

**Interfaces:**
```ts
useSubmitReview(jobId) → { submit(): Promise<void>; state: 'idle'|'saving'|'done'|'error'; error?: string }
//   guarded against re-entry (Review Focus #4); calls saveCorrections(toSubmission(doc)) → getCorrectionData (the fresh doc
//   already holds gen's sanitized segments from call 1) → completeReview(fresh, selection, isDuet) → clearDraft
//   → invalidate ['jobs'] → router.replace(`/job/${id}`)
usePreview(jobId) → { start(): void; state: 'idle'|'generating'|'slow'|'ready'|'error'|'untimed'; uri?: string }
continueOnWeb(jobId, doc, editCount): Promise<void>   // saveReviewSession (skip if editCount === 0) then openWebHandoff
```
- **Selection:** `instrumental_selection` is `auto` iff `recommendInstrumental().confident && !selectionTouched`; otherwise the chosen choice.
- **Submit gating:** disabled while `!stemsReady` (label `review.finish.waitingStems`) or untimed > 0.
- **Preview:**
  - The 422 maps to `untimed`, which offers a button back to lyrics.
  - The preview player is expo-video with `muted` when the audio toggle is Instrumental, plus a `useReviewPlayer`-style stem player in lockstep (reuse the `useAbPlayers` lockstep helper; extract it into `review/audio/lockstep.ts`).

- [ ] **Step 1: Write failing tests:**
  - the chooser preselects the recommendation, with the badge only when confident;
  - with stems pending it shows the spinner, the submit is disabled with the waiting label, and the poll flipping to ready enables it;
  - pressing B while A plays switches without seeking;
  - a backing-strip tap selects with_backing and plays from that time;
  - submit calls the 3 facades in order with `is_duet` false for a non-duet and `selection` `auto` for an unchanged confident pick;
  - a double press submits once;
  - a 503 on complete shows Retry and keeps the draft, and Retry succeeds;
  - preview `success` is ready at once, while `generating` polls; after 30 s it shows the slow copy; a 422 maps to untimed;
  - Continue on web saves the session before opening the handoff, and skips the session save with 0 edits;
  - the JobCard review press navigates to `/review/{id}`;
  - the chooseAudioOnWeb path still opens the web handoff.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 14: Shared UX doc, i18n, docs

**Files:**
- Create: `docs/REVIEW-UX.md` (spec §7.2: platform-neutral behaviours, issue ordering, gesture ↔ keyboard/mouse equivalents, states, copy keys; written for gen web's responsive pass)
- Modify: `packages/i18n/messages/*.json` (run `env -u GEMINI_API_KEY pnpm i18n:translate`, then `pnpm i18n:check`)
- Modify: `CLAUDE.md` (status, workspace line for `packages/review-core`, gotchas found), `docs/VISION.md` (Phase 2 row: built; backend work = gen fake-stack knobs only), `README.md` if it lists packages
- Modify: workspace `BACKLOG.md`. Add a gen item: "gen web: phone-width review using @nomad/review-core + nomad-mobile docs/REVIEW-UX.md (vendor via sync script + parity check)", plus the response_model follow-up from Task 6.

- [ ] **Step 1:** Write `REVIEW-UX.md`.
- [ ] **Step 2:** Translate. Run `pnpm i18n:check`; expected: 0 missing. If `gcloud` auth has lapsed, run `gcloud auth application-default print-access-token` to check, and use the `/gcp-admin` grant Andrew gave this session if needed.
- [ ] **Step 3:** Update the docs and commit.

### Task 15: Maestro flows (iOS and Android)

**Files:**
- Modify: `maestro/scripts/stack.js`:
  - `ACTION: scenario`: `SCENARIO=job_awaiting_review`, uses the setup user's email and its `USER_CONFIG` knobs → `output.jobId`;
  - `ACTION: review`: `TOKEN`, `JOB_ID`, `EXPECT_SELECTION`, `EXPECT_DUET`, `EXPECT_TEXT_CONTAINS`, `EXPECT_SINGER_LINE`/`EXPECT_SINGER` → asserts via `/api/test/jobs/{id}/review-result`;
  - document both in the header comment.
- Create: `maestro/common/open-review.yaml` (sign in as the setup user, go to Make, tap `job-review-${jobId}`)
- Create: `maestro/flows/review-1-approve.yaml` … `review-12-continue-web.yaml` (the table in spec §8.3; review-11 uses `review_complete_fail_once` and a `stopApp` / `launchApp` relaunch to check the draft restore)
- Modify: `maestro/flows/make-5-needs-review.yaml` (it now lands on `review-screen`)
- Modify: `scripts/e2e-local.sh` only if new env is needed

- [ ] **Step 1:** Write the flows. Screenshots go to `docs/screenshots/phase2/<platform>/`.
- [ ] **Step 2: Run** `scripts/e2e-local.sh --platform ios review` (with `GEN_DIR` pointed at the gen worktree if Task 1 isn't merged). Expected: 12/12 pass, plus make-5.
- [ ] **Step 3: Run** `scripts/e2e-local.sh --platform android review` (never at the same time as iOS). Expected: 12/12 pass.
- [ ] **Step 4:** Fix what fails (systematic-debugging), re-run, commit.
- [ ] **Step 5:** Run the full suite once per platform (`scripts/e2e-local.sh --platform ios`) to catch regressions in make and search.

### Task 16: Screenshot UX review and release APK

**Files:**
- Create: `maestro/screens/review-tour.yaml` (every screen and state: lyrics with issues, word sheet, edit line, nudge, Tap To Sync mid-sync, gap callout, duet chips, RTL, finish with confident/unsure/pending, preview generating/ready, error/retry). It takes `LOCALE` (en, he, de).
- Output: `docs/screenshots/phase2/review/<platform>/<locale>/*.png`

- [ ] **Step 1:** Run the tour for iOS (en, he, de) and Android (en).
- [ ] **Step 2:** Review every shot against `docs/REVIEW-UX.md` and spec §4.8. Look for clipped text, touch targets < 44 pt, RTL mirroring, contrast, overlapping sheets, and the keyboard covering inputs. List the issues in the session record, fix them, and re-run until clean.
- [ ] **Step 3: Release APK.** Run `cd apps/mobile/android && ./gradlew assembleRelease` (same local signing as Phase 1; see `docs/sessions/2026-Q4/2026-10-19-mobile-search-parity.md` for the exact command and env) and copy it to `~/Downloads/nomad-karaoke-phase2-release.apk`. Install it on the emulator and smoke-test against prod: sign in, open Make, and (if a real job is in review) open it.
- [ ] **Step 4:** Commit the screenshots and fixes.
