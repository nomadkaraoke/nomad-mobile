# Review UX: phone-first lyrics and instrumental review

*2026-10-20. Platform-neutral. Source of truth for how the review behaves on a phone-width screen.*
*Spec: [superpowers/specs/2026-10-19-mobile-phase2-native-review-design.md](superpowers/specs/2026-10-19-mobile-phase2-native-review-design.md) (this doc is §4 and Appendix A/B written as behaviours).*

## 1. Purpose and audience

**Who.** A singer on a phone, often at a bar, one-handed, a few minutes. Gen's auto-approval could not settle the lyrics or the backing vocals, so the job waits for them. In order of how often they happen, they want to:

1. listen and approve (the common case, 3 taps);
2. fix a word;
3. nudge or re-sync a line (about 40% of reviewed jobs have real timing edits, median 0.7 s, so this is core);
4. pick the instrumental by A/B listening;
5. optionally preview the video, then finish.

**Two implementations, one design.**

| Implementation | Status | Where |
|---|---|---|
| nomad-mobile native app (React Native) | built in Phase 2 | `apps/mobile/src/review/**` |
| karaoke-gen web frontend, narrow widths | later responsive pass | gen `frontend/` |

A gen web engineer should be able to build every interaction below at narrow widths without reading the React Native code. Section 6 maps each touch gesture to a desktop input.

**Shared logic: `@nomad/review-core`** (`packages/review-core`, pure TypeScript, no React, React Native, DOM or Node imports). It was ported from gen `frontend/lib/lyrics-review/` and `hooks/useManualSync.ts`. The UI layer only renders state and calls these functions. Names in `code font` below are review-core exports unless marked "app".

**Anti-goals (the design fails if any happens):**
- submitting lyrics with untimed words or invalid timings (render crashes);
- re-applying AI suggestions on the client (gen pre-applies them; doing it twice duplicates edits);
- losing a singer's edits to a failed save, an app kill or a 1 MB Firestore error;
- a squeezed copy of the desktop UI (no multi-panel layouts, no hover-only affordances);
- calling endpoints the web does not, or adding backend endpoints just for the phone;
- waiting for the preview before finishing;
- showing "Access denied" for a network or Cloudflare error.

## 2. Flow

### 2.1 Entry

The job's Review action (job card, job page, progress screen for `awaiting_review` / `in_review`) opens the review at `/review/{jobId}`. On the web this is the existing `/app/jobs#/{jobId}/review` route.

### 2.2 Load sequence

1. `POST start-review` (idempotent).
2. `GET correction-data` (idempotent, already AI-pre-applied, no URL signing so it is fast).
3. Fire-and-forget encoder warmup, then a heartbeat every 60 s while the screen is open (keeps the encoding VM warm for the preview).

The correction doc is turned into an editable `ReviewDoc` with `fromCorrectionData`. The original server doc is kept so the submission can round-trip every field it does not edit (`toSubmission`: the whole doc received, with only the corrected segments replaced, plus `is_duet` when it is known (see the `is_duet` rules); wordless segments are dropped as a safety net).

Loading shows "Opening your lyrics..." Errors: section 5.

### 2.3 Step plan

`planSteps(correctionData)` returns the steps and chooser state from `auto_approval`.

| Condition | Result |
|---|---|
| `auto_approval.lyrics.confident === true` | Lyrics step skipped; open on Finish |
| anything else, including `auto_approval` absent | Lyrics, then Finish |
| `auto_approval.custom_instrumental === true` | no instrumental chooser in Finish (`showChooser: false`) |
| `auto_approval.backing.confident === true` | chooser collapsed to one line ("Instrumental: Clean, Change") |

Gen already forces `confident: false` when `review_mode != "auto"`, so clients only read `confident`. There are exactly **two steps: Lyrics, then Finish**. The instrumental chooser lives inside Finish, as on the web.

Step header: two-part progress (Lyrics, Finish). Back goes to the previous step; the system back / browser back does the same. Leaving the review keeps the draft. Moving between steps never submits.

### 2.4 Drafts and resume

