# Nomad Karaoke mobile app: native review design (Phase 2)

*2026-10-19. Backlog Frog 4.2. It follows [Phase 1b "Search parity"](2026-10-18-mobile-search-parity-design.md). Read [docs/VISION.md](../../VISION.md) first. It delivers VISION Phase 2 "Native review", which replaces Phase 1's web-review bridge.*

## 1. Intent

**Why.** VISION use case 2 relies on "a really easy, mobile-friendly lyrics and instrumental review". Andrew, 2026-10-19:

> the UX of the current karaoke-gen lyrics review process is just pretty much unusuable on a phone screen, it was never really well designed for mobile use - the things i do during a review on the web will all need proper thought to make actually usable with proper mobile-friendly UX thought put into responsive design

He also set a second goal for this phase:

> let's make sure we build this in a way which also unlocks us making the karaoke-gen website fully usable on mobile screens too, whatever that may mean (either sharing code or at least sharing design and UX even if reimplemented in two languages etc.)

Andrew then went AFK in autonomous mode ("i trust you to make the best judgements about how to proceed"). Every scope decision below that isn't quoted is **the builder's own call**, and is marked *(call)* where it matters.

**The person.** A singer has made a song in the app, often at a bar the same night. Gen's auto-approval couldn't settle the lyrics or the backing vocals, so the job needs them. On one phone screen, one-handed and in a few minutes, they need to:

1. **listen and approve** when it's already right (the common case);
2. **fix a word** the transcription got wrong;
3. **nudge or re-sync a line** whose timing is off (about 40% of reviewed jobs have real timing edits, median 0.7 s, so this is core, not optional);
4. **pick the instrumental** by A/B listening;
5. **preview the video** if they want to, and **finish**.

**What success looks like**
- A job needing review opens a native screen in under 2 s on a warm API. Playback starts with one tap.
- Approve-as-is takes 3 taps from the job card (Review → Lyrics look good → Make my video), with the instrumental preselected from gen's recommendation. *(call: the builder check showed a job only reaches review when something isn't confident, so 2 taps can't happen.)*
- A wrong word is fixed in 3 taps plus typing. A late line is re-synced with the Tap To Sync pad, or nudged in 0.1 s steps, without zooming or precise dragging.
- A 300-line lyrics doc scrolls smoothly and edits feel instant.
- Hebrew/Arabic lines read right-to-left. Duets show who sings each line.
- Nothing the singer does is lost on a flaky connection: edits stay on the phone until gen accepts them.
- Gen web can adopt the same model code and the same UX for its own mobile layout (§7).

## 2. Goals, non-goals, anti-goals

**Goals**
1. A native review flow (`/review/[id]`) with two steps, **Lyrics → Finish**. The instrumental choice sits inside Finish, the same way the web's inline chooser does. The Lyrics step is skipped when gen already resolved it (§4).
2. **`@nomad/review-core`:** a pure-TypeScript package holding the review model, edit operations, timing rules and recommendations. It has no React, React Native or DOM imports, so gen's Next.js frontend can share it (§7).
3. **`docs/REVIEW-UX.md`:** the platform-neutral phone-first review UX. It is the shared design that gen web's responsive pass will implement (§7).
4. Zod schemas for every review endpoint the app calls, plus `@nomad/api-gen` facades (§6).
5. Audio playback (expo-audio). An interactive `WaveformCanvas` (seek, progress, markers) and a `List` ref API in `@nomad/ui` (§5).
6. Gen local-stack scenario data that can exercise all of the above (§8.1).
7. Tests: component tests for every review screen; Maestro on iOS and Android (approve, edit, re-sync, instrumental, preview, stems processing, large doc, duet, RTL, failures); a screenshot UX review; a release APK for Andrew's phone (§8).

**Non-goals (stay web-only for now, reached through "Continue on web", §4.7)** *(call)*
- The **audio editor** (tempo, fades, trims). It runs before review, is a waveform-precision tool, and is rarely used. The app shows "Edit audio on the web" when a job sits in the audio-edit step.
- **Reference-lyrics management:** search, paste or replace all lyrics, add-lyrics, custom-lyrics AI mode, and find/replace.
- **The AI auto-correct panel.** Gen already applies its suggestions on the server before review opens. The app shows the corrected words and can revert one, but doesn't rerun or browse suggestions.
- **Custom instrumental upload and mute regions.**
- **Per-word singer overrides in duets.** The app shows and preserves them but only edits per-line singers.
- **Waveform drag-resize of word edges.** The app replaces it with nudge buttons and Tap To Sync (§4.3).
- Replay mode, annotations and edit-log metrics (memory `feedback_never_use_edit_log_metric`: never send edit-log for metrics).
- Gen web adopting `review-core` and building its mobile layout. That gets its own backlog item (§7.3).
- Typed `response_model`s in gen. That is a gen follow-up, filed per mobile CLAUDE.md rule 6 (§6).

