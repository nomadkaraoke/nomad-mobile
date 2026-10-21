# Phase 3c "Discover: your voice"

**Phase:** VISION.md Phase 3 "Discover", third sub-phase (after [3a](2026-10-21-mobile-phase3a-discover-core-design.md) and [3b](2026-10-21-mobile-phase3b-music-data-design.md)). Repos: nomad-mobile, karaoke-decide (data + API), karaoke-gen (read-only data source). Learnings: [survey](2026-10-21-mobile-phase3-discover-survey.md) §8, §12, §13.

## 1. Intent

"Can I actually sing this?" is decide's second core problem (decide VISION). Andrew (2026-10-21):

> i think we should take the vocal range detection and map it to an estimated voice type (eg soprano, baritone) as accurately as we can, then get creative about how to map that to artists and songs which match the user's voice

and on sources: "the flash batch is probably the most reasonable way to tackle that, but let's also see if we can find a source for ultrastar data as that's a great idea".

3c delivers: a phone mic test that measures the user's range and estimates their voice type; a per-song vocal range dataset built from several sources with confidence tiers; a "singable for me" filter and fit badges, with transposition taken into account.

## 2. Goals, non-goals, anti-goals

**Goals**
1. A guided mic test (≈ 60 s): lowest comfortable note, highest comfortable note, and a short free sing, measured on the phone in real time. Result: range (e.g. "A2–F4"), comfortable middle, and "likely Baritone" with a confidence line. Saved to the decide profile; can be redone.
2. A song vocal range dataset (`song_vocal_range`) for as many karaoke songs as possible, each with low, high, tessitura (P10–P90), and a confidence tier: **measured** (pitch-tracked from real vocals), **notes** (UltraStar note files, octave-repaired), **estimated** (Gemini Flash), **rough** (artist prior only).
3. Matching: a fit score per song for the user, minimised over transposition −4…+4 semitones and an octave allowance (singing an octave down/up, mild penalty). Shown as a badge ("Fits your voice", "Fits in −2", "Stretch") and a **Singable** filter + "Fits my voice" sort in Discover.
4. A self-reported fallback: users who skip the mic test can pick a voice type (or "Not sure: lower / middle / higher") and still get the filter at artist-level precision.

**Non-goals**
- Mic-based scoring/competition (post-release).
- Rendering key-shifted karaoke tracks in gen (kjbox shifts live; later).
- Crowd singability ratings (Phase 4 collects them; 3c only reserves the fields).

**Anti-goals**
- Confidently wrong labels: every voice type and song range carries its confidence and the UI words it as "likely".
- Mic audio leaving the phone. Only the derived numbers are uploaded.
- Song data fabricated from copyrighted lyrics in tests (use synthetic tones and invented lyrics; memory `feedback_no_copyrighted_lyrics_in_tests`).

