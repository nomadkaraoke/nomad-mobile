# Phase 3d "Discover: voice session"

**Phase:** VISION.md Phase 3 "Discover", fourth sub-phase, **in the release** (Andrew, 2026-10-22: "i'd ideally like this to be part of release too"). Builds on [3a](2026-10-21-mobile-phase3a-discover-core-design.md) (recommendations v2, catalog.db, quiz, profile), [3b](2026-10-21-mobile-phase3b-music-data-design.md) (listening history) and [3c](2026-10-21-mobile-phase3c-vocal-range-design.md) (mic pitch pipeline, voice types, song vocal ranges, UltraStar, fit/transposition). Repos: nomad-mobile, karaoke-decide; existing audio tools (flacfetch for downloads, python-audio-separator / gen's GPU separation job). Learnings: [survey](2026-10-21-mobile-phase3-discover-survey.md) §8, §12, §13.

## 1. Intent

A singer who wants better recommendations spends about 30 minutes at home "speedrunning" 5–10 karaoke songs in the app. Each song plays from a good community karaoke version on YouTube; after each one a short quiz captures what it was like to sing, and (if they agree) the app records them singing. Each answer picks the next most informative song. The session ends when we're confident, or whenever they stop, and they leave with **a confident voice type and a list of songs that suit it**.

Andrew (2026-10-22):

> get the user to speedrun trying to sing a bunch of karaoke songs in a row, each with a button to launch a good quality community karaoke version of a song on youtube for them to sing, possibly even with the player embedded in the app if possible? then answering a quiz after each one to capture what it was like to sing, to gather super rich data on their vocal range and song preferences. we could pre-determine a selection of eg 1000 songs which are varied enough and match our other criteria, download the audio for all of those and run analyses on them, test with me to figure out what audio analysis process and markers etc. actually deliver value, then make it useful for any user by matching enough songs they know well enough to try singing
>
> i'm imagining users would do this process at home, spend maybe 30 minutes trying to sing 5-10 songs using our app guiding them and suggesting things to try singing, capturing the info they give us and using that to suggest the next song to try singing, until we've gathered rich enough data to confidently give them an assessment of their voice type, or until the user gets bored/wants to end the process (then we can still show them our estimation of their voice type based on anything they did sing and data captured).

On recording: "we should capture the audio for sure if the user is willing, and do as much as we can with it to provide value for the user, storing recordings for future analyses too … a user who doesn't want to be recorded can still get value from the quiz alone though."

On posture and warm-up, from Andrew's own karaoke sheet ("Lindrew karaoke recommendations", Google Sheet `1VtInjcGXAtpNr7vnTjjl8KSMfnid-HepxEag5yRL8P4`, tab "Andrew"): notes such as "yes if warm", "needs warm-up", "need to be a little warmed up but not too much", "only if feeling flamboyant", "too low if you sing it low, too high if high", "octave is mixed between verse and chorus", "stay in the lower octave or try to raise the key", "need to practice at home first", "too hard without practice", "comes in immediately with no intro time", "Funbox version is great".

On tuning: "we build this all out then i use it as the first test user, us tune it and iterate until it reliably gives good suggestions for me, then make it useful to any user".

On personal pools: "for users who we already have rich music listening data … a way to ask the system to fetch, analyse and prepare a bunch more songs … tailored to this user's preferences/taste … in an overnight or background batch job … might be a feature which only unlocks for users who have paid something or who have connected a minimum amount of music history data".

## 2. Goals, non-goals, anti-goals

**Goals**
1. A guided at-home voice session in the app: setup (posture, warm-up, recording consent, headphones), a sequence of songs chosen adaptively, a post-song quiz, optional recording, and a result screen (voice type with confidence, suited songs).
2. A **shared song pool** of ~1,000 analysed songs, each with a good community karaoke version on YouTube, widely known, deliberately varied.
3. **Song analysis** per pool song combining every source we have: original audio and separated vocals (pitch track, markers), UltraStar notes (3c), Spotify audio features (BigQuery), MusicBrainz/LB metadata, catalog.db facets.
4. **Recording** (opt-in): on-device pitch analysis during the song (3c pipeline) plus an upload of the compressed recording for later analysis; delete-my-recordings.
5. A **voice model** per user that combines quiz answers, recordings, context (posture, warmth, fatigue, song position) and the song analyses into a voice type, range, comfortable range and confidence, and feeds recommendations v2 (fit + preferences).
6. **Personal pool**: an "analyse my music" background job for users with rich listening history (gated), adding ~20 of their well-known songs per batch; analysed songs join the shared pool.
7. **Andrew as the first tuning user**: a private debug view and an agreement metric; the session opens to everyone only after it reliably predicts Andrew's "good / no" judgements.

**Non-goals**
- Live scoring or a karaoke game (post-release "mic-based scoring").
- Rendering our own karaoke videos for the session (we use existing community YouTube versions).
- Group sessions.

**Anti-goals**
- A cold or tired attempt treated as a hard range limit.
- A voice type stated with more confidence than the data supports.
- Recording without explicit consent, or recordings the user can't delete.
- Uncapped background compute per user.

## 3. Constraints
- Same principles as Phase 3 (VISION): native, one gen account (session requires sign-in), offline states stated (the session needs a connection; recordings queue if the upload fails), no new paid services without Andrew.
- YouTube: an embedded player only through YouTube's official iframe player (e.g. `react-native-youtube-iframe` / WebView) within YouTube's API Terms; no downloading YouTube streams for playback. If embedding fails for a video (embedding disabled), fall back to opening the YouTube app/link and a "back to the session" prompt.
- Audio acquisition for analysis: our existing pipeline (flacfetch → original audio; audio-separator → vocals). Never stream bulk audio through Andrew's Mac (memory `feedback_no_bulk_data_through_mac`); jobs run on GCP or the existing download box. Public UltraStar torrents via Transmission on Andrew's Mac are fine (Andrew, 2026-10-21) but only small derived outputs go up.
- Zero AI spend in the GCP project: any LLM use goes through the AI Studio key (memory `project_no_ai_spend_in_gcp_project`). Classical DSP and open models on our compute are fine.
- Recordings are personal data: stored in a private GCS bucket keyed by user, never public, deleted on request and on account deletion (Phase 6 `DELETE /api/users/me` must cover them).
- i18n (33 locales), testIDs, RTL, mobile rules as in 3a.

## 4. The session (mobile)

### 4.1 Entry
Discover's "Improve your picks" card and Me → Your music profile → "Find your voice (30 min)". Shows what it involves (5–10 songs, ~30 min, best with headphones, at home).

### 4.2 Setup screen
- **How are you singing?** Standing / Sitting / Lying down.
- **Voice right now?** Cold / A bit warmed up / Fully warmed up. If cold: a guided 60-second warm-up (sirens/hums using the 3c pitch ribbon) is offered.
- **Record me singing?** Yes / No, with a one-paragraph explanation (what's kept, why, how to delete). Changeable later in Me.
- **Headphones?** Yes / No (no → we warn that the backing track will leak into the mic and treat recordings as lower confidence; echo cancellation on).
- Posture and warmth stay changeable mid-session from a small chip.

### 4.3 Song loop
For each song:
1. **Pick card**: title, artist, why it was picked ("checks your upper range", "a song you love"), "I know this" / "Skip, don't know it" / "Something else".
2. **Play**: embedded YouTube player of the chosen community karaoke version; recording (if consented) runs in parallel with the 3c pitch pipeline (live ribbon optional); "Stop early" allowed.
3. **Quiz** (one screen, ~10 s, taps; Q1–Q2 mandatory, rest skippable):
   1. How did that feel? Loved it / Fine / Not for me.
   2. Where did it sit for your voice? Too low / Comfortable / Too high / Hard at both ends (pre-filled from the recording when available: "You were reaching for G4 in the chorus").
   3. How hard was it? Easy / A bit of a stretch / Couldn't hit some parts.
   4. How well did you know it? Knew it well / Partly / Barely.
   5. Would you sing it at karaoke? Yes / Yes, in a different key / No.
   6. Would it work if…? You were more warmed up / In a different key / An octave lower or higher / After some practice / It's fine as is.
   7. Voice now: Fresh / Warm / Getting tired.
   8. This karaoke version: Good / Not great (+ reason chips: no intro, wrong lyrics, bad sync, low quality).
   9. Optional tags: fast lyrics, long instrumental gaps, needed a warm-up, great crowd song, only if I'm in the mood.
4. **Next**: the app picks the next song (§6) or offers to finish.

### 4.4 End
When confidence passes a threshold (§6.3), or the user taps Finish, or "Getting tired" twice: the **result screen** — voice type ("likely Baritone, could stretch to Tenor"), range on a keyboard, comfortable range, confidence and what would raise it ("sing 2 more higher songs when warm"), and **songs that suit you** (recommendations v2 with the new fit term, plus the session's "loved" songs). Partial sessions still produce a result with lower confidence. Results feed Me → music profile and the singable filter.

### 4.5 Recording details
- 3c `PitchSource` from the mic; frames analysed on device in real time (held notes, range, time out of tune vs the song's notes when UltraStar/pitch-track data exists).
- Upload: Opus/AAC mono ~32–48 kbps after the song (≈1–1.5 MB per song), to decide `POST /api/voice/recordings` → private GCS `gs://<bucket>/voice-recordings/<user_id>/<session_id>/<n>.m4a` with metadata (song_key, version video id, posture, warmth, headphones, device). Queued and retried if offline.
- Delete: Me → "Delete my recordings" removes all objects and rows.

## 5. Song pool and analysis (decide + data jobs)

### 5.1 Shared pool (~1,000 songs)
Selection job (BigQuery + catalog.db + the KN community catalogue):
- has at least one **community** karaoke version on YouTube (KN community data) with a known-good channel (Nomad, Funbox, CC, etc.; a per-version quality score from §5.4 and from session answers Q8);
- widely known (LB listeners / Spotify popularity top band);
- **varied** by stratified sampling over: lead gender, range and tessitura (3c data where present), range span, octave jumps between sections, lyric speed, decade, genre, energy, duet flag;
- prefers songs with **UltraStar notes** (Andrew 2026-10-22) and with measured stems from gen.
The pool table (`voice_pool_songs`) records why each song is in it (stratum) so coverage can be audited.

### 5.2 Per-song analysis
Inputs: original audio (flacfetch), separated vocals (audio-separator; reuse gen stems where they exist), UltraStar notes, Spotify audio features, catalog facets, lyrics timing where available (gen corrections or LRC).
Markers (computed, then validated against Andrew's sessions — §7; the set is expected to change):
- range: P5/P95, comfortable P10–P90 (3c), time above/below thresholds;
- **octave ambiguity**: whether the melody sits between two octaves for a typical male/female range ("too low if you sing it low, too high if high"), and octave jumps between verse and chorus;
- sustained high notes (count, duration), belting proxies (loudness of high notes in stems);
- lyric density (syllables/second), longest phrase without a breath gap, intro length before the first vocal ("comes in immediately with no intro time");
- key and transposition options (from 3c fit);
- energy/valence (Spotify), duration.
Output rows in `song_voice_analysis` (BigQuery), copied into catalog.db for request-time use; analysis code versioned so re-runs are comparable.

### 5.3 Personal pool ("analyse my music")
- Eligible: users who have bought credits at least once **or** have rich history (≥ 1,000 listens or ≥ 200 songs with play counts from Last.fm/LB/exports). Cap: one batch of 20 songs per user per 30 days (tunable); Andrew exempt.
- Picks: the user's best-known songs (play count, loved) that have a community karaoke version and aren't analysed yet.
- Runs overnight as a queued job (Cloud Run job or the existing separation infrastructure); per-batch cost estimate shown in admin; in-app "your songs are ready" (push in Phase 6).
- Every analysed song joins the shared pool (`source = personal`, the requesting user not recorded on the shared row).

### 5.4 Community version choice
For each pool song, which YouTube karaoke version to play: start from KN community data and our brand priority, then learn from session answers (Q8) and early-exit rates; store per-version scores.

## 6. Adaptive selection and the voice model

### 6.1 State per user
Range estimate (low/high/comfortable with uncertainty), voice-type posterior over bass…soprano, preference signals, context history.

### 6.2 Evidence model
Each song attempt produces evidence weighted by context:
- recording pitch data (high weight with headphones, lower without);
- quiz answers (Q2/Q3/Q6 for range; Q1/Q5/Q9 for preference);
- **context discounts**: a miss while "Cold" or "Getting tired" counts less; Q4 "Barely knew it" discounts range evidence; "Would work if warmed up / with practice / in a different key" turns a "No" into evidence about the song's demands, not the user's limit.
Andrew's sheet is the first labelled set for calibrating these weights.

### 6.3 Next-song choice and stopping
Choose the song that most reduces uncertainty about the voice type/range (e.g. expected information gain) among songs the user knows (their history, quiz artists, "I know this"), respecting warm-up order: start in the predicted comfortable middle, hold range-stretching songs until warmth ≥ "a bit warmed up", avoid repeating the same stratum. Stop when the posterior's top type (or adjacent pair) passes a confidence threshold and the comfortable range is stable, or on user request / fatigue.

### 6.4 Outputs
Voice profile (extends 3c's `PUT /api/my/voice` with `method: session`, evidence count, confidence) and per-song personal labels (user_songs with sung-in-session, feel, fit, key-change hint), consumed by recommendations v2 (fit term + preferences) and the singable filter.

## 7. Tuning with Andrew first
- Seed labels: import Andrew's sheet ("Andrew" tab: Artist, Title, Duet?, good?, Sung?, Notes) as labelled evidence for his account (read via the Google Drive connector; no scraping).
- Andrew runs sessions; a **private debug view** (admin-only; decide `/api/admin/voice/...` + a hidden app screen) shows, per song, the computed markers next to his answers and recordings.
- **Agreement metric**: predict Andrew's good/no and range answers for held-out songs; iterate on markers and weights until agreement is high enough for Andrew to sign off. The session is behind a flag (on for admins) until then.
- After sign-off: open to everyone; keep collecting labels to calibrate across voices.

## 8. Backend API sketch (decide)
- `POST /api/voice/sessions` (create; setup answers) → session id.
- `GET /api/voice/sessions/{id}/next` → next song (song_key, version video id, reason) or `done`.
- `POST /api/voice/sessions/{id}/attempts` (song_key, version, quiz answers, context, on-device pitch summary, recording upload id).
- `POST /api/voice/recordings` (multipart audio; consent required) and `DELETE /api/voice/recordings`.
- `GET /api/voice/sessions/{id}/result`.
- `POST /api/voice/personal-pool` (request a batch; eligibility + cap) and `GET` status.
- Admin: debug view endpoints.
Collections/tables: `voice_sessions`, `voice_attempts`, `voice_recordings` (Firestore), `voice_pool_songs`, `song_voice_analysis` (BigQuery → catalog.db).

## 9. Tests
- Selection/stopping logic as pure code with simulated users (synthetic voices with known ranges and noisy answers) — sessions should converge in ≤ 10 songs for most simulated voices.
- Evidence weighting table tests (cold/tired/unknown-song discounts).
- Analysis markers on synthetic audio and invented UltraStar files (no real lyrics).
- Mobile: component tests per screen; Maestro flow with a fake YouTube player and the 3c fake mic (WAV) through a 3-song session to a result.
- A replay harness for Andrew's labelled data to report the agreement metric.

## 10. Order
1. Pool selection + analysis pipeline (data, no UI) and Andrew's sheet import.
2. Debug view; Andrew reviews markers on his known songs.
3. Session backend (selection, evidence, result) behind an admin flag.
4. Mobile session UI (setup, player, quiz, recording, result).
5. Andrew's tuning sessions → iterate → sign-off.
6. Personal pool job + gate.
7. Open to everyone.

## 10a. Additions after the builder check (2026-10-22, Claude's calls)
- **Depends on 3a + 3c being merged** (3b is optional: without listening history the session uses quiz artists and "I know this"). 3c's voice-type labels and fit logic are reused, extended with session evidence.
- **Pool target 1,000, minimum 600** at launch if strata can't all be filled; a coverage report lists empty strata.
- **Embedding probe**: before a song is offered, the version's embeddability is checked (oEmbed / player error) and cached; non-embeddable versions are skipped unless no alternative exists.
- **Recording format**: AAC-LC mono 48 kbps, 44.1 kHz; on-device pitch summary uploaded with the attempt even when the audio isn't.
- **Retention**: recordings kept until the user deletes them or their account; no automatic expiry in the first release (Andrew wants them for future analyses); revisit in Phase 6 privacy work.
- **Confidence threshold**: posterior ≥ 0.75 on one type (or ≥ 0.85 on an adjacent pair, reported as "between X and Y") and comfortable-range bounds stable within 2 semitones over the last 2 attempts; defaults, tuned with Andrew.
- **Agreement metric for sign-off**: ≥ 80% agreement with Andrew's good/no on ≥ 30 held-out songs, plus his qualitative OK.
- **Personal pool cap and costs**: 20 songs / 30 days; estimated cost per batch reported in the admin view; a global monthly budget guard (default $20) pauses batches if exceeded.

## 10b. Resolutions after the builder check (2026-10-22)
Andrew decided:
- **Audio for analysis comes from Spotify only, via flacfetch**, and must not risk the flacfetch Spotify Premium account: downloads are throttled so the account never "listens" to more than **24 hours of audio in any rolling 24-hour period**, and the shared-pool backfill is spread over about a week. Default budget: 12 hours of audio per 24 h (≈ 190 songs/day at ~3.7 min), 2 downloads at a time, randomised spacing, each file deleted after upload. Private trackers and YouTube downloads are not used for this. The personal pool shares the same budget (it queues behind it).
- **If the embedded YouTube player doesn't work** (the 2025 "Error 153" WebView failures), use the link fallback: the app opens the video in YouTube and schedules a local notification ("Done singing? Tap to rate it and get your next song") so the user comes back to answer the quiz and continue. Run a device spike first to decide which path is default.

Claude's calls on the builder's other questions:
- **Sequencing:** plan 3d once 3a and 3c are merged; reuse 3c's PitchSource, voice types, fit and song range data rather than re-planning them.
- **Separation:** a new batch "separate-only" GPU Cloud Run job built from gen's existing audio-separation image, fed a GCS manifest of songs; Pulumi written for Andrew to apply. Expect almost no reusable gen stems (30-day retention purge), so plan for fresh separation of the whole pool (~$10 one-off on L4).
- **Feedback granularity in the release:** overall range and comfort only ("your highest held note was G4"). Song-position feedback ("in the chorus") needs aligning the recording with the community version and is a later improvement.
- **Recording:** use the 3c mic stream (expo-audio `useAudioStream` PCM) for both pitch and the stored recording; encode on device if a small dependency allows it, otherwise upload compressed PCM (FLAC/WAV) and encode server-side. No echo cancellation (not available in expo-audio): rely on headphones and mark no-headphone recordings lower confidence.
- **Version choice:** KN community rows (`karaokenerds_community.Watch` = YouTube id, `Brand` = KN brand code mapped to a display name) from our BigQuery copy (never karaokenerds.com), plus session Q8 answers.
- **Paid-user gate:** decide reads gen's user documents in the shared Firestore (as it already reads gen sessions) to check for a past credit purchase.
- **Extra marker source:** `spotify_audio_analysis_sections` (section timing, key/tempo changes) for verse/chorus and intro-length markers.

## 11. Claude's calls
- Sub-phase 3d inside Phase 3 (release scope per Andrew).
- Embedded official YouTube player with a link fallback.
- Expected-information-gain style selection with warm-up ordering; thresholds tuned with Andrew.
- Gate: bought credits or rich history; 20 songs per 30 days.
- Personal-pool songs join the shared pool.
- Recordings stored privately, user-deletable, no auto-expiry yet.

## 12. Andrew to-dos
1. Be the first test user (sessions + reviewing the debug view).
2. Approve the personal-pool budget guard default.
3. Confirm Google Drive access to his sheet stays available for the import (it's read via the connector).