**Anti-goals: the phase fails if any of these happens, even if everything else works**
- **Submitting lyrics with untimed words or invalid timings.** Render crashes on them.
- **Re-applying AI suggestions on the phone.** Gen pre-applies them, and applying them twice duplicates edits.
- **Losing a singer's edits** to a failed save, an app kill or a 1 MB Firestore error.
- **A screen that is a squeezed copy of the desktop UI**, such as multi-panel layouts or hover affordances.
- Calling **different endpoints than the web**, or adding backend review endpoints only for the app (VISION "Same endpoints as the web"). The app may call existing endpoints the web doesn't, such as `start-review`.
- Waiting on the preview video before finishing.
- Showing "Access denied" for a network or Cloudflare error.

## 3. Constraints

- Mobile CLAUDE.md applies:
  - no user-facing string literals, and all 33 locales translated;
  - a `testID` on every interactive element;
  - FlashList and Skia only through `@nomad/ui`;
  - API clients never touch storage;
  - untyped endpoints get zod overrides;
  - no accounts or spend.
- **Same backend as the web.** Review auth is `require_review_auth`: a Bearer token, or `?token=` on media URLs. Native players stream `instrumental-audio`, `audio/vocals` and the preview mp4 with `?token=`.
- Use the **Expo SDK 57 versioned docs** for expo-audio and expo-video (AGENTS.md). Install native deps with `npx expo install`.
- Correction docs can be large: 300+ segments and thousands of words, with a JSON body of 1–3 MB. Keep state updates per segment (structural sharing), never a deep clone per keystroke.
- Gen deploys can skew from the app. Every new field needs a fallback for older backends.

## 4. The phone-first review UX

`docs/REVIEW-UX.md` is the source of truth for interactions. This section is its summary and the spec for the app.

### 4.1 Entry and routing
- The job card's **Review** action, the job page and the progress screen for `awaiting_review` / `in_review` open `/review/[id]` natively. The Phase 1 web bridge (`openReview.ts` for review) is removed. `ReviewAction` stays for "choose audio on web" (non-review), which is out of this phase.
- **Load sequence:**
  1. `POST /api/jobs/{id}/start-review` (idempotent).
  2. `GET /api/review/{id}/correction-data` (idempotent). It is the main payload, already AI-pre-applied.
  3. Fire-and-forget encoding-VM warmup, plus a heartbeat every 60 s while the screen is open (memory `feedback_gen_review_warmup_keep`).
- **Load errors:**
  - Retry transient 5xx, 429 and network errors with backoff of 5, 15, 30 and 60 s, honouring Retry-After.
  - A 404 is final.
  - Show "Trouble reaching Nomad Karaoke · Retry", never "Access denied".
  - Report `lyrics_load_failed` to `POST /api/client-events`, throttled to once per 60 s per type.
- **Step plan** from `auto_approval`. Gen's `auto_approval_summary` already forces `confident: false` when `review_mode != "auto"`, so the app checks only `confident`. When `auto_approval` is absent, show both steps.
  - **Lyrics step:** shown unless `auto_approval.lyrics.confident` is true.
  - **Finish step:** always shown. It holds the instrumental chooser (§4.4), unless it's a custom instrumental (`auto_approval.custom_instrumental`). A confident backing verdict collapses the chooser to one line ("Instrumental: Clean ✓ · Change").
- The **step header** shows a two-part progress (Lyrics · Finish). Back goes to the previous step, and the system back button behaves the same. Leaving the review keeps the draft (§4.6).

### 4.2 Lyrics step: listen and approve
The layout is phone portrait. Top to bottom:

- **Header:** artist/title, an undo button (disabled when there is nothing to undo), and an overflow menu:
  - Continue on web
  - Mark as duet / Not a duet
  - Discard my edits
  - Help
- **"Things to check" bar** (hidden when empty). It reads "3 things to check ‹ ›" and steps through issues in song order. Issue kinds, in priority order:
  1. untimed word (blocks Finish);
  2. evidenced vocal gap ("possible missing lyrics");
  3. AI-corrected span (purple; check it);
  4. estimated-timing words (amber dashed);
  5. a word longer than 2 s, or a gap longer than 2 s, inside a line (warning).

  Stepping scrolls to the line, selects it and plays from 1 s before it.
- **Lines list** (`<List>`, virtualized):
  - Each row shows the line's words as wrapped text "pills" with per-word decorations: purple for AI-corrected (tap shows the original), amber dashed underline for estimated timing, red outline for untimed, orange gap colour when there are no reference lyrics.
  - The row has a small start time on the leading edge.
  - In a duet, a singer chip (1 / 2 / Both) is on the trailing edge.
  - While playing, the active line is highlighted and words fill karaoke-style. The list auto-follows the active line until the user scrolls by hand, which shows a "Follow" pill to resume.
  - RTL lines (by first-strong character, not app locale) lay out right-to-left.
- **Tap a line:** it is selected and plays from its start (minus 0.5 s). The selected line expands a **line toolbar**:
  - ▶ Play line
  - ✎ Edit text
  - ⟲ Re-sync (Tap To Sync)
  - ⇆ Nudge
  - ⋯ (Split line here / Merge with next / Insert line after / Delete line)