- After each edit (debounced 1 s) the phone saves, per job: edited segments, duet flag, whether the person touched duet, the instrumental choice, an edit count, the doc's `metadata.audio_hash` and a fingerprint of the server doc the edits started from (`docFingerprint`: FNV-1a over every segment id and every word's id, text, timings and singer). **Never media URLs or tokens.**
- On reopen: if a draft exists and both its audio hash and its server fingerprint match the server doc, restore silently and show a banner "Restored your edits, Discard" (Discard asks to confirm). A different hash or fingerprint (the review was finished on the web and came back with other lyrics), a corrupt draft or an unknown version is deleted.
- The draft is cleared after a successful complete, and when the person comes back from Continue on web and gen shows the job has left review (finished on the web).
- Overflow menu "Discard my edits" confirms, then returns to what gen sent.
- On web, use localStorage keyed by job id with the same shape; gen's existing review-session restore dialog can also serve it.

### 2.5 Continue on web

Kept in the overflow menu and in error states (on Finish, a failed submit shows it next to Retry) so web-only tools stay reachable (section 7). It first saves the draft as a gen review session (`POST sessions`, trigger `manual`) so the web restore dialog offers the edits, then opens the existing handoff link (`handoff-token`). On gen web this item is not needed.

### 2.6 Overflow menu

Continue on web, Mark as duet / Not a duet, Discard my edits. While Make my video is saving or done, all three are disabled (the edits were sent). The header also has Undo (disabled when nothing to undo). (A Help item is deferred until there is help content.)

## 3. Lyrics step

### 3.1 Layout, top to bottom (phone portrait)

1. **Header:** artist and title (long titles truncate), Undo, overflow menu.
2. **"Things to check" bar** (hidden when empty): "3 things to check" with previous / next arrows.
3. **Line list** (virtualized; 300+ lines and about 2,000 words must scroll smoothly).
4. **Player bar** (sticky): play/pause, back 5 s, scrubber over the vocals waveform, source toggle Vocals / Song, speed toggle 1x <-> 0.75x.
5. **Step CTA:** "Lyrics look good" (Next).

Open vocal-gap callouts sit inline in the list (3.7). The selected line expands a toolbar (3.3). Sheets (word, edit text, nudge, Tap To Sync) slide up from the bottom and are keyboard-aware.

Minimum touch target 44 pt. Every control has an accessibility label and a test id.

### 3.2 Issues bar

`collectIssues(doc)` returns ordered issues; the bar steps through them.

| Kind | Meaning | Marker |
|---|---|---|
| `untimed` | word with no timing (blocks Finish) | red outline |
| `vocal_gap` | evidenced possible missing lyrics | callout between lines |
| `ai_corrected` | span changed by gen's AI | purple |
| `estimated` | words with guessed timing | amber dashed underline |
| `long_word` | a word longer than 2 s (`LONG_SECONDS`) | warning |
| `long_gap` | silence longer than 2 s between words inside a line | warning |

Rules:
- One issue per run of untimed words, per AI span, per run of estimated words.
- Sorted by time; ties broken by kind priority in the order above (`ISSUE_KIND_ORDER`), then document position.
- Long gaps only count inside a line, never across lines.
- The bar reads "N of M, kind" with prev / next. Next scrolls to the issue's line (landing about 30% from the top), selects the line and plays from **1 s before** the issue. After a jump, auto-follow holds off 1.5 s so the list is not yanked back.
- Copy for kinds: "Word needs timing", "Possible missing lyrics", "Changed by AI", "Timing guessed", "Very long word", "Long pause in a line".
- Reviewers cannot eyeball a script they cannot read (Hebrew, Arabic), so the bar matters most there.

### 3.3 Line list

Each row: start time on the leading edge ("--:--" if untimed), the words as wrapped pills, and in a duet a singer chip on the trailing edge.

**Word pill decorations**

| State | Look | Tap hint |
|---|---|---|
| AI-corrected | purple | "Changed by AI" (word sheet shows the original) |
| estimated timing | amber dashed underline | "Timing guessed" |
| untimed | red outline | "No timing yet" |
| no reference lyrics | orange gap colour | "Not matched to the reference lyrics" |

**Active line and follow**
- While playing, `activeLine(segments, t)` gives the active line; it is highlighted and words fill karaoke-style.
- The list auto-follows the active line. A manual scroll turns follow off and shows a "Follow" pill; tapping it resumes.
- Jumps (issue next, tapped line, CTA to first untimed) pause follow for 1.5 s.