## 3. Constraints
- Expo SDK 57, New Architecture. Mic capture via `expo-audio` 57 `useAudioStream` (live PCM, already installed) + `pitchy` (MIT, McLeod Pitch Method). No GPL code (`pitchfinder` is GPL-3). Microphone permission strings in all 33 locales; iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` via the expo-audio config plugin.
- A `PitchSource` interface so a fake source (bundled synthetic WAV, `EXPO_PUBLIC_FAKE_MIC=<name>`, honoured only in dev/local builds) drives Maestro.
- Data jobs run inside GCP or on NomadPC; nothing bulk through Andrew's Mac, except public torrents via Transmission if ever needed (memory `feedback_no_bulk_data_through_mac`).
- Gemini Flash batch via the AI Studio key only; Andrew approved the batch ("the flash batch is probably the most reasonable way"); budget ≤ $80, Batch API.
- Pitch analysis of our own audio uses classical pyin (librosa) on CPU (no ML model, so no AI-spend question).
- Infra policy as 3a §9.4: Claude's GCP credentials are read-only. The UltraStar parse runs as a step of decide's existing weekly `mb-refresh` job (BigQuery + GCS rights already; the 78 MB zip is fetched inside GCP). The gen-stem analysis needs read access to gen's bucket and a job definition: written in Pulumi in the PR for Andrew to apply; until then the NomadPC analysis and UltraStar data carry the measured/notes tiers. The Gemini batch is a one-off script run from the session (it sends only artist/title prompts and receives small JSON; no bulk data) and its results are loaded through the same `mb-refresh` step from a GCS-free path: committed as a compressed CSV under `data/vocal_range/` in decide if < 10 MB, else Andrew uploads it.

## 4. The mic test (mobile)

### 4.1 Signal path
- `useAudioStream` mono float32 at the device rate (44.1/48 kHz), ~100 ms buffers → 2048-sample frames, hop 512 → `pitchy` `PitchDetector.forFloat32Array` → (frequency, clarity). Gate: RMS above a calibrated noise floor (first 1 s of silence) and clarity ≥ 0.9; clamp 60–1200 Hz.
- Convert to MIDI (float). A note **counts** when held ≥ 500 ms within ±50 cents (rolling median).
- Pure logic in `packages/core/src/voice/` (frame → notes, held-note detection, range summary, voice-type classifier, song fit), unit-tested with synthetic sine/sawtooth sweeps and vibrato.

### 4.2 Flow (`/discover/voice`)
1. Intro: "Find a quiet spot. Sing 'laaa'. Takes about a minute." Permission prompt.
2. **Lowest note:** "Slide down to the lowest note you can hold comfortably" — live pitch ribbon on a piano strip (Skia via `@nomad/ui`), held notes light up.
3. **Highest note:** same upward.
4. **Sing something you know** (15 s, optional): gives the comfortable middle (tessitura).
5. Result: range on a keyboard, "Likely **Baritone**" (or "between Baritone and Tenor"), confidence line, "Save" / "Try again". Saved to decide `PUT /api/my/voice` `{low_midi, high_midi, comfort_low, comfort_high, voice_type, confidence, method: mic|self, measured_at}`.

### 4.3 Voice type classification
Typical ranges: bass E2–E4, baritone A2–A4, tenor C3–C5, alto F3–F5, mezzo A3–A5, soprano C4–C6. Score each type by overlap of the user's held range and comfortable middle with the type's range (comfort weighted higher); report the best, or two adjacent types when they're within a margin. Untrained singers have narrow ranges, so use the comfortable middle more than the extremes. Confidence from held-note count and stability.

### 4.4 Self-report
"Skip the test" → pick Bass … Soprano or "Not sure: lower / middle / higher voice" → stored with `method: self` and a default range for that type.

## 5. Song vocal range dataset (decide data jobs)

All sources write rows `(song_key, source, low_midi, high_midi, p10, p50, p90, octave_confidence, lead_part)` into a BigQuery table `karaoke_decide.song_vocal_range_sources`; a merge step picks the best per song into `song_vocal_range`, which the daily `catalog.db` build (3a §5.1) copies in as `songs.vr_*` columns plus `artists.vr_*` aggregates.

### 5.1 Measured (our audio) — highest trust
- **gen jobs:** ~1,198 jobs with word-timed `lyrics/corrections.json` and kept inputs (survey §12). Cloud Run job reads vocals stems where present (446) and re-separates the rest from inputs via the existing audio-separator GPU job (< $10), runs pyin restricted to word windows, outputs P5/P95 as low/high and P10/P50/P90 tessitura. Duets: per singer where the corrections mark parts; otherwise flag.
- **NOMAD catalog vocals on NomadPC** (1,488 stems): run the same analysis script on NomadPC between shows (venv with librosa), upload only the CSV. No word timings there: gate frames by stem energy instead.
- Join to `song_key` via job artist/title through the search service's normalizer.
- New gen jobs: add a step to the audio worker later (backlog), so coverage grows with every order.

### 5.2 UltraStar notes
- Source: archive.org `usdb_20250204` (27,136 .txt in a 78 MB zip, no login). A Cloud Run job pulls it to GCS and parses it (MIDI = pitch + 60; keep `:` and `*`, drop `F/R/G`; `#RELATIVE`, `P1/P2` duets, CP1252 detection). Duration-weighted P10/P50/P90, raw min/max, span.
- Join via `#VIDEO a=<youtubeId>` to community versions where possible, else normalized artist/title through the search normalizer.
- **Octave repair** (scoring ignores octaves, so files are often an octave off): choose the octave shift (−24…+24 in 12s) that puts the median in the lead singer's plausible register (male ≈ A2–A4, female ≈ E3–E5, from `lead_gender`), then validate against measured songs where both exist; publish span/tessitura always, absolute values with `octave_confidence`. Report the measured octave-error rate in the session record.
- Incremental refresh from usdb.animux.de (songs changed since 2025-02-04) needs a USDB account → Andrew to-do; skip in 3c.