- **Tap a word** (when its line is selected): opens the **word sheet** (§4.3).
- **Player bar** (sticky at the bottom, above the step CTA):
  - play/pause, back 5 s;
  - a scrubber over the vocals waveform (tap or drag to seek; markers for vocal gaps and untimed words);
  - a source toggle **Vocals / Song**. Vocals-only makes words easy to hear. It falls back to the song while stems are still separating.
  - speed **1× / 0.75×**.
- **Vocal-gap callouts** sit inline between lines: "Possible missing lyrics · 0:42–0:51" with buttons Play / Insert line(s).
  - "Insert lines" inserts the evidenced synced reference lines with their reference timings (gen `missingLyrics.ts` behaviour).
  - Without references it inserts one empty line spanning the gap and opens Edit text.
- **Step CTA** (bottom): "Lyrics look good → Next".
  - It is disabled while any word is untimed. The button then says "2 words need timing", and tapping it jumps to the first one.

### 4.3 Fixing words and timing
- **Word sheet** (bottom sheet, keyboard-aware):
  - A text field holding the word, with Save.
    - Typing a space splits the word into N words, with timing split evenly and marked `timing_estimated`.
    - Clearing the field deletes the word.
  - Buttons: Delete word, Merge with next word.
  - **Timing:** "Start 0:42.30 [−] [+]" and "End 0:42.80 [−] [+]", in 0.05 s steps.
    - Each step replays that word plus 0.3 s around it.
    - Long-press repeats the step.
    - Clamps: start ≥ previous word's end, end ≤ next word's start, end ≥ start + 0.05.
  - For an AI-corrected word: "Changed by AI from 'teh' · Revert".
- **Edit text** (line sheet): a multi-line text field with the whole line, then Save. Saving uses `review-core` `applyLineText`, which keeps the timing of matching words.
  - Words matched by an LCS diff keep their timings.
  - New words get evenly estimated timing between their timed neighbours and are marked `timing_estimated`.
  - If any timing was estimated, it shows "Timing guessed for 2 new words · Re-sync now?".
- **Nudge** (line sheet): "Move whole line [−0.1 s] [+0.1 s]" (plus long-press), "Start of line [−][+]" and "End of line [−][+]".
  - Every change replays the line.
  - Moving the whole line is clamped between the neighbouring lines.
- **Tap To Sync (re-sync)** opens a full-height sheet for the selected line, with "Keep going into the next lines" off by default.
  - **Layout:**
    - top: the current word large, plus the next 4 words;
    - middle: a progress row of the line's words;
    - bottom half: one big **TAP pad**;
    - controls: speed (1× / 0.75× / 0.5×), Restart, Done.
  - **Behaviour:**
    1. Playback starts 3 s before the line's start (floored at 0).
    2. Press down = the current word starts. Release = it ends.
    3. A quick tap fills the gap up to the next word, capped at +1.0 s past start. A hold keeps its release point.
    4. Re-tapping clamps to the line ±3 s (`clampSyncTime`).
    5. Overlaps are never corrected against the next word's stale (not re-tapped) start (`syncedIndices`).
    6. Playback doesn't auto-stop while holding; otherwise it stops at line end + 1 s.
    7. After the last word: "Play it back · Redo · Done".
    8. Delete and edit actions are disabled while syncing.
    9. Haptic tick on each press.
  - The press timestamp is the player's position read at the gesture's `onBegin` (native thread, via gesture-handler), minus a per-platform output-latency constant *(call: start at 0; measure on device in the screenshot/phone pass and tune)*.
- Every edit runs `review-core` `sanitizeSegments`: each word inside its segment, end ≥ start, the segment's bounds recomputed from its words. Every edit pushes onto the **undo** stack, capped at 100 snapshots of changed segments only.

### 4.4 Instrumental chooser (inside Finish)
- Two large cards:
  - **Clean** ("Just the music, no backing singers").
  - **With backing vocals** ("Keeps the backing singers").

  The recommended card is preselected and badged "✓ Recommended" when confident. When not confident: "Have a listen and choose".
- **Recommendation:** `auto_approval.backing.resolved_selection` → `backing_vocals_analysis.recommended_selection` → (backing has audible content ? with_backing : clean). Validate it: `review_needed` or an unknown value means preselect with no badge. This lives in `review-core` (`recommendInstrumental`).
- **A/B listening:** one shared playhead and scrubber. Tapping a card's ▶ (or the card while playing) switches the audible stem **at the same position** (two preloaded players, one muted, kept in lockstep with drift ≤ 0.25 s).
- **Backing-vocals strip:** a waveform of the backing stem (`waveform-data`), shown only once the stems are complete, because before that gen falls back to the full mix. Audible segments are highlighted. Tapping a highlighted region selects With backing and auditions it from there.
- **Help line:** "If you can hear the lead singer coming through, choose Clean." Clean stays one tap away (customers lean clean, 38%).
- **Stems still separating** (`instrumental_options` empty or `audio_complete` false):
  - The cards show "Separating the music… usually 2–3 minutes", with a spinner.
  - Poll `GET /instrumental-urls` every 15 s for up to 10 min. Treat "both stems present" as ready when `audio_complete` is absent.
  - The Lyrics step's CTA stays enabled, so the singer can move on (Andrew wants to be able to skip ahead). **"Make my video" waits until the stems land**, as on the web (`InstrumentalSelector` blocks submit while `waitingForAudio`). The button says "Waiting for the music to finish separating…". Gen can't resolve a selection without the stem files: `"auto"` with a missing stem is a 400. The screen tells the singer they can leave; the draft is kept, and the job card shows Review again.