**RTL.** Direction is per line from its first strong character (`lineDirection`: Hebrew and Arabic ranges are RTL; digits and punctuation are neutral; default LTR). It follows the text, never the app locale. RTL lines lay out right to left, with the time and chip mirrored.

**Duets.** Chip cycles 1 -> 2 -> Both -> 1 (`setLineSinger`; singer ids 1, 2, 0 = Both; absent means 1). Per-word singer overrides are preserved but not editable.

**Selecting.** Tapping a line selects it and plays from **0.5 s before its start**. Tapping between pills selects the line. Tapping a word in a selected line opens the word sheet.

**Line toolbar** (on the selected line):

| Action | Behaviour |
|---|---|
| Play line | play the line's range |
| Edit text | edit-text sheet (3.5) |
| Re-sync | Tap To Sync sheet (3.7) |
| Nudge | nudge sheet (3.6) |
| More: Split line here | `splitLine` at the chosen word |
| More: Merge with next | `mergeLines` |
| More: Insert line after | typed line, `insertLineEstimated` (3.5) |
| More: Delete line | `deleteLine` |

Delete and structural edits are disabled while Tap To Sync is open (indices shift).

### 3.4 Word sheet

Opens from a word tap. Fields and actions:
- Text field (Save). Typing a space splits into N words (`splitWord`, timing split evenly, marked `timing_estimated`). Clearing the field deletes the word. Unchanged text is not an edit (`editWordText`, `deleteWord`).
- Delete word, Merge with next word (`mergeWords`).
- **Timing:** "Start 0:42.30 [-] [+]" and "End 0:42.80 [-] [+]", in **0.05 s** steps (`WORD_STEP_S`) via `setWordTiming`. Each step replays the word with **0.3 s** padding each side. Holding a button repeats (3.6).
- Clamps (in `setWordTiming`): start >= previous timed word's end, across lines, and >= 0; end <= next timed word's start, across lines, and <= audio duration (the player passes it); end >= start + 0.05. If there is no room for a minimum-length word the edit is refused.
- An untimed word shows "No timing yet" and a Re-sync button instead of steppers.
- AI-corrected word: "Changed by AI from 'teh'" with Revert (`revertAiSpan`, using `metadata.auto_approval.undo_info`; `original_text` alone cannot rebuild a span).

### 3.5 Edit-line sheet

- Multi-line free text with the whole line. Save calls `applyLineText(doc, segment, text)`.
  - Words matched by a case-folded LCS diff keep their timings.
  - New words get evenly spread timing between their timed neighbours (or the line bounds) and are flagged `timing_estimated`. The result reports `estimated`, the number guessed.
  - Empty text deletes the line.
- If any timing was guessed: "Timing guessed for 2 new words" with **"Re-sync now?"**. Yes opens Tap To Sync for the line; No leaves the amber markers for the issues bar.
- If new words could not be timed (no timed neighbours): "2 new words need timing" and Finish stays blocked until synced.
- **Insert line after:** typed text goes through `insertLineEstimated(doc, afterS, text, audioDuration)`. Words are spread from the previous timed line's end to the next timed line's start (3 s fallback after the last line, capped at the audio duration) and flagged estimated. If the room is under 0.05 s per word they go in untimed.

### 3.6 Nudge sheet

- **Move whole line:** [-0.1 s] [+0.1 s] (`LINE_STEP_S`), `shiftLine`. Relative word timings are intact. The move is clamped so the line never crosses the previous line's last end (or 0) or the next line's first start. A clamp that would reverse direction is ignored (an "earlier" press never pushes a line later).
- **Start of line** and **End of line:** [-][+] in 0.05 s steps on the first / last word (`setWordTiming`).
- Every change replays the line.
- **Press and hold repeats:** first step immediately, then after **400 ms** repeats every **120 ms** while held.
- **A whole hold is one undo entry** and one edit: the first step opens a gesture (`gesture.begin`) and the release closes it (`gesture.end`); the store coalesces every step in between so a long hold cannot flood the 100-deep undo stack.

### 3.7 Tap To Sync (re-sync a line)

Full-height sheet for the selected line. Option "Keep going into the next lines" (off by default; on by default after typing several lines).