### 5.3 Gemini Flash estimates (the long tail)
- One-off Batch API run (AI Studio key) over the top ~20k artists (by LB listeners among karaoke artists) and top ~50k karaoke songs: structured JSON `{low_note, high_note, typical_low, typical_high, voice_type, confidence, unknown}`; "unknown" allowed.
- Calibrate against measured + UltraStar songs and Wikidata P412 (`p412_mbid.csv`, CC0): per popularity band, keep estimates only where median error ≤ 3 semitones; otherwise fall back to the artist prior. Record calibration stats.
- Budget ≤ $80; abort if the estimate exceeds it.

### 5.4 Artist priors (rough)
`lead_gender` (MB solo gender + band lead-vocal member gender, ~65% of top artists) → register prior; Wikidata P412 where present. Used when nothing better exists, with wider tolerance.

## 6. Matching and UI
- Fit: for transposition t ∈ [−4, +4] (and ±12 with a penalty), cost = semitones the song's P10–P90 falls outside the user's comfortable range + half-weight for P5/P95 outside the full range; best t wins. Buckets: **Fits** (cost 0 at t=0), **Fits in ±n** (cost 0 at t≠0), **Stretch** (small cost), hidden/penalised beyond.
- Implemented once in `packages/core/src/voice/fit.ts` and mirrored in decide (Python) with a shared fixture table (same parity approach as the search matcher).
- Discover: a **Singable** chip (on = Fits + Fits in ±n), sort "Fits my voice", and a fit badge on rows and the song page ("Fits your voice", "Try it 2 keys down"), with the tier shown on the song page ("measured", "from note data", "estimated", "rough").
- Recommendations v2 adds a fit term (and the filter) server-side using the saved voice profile.
- Offline: fit is computed on the phone from `vr_*` columns added to the offline list (offline schema bump).

## 7. Tests
- core: synthetic signal → held notes → range → voice type; fit table parity with Python.
- decide: UltraStar parser + octave repair (fixture .txt files written for the test with invented lyrics), merge precedence, calibration maths, fit SQL.
- mobile jest: voice screens with a fake `PitchSource`.
- Maestro (iOS + Android): `voice-1-test` (fake mic WAV of a synthetic baritone-range scale → result "Baritone" → saved), `voice-2-self-report`, `voice-3-singable` (Singable chip filters the list; badge shows).
- Real-device check on Andrew's phone via the release APK `~/Downloads/nomad-karaoke-phase3c-release.apk` (mic accuracy can't be proven in an emulator).
- Data job outputs: coverage counts per tier, UltraStar octave-error rate, Gemini calibration error per band, recorded in the session record.

## 8. Claude's calls
- `expo-audio` stream + `pitchy` rather than a new native module.
- pyin (classical) for our audio, not torchcrepe.
- UltraStar from the archive.org dump; no USDB account in 3c.
- Gemini batch ≤ $80, calibrated, kept per popularity band.
- Fit computed in both TS and Python with a shared fixture table.

## 9. Andrew to-dos
1. Optional USDB account for incremental UltraStar refresh.
2. Phone test of the mic flow (the real accuracy check).