- **Audio errors:** re-fetch `instrumental-urls` (max 3 times). Never persist media URLs.

### 4.5 Finish step
- **Summary:**
  - "Lyrics: 3 fixes" or "Lyrics: approved as is";
  - "Instrumental: Clean" (Change);
  - "Duet: 2 singers" when it is a duet.
- **Preview video (optional):**
  1. "Preview the video" sends `POST /preview-video`. A response of `{status:"success", preview_hash}` (a cache hit, the local render or the sync GCE fallback) is ready at once. `{status:"generating"}` means poll `GET …/{hash}/status` (`ready` / `error` / `generating`) every 3 s for up to 5 min.
  2. After 30 s it shows "Starting a video server, this can take a couple of minutes". A cached preview returns at once.
  3. The player (expo-video) is capped at 40% of the screen height.
  4. A "Preview audio: Song / Instrumental" toggle overlays the chosen stem on the muted video in lockstep.
  5. A note says it is a black-background sync check, and that translations are added after review when the job has `translation_language`.
  6. A 422 (untimed lines) sends the user back to the lyrics step.
- **"Make my video"** (primary) uses **the web's three-call sequence** (gen `LyricsAnalyzer` ~1170):
  1. `POST /api/jobs/{id}/corrections` with `{corrections: {...doc, lines: corrected_segments}, is_duet}`. Gen runs `sanitize_corrections` here, which is the server-side timing safety net.
  2. A fresh `GET correction-data`.
  3. `POST /api/review/{id}/complete` with that doc + `instrumental_selection` + `is_duet`.
  - `instrumental_selection` is `clean` or `with_backing`. It is `auto` only when the backing verdict was confident and the singer didn't change it.
  - `is_duet` is sent as `isDuet ?? false`, the same as the web. Gen latches `is_duet` up only, so false never un-duets a job.
  - It shows "Saving…" through the slow call, then a success state, then returns to the job page with progress.
  - It never waits for the preview.
- **Failure** (including the Firestore 1 MB error, which gen self-heals): keep the draft, show the reason and Retry.

### 4.6 Drafts and resume
- **Edits are autosaved on the phone.** After each edit (debounced 1 s), the edited segments, duet flag, instrumental choice and an edit count are saved to MMKV per job. Media URLs and tokens are never saved.
- **Reopening:** if a draft exists and the server doc's audio hash matches, the app restores it silently and shows a banner "Restored your edits · Discard".
- **Handing over to the web:** before "Continue on web", the app saves the draft as a gen review session (`POST /api/review/{id}/sessions`, trigger `manual`) so the web's restore dialog offers it. Then it opens the existing handoff link.
- The draft is cleared after a successful complete.

### 4.7 Continue on web (escape hatch)
It is kept *(call)* in the overflow menu and in error states, so the web-only tools (§2) stay reachable from the phone. It saves the session first (§4.6). The Phase 1 handoff-token flow is unchanged.

### 4.8 Accessibility and polish
- Minimum touch target 44 pt. Word pills have padding, and tapping between pills selects the line.
- Every control has an accessibility label. The TAP pad announces the current word.
- Dark theme tokens from `@nomad/ui`.
- Long titles truncate.
- Haptics on Tap To Sync and step completion.

## 5. Platform pieces

- **iOS and Ogg Opus (first task, a spike).** All of gen's review audio is Ogg Opus (`audio_transcoding_service.py`), and AVPlayer (which expo-audio uses on iOS) may not play the Ogg container. The plan's first task plays `instrumental-audio` on the iOS simulator. If it fails, gen also transcodes an AAC `.m4a` variant in the same transcoding step and serves it from the **same endpoints** with `?format=m4a` *(call: a format variant of existing endpoints, not an app-only endpoint; Safari benefits too)*. Android uses Ogg as today.
- **expo-audio:** a `useReviewPlayer` hook in `apps/mobile/src/review/audio/`.
  - It handles one source switch (vocals / song / stems), `seekTo`, rate and a position subscription (about 30 Hz for highlighting).
  - The A/B pair wraps two players with lockstep sync.
  - Media URLs are built from the API base + `?token=` (review-core `mediaUrl`).
  - Vocals and peaks return 202 while separating, so it falls back to the song and polls.