**Layout.** Top: the current word large and the next 4. Middle: progress row of the line's words. Bottom half: one big **TAP pad**. Controls: speed cycling 1x -> 0.75x -> 0.5x (the sheet always opens at 1x and gives the player bar its own speed back on close), Restart, Done.

**Constants** (all in `tapSync.ts` / `timing.ts` unless noted)

| Constant | Value | Meaning |
|---|---|---|
| lead-in (app) | 3 s | playback starts this long before the line start, floored at 0 |
| `HOLD_THRESHOLD_MS` | 200 ms | shorter than this is a tap, longer is a hold |
| `MAX_TAP_GAP_FILL_SECONDS` | 1.0 s | a tap's provisional end = start + 1.0 s |
| `OVERLAP_BUFFER_SECONDS` | 0.01 s | gap left before the next word when capping |
| `SYNC_WINDOW_SECONDS` | 3 s | taps clamp to the line start/end +-3 s, floored at 0 (`clampSyncTime`) |
| `STOP_AFTER_END_SECONDS` | 1 s | playback auto-stops this long after the line end |
| stop check (app) | about 30 Hz | cadence of the auto-stop check |
| output latency (app) | 0 s iOS / 0 s Android | subtracted from every press time; tune on device |

**State machine** (`createTapSync`, `press`, `release`, `shouldStop`, `commitTapSync`; time is injected, so it is testable):
0. **Input events.** Use raw down/up events, not tap or long-press recognisers: native `touchstart` / `touchend` (React Native: `onResponderGrant` / `onResponderRelease`, plus terminate treated as release and termination requests refused); on web use `pointerdown` / `pointerup` (and `pointercancel` as release). Gesture libraries are not suitable here, see the CLAUDE.md gotcha.
1. **Press** = the current word starts at the clamped player time. Its end is set equal to start until release.
2. **Release** = the word ends. A **hold** (>= 200 ms) keeps its release point as the end. A **tap** (< 200 ms) is gap-filled: the provisional end is start + 1.0 s, corrected by the next press (the previous word's end is pulled back to just before the new start when needed).
3. Overlaps are never corrected against the next word's *stale* start (a word not re-tapped in this pass). The session tracks `synced` indices.
4. No auto-stop while a finger is down. Otherwise playback stops at line end + 1 s ("Stopped after the line").
5. After the last word: "Line done" with **Play it back**, **Redo**, **Done**.
6. **Restart / Redo** discards this pass for the line (lines already finished in a keep-going session are kept).
7. **Commit** (`commitTapSync`) writes the line back sanitized, and caps the last tapped word at the next timed word's start - 0.01 (never below its own start). Partial passes commit only the tapped words.
8. **Keep going:** finishing a line continues into the following line with the next line's bounds; Done commits every line in order.
9. Delete and structural edits are off while syncing.
10. Haptic tick on each press (phone only).
11. The pad announces the current word to screen readers and offers an "activate" action for non-touch users.

**Sanitizing.** Every edit and commit runs `sanitizeSegments` / `sanitizeSegment`: each word inside its segment, end >= start, segment bounds recomputed from its words. This prevents the old `start=0` / `end=-0.005` corruption.

### 3.8 Vocal-gap callouts

Inline between lines: "Possible missing lyrics, 0:42-0:51" with Play and Insert lines.

- Only **evidenced** gaps are shown (`evidenced` true: the lead vocal sings, no words there, and reference lyrics place lines there). Audio-only "suspect" gaps are too noisy and not flagged (same as web).
- `openVocalGaps(doc)` is derived from the current segments: a gap closes as soon as a timed word lands in it (50 ms edge tolerance, `GAP_EDGE_TOLERANCE_S`) and reopens on undo. The server payload is never mutated.
- **Pending:** if untimed words already sit between the gap's neighbouring timed words (typed or inserted but not synced), the button becomes **Sync timing** and opens Tap To Sync for that line. Insert is not offered, which would duplicate the words.
- **Insert lines:** `insertGapLines(doc, gap)`.
  - Prefers `synced_reference_lines`, whose reference segments carry word timings inside the gap; these keep their timings, fitted into the room between neighbouring lines.
  - Other reference lines go in **untimed**, bounded by the gap, so Finish stays blocked until they are Tap-synced.
  - New lines inherit the singer of the following (else preceding) line.
- **No references:** nothing is inserted; the result has `needsText: true`. The UI asks for the words (a text sheet), then `insertGapText(doc, gap, text)` spreads them evenly across the gap, one line per newline, flagged `timing_estimated`. **A wordless line is never created**: it would reach gen and render a fake INSTRUMENTAL.
- Gap markers also show on the scrubber waveform.

### 3.9 Untimed gate

`countUntimedWords` / `firstUntimed`. While any word is untimed the Lyrics CTA is disabled and reads "2 words need timing" with the hint "Takes you to the first one"; tapping it selects and scrolls to the first untimed word. The same gate guards Finish (including opening Finish from the step header) and the preview (a 422 from the preview sends the person back to Lyrics).

### 3.10 Player bar details

- Back 5 s button; scrubber = vocals waveform (tap or drag to seek). Waveform comes from `vocals-peaks` (uint8, base64, 400 per second): `decodePeaks`, `downsamplePeaks` with **fractional bucket strides** (integer strides drift about 0.4 s at 3 min), then `normalizePeaks` so quiet vocals are not a flat line. The app draws 240 bars.
- Source toggle **Vocals / Song**. Vocals makes words easy to hear. While stems are still separating, `audio/vocals` and `vocals-peaks` return 202 + Retry-After: the toggle reads "Vocals soon", playback falls back to Song, and the waveform shows "Loading the vocals..." with up to 3 ready-retries honouring Retry-After. Never show empty waveforms.
- Speed toggles 1x <-> 0.75x (0.5x is only in Tap To Sync). Position updates about 30 Hz for word highlighting.
- Audio errors: "We couldn't load the audio..." or "We couldn't play the audio. Tap play to try again." A failed play is caught; AbortError is benign. Gate playback until audio is ready.

## 4. Finish step

Summary at the top: "Lyrics: 3 fixes" or "Lyrics: approved as is"; "Instrumental: Clean" (Change); "Duet: 2 singers" when it is a duet.

### 4.1 Instrumental chooser

Two large cards: **Clean** ("Just the music, no backing singers") and **With backing vocals** ("Keeps the backing singers").

**Recommendation chain** (`recommendInstrumental(data)` returns `{choice, confident}`):
1. `auto_approval.backing.resolved_selection`, if it is `clean` or `with_backing`;
2. else `backing_vocals_analysis.recommended_selection`, if valid;
3. else `with_backing` if `backing_vocals_analysis.has_audible_content`, otherwise `clean`.

`confident` is `auto_approval.backing.confident`, trusted only when the choice came from a valid server value. Any unknown value anywhere, or `review_needed`, gives `{clean, confident: false}`. Use only this unified scorer; the legacy heuristic disagreed on 15% of jobs.

| State | Presentation |
|---|---|
| confident | recommended card preselected, badge "Recommended"; the chooser may collapse to "Instrumental: Clean, Change" |
| unsure | recommended choice preselected, **no badge**, line "Have a listen and choose" |
| custom instrumental | chooser hidden |

**A/B listening.** One shared playhead and scrubber. Tapping a card's play (or the card while playing) switches the audible stem **at the same position**: two preloaded players, one muted, kept in lockstep. Lockstep checks every 1 s and re-seeks the follower when drift exceeds **0.25 s** (`LOCKSTEP_MAX_DRIFT`).

**Backing-vocals strip.** Waveform of the backing stem from `waveform-data`, shown only once the stems are complete (before that gen falls back to the full mix). The strip is full width, with peaks normalized (raw values are absolute and look flat). Audible segments are highlighted. Tapping a highlighted region selects With backing and auditions it from there.

**Copy guidance.** "If you can hear the lead singer coming through, choose Clean." Never say "bleed". Clean stays one tap away (customers lean clean, 38%).

**Stems still separating** (`stemsReady(options, audioComplete)` false: `instrumental_options` lacks a stem URL, or `audio_complete` is false; when `audio_complete` is absent on an older backend, both stems having a URL means ready):
- The cards show a spinner and "Separating the music... usually 2-3 minutes".
- Poll `instrumental-urls` every **15 s** for up to **10 min**. Keep the result in separate state from the lyrics, and re-read `auto_approval` and the analysis from each poll. Errors just wait for the next tick.
- The Lyrics step is **not** blocked, so the singer can move on.
- **Make my video waits until the stems land**, as on the web: the button reads "Waiting for the music to finish separating...". Gen cannot resolve a selection without the stem files (`"auto"` with a missing stem is a 400). The screen says they can leave; the draft is kept and the job card shows Review again.

**Audio focus.** Only one audible thing at a time on Finish: starting the A/B players pauses the preview video, and starting the preview pauses the A/B players (a small owner registry: `claim(owner)` pauses the others).

**Audio errors:** re-fetch `instrumental-urls` (at most 3 refreshes per source). Media URLs are never persisted.

### 4.2 Preview video (optional)

"Preview the video" calls `POST preview-video`.

| Response | Meaning | Action |
|---|---|---|
| `{status: "success", preview_hash}` | cache hit, local render or the synchronous GCE fallback | ready at once |
| `{status: "generating", preview_hash}` | async render | poll `GET .../{hash}/status` every **3 s** for up to **5 min** |
| status `ready` / `generating` / `error` | poll results | ready -> play; error -> message + Retry |
| 422 | untimed lines | back to Lyrics, first untimed |

- After **30 s** of generating, show "Starting a video server, this can take a couple of minutes" (cold encoder; Cloudflare caps requests at 100 s).
- Video player height is capped at **40% of the screen** so the instrumental choice stays visible.
- **Preview audio: Song / Instrumental** toggle overlays the chosen stem on the muted video, in lockstep (drift <= 0.25 s). The preview mp4 itself carries the with-vocals audio. Previewing audio is separate from the final choice.
- Stems must be playable while the preview encodes: preload them and show "Loading..." until playing.
- Notes: "Black-background sync check" and, when the job has `translation_language`, "Translations are added after review".
- The preview URL is built at play time from `preview-video/{hash}` plus the token (gen 302s to a signed URL).
- When the preview becomes ready it renders at the bottom of the scrolling step, so scroll it into view once it has laid out (otherwise it lands below the fold).
- The A/B scrubber stays a plain progress bar: there is no clean-stem waveform endpoint (the backing strip above is the only drawn stem).
- Never wait for the preview before finishing; complete cancels it server side.

### 4.3 Make my video (three calls, same as the web)

1. `POST /api/jobs/{id}/corrections` with `{corrections: {...doc, lines: corrected_segments}, is_duet}`. Gen runs `sanitize_corrections` here, the server-side timing safety net.
2. A fresh `GET correction-data`.
3. `POST /api/review/{id}/complete` with that doc + `instrumental_selection` + `is_duet`.

**`instrumental_selection`**

| Situation | Sent |
|---|---|
| backing verdict was confident and the singer did not change it | `auto` (server resolves) |
| singer chose or changed it | `clean` or `with_backing` |
| stems missing | **nothing**: button disabled (never `auto` with a missing stem) |

**`is_duet` rules** (gen's `/corrections` overwrites it with no latch; gen says it does not reliably round-trip in `correction-data`):
- Call 1 (`saveCorrections`): send `is_duet` **only when known**: the loaded doc had `is_duet: true`, or the singer toggled duet. Otherwise omit it (a default false once wiped a duet).
- Call 3 (`completeReview`): send `isDuet ?? false`, as the web does. Gen latches `is_duet` up only, so false never un-duets a job.
- Turning duet off (`setDuet(doc, false)`) strips every `singer` field from lines and words.

**Behaviour**
- Re-entry guard: a second tap, or a retry after a network drop between calls 1 and 3, must not submit twice. The calls are idempotent on gen, so a retry resumes safely.
- Show "Saving..." through the slow calls, then a success state (about 1.2 s, with a success haptic), then leave **to the Make tab**, whose job card shows the render's progress. Do not flash back to the review. Native: `router.dismissTo('/make')`; the back interceptor only handles back/pop actions, so this leaves cleanly. Refresh the jobs list and the job on success.
- **Locking while saving.** From the first tap until success: the instrumental chooser is locked (listening still works), edits are frozen, the button shows a spinner, and leaving the review does not cancel the submit (nothing navigates afterwards if the screen was closed).
- **Submit recovery.** The submit lives in the review body (not the Finish step), so switching steps cannot drop or repeat it. If a call fails in a way that may hide a landed submit (network error, unreadable response, or a 400/409 on retry because the job left review), ask `GET /api/jobs/{id}` first: if the job is past review (rendering, or done) count it as success. Otherwise show the error: "no connection" for network failures, a generic message for gen refusals, with Retry.
- **On success** the store is finished: the draft is deleted and edits are disabled, so a late edit cannot resurrect a draft.
- **Back on Finish** returns to Lyrics first (draft kept), unless saving or already submitted.
- **Failure keeps the draft.** Show the reason and Retry. This includes the Firestore 1 MB error, which gen self-heals: keep the edits and retry.

## 5. Errors and resilience

**Retry schedule** (loader, transient errors only: 5xx, 429, network): wait **5, 15, 30, 60 s** (`RETRY_SCHEDULE_S`), then give up and show the error with a Retry button. A `Retry-After` header on the error replaces the scheduled wait for that attempt.

| Error | Treatment |
|---|---|
| network / 5xx / 429 | retry on schedule |
| 404 | **final**: "We couldn't find this review." |
| 401 | final: gen client signs the person out |
| other 4xx | final, no retry |
| 202 on `audio/vocals`, `vocals-peaks` | not an error: separating; fall back to Song, wait Retry-After |
| 404 on those after `audio_complete` | final |

- Copy is always "Trouble reaching Nomad Karaoke" with Retry. **Never "Access denied"**; Cloudflare blocks look like network errors.
- **Telemetry** (`POST client-events`): `lyrics_load_failed`, `waveform_slow`, `waveform_failed`. Throttled to once per 60 s per event type. Never send edit-log or edit count as a metric.
- **No persisted media URLs or tokens.** URLs are built at play time (`mediaUrl(apiBase, jobId, path, token)`): absolute URLs pass through and only get the token if on the API origin; `/api/...` hangs off the API base; any other path is relative to `/api/review/{jobId}`. Instrumental options come back as relative proxy paths.
- Gen deploys can skew from clients: every new field needs an old-backend fallback.
- Edits never leave the phone until gen accepts them; a failed save leaves the draft.
- Toasts and error banners must actually display (they were silently dropped on the web once).

## 6. Input equivalents

| Action | Phone | Desktop web at narrow width |
|---|---|---|
| Select a line and play it | tap line | click line |
| Open word sheet | tap word in selected line | click word (double-click not required) |
| Close sheet / go back a step | swipe down on sheet, system back | Esc, browser back |
| Next / previous issue | tap arrows in the bar | `]` / `[`, or Alt+Down / Alt+Up; arrows also clickable |
| Play / pause | play button | Space (when no text field or pad has focus) |
| Back 5 s | back button | Left arrow on the scrubber, or `J` |
| Seek | tap or drag waveform | click or drag waveform; arrow keys on focused scrubber |
| Source toggle, speed | tap | click, or `V` / `R` |
| TAP pad press / release | finger down / up on the pad (touch down/up) | Space bar keydown / keyup (ignore key repeat), `pointerdown` / `pointerup` on the pad |
| Nudge a step | tap [-] / [+] | click; Left / Right arrows on a focused nudge row (Shift = 0.1 s) |
| Long-press repeat | hold button (400 ms, then every 120 ms) | key repeat on held arrow key, or hold mouse button with the same timings |
| Undo | header Undo | Ctrl/Cmd+Z |
| Cycle duet singer | tap chip | click chip |
| Delete line / word | More menu / word sheet | the same menu; Delete key only when it cannot be hit by accident |
| Jump to first untimed word | tap disabled CTA | click disabled CTA, or Enter on it |
| Edit text save | Save button | Save button; Ctrl/Cmd+Enter |
| Choose instrumental | tap card | click card; Left / Right when the group is focused |
| A/B switch | tap a card's play | click, or `A` / `B` |
| Tap tick | haptic | none; optional click sound |

Rules for web parity: keep a visible on-screen control for every keyboard shortcut (touch laptops exist), keep targets at least 44 px, no hover-only affordances, and do not claim a desktop power-user gesture is "unsupported on mobile": give it a touch equivalent.

## 7. What stays web-only (spec §2 non-goals)

Reached through "Continue on web". The app shows "Edit audio on the web" when a job sits in the audio-edit step.

| Tool | Why it stays on the web |
|---|---|
| Audio editor (tempo, fades, trims) | runs before review, waveform-precision tool, rarely used |
| Reference-lyrics management: search, paste or replace all lyrics, add-lyrics, custom-lyrics AI mode, find/replace | desktop text work; add-lyrics has silent-rejection edge cases |
| AI auto-correct panel (rerun, browse suggestions) | gen already applies suggestions server side; the phone shows corrections and can revert one span |
| Custom instrumental upload, mute regions | file handling and precision; review-time uploads are not conformed |
| Per-word singer overrides in duets | shown and preserved, edited per line only |
| Waveform drag-resize of word edges | replaced by nudges and Tap To Sync; the stop rules still bound nudges (next word, including the next line's first word, and audio end) |
| Replay mode, annotations, edit-log metrics | not needed; never use edit-log as a metric |
| Translated lyrics display | chosen at creation, added after review; review shows only the note |

## 8. Endpoints

All exist in gen already. Auth is a Bearer token, or `?token=` on media URLs (native players cannot set headers). Media path is the API base plus the path below.

| Method | Path | Use |
|---|---|---|
| POST | `/api/jobs/{id}/start-review` | Load, idempotent (web does not call it) |
| GET | `/api/review/{id}/correction-data` | Main payload, idempotent, AI-pre-applied, no URL signing |
| GET | `/api/review/{id}/instrumental-urls` | Stem poll (15 s, 10 min) and URL refresh (max 3); returns options, `audio_complete`, analysis, `auto_approval` |
| GET | `/api/review/{id}/instrumental-audio/{option}` | A/B stems, `clean` or `with_backing` (`?token=`) |
| GET | `/api/review/{id}/audio/vocals` and `/audio` | Player sources; 202 + Retry-After while separating |
| GET | `/api/review/{id}/vocals-peaks` | Scrubber waveform (uint8 base64, 400/s, about 225 KB; 202 while separating) |
| GET | `/api/review/{id}/waveform-data` | Backing-vocals strip |
| POST | `/api/review/{id}/preview-video` | Start preview; `success` or `generating` + `preview_hash` |
| GET | `/api/review/{id}/preview-video/{hash}/status` | Poll every 3 s up to 5 min: `ready` / `generating` / `error` |
| GET | `/api/review/{id}/preview-video/{hash}` | The mp4 (302 to signed URL; `?token=`) |
| POST | `/api/review/{id}/sessions` | Save draft before Continue on web (trigger `manual`) |
| POST | `/api/jobs/{id}/corrections` | Finish call 1 (server sanitizes) |
| POST | `/api/review/{id}/complete` | Finish call 3 |
| POST | `/api/internal/encoding-worker/warmup/{id}`, `/heartbeat/{id}` | On open; heartbeat every 60 s while open |
| POST | `/api/client-events` | Degradation telemetry, throttled 60 s per type |
| POST | `/api/users/auth/handoff-token` | Continue on web (Phase 1 flow) |

**Round-trip rule.** Send back the whole correction doc that was received, with only the corrected segments (and `is_duet`, when known) replaced. Never rebuild the doc from the client model; unknown fields must survive.

## 9. review-core function index

| Behaviour | Function(s) |
|---|---|
| Step plan | `planSteps` |
| Issues, order | `collectIssues`, `ISSUE_KIND_ORDER`, `LONG_SECONDS` |
| Vocal gaps | `openVocalGaps`, `insertGapLines`, `insertGapText` |
| Word / line edits | `editWordText`, `deleteWord`, `splitWord`, `mergeWords`, `applyLineText`, `splitLine`, `mergeLines`, `insertLine`, `insertLineEstimated`, `deleteLine` |
| Timing | `setWordTiming`, `shiftLine`, `sanitizeSegments`, `clampSyncTime`, `countUntimedWords`, `firstUntimed`, `activeLine` |
| Tap To Sync | `createTapSync`, `press`, `release`, `shouldStop`, `commitTapSync` |
| AI spans | `revertAiSpan` |
| Duet | `setLineSinger`, `setDuet` |
| Instrumental | `recommendInstrumental`, `stemsReady` |
| Direction | `lineDirection` |
| Waveform | `decodePeaks`, `downsamplePeaks`, `normalizePeaks` |
| Media URLs | `mediaUrl` |
| Undo | `UndoStack` (100 snapshots; a held button is one entry) |
| Doc model | `fromCorrectionData`, `toSubmission` |