- **Peaks:** `GET /vocals-peaks` (uint8 base64, 400/s) is decoded and downsampled in `review-core` with **fractional bucket strides**.
- **`@nomad/ui` `WaveformCanvas` grows:** `onSeek(fraction)` (tap and pan), `markers` (time ranges with a colour), `highlights` and accessibility. It draws one Skia `Path` instead of one `Rect` per bar, for large arrays.
- **`@nomad/ui` `List`** exposes a ref (`scrollToIndex`), `extraData` and `getItemType`.
- **Bottom sheets:** a small `Sheet` component in `@nomad/ui` (RN `Modal` + Reanimated). No new sheet library *(call: avoids another native dependency)*.
- **Gestures:** react-native-gesture-handler (already installed) for the TAP pad and long-press repeat.

## 6. API layer (`@nomad/api-gen`)

- Run `pnpm gen:api` to refresh `openapi/gen.json` to current gen.
- Add zod overrides in `packages/api-gen/src/overrides/review.ts`:
  - `CorrectionData` (lenient: `.passthrough()` everywhere, so unknown fields survive the round-trip);
  - instrumental-urls, start-review, complete, preview-video POST/status, sessions POST, waveform-data, vocals-peaks and client-events.
- Add `facades/review.ts`:
  - `startReview`, `getCorrectionData`, `getInstrumentalUrls`, `getVocalsPeaks` (202-aware), `getWaveformData`;
  - `requestPreview`, `getPreviewStatus`, `previewVideoUrl`;
  - `saveReviewSession`, `completeReview`, `warmupEncoder`, `encoderHeartbeat`, `reportClientEvent`;
  - `reviewMediaUrl(path)`.
- **Round-trip rule:** the app sends back the whole correction doc it received, with only `corrected_segments` (and `is_duet`) replaced. It never rebuilds the doc from its own model.
- Update `docs/gen-untyped-endpoints.md`. File a gen backlog follow-up: "response_model for review endpoints used by mobile".

## 7. Sharing with gen web

### 7.1 `@nomad/review-core` (pure TS, in `packages/review-core`)
It is ported from gen `frontend/lib/lyrics-review/` and `frontend/hooks/useManualSync.ts`, keeping their behaviour, with gen's existing unit-test cases ported as parity tests. Contents:
- **Types:** `CorrectionData`, `LyricsSegment`, `Word`, `SingerId`, and the instrumental types.
- **Model:** `ReviewDoc` (the normalized editable state plus the original doc for round-trip), `toSubmission`.
- **Edit operations**, all pure (`(doc, args) => doc`) and preserving untouched segment identity:
  - `editWordText`, `deleteWord`, `splitWord`, `mergeWords`;
  - `applyLineText`, `splitLine`, `mergeLines`, `insertLine`, `deleteLine`;
  - `shiftLine`, `setWordTiming`, `setLineSinger`, `setDuet`;
  - `revertAiSpan`, ported from gen `autoCorrectApply.ts` (`fromServerUndoInfo` / `revertSuggestion`, using `metadata.auto_approval.undo_info`). `original_text` alone can't rebuild the span.
- **Timing:** `sanitizeSegments`, `countUntimedWords`, `clampSyncTime`, and the `TapSyncSession` state machine (press/release/gap-fill/syncedIndices; time is injected).
- **Issues:** `collectIssues(doc)`, giving ordered issues with kinds per §4.2, and `openVocalGaps`, `insertGapLines`.
- **Recommendation and routing:** `recommendInstrumental`, `planSteps(correctionData, job)`.
- **Text:** `lineDirection` (first-strong bidi).
- **Media:** `decodePeaks`, `downsamplePeaks` (fractional strides), `mediaUrl`.
- **Undo:** `UndoStack`.

Rules: no imports from React, React Native, the DOM or Node, and ≥ 90% coverage (it is the shared logic). It is published only inside this workspace for now.

### 7.2 `docs/REVIEW-UX.md`
The platform-neutral interaction spec (§4 written as behaviours, not components): steps, issue ordering, the gestures and their web equivalents (TAP pad = space bar / mouse down; nudge = arrow keys), copy keys and states. Gen web's responsive pass implements this same document at narrow widths.

### 7.3 How gen adopts it (follow-up, not this phase)
A backlog item: "gen web: phone-width review using review-core + REVIEW-UX.md". Gen vendors `packages/review-core/src` through a sync script plus a CI parity check, the same pattern as `scripts/sync-search-fixtures.mjs`. The alternative is publishing the package to GitHub Packages. That choice is left to the gen session. Phase 2 only guarantees that review-core has no platform dependencies and runs under gen's Jest/TS settings, which is checked by a tsc run with `lib: ["ES2022"]` and no DOM.

## 8. Testing

### 8.1 Gen local-stack additions (gen PR)
- **Per-user fake-config knob `review_fixture`:**
  - `default`: today's 6 lines.
  - `corrections`: AI-corrected spans with `original_text`, estimated-timing words, one evidenced vocal gap with synced reference lines, one untimed word, and a word longer than 2 s.
  - `duet`: `is_duet` true, with per-line singers 1 / 2 / 0.
  - `rtl`: Hebrew lines, plus one Arabic line.
  - `large`: 300 lines, about 2,000 words.
  - The fake lyrics worker builds them from the real dataclasses, so the schema stays valid.
- **Knob `backing_vocals`:** `silent` (today) or `audible` (a backing stem with audible sections, so the analysis recommends `with_backing` or `review_needed`).
- **Knobs `review_mode` (`always_review` default, or `auto`) and `auto_approval`** (`none` / `lyrics_confident` / `backing_confident` / `both_unsure`): they make the scenario write `processing_metadata.auto_approval`, so confident, skipped-step and "✓ Recommended" states can be reached.
- **The local `/audio` dev-proxy branch** returns `_ranged_response` like `/audio/vocals` does, so the Song source can seek on iOS. This is a bug fix.
- **Knob `stems_delay_seconds`:** the fake audio worker's stem upload lands this many seconds after the job reaches `awaiting_review`. This exercises late stems and `audio_complete` false.
- **Fake media gets an amplitude envelope** (tremolo plus sung-like bursts on the vocal stem) so waveforms aren't solid blocks.
- **The test API exposes the submitted review**, extending `GET` job detail (or `stack.js ACTION: job`) to return `instrumental_selection`, `is_duet` and the corrected lines' text and timings. Maestro asserts on these.
- **`stack.js` `ACTION: scenario`** creates `job_awaiting_review` directly for the flow's user (no UI make) and returns `job_id`.

### 8.2 Component tests (jest, `apps/mobile/src/__tests__/review/`)
These cover every screen and sheet:
- the load, error and retry states;
- the steps plan;
- the lyrics list (decorations, issues bar, duet chips, RTL rows);
- the word, edit-text and nudge sheets;
- the Tap To Sync sheet (simulated press/release with a fake clock);
- the instrumental step (recommended / unsure / pending / poll-to-ready);
- the finish step (preview states, complete success and failure, `is_duet` rule);
- draft restore and discard;
- Continue on web saving the session first.

`review-core` gets unit and parity tests. The `@nomad/ui` waveform, list and sheet get their own tests.

### 8.3 Maestro (iOS and Android, against the gen local stack)
`maestro/flows/review-*.yaml`, each with its own user, seeded by `ACTION: scenario`:

| Flow | Covers |
|---|---|
| review-1-approve | open → Lyrics look good → Make my video → `instrumental_selection` = the recommendation; job leaves review. A variant with `auto_approval: lyrics_confident` opens straight on Finish |
| review-2-edit-word | fix a word + edit a line's text → submitted text matches |
| review-3-resync | Tap To Sync a line (press/release on the pad) → the line's word timings changed and stay valid (sanitized, inside the segment) |
| review-4-instrumental | `backing_vocals: audible`; A/B switch; choose the non-recommended option → submitted selection |
| review-5-preview | generate the preview (the sync local render), the player shows, the audio toggle works; then finish. The async poll path is covered by component tests |
| review-6-stems-pending | `stems_delay_seconds: 60`; separating state; lyrics step completes; Make my video waits, then enables when the stems land; finish |
| review-7-large | `large`; scroll to line 250 via the issues bar / scroll, edit there, finish |
| review-8-duet | `duet`; chips shown; change one line's singer; submitted `is_duet` true and the singer saved |
| review-9-rtl | `rtl` + app locale `he`; screenshot; edit a Hebrew word |
| review-10-corrections-untimed | `corrections`; Finish blocked by the untimed word; fix via re-sync; AI revert; insert gap lines |
| review-11-failure | `fail_at`-style injection: complete returns 5xx once (a fake knob `review_complete_fail_once`) → error, draft kept, retry succeeds; plus kill/relaunch restores the draft |
| review-12-continue-web | overflow → Continue on web → the web review opens and offers the restored session |

make-5 is updated: the review card now opens the native screen.

### 8.4 Screenshot UX review and phone build
- `maestro/screens/review-*.yaml` captures each screen and state into `docs/screenshots/phase2/<platform>/`, in en, he and one long-word locale (de). Review every shot against REVIEW-UX.md, fix the issues found and re-capture.
- Build a release APK (`./gradlew assembleRelease`, local signing as in Phase 1) to `~/Downloads/nomad-karaoke-phase2-release.apk` for Andrew's phone test, and record that in the session record.

## 9. What's left to the builder
- Exact visuals within `@nomad/ui` tokens, and component structure.
- The bottom-sheet implementation details.
- Tap latency constants (measure them).
- How the fake media envelope is generated.
- How the submitted-review test endpoint is shaped.
- The order of plan tasks. The gen PR must merge, or its worktree be used via `GEN_DIR`, before the Maestro flows that need it.

### Calls made after the builder check (2026-10-19)
- **Stems pending:** wait like the web; don't send `"auto"` with missing stems (gen 400s).
- **iOS Ogg:** spike first. If it fails, gen adds a `?format=m4a` variant on the same endpoints.
- **Finish:** the web's three calls (corrections → re-fetch → complete), keeping gen's server-side sanitizer.
- **Steps:** two (Lyrics, Finish with the chooser inline). Approve-as-is is 3 taps.
- **`is_duet`:** sent like the web (`?? false`). Gen latches it up only.
- **The gen local stack gets new knobs:** `review_mode`, `auto_approval`, `backing_vocals`, `stems_delay_seconds`, `review_fixture`, `review_complete_fail_once`, plus the `/audio` Range fix.

---

## Appendix A: learnings from gen's web review (all must hold in the app)

From the session records and memories surveyed on 2026-10-19. `M/` is the agent memory directory and `S/` is the workspace `docs/sessions/`.

**Full-auto review and the timing gate**
- Each screen is shown only when its decision is unsolved; route from `auto_approval`. `always_review` never auto-skips. (M/project_gen_full_auto_review)
- When the backing verdict is confident, send `instrumental_selection: "auto"`; the server resolves it.
- AI corrections are pre-applied on the server (`metadata.auto_approval.pre_applied`). Never re-apply them on the client: an earlier client-side apply caused a 4 s flicker and an edit race.
- The timing gate sends start-in-silence and spread-timing jobs to review. About 40% have real timing edits (median 0.7 s), so phone timing editing is required.
- Never use edit_log or edit_count as a metric. (M/feedback_never_use_edit_log_metric)

**Tap To Sync** (M/project_gen_tap_to_sync_timing)
- Clamp taps to the segment ±3 s, floored at 0, with one clamp shared by every input path. The touch path once had a tighter clamp.
- Never correct overlaps against the next word's stale start; track the indices re-synced in this pass.
- A tap fills the gap to the next word, capped at 1.0 s. A hold keeps its release point. Holds once crushed words.
- No auto-stop while holding.
- A playhead at 0 once produced `start=0`/`end=-0.005` corruption. Sanitize: word inside segment, end ≥ start. (M/project_lyrics_overlap_invalid_word_timing)
- Block submit while any word is untimed; render fails on null timings. (M/project_render_untimed_lyrics_crash)
- Disable delete while syncing, because indices shift. (S/2026-Q3/2026-09-29-gen-edit-segment-waveform-click-ctrl-delete)

**Word resize and edits**
- Edge auto-extend (desktop) is replaced on phones by nudges and Tap To Sync. Its stop rules still bound the nudges: the next word, including the next line's first word, and the end of the audio. (M/project_gen_word_resize_edge_autoextend)
- Deleting a word must recompute the segment's bounds. (M/project_delete_mode_segment_times)
- Commit drags through refs, not setState-updater callbacks. (gen docs/LESSONS-LEARNED.md)

**Preview video**
- Async: POST returns `{status:"generating", preview_hash}`. Poll status every 3 s for up to 5 min, with a cold-encoder message after 30 s. Cloudflare's 100 s cap and a 2+ minute cold encoder are why. (M/project_gen_preview_video_async)
- The preview mp4 carries the with-vocals audio. Overlay the stem audio in lockstep (drift ≤ 0.25 s) for an instrumental preview. (M/project_gen_preview_modal_audio_toggle)
- Keep previewing audio separate from the final choice.
- Cap the video height so the choice stays visible.
- Stems must be playable while the preview encodes. Show "Loading…" until playing, and preload the stems. (M/project_gen_preview_modal_early_audio, M/project_gen_review_stem_ogg_race_waveform_layout)
- Tapping the backing waveform selects with_backing and auditions it.
- Keep "Saving…" up through complete, then show success; don't flash back to review.
- Complete never waits for the preview; the server cancels it. (M/project_gen_complete_no_preview_wait)
- Add the black-background note, plus the translation note when `translation_language` is set. (M/project_gen_translated_lyrics)

**Instrumental** (M/project_gen_backing_recommendation_unified)
- Show the chooser whenever both stems exist.
- The recommendation chain is resolved_selection → recommended_selection → has-backing. Validate it (`review_needed`).
- Use the unified scorer only. The legacy heuristic disagreed on 15% of jobs.
- Clean is one tap away; customers lean clean (38%).
- Use the copy "if you can hear the lead singer's voice coming through", not "bleed".
- A BYO instrumental skips this step (`custom`). (M/project_gen_unified_upload_byo_instrumental)
- A review-time upload isn't conformed; that's a web-only tool. (M/project_gen_instrumental_conform)

**Stems landing late** (M/project_gen_review_late_stems_poll, M/project_gen_vocals_waveform_separation_race)
- Review opens when lyrics finish, and stems land 2–3 minutes later. Poll `/instrumental-urls` every 15 s for up to 10 min, and keep the result in separate state from the lyrics.
- Keep the CTA enabled while waiting; treat both stems present as ready on older backends.
- `/audio/vocals` and `/vocals-peaks` return 202 + Retry-After while separating. A 404 after `audio_complete` is final.
- Show a "separating" spinner, never empty waveforms. Re-read `auto_approval` from the poll.

**Duet** (gen docs/archive/2026-04-21-multi-singer-duets-design.md; gen docs/LESSONS-LEARNED.md; S/2026-Q4/2026-10-16-gen-duet-waveforms-singer-chips)
- Off by default. Singer ids are 1, 2 and 0 = Both; absent means 1. Omit the fields when it isn't a duet.
- Send `is_duet` only when known. A false value once wiped a duet.
- Every view needs the chips.

**Translated lyrics:** chosen at creation and added after review. Review shows only the note.

**RTL and missing lyrics**
- Hebrew/Arabic pills lay out RTL. A reviewer can't eyeball a script he can't read, so the issues bar matters. (M/project_gen_rtl_karaoke_rendering)
- Show `vocal_gaps` as "possible missing lyrics" with "Insert lines" from synced references. Otherwise the renderer shows a fake INSTRUMENTAL. (M/project_gen_missing_lyrics_vocal_gaps)
- Make sure toasts actually display. They were silently dropped on the web once.

**Audio editor** (web-only here)
- A tempo change renames the title "(90% Tempo)" with half-up rounding on both sides, or YouTube replace deletes the original. (M/project_gen_audio_editor_tempo)
- Audio-edit stalls need a visible stalled state. (M/project_gen_audio_edit_stalls)

**Fast load and failures**
- Correction-data does no URL signing. Instrumental options are relative proxy paths, and the client builds absolute URLs + `?token=`. (M/project_gen_signed_url_signing_hang)
- Never persist media URLs. On an audio error, re-fetch `/instrumental-urls` (max 3).
- start-review and correction-data are idempotent (#1181/#1182); iOS double-mounts once caused "Failed to load lyrics".
- Prefer `/vocals-peaks` (about 225 KB) to decoding the 7.5 MB OGG.
- Backoff of 5, 15, 30 and 60 s on 5xx/429/network; 404 is final. Honour Retry-After. (M/project_gen_concurrent_review_reliability)
- Cloudflare blocks look like network errors. Say "trouble reaching", never "access denied".
- A save hitting the 1 MB Firestore limit self-heals on the server. Keep the edits and retry. (M/project_gen_firestore_doc_size_selfheal)
- Add-lyrics rejection and `force` as a string apply to web-only tools. (M/project_gen_add_lyrics_silent_rejection)
- Downsample with fractional strides; integer strides drift ~0.4 s at 3 min. (M/project_gen_waveform_44khz_drift)
- Gate playback until the audio is ready, catch failed play, and treat AbortError as benign. (M/project_lyrics_review_audio_readiness)

**Mobile-specific feedback**
- Don't declare desktop power-user gestures "unsupported on mobile"; give touch equivalents. Reproduce real errors before guessing. (M/feedback_mobile_review_assumption)
- Port existing endpoints and learnings; don't rebuild naively. (M/feedback_mobile_port_existing_learnings)

**Other**
- Opening review warms the encoding VM (warmup + heartbeat). Keep it. (M/feedback_gen_review_warmup_keep)
- With no reference lyrics, use the orange gap colour; AI auto-correct is disabled (422). (M/project_word_pill_no_reference_color)
- AI-corrected words are purple with the original shown. Estimated timing gets an amber dashed underline. Warn on words and gaps over 2 s. (M/project_autocorrect_applied_ux)
- Report degradation (`lyrics_load_failed`, `waveform_slow`, `waveform_failed`) to `/api/client-events`, at most once per 60 s.
- Every new client/server field needs an old-backend fallback; deploys skew.

## Appendix B: review endpoints the app calls (all exist; the web uses them except where noted)

| Method | Path | Use in app |
|---|---|---|
| POST | `/api/jobs/{id}/start-review` | Load (idempotent; body `StartReviewRequest`; `require_auth`; the web doesn't call it) |
| GET | `/api/review/{id}/correction-data` | Load |
| GET | `/api/review/{id}/instrumental-urls` | Stem poll and URL refresh |
| GET | `/api/review/{id}/instrumental-audio/{option}` | A/B stems (`?token=`) |
| GET | `/api/review/{id}/audio/vocals`, `/audio` | Player (202 while separating) |
| GET | `/api/review/{id}/vocals-peaks` | Scrubber waveform |
| GET | `/api/review/{id}/waveform-data` | Backing-vocals strip |
| POST | `/api/review/{id}/preview-video`; GET `…/{hash}/status`, `…/{hash}` | Preview |
| POST | `/api/review/{id}/sessions` | Before Continue on web |
| POST | `/api/jobs/{id}/corrections` | Finish, call 1 (the server sanitizes) |
| POST | `/api/review/{id}/complete` | Finish, call 3 |
| POST | `/api/internal/encoding-worker/warmup/{id}`, `/heartbeat/{id}` | On open, while open |
| POST | `/api/client-events` | Degradation telemetry |
| POST | `/api/users/auth/handoff-token` | Continue on web (Phase 1) |
