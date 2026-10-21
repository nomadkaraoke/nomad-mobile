# Mobile Phase 3c "Discover: your voice" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 60-second phone mic test that measures the singer's range and names a likely voice type, a per-song vocal range dataset with confidence tiers, and a "Singable" filter, sort and fit badges (transposition-aware) in Discover.

**Architecture:**
- **Pure logic, two languages.** `packages/core/src/voice/` does frames → held notes → range → voice type, plus song fit. decide's `karaoke_decide/vocal_range/fit.py` does the same fit. A fixture table owned by decide proves they agree (the same approach as the search matcher).
- **Data (decide).** Four sources write rows into BigQuery `song_vocal_range_sources`: gen stems and NOMAD stems (pyin), UltraStar notes and a Gemini Flash batch. A new `vocal_range` step in the weekly `mb-refresh` job calibrates, merges and exports them. `catalog.db` (3a) and the phone's `offline.db` gain `vr_*` columns.
- **API (decide).** Voice profile endpoints. Recommendations v2 gets a fit term, a `singable` filter and a `fit` sort. There is also a public per-song range endpoint.
- **App.** A `PitchSource` interface: a real one on `expo-audio` `useAudioStream` and a fake one that plays a bundled synthetic WAV. `pitchy` does the pitch detection. The `/discover/voice` screens and fit badges are built on these.

**Tech Stack:**
- Mobile: Expo SDK 57, `expo-audio` 57.0.5 (`useAudioStream`, `requestRecordingPermissionsAsync`, `setAudioModeAsync`), `pitchy` (MIT), Skia via `@nomad/ui`, TanStack Query, Zustand + MMKV, use-intl, jest-expo, Maestro.
- decide: Python 3.11, FastAPI, BigQuery, GCS, SQLite, `librosa` pyin (vocal-analysis image and NomadPC venv only), `google-genai` (AI Studio key), Pulumi.

**Spec:** `docs/superpowers/specs/2026-10-21-mobile-phase3c-vocal-range-design.md`. Also read:
- 3a spec `2026-10-21-mobile-phase3a-discover-core-design.md` §5 (catalog.db, v2 API), §8 and §9;
- survey `2026-10-21-mobile-phase3-discover-survey.md` §8, §12, §13.

**3a seam (read before Tasks 12, 14, 19, 20).** This plan assumes 3a and 3b are implemented as specified. No 3a plan existed when this was written, so the names of 3a code are the spec's. Before each task that touches 3a code, open the merged 3a code (or the 3a plan, `docs/superpowers/plans/2026-10-21-mobile-phase3a-discover-core.md`) and use its real names:
- the catalog builder step in `mb-refresh`;
- the v2 engine's filter/scoring/RecSong modules;
- the decide test API and local stack;
- the Discover filter bar, row and "Improve your picks" card;
- the music profile screen;
- the `stack.js` decide actions.

Where this plan says "3a's X", that is a seam to align, not a new file.

**Repos and worktrees:**
- decide: `/Users/andrew/Projects/nomadkaraoke/karaoke-decide-phase3-discover`.
- mobile: `/Users/andrew/Projects/nomadkaraoke/nomad-mobile-phase3-discover`.
- gen: `/Users/andrew/Projects/nomadkaraoke/karaoke-gen`, read-only reference.

Order: Part A → D → C (decide PRs; deploy) → B → E.

## Global Constraints

- **Pitch:**
  - MIDI is a float with C4 = 60 and A4 = 440 Hz: `midi = 69 + 12·log2(hz/440)`.
  - Mic frames are 2048 samples with hop 512, at the buffer's actual `sampleRate` (44.1 or 48 kHz; the fake source uses 16 kHz).
  - A frame counts as voiced when clarity ≥ 0.9, RMS is above the noise floor, and the pitch is 60–1200 Hz.
- **Noise floor:** `max(0.003, 3 × P90(rms))` over the first 1.0 s of each mic step. The UI says "Stay quiet for a second…" during that second.
- **Held note:** held ≥ 500 ms within ±50 cents (rolling median), gap ≤ 100 ms.
- **Voice types (MIDI):**
  - bass E2–E4 (40–64);
  - baritone A2–A4 (45–69);
  - tenor C3–C5 (48–72);
  - alto F3–F5 (53–77);
  - mezzo A3–A5 (57–81);
  - soprano C4–C6 (60–84).
  - The UI always words a type as "likely".
- **Fit:**
  - transposition t ∈ −4…+4, octave o ∈ {0, −12, +12}.
  - `OCTAVE_PENALTY = 0.75`, `KEY_PENALTY = 0.05` per semitone, `STRETCH_MAX = 2.0`.
  - Tier tolerance: measured 0, notes 0, estimated 1, rough 2 semitones.
  - Singable = bucket `fits` or `fitsIn`.
- **Tiers:**
  - `measured` (pyin on our vocals), `notes` (UltraStar, octave-repaired), `estimated` (Gemini, calibrated), `rough` (artist prior).
  - UI labels: "measured", "from note data", "estimated", "rough".
  - offline.db int codes: 4, 3, 2, 1.
- **Privacy:**
  - Mic audio never leaves the phone. Only the profile numbers are uploaded.
  - The decide `VoiceProfileIn` model uses `extra="forbid"`.
- **Licences:**
  - No GPL: `pitchy` is MIT; never use `pitchfinder`.
  - UltraStar comes from archive.org `usdb_20250204` (no USDB account in 3c).
  - Wikidata P412 is CC0. Commit it with a SOURCES note.
- **Tests:** synthetic tones and invented lyrics only. Never real lyrics in fixtures, commits or tool output.
- **Gemini:**
  - Batch API on the AI Studio key only (`GOOGLE_AI_STUDIO_KEY`); `genai.Client(api_key=…)`, never Vertex.
  - Budget ≤ $80. The script aborts before submitting if the estimate × 1.5 exceeds it.
  - It sends only artist/title prompts.
- **Data movement:** nothing bulk goes through Andrew's Mac. The UltraStar zip is fetched inside GCP. NomadPC uploads only a CSV. Committed data under decide `data/vocal_range/` stays < 10 MB in total.
- **Infra:**
  - Claude's GCP credentials are read-only. New jobs and IAM go in decide `infrastructure/__main__.py`, listed for Andrew to apply with `/gcp-admin`.
  - Code degrades gracefully until then: missing inputs log WARNING, never ERROR.
  - ERROR is only for real failures, one per run (workspace #alerts rule).
- **Mobile rules:**
  - No JSX string literals. Keys go under `voice.*` (and `permissions.microphone`), translated to 33 locales (`env -u GEMINI_API_KEY pnpm i18n:translate`, `pnpm i18n:check`).
  - Every interactive element has a `testID` prefixed `voice-` or `fit-`.
  - Skia only inside `packages/ui`.
  - Native deps via `npx expo install`.
  - Tests never go under `src/app`.
- **Mobile coordination:** before merging shared files, message Phase 5 Tonight (session nomadkaraoke-a7). Shared files: i18n, ui, core index, package.json/lock, app.config, offline schema.
- **decide:**
  - Bump `tool.poetry.version` per PR. Unit coverage ≥ 70%.
  - `librosa` is not added to the main image. It lives in the `vocal-analysis` poetry group and `Dockerfile.vocal-analysis`.

## Review Focus

1. **Mic permission denied, or "don't ask again".** The test must not hang on a spinner. Expected: a "Microphone is off" state with an Open Settings button (`Linking.openSettings()`) and "Pick my voice type instead" (self-report). Test in Task 17 (`useVoiceTest` → `permission-blocked`) and Task 18 (screen test).
2. **Noisy room or silent singer: no held note within 20 s of a step.** The result must never come from zero or one notes. Expected: "We couldn't hear a held note" with Try again and Skip to self-report. Save stays disabled until `summarizeRange` returns non-null. Test in Task 2 (`summarizeRange` → null below 2 held notes or a span below 3) and Task 17 (step timeout).
3. **Detector octave errors and slides.** A single-frame octave jump (MPM doubling) or a glide through notes must not stretch the range. A user who sings the "high" step lower than the "low" step still gets min/max over all held notes. Test in Task 1 (octave spike of 3 frames → no held note; 4 st/s slide → none) and Task 2 (range is order-independent).
4. **Leaving mid-test (back, background, tab switch).** The mic must be released and no buffers processed after unmount. iOS audio mode returns to playback (`allowsRecording: false`), otherwise review playback later routes to the earpiece. Test in Task 16 (mic source `stop` restores the audio mode) and Task 17 (unmount → `stop` called, later buffers ignored).
5. **Save fails (offline, decide 5xx or 503 warming_up), or the user is signed out.** The measured result must not be lost. It stays in the local voice store as `pending`, is retried on the next Discover mount or foreground, and badges still use it. Test in Task 18 (`useSaveVoiceProfile` keeps `pending` on 503 and retries).

---

## Part A: Core voice logic

### Task 1: Notes, frame gating and held notes (`@nomad/core`)

**Files:**
- Create: `packages/core/src/voice/notes.ts`, `packages/core/src/voice/frames.ts`, `packages/core/src/voice/heldNotes.ts`, `packages/core/src/voice/testSignals.ts` (test helpers, exported only from the voice folder)
- Modify: `packages/core/src/index.ts` (export `voice/*` public API)
- Test: `packages/core/src/voice/__tests__/notes.test.ts`, `frames.test.ts`, `heldNotes.test.ts`

**Interfaces:**
- Produces:
  - `hzToMidi(hz: number): number`, `midiToHz(m: number): number`.
  - `midiToName(m: number): string` (rounded, sharps: `"A#2"`), `nameToMidi(name: string): number | null` (accepts `#`, `b`, `♯`, `♭`).
  - `type PitchFrame = { t: number; hz: number | null; clarity: number; rms: number }` (t in seconds).
  - `type VoicedFrame = { t: number; midi: number }`.
  - `noiseFloor(frames: PitchFrame[]): number`.
  - `gateFrames(frames: PitchFrame[], floor: number, opts?: { minClarity?: number; minHz?: number; maxHz?: number }): VoicedFrame[]`.
  - `type HeldNote = { start: number; end: number; midi: number; note: number }` (`note = Math.round(midi)`).
  - `findHeldNotes(frames: VoicedFrame[], opts?: { minHoldS?: number; tolCents?: number; maxGapS?: number; medianWindowS?: number }): HeldNote[]`.
  - Defaults: 0.5, 50, 0.1, 0.2.
  - `testSignals.ts`: `framesFor(notes: {midi: number; dur: number; vibratoCents?: number; vibratoHz?: number}[], hop = 0.01): VoicedFrame[]` and `slide(fromMidi, toMidi, semisPerSec, hop = 0.01): VoicedFrame[]`.

- [ ] **Step 1: Write the failing tests**

```ts
test('A4 is 69 and C4 is 60', () => { expect(hzToMidi(440)).toBeCloseTo(69); expect(hzToMidi(261.626)).toBeCloseTo(60, 3); });
test('names round-trip', () => { expect(midiToName(45)).toBe('A2'); expect(nameToMidi('C#4')).toBe(61); expect(nameToMidi('E♭3')).toBe(51); expect(nameToMidi('H9')).toBeNull(); });
test('noise floor is 3×P90 of the first second, at least 0.003', () => {
  const quiet = Array.from({ length: 150 }, (_, i) => ({ t: i / 100, hz: null, clarity: 0, rms: i < 100 ? 0.002 : 0.5 }));
  expect(noiseFloor(quiet)).toBeCloseTo(0.006, 6);              // frames after 1.0 s are ignored
  expect(noiseFloor(quiet.map((f) => ({ ...f, rms: 0 })))).toBe(0.003);
});
test('gate drops low clarity, quiet and out-of-band frames', () => { /* clarity 0.89, rms below floor, 55 Hz, 1300 Hz all dropped; 220 Hz clarity 0.95 kept as midi 57 */ });
test('a 0.6 s held A2 is one held note', () => expect(findHeldNotes(framesFor([{ midi: 45, dur: 0.6 }]))).toEqual([expect.objectContaining({ note: 45 })]));
test('0.4 s is too short', () => expect(findHeldNotes(framesFor([{ midi: 45, dur: 0.4 }]))).toEqual([]));
test('vibrato ±40 cents at 5.5 Hz still counts', () => expect(findHeldNotes(framesFor([{ midi: 57, dur: 1, vibratoCents: 40, vibratoHz: 5.5 }]))).toHaveLength(1));
test('a slide at 4 semitones/s holds nothing', () => expect(findHeldNotes(slide(45, 57, 4))).toEqual([]));
test('a 3-frame octave spike neither splits nor extends a held note', () => {
  const f = framesFor([{ midi: 50, dur: 1 }]); for (const i of [40, 41, 42]) f[i] = { ...f[i], midi: 62 };
  expect(findHeldNotes(f).map((n) => n.note)).toEqual([50]);
});
test('a 150 ms gap splits notes', () => { /* 0.6 s at 50, gap 0.15 s, 0.6 s at 50 → two notes */ });
```

- [ ] **Step 2: Run** `pnpm --filter @nomad/core test voice`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement.** `findHeldNotes` is not determined by its tests alone, so its algorithm is given here:

```
sort by t; split into segments wherever t[i] − t[i−1] > maxGapS
per segment: r[i] = median(midi of frames with t in [t[i] − medianWindowS, t[i]])   // rolling median smooths vibrato and spikes
  run = [first index]; runMed = r[first]
  for each next i: if |r[i] − runMed| ≤ tolCents/100 → append, runMed = median(r over run)
                   else close run, start new run at i
  close run: if (t_last − t_first) ≥ minHoldS → HeldNote{start: t_first, end: t_last, midi: runMed, note: round(runMed)}
```

- [ ] **Step 4: Run** `pnpm --filter @nomad/core test voice`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): voice notes, frame gating and held-note detection`.

### Task 2: Range summary, voice-type classifier, self-report presets, WAV parsing (`@nomad/core`)

**Files:**
- Create: `packages/core/src/voice/range.ts`, `voiceType.ts`, `selfReport.ts`, `wav.ts`
- Test: `packages/core/src/voice/__tests__/range.test.ts`, `voiceType.test.ts`, `selfReport.test.ts`, `wav.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `type VoiceType = 'bass' | 'baritone' | 'tenor' | 'alto' | 'mezzo' | 'soprano'`.
  - `VOICE_TYPES: readonly { type: VoiceType; lo: number; hi: number }[]`, in that order with the Global Constraints values.
  - `type RangeSummary = { low: number; high: number; comfortLow: number; comfortHigh: number; heldCount: number; freeVoicedS: number }`.
  - `summarizeRange(held: HeldNote[], free: VoicedFrame[]): RangeSummary | null`.
  - `type Classification = { type: VoiceType; between: VoiceType | null; margin: number; confidence: 'low' | 'medium' | 'high'; scores: Record<VoiceType, number> }`.
  - `classifyVoice(r: RangeSummary): Classification`.
  - `type Register = 'lower' | 'middle' | 'higher'`.
  - `selfReportProfile(choice: VoiceType | Register): { low: number; high: number; comfortLow: number; comfortHigh: number; voiceType: VoiceType | null; register: Register | null }`.
  - `parseWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array }`. It accepts PCM16 or float32, mono or stereo (channel 0), and throws `Error('unsupported wav')` otherwise.

**Pinned rules:**
- **Percentiles** (here and in `noiseFloor`): nearest-rank over frames, `sorted[ceil(p·n) − 1]`.
- **Range:**
  - `low` = min and `high` = max of `held[].note` over every phase.
  - Return null when there are fewer than 2 held notes or `high − low < 3`.
- **Comfort:**
  - When `free` has ≥ 3 s voiced (`freeVoicedS` = frame count × median frame spacing), comfort is P10/P90 of `free` midi, rounded.
  - Otherwise `low + round(0.25·span)` and `high − round(0.25·span)`.
  - Either way it is clamped into [low, high].
- **Classifier:**
  - `cc = (comfortLow + comfortHigh)/2`, `tc = (lo + hi)/2`, `outside = max(0, lo − low) + max(0, high − hi)`.
  - `score = 1 − (0.65·|cc − tc|/6 + 0.35·outside/12)`.
  - Best = argmax; ties go to the earlier type in `VOICE_TYPES`.
  - `between` = the runner-up when it is adjacent in `VOICE_TYPES` and `best − runnerUp < 0.08`.
  - `margin = best − runnerUp`.
  - Confidence is `high` if heldCount ≥ 6, span ≥ 12, freeVoicedS ≥ 5 and margin ≥ 0.1. It is `low` if heldCount < 3 or span < 7. Otherwise `medium`.
- **Self-report:**
  - A type gives `{low: lo, high: hi, comfortLow: lo+5, comfortHigh: hi−5}`.
  - `lower` gives 40–69 (comfort 47–62).
  - `middle` gives 48–77 (comfort 55–70).
  - `higher` gives 57–84 (comfort 64–79).

- [ ] **Step 1: Write the failing tests**

```ts
const held = (notes: number[]) => notes.map((n, i) => ({ start: i, end: i + 0.6, midi: n, note: n }));
test('baritone: held A2..E4, free sing E3..C4', () => {
  const r = summarizeRange(held([45, 47, 62, 64]), framesFor([{ midi: 52, dur: 2 }, { midi: 57, dur: 2 }, { midi: 60, dur: 2 }]))!;
  expect(r).toMatchObject({ low: 45, high: 64, comfortLow: 52, comfortHigh: 60 });   // cc 56: baritone 0.892, bass 0.567, tenor 0.479
  expect(classifyVoice(r)).toMatchObject({ type: 'baritone', between: null });
});
test('soprano: 60..84, comfort 67..79', () => expect(classifyVoice({ low: 60, high: 84, comfortLow: 67, comfortHigh: 79, heldCount: 6, freeVoicedS: 6 }).type).toBe('soprano'));
test('between baritone and tenor when scores tie', () =>
  expect(classifyVoice({ low: 47, high: 70, comfortLow: 53, comfortHigh: 64, heldCount: 4, freeVoicedS: 6 })).toMatchObject({ type: 'baritone', between: 'tenor' }));
test('range is order-independent (high step sung lower than low step)', () => expect(summarizeRange(held([64, 45, 62]), [])).toMatchObject({ low: 45, high: 64 }));
test('null with one held note or a span under 3', () => { expect(summarizeRange(held([50]), [])).toBeNull(); expect(summarizeRange(held([50, 52]), [])).toBeNull(); });
test('no free sing → comfort from quartiles', () => expect(summarizeRange(held([45, 61]), [])).toMatchObject({ comfortLow: 49, comfortHigh: 57 }));
test('confidence low for narrow untrained range', () => expect(classifyVoice({ low: 50, high: 56, comfortLow: 51, comfortHigh: 55, heldCount: 2, freeVoicedS: 0 }).confidence).toBe('low'));
test('self-report presets', () => { expect(selfReportProfile('tenor')).toMatchObject({ low: 48, high: 72, comfortLow: 53, comfortHigh: 67, voiceType: 'tenor' }); expect(selfReportProfile('lower')).toMatchObject({ register: 'lower', voiceType: null, low: 40 }); });
test('parseWav reads a PCM16 mono header and samples', () => { /* build a 44-byte header + [0, 16384, -32768] → sampleRate 16000, samples ≈ [0, 0.5, -1] */ });
```

- [ ] **Step 2: Run** `pnpm --filter @nomad/core test voice`. Expected: FAIL.
- [ ] **Step 3: Implement** the pinned rules.
- [ ] **Step 4: Run** `pnpm --filter @nomad/core test voice && pnpm --filter @nomad/core typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): range summary, voice-type classifier, self-report presets, wav parser`.

### Task 3: Song fit in Python + the shared fixture table (decide)

**Files:**
- Create: `karaoke_decide/vocal_range/__init__.py`, `karaoke_decide/vocal_range/notes.py`, `karaoke_decide/vocal_range/fit.py`, `tests/fixtures/voice/fit_cases.json`, `scripts/emit_voice_fixtures.py`
- Test: `tests/unit/vocal_range/test_fit.py`, `tests/unit/vocal_range/test_notes.py`

**Interfaces:**
- Produces:
  - `notes.hz_to_midi(hz) -> float`, `notes.note_name_to_midi(name: str) -> int | None` (same rules as TS `nameToMidi`), `notes.midi_to_name(m) -> str`.
  - `VOICE_TYPES: dict[str, tuple[int, int]]`.
  - `fit.VocalTier = Literal['measured','notes','estimated','rough']`.
  - `@dataclass(frozen=True) SongVocalRange(low: float, high: float, p10: float, p50: float, p90: float, tier: VocalTier, octave_confidence: float | None = None)`.
  - `@dataclass(frozen=True) UserVoiceRange(low: int, high: int, comfort_low: int, comfort_high: int)`.
  - `@dataclass(frozen=True) FitResult(bucket: Literal['fits','fitsIn','stretch','outside'], transpose: int, octave: int, cost: float, score: float)`.
  - `fit_song(user, song) -> FitResult`, `is_singable(fit) -> bool`.
  - Constants `OCTAVE_PENALTY = 0.75`, `KEY_PENALTY = 0.05`, `STRETCH_MAX = 2.0`, `TIER_TOLERANCE = {'measured': 0, 'notes': 0, 'estimated': 1, 'rough': 2}`.
  - Fixture schema: `[{"name", "user": {low, high, comfort_low, comfort_high}, "song": {low, high, p10, p50, p90, tier, octave_confidence}, "expect": {bucket, transpose, octave, cost, score}}]`.

**Algorithm** (pinned; both languages must match):

```
tol = TIER_TOLERANCE[tier]; octave_free = tier == 'notes' and (octave_confidence if not None else 1.0) < 0.5
outside(a, b, lo, hi) = max(0, lo - a) + max(0, b - hi)
for o in (0, -12, 12):            # this iteration order + strict '<' makes ties prefer o=0, then octave down
  for t in (0, -1, 1, -2, 2, -3, 3, -4, 4):   # ties prefer smaller |t|, then down
    s = t + o
    cost = outside(p10+s, p90+s, comfort_low-tol, comfort_high+tol) + 0.5*outside(low+s, high+s, user.low-tol, user.high+tol)
    score = cost + (0 if o == 0 or octave_free else OCTAVE_PENALTY) + KEY_PENALTY*abs(t)
    keep the first strictly-lower score
bucket = 'fits' if cost == 0 and t == 0 and (o == 0 or octave_free) else 'fitsIn' if cost == 0 else 'stretch' if cost <= STRETCH_MAX else 'outside'
cost, score rounded to 3 decimals
```

- [ ] **Step 1: Write the fixture table.** At least 16 named cases:
  - `fits_at_zero`, `fits_down_2`, `fits_up_3`, `fits_down_4_not_5`, `stretch_half_key_high`, `outside_too_wide`;
  - `octave_down_male_singing_female_song`, `octave_up`, `octave_free_notes_low_conf` (bucket `fits` with o=−12);
  - `estimated_tolerance_1`, `rough_tolerance_2`, `tie_prefers_zero_shift`, `tie_prefers_down`;
  - `ext_half_weight` (P5/P95 one semitone out → cost 0.5 → stretch), `exact_edge_inclusive`, `duet_wide_span_outside`.

  Put the expected values in by hand. `scripts/emit_voice_fixtures.py` only re-checks the table against `fit_song` and pretty-prints it, and fails on any mismatch.

- [ ] **Step 2: Write the failing tests**

```python
CASES = json.loads((FIXTURES / "voice" / "fit_cases.json").read_text())
@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fit_matches_fixture(case):
    r = fit_song(UserVoiceRange(**case["user"]), SongVocalRange(**case["song"]))
    assert (r.bucket, r.transpose, r.octave) == (case["expect"]["bucket"], case["expect"]["transpose"], case["expect"]["octave"])
    assert r.cost == pytest.approx(case["expect"]["cost"]) and r.score == pytest.approx(case["expect"]["score"])
def test_fixture_has_every_bucket_and_tier(): ...   # {fits, fitsIn, stretch, outside} and all four tiers present
def test_note_names(): assert note_name_to_midi("C#4") == 61 and note_name_to_midi("E♭3") == 51 and note_name_to_midi("x") is None
```

- [ ] **Step 3: Run** `poetry run pytest tests/unit/vocal_range -q`. Expected: FAIL.
- [ ] **Step 4: Implement** `notes.py` and `fit.py`.
- [ ] **Step 5: Run** the same command. Expected: PASS. Then `poetry run python scripts/emit_voice_fixtures.py --check` exits 0.
- [ ] **Step 6: Commit** (decide) `feat(vocal-range): song fit with transposition + shared fixture table`.

### Task 4: Song fit in TypeScript with parity (`@nomad/core`)

**Files:**
- Create: `packages/core/src/voice/fit.ts`, `packages/core/src/voice/__fixtures__/fit_cases.json` (copied)
- Modify: `scripts/sync-search-fixtures.mjs` (also copy `tests/fixtures/voice/fit_cases.json` → `packages/core/src/voice/__fixtures__/`), `packages/core/src/index.ts`
- Test: `packages/core/src/voice/__tests__/fit.parity.test.ts`

**Interfaces:**
- Consumes: the Task 3 fixture schema.
- Produces:
  - `type VocalTier = 'measured' | 'notes' | 'estimated' | 'rough'`.
  - `type SongVocalRange = { low; high; p10; p50; p90: number; tier: VocalTier; octaveConfidence: number | null }`.
  - `type UserVoiceRange = { low; high; comfortLow; comfortHigh: number }`.
  - `type FitBucket = 'fits' | 'fitsIn' | 'stretch' | 'outside'`.
  - `type FitResult = { bucket: FitBucket; transpose: number; octave: -12 | 0 | 12; cost: number; score: number }`.
  - `fitSong(user, song): FitResult`, `isSingable(f): boolean`.
  - `TIER_CODE: Record<VocalTier, 1|2|3|4>` and `tierFromCode(n): VocalTier | null`.

- [ ] **Step 1: Sync and write the parity test.** Run `DECIDE_DIR=../karaoke-decide-phase3-discover node scripts/sync-search-fixtures.mjs`.

```ts
const cases = require('../__fixtures__/fit_cases.json');
test.each(cases.map((c: any) => [c.name, c]))('%s matches decide', (_n, c: any) => {
  const r = fitSong({ low: c.user.low, high: c.user.high, comfortLow: c.user.comfort_low, comfortHigh: c.user.comfort_high },
    { ...c.song, octaveConfidence: c.song.octave_confidence ?? null });
  expect([r.bucket, r.transpose, r.octave]).toEqual([c.expect.bucket, c.expect.transpose, c.expect.octave]);
  expect(r.cost).toBeCloseTo(c.expect.cost, 6); expect(r.score).toBeCloseTo(c.expect.score, 6);
});
```

- [ ] **Step 2: Run** `pnpm --filter @nomad/core test fit`. Expected: FAIL.
- [ ] **Step 3: Implement** `fit.ts`. It is a line-for-line port of Task 3's algorithm, with the same iteration order.
- [ ] **Step 4: Run** `pnpm --filter @nomad/core test && pnpm test:coverage`. Expected: PASS, with packages/core ≥ 70% (voice/ ≥ 90%).
- [ ] **Step 5: Commit** (mobile) `feat(core): song fit with decide parity fixtures`.

---

## Part D: Song vocal range data (decide)

### Task 5: UltraStar parser and note statistics

**Files:**
- Create: `karaoke_decide/vocal_range/ultrastar.py`, `tests/fixtures/vocal_range/ultrastar/` (hand-written .txt with invented lyrics: `solo_utf8.txt`, `solo_cp1252.txt` (an `é` in the title), `relative.txt`, `duet_p1_p2.txt`, `freestyle_rap_golden.txt`, `bom_encoding_tag.txt`, `broken_no_bpm.txt`)
- Test: `tests/unit/vocal_range/test_ultrastar.py`

**Interfaces:**
- Produces:
  - `@dataclass UltraStarNote(beat: int, length: int, pitch: int, kind: str)`.
  - `@dataclass UltraStarSong(artist: str, title: str, language: str | None, year: int | None, video_id: str | None, bpm: float, gap_ms: float, relative: bool, parts: dict[str, list[UltraStarNote]])`. Part keys are `"P1"`, `"P2"`, or `"all"` for solos.
  - `parse_ultrastar(raw: bytes) -> UltraStarSong | None` (None when there is no `#BPM`, no `#ARTIST`/`#TITLE`, or no singable notes).
  - `@dataclass NoteStats(low: float, high: float, p10: float, p50: float, p90: float, span: float, sung_beats: int)`.
  - `note_stats(notes: list[UltraStarNote]) -> NoteStats | None`.
- **Rules:**
  - MIDI = pitch + 60.
  - Keep kinds `:` and `*`; drop `F`, `R`, `G`.
  - Percentiles are weighted by `length`; `low`/`high` are weighted P5/P95; `span = high − low`.
  - Decoding: honour `#ENCODING:`; else strip the BOM and try UTF-8; else CP1252.
  - `#VIDEO:` is parsed for `a=<id>` (USDB style) → `video_id`.
  - `#BPM` accepts a comma decimal.
  - Duet part markers are `P1`, `P2` and `P 1`.

- [ ] **Step 1: Write the failing tests:**
  - `test_solo_stats` (exact p10/p50/p90 for a 4-note fixture weighted 1:1:2:4);
  - `test_cp1252_title` (`"Café"`);
  - `test_freestyle_rap_golden` (`F`, `R` and `G` lines excluded from the stats; golden `*` notes kept);
  - `test_relative_parses` (`relative is True`, same note set);
  - `test_duet_parts` (`parts.keys() == {"P1","P2"}`);
  - `test_video_id_extracted` (`"a=abc123XYZ_-,co=cover.jpg"` → `"abc123XYZ_-"`);
  - `test_broken_returns_none`;
  - `test_comma_bpm`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/vocal_range/test_ultrastar.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(vocal-range): UltraStar .txt parser and duration-weighted note stats`.

### Task 6: Octave repair and validation statistics

**Files:**
- Create: `karaoke_decide/vocal_range/octave.py`
- Test: `tests/unit/vocal_range/test_octave.py`

**Interfaces:**
- Consumes: `NoteStats` (Task 5).
- Produces:
  - `REGISTERS = {'male': (45, 69), 'female': (52, 76), None: (45, 76)}`.
  - `repair_octave(stats: NoteStats, lead_gender: Literal['male','female'] | None) -> tuple[int, float]`, returning (shift, octave_confidence).
  - `shifted(stats, shift) -> NoteStats`.
  - `octave_error_rate(pairs: list[tuple[float, float]]) -> tuple[float, int]`. Pairs are (repaired p50, measured p50). It returns (rate, n). A pair is an error when |Δ| ≥ 9.
- **Rules:**
  - Candidate shifts are −24, −12, 0, 12, 24. Choose the one minimising |p50 + s − centre(register)|; ties go to 0.
  - `inside(s)` = `[p10+s, p90+s]` lies within the register ±2.
  - Confidence is 0.9 if exactly one shift is inside, 0.5 if more than one, 0.3 if none.
  - When `lead_gender is None`, multiply by 0.6.

- [ ] **Step 1: Write the failing tests:**
  - `test_male_song_written_octave_high_is_shifted_down` (p50 69 → shift −12, conf 0.9);
  - `test_female_in_register_untouched` (shift 0);
  - `test_unknown_gender_ambiguous_conf` (≤ 0.54);
  - `test_two_octaves_off`;
  - `test_error_rate_counts_near_octave_only` (pairs Δ 2, 12, 8.9, 9 → rate 0.5, n 4).
- [ ] **Step 2: Run** `poetry run pytest tests/unit/vocal_range/test_octave.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(vocal-range): UltraStar octave repair + octave-error rate`.

### Task 7: pyin vocal analysis + NomadPC stem run

**Files:**
- Create: `karaoke_decide/vocal_range/pitch.py`, `scripts/vocal_range/analyze_nomad_stems.py`, `scripts/vocal_range/requirements-analysis.txt` (`librosa`, `soundfile`, `numpy`; pinned), `data/vocal_range/nomad_measured.csv.gz` (output, committed in Step 7)
- Modify: `pyproject.toml` (new optional group `vocal-analysis` with `librosa`, `soundfile`)
- Test: `tests/unit/vocal_range/test_pitch.py` (`pytest.importorskip("librosa")`; CI installs the group for unit tests)

**Interfaces:**
- Produces:
  - `@dataclass PitchStats(low: float, high: float, p10: float, p50: float, p90: float, voiced_s: float)`.
  - `analyze_vocals(y: np.ndarray, sr: int, windows: list[tuple[float, float]] | None = None) -> PitchStats | None`.
- **Rules:**
  - Resample to 16 kHz; `librosa.pyin(fmin=65, fmax=1100, frame_length=1024, hop_length=320)`.
  - Keep frames where `voiced_flag` is true and `voiced_prob ≥ 0.5`.
  - With `windows`, keep only frames inside them (word timings).
  - Without `windows` (energy gating), keep only frames with RMS dB ≥ (P95 RMS dB − 25).
  - low/high = P5/P95 and p10/p50/p90 of the kept MIDI.
  - Return None when `voiced_s < 20`.
- CSV columns (both measured sources): `source_id,artist,title,lead_part,low_midi,high_midi,p10,p50,p90,voiced_seconds`.

- [ ] **Step 1: Write the failing tests** (synthetic signals only):
  - `test_sine_scale_stats`: 30 s of a 5-harmonic tone stepping 50→62, with exact-to-0.3 p10/p90.
  - `test_word_windows_exclude_outside_frames`: a loud 80 Hz tone outside the windows does not lower `low`.
  - `test_energy_gating_ignores_bleed`: a −40 dB tone at 1000 Hz under a −6 dB voice line does not raise `high`.
  - `test_short_returns_none`.
- [ ] **Step 2: Run** `poetry install --with vocal-analysis && poetry run pytest tests/unit/vocal_range/test_pitch.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `pitch.py`. Import librosa inside the function.
- [ ] **Step 4: Implement** `scripts/vocal_range/analyze_nomad_stems.py --in DIR --out CSV [--limit N]`. It is standalone: `pitch.py` is copied next to it by the run step, so NomadPC needs no decide checkout.
  - It parses filenames `NOMAD-#### - Artist - Title.<ext>` (`source_id` = brand) and skips unparseable names with a count.
  - It is resumable: it skips brands already in `--out` and appends rows.
  - It runs with `nice -n 19`.
  - Test: `test_filename_parse` in `tests/unit/vocal_range/test_nomad_script.py` (imports the script module).
- [ ] **Step 5: Run** `poetry run pytest tests/unit/vocal_range -q`. Expected: PASS.
- [ ] **Step 6: Run on NomadPC between shows** (the box is live: check that no show is running with `ssh nomadpc 'curl -s localhost:5000/status'`, state `stopped`).
  - Check the filename format first: `ssh nomadpc 'ls /opt/nomad/downloads/NOMAD-vocals | head'`.
  - Create the venv: `ssh nomadpc 'python3 -m venv ~/vr_venv && ~/vr_venv/bin/pip install -r …'`.
  - Copy the two .py files with scp.
  - Launch fully detached: `nohup … </dev/null >~/vr.log 2>&1 & disown`.
  - When done, `scp` back only the CSV, gzip it to `data/vocal_range/nomad_measured.csv.gz`, and record the row count and skip count.
- [ ] **Step 7: Commit** `feat(vocal-range): pyin analysis + NomadPC stem script; NOMAD measured ranges`.

### Task 8: gen-stem analysis job (`vocal-range-gen`), image and Pulumi

**Files:**
- Create: `karaoke_decide/etl/vocal_range_gen.py`, `Dockerfile.vocal-analysis` (FROM the main image tag + `poetry install --only vocal-analysis` + `ffmpeg`)
- Modify: `infrastructure/__main__.py`, `.github/workflows/ci.yml` (build/push `karaoke-decide-vocal:<sha>`; `gcloud run jobs update vocal-range-gen` only if it exists, otherwise `::warning::` and skip, as song-index-build does), `tests/unit/test_infra_ci_parity.py` (new job)
- Test: `tests/unit/etl/test_vocal_range_gen.py`

**Interfaces:**
- Consumes: `analyze_vocals` (Task 7), `text_normalize.song_key`.
- Produces:
  - CSVs at `gs://nomadkaraoke-musicbrainz-data/vocal-range/gen_measured/<run>/part-<task>.csv` (Task 7 columns; `source_id` = job id).
  - `select_word_windows(corrections: dict) -> dict[str, list[tuple[float, float]]]`. It handles both `{corrections:{corrected_segments}}` and `{corrected_segments}` and prefers `corrections_updated.json`. Keys are the singer id (`"1"`, `"2"`, …) or `"all"` when no word has a `singer`.
  - `shard(job_ids: list[str], index: int, count: int) -> list[str]` (stable `sha1(id) % count`).
- **Job behaviour:**
  - Lists `jobs/*/lyrics/corrections.json` in `karaoke-gen-storage`.
  - Reads `artist`/`title` from Firestore `jobs/{id}`. It skips tenant and deleted jobs.
  - Vocals come from `stems/vocals_clean.flac`. If that is missing and `--reseparate`, it calls the audio-separator service (`audio_separator.remote.AudioSeparatorAPIClient(url).separate_audio_and_wait(gcs_uri=…, models=[<gen's default clean-vocals model>], output_single_stem="Vocals")`) up to `--max-reseparate 800`.
  - Analysis runs per singer with word windows.
  - It is resumable: it skips job ids present in any earlier `gen_measured/*/part-*.csv`.
  - Logs: ERROR only when every job failed; per-job failures are WARNING plus one summary.
- **Pulumi** (for Andrew):
  - SA `vocal-range-gen` with `storage.objectViewer` on `karaoke-gen-storage`;
  - `datastore.viewer`;
  - `run.invoker` on the `audio-separator` service (us-east4);
  - `storage.objectAdmin` on `nomadkaraoke-musicbrainz-data` with condition prefix `vocal-range/gen_measured/`;
  - a Cloud Run job of 10 tasks, 2 CPU / 4 GiB, timeout 21600 s, `max_retries 0`, image `karaoke-decide-vocal` (image drift ignored), no scheduler (on-demand).

- [ ] **Step 1: Write the failing tests:**
  - `test_select_word_windows_both_shapes`;
  - `test_duet_windows_per_singer`;
  - `test_shard_is_stable_and_complete`;
  - `test_run_skips_done_and_writes_csv` (FakeGCS from `tests/unit/fake_gcs.py`, a fake Firestore dict, `analyze_vocals` patched);
  - `test_missing_stem_without_reseparate_is_skipped_with_warning`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/etl/test_vocal_range_gen.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `python -m karaoke_decide.etl.vocal_range_gen run [--reseparate] [--max-reseparate N] [--limit N]`. The task index and count come from `CLOUD_RUN_TASK_INDEX` / `CLOUD_RUN_TASK_COUNT`.
- [ ] **Step 4: Add** the Pulumi resources and the CI step. Run `poetry run pytest tests/unit/test_infra_ci_parity.py -q`. Expected: PASS.
- [ ] **Step 5: Run** `poetry run pytest tests/unit -q`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(vocal-range): gen-stem pyin analysis job + Pulumi (for Andrew to apply)`.

### Task 9: Gemini Flash batch script, P412 data

**Files:**
- Create:
  - `scripts/vocal_range/gemini_batch.py`;
  - `karaoke_decide/vocal_range/gemini.py` (pure: request building, response parsing, cost estimate);
  - `karaoke_decide/vocal_range/p412.py`;
  - `data/vocal_range/wikidata_p412.csv` (copy of scratchpad `wd/p412_mbid.csv`, 11,491 rows, `mbid,vtLabel`);
  - `data/vocal_range/SOURCES.md` (provenance and licence lines: Wikidata CC0 query date 2026-10-21, archive.org `usdb_20250204`, Gemini model + run date);
  - `data/vocal_range/gemini_songs.csv.gz` and `gemini_artists.csv.gz` (outputs, Step 7).
- Test: `tests/unit/vocal_range/test_gemini.py`, `tests/unit/vocal_range/test_p412.py`

**Interfaces:**
- Produces:
  - `P412_MAP: dict[str, str | None]`, mapping every label with ≥ 9 rows to one of the 6 types or None. Pinned examples: contralto/alto/countertenor→alto; bass-baritone/basso profondo→bass; baritenor/lyric baritone/baryton-Martin→baritone; every "* tenor"/Heldentenor/tenore */haute-contre→tenor; mezzo-soprano/* mezzo-soprano→mezzo; every "* soprano"/Soubrette→soprano; male voice/death growl/castrato→None. Unlisted labels → None.
  - `load_p412(path) -> dict[str, set[str]]` (an mbid can have several labels).
  - `build_request(kind: Literal['song','artist'], key: str, artist: str, title: str | None) -> dict`. This is one Batch JSONL line: `{"key", "request": {contents, generation_config: {response_mime_type: "application/json", response_schema, max_output_tokens: 200, thinking_config: {thinking_budget: 0}, temperature: 0}}}`.
  - Schema `{low_note, high_note, typical_low, typical_high: str, voice_type: enum(6 types), confidence: number 0–1, unknown: bool}`.
  - `parse_response(text: str) -> dict | None`. It maps note names via `note_name_to_midi` and returns None when `unknown` is set, a name is invalid, or low > high.
  - `PRICES_PER_M = {"gemini-2.5-flash": (0.15, 1.25)}` (batch input/output USD per 1M tokens). The script refuses a model not in the table; verify the price at ai.google.dev/pricing before running and update it.
  - `estimate_cost(n: int, avg_in: float, avg_out: float, model: str) -> float`.
  - `BUDGET_USD = 80.0`.
- Output CSV columns: `kind,key,artist,title,pop_rank,low_midi,high_midi,p10,p50,p90,voice_type,confidence`. Here p10 = typical_low, p90 = typical_high and p50 = their mean.

- [ ] **Step 1: Write the failing tests:**
  - `test_request_shape` (no Vertex fields; thinking budget 0; key round-trips);
  - `test_parse_valid`, `test_parse_unknown_none`, `test_parse_bad_note_none`, `test_parse_low_above_high_none`;
  - `test_estimate_cost_70k` (`estimate_cost(70000, 120, 80, "gemini-2.5-flash") == pytest.approx(8.26, rel=0.01)`);
  - `test_unknown_model_raises`;
  - `test_p412_map_covers_frequent_labels` (every label with ≥ 9 rows in the CSV is a key);
  - `test_p412_multi_label`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/vocal_range/test_gemini.py tests/unit/vocal_range/test_p412.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure module and `p412.py`.
- [ ] **Step 4: Implement** `scripts/vocal_range/gemini_batch.py`. Subcommands:
  - `prepare --artists 20000 --songs 50000` (BigQuery via ADC, read-only). Top artists by `lb_artist_popularity` listeners among artists with a `karaokenerds_raw` song. Top karaoke songs by 3a's popularity blend (or `lb_recording_popularity` via `karaoke_recording_links` if 3a left no BQ table). Writes `requests.jsonl` plus a `pop_rank` sidecar in the scratchpad.
  - `estimate`: `count_tokens` on 200 sampled requests, then the cost. Exit 2 if `cost × 1.5 > BUDGET_USD`.
  - `submit`: `client.files.upload(file=…, config={"mime_type": "jsonl"})`, then `client.batches.create(model=…, src=file.name)`. Writes `job.json`.
  - `poll`.
  - `collect`: download `job.dest.file_name`, parse, write the two CSV.gz.

  The key comes from `GOOGLE_AI_STUDIO_KEY` (refuse if unset). Read the current SDK docs first (`npx ctx7@latest docs /googleapis/python-genai "batch mode jsonl file"`).
- [ ] **Step 5: Run** `poetry run pytest tests/unit/vocal_range -q`. Expected: PASS.
- [ ] **Step 6: Run the batch** (Andrew approved ≤ $80):
  - `prepare` → `estimate` (record the number) → `submit` → `poll` until `JOB_STATE_SUCCEEDED` (Batch API: up to 24 h; use Monitor) → `collect`.
  - Record the actual cost from AI Studio usage and the unknown rate.
  - Check that both files together are < 10 MB.
- [ ] **Step 7: Commit** `feat(vocal-range): Gemini Flash batch estimates (calibrated in the refresh step) + Wikidata P412`.

### Task 10: Merge, calibration and artist priors (pure)

**Files:**
- Create: `karaoke_decide/vocal_range/merge.py`, `karaoke_decide/vocal_range/calibrate.py`
- Test: `tests/unit/vocal_range/test_merge.py`, `tests/unit/vocal_range/test_calibrate.py`

**Interfaces:**
- Consumes: Tasks 5, 6, 7 and 9.
- Produces:
  - `@dataclass SourceRow(song_key, source: Literal['gen_measured','nomad_measured','ultrastar','gemini'], source_id, artist, title, low_midi, high_midi, p10, p50, p90, octave_confidence: float | None, lead_part: str, weight_s: float, pop_rank: int | None = None)`.
  - `@dataclass MergedSong(song_key, low_midi, high_midi, p10, p50, p90, tier, source, octave_confidence, is_duet: bool, n_sources: int)`.
  - `merge_songs(rows: list[SourceRow], gemini_kept: Callable[[SourceRow], bool]) -> list[MergedSong]`.
  - `@dataclass ArtistRange(artist_key, low_midi, high_midi, p10, p50, p90, basis: Literal['songs','gemini','p412','gender'])`.
  - `artist_ranges(songs: list[MergedSong], artist_of: dict[str, str], gemini_artists: list[SourceRow], gemini_artist_kept: Callable, p412: dict[str, set[str]], mbid_of: dict[str, str], gender_of: dict[str, str]) -> list[ArtistRange]`.
  - `@dataclass BandStats(band: str, n: int, median_err: float | None, kept: bool)`.
  - `calibrate_songs(est: list[SourceRow], truth: dict[str, MergedSong]) -> list[BandStats]`.
  - `calibrate_artists(est, p412_types: dict[str, set[str]], measured_artist: dict[str, ArtistRange]) -> list[BandStats]`.
- **Pinned rules:**
  - **Precedence:** gen_measured > nomad_measured > ultrastar > gemini.
    - Measured needs `weight_s ≥ 20`.
    - Gemini needs band kept and `confidence ≥ 0.3`.
    - Tier is measured, measured, notes, estimated respectively.
  - **Duets:**
    - A song with more than one `lead_part` (not `"all"`) from the winning source uses the part with the largest `weight_s`, and `is_duet = True`.
    - UltraStar `weight_s` = sung beats × 60/(BPM×4).
    - Several UltraStar files for one song: take the row whose p50 is closest to their median.
  - **Song calibration:**
    - Truth = merged songs with tier measured, or notes with `octave_confidence ≥ 0.5`.
    - Per-song error = mean(|Δp10|, |Δp50|, |Δp90|).
    - Bands by `pop_rank`: `1-5k`, `5k-20k`, `20k-50k`.
    - A band is kept if `n ≥ 30` and median ≤ 3.0. With `n < 30` it uses the pooled decision.
  - **Artist calibration:**
    - Bands by rank: `1-1k`, `1k-5k`, `5k-20k`.
    - Kept when P412 agreement (exact or adjacent type in `VOICE_TYPES` order) ≥ 0.7 over n ≥ 30, AND, where ≥ 30 artists have basis `songs`, median |Δp50| ≤ 3.0. If a check lacks n, only the other applies; with neither, the band is not kept.
  - **Artist basis precedence:**
    - `songs`: ≥ 3 merged songs with tier ≠ rough; median of each field.
    - `gemini` (kept).
    - `p412` (first mapped type; p10 = lo+5, p50 = (lo+hi)/2, p90 = hi−5, low = lo+2, high = hi−2).
    - `gender`: male {47, 67, 50, 57, 64} / female {54, 74, 57, 64, 71} as (low, high, p10, p50, p90).
    - Mixed or unknown gender → no row.

- [ ] **Step 1: Write the failing tests:**
  - `test_measured_beats_notes_beats_estimated`;
  - `test_gen_beats_nomad`;
  - `test_short_measured_ignored`;
  - `test_duet_picks_longest_part`;
  - `test_gemini_dropped_when_band_not_kept`;
  - `test_ultrastar_duplicates_choose_median`;
  - `test_band_kept_only_under_3`;
  - `test_small_band_uses_pooled`;
  - `test_artist_basis_precedence`;
  - `test_p412_adjacent_counts`;
  - `test_mixed_gender_no_prior`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/vocal_range/test_merge.py tests/unit/vocal_range/test_calibrate.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(vocal-range): merge precedence, Gemini calibration, artist priors`.

### Task 11: `vocal_range` step in `mb-refresh` (BigQuery + GCS I/O)

**Files:**
- Create: `karaoke_decide/etl/vocal_range_refresh.py`
- Modify: `karaoke_decide/etl/musicbrainz_refresh.py` (call the step), `Dockerfile` (`COPY data/vocal_range/ ./data/vocal_range/`)
- Test: `tests/unit/etl/test_vocal_range_refresh.py`

**Interfaces:**
- Consumes: Tasks 5, 6, 9 and 10, and `text_normalize.song_key` / `identity_normalize` (artist_key).
- Produces:
  - **BigQuery** (WRITE_TRUNCATE each run):
    - `karaoke_decide.song_vocal_range_sources` (SourceRow columns + `loaded_at`).
    - `karaoke_decide.song_vocal_range` (MergedSong columns + reserved, always-NULL Phase 4 crowd fields `crowd_comfortable INT64`, `crowd_too_low INT64`, `crowd_too_high INT64`).
    - `karaoke_decide.artist_vocal_range` (ArtistRange).
  - **GCS** `gs://nomadkaraoke-musicbrainz-data/vocal-range/`:
    - `ultrastar/usdb_20250204.zip` (fetched once from archive.org, then reused);
    - `latest/song_vocal_range.tsv.gz`;
    - `latest/artist_vocal_range.tsv.gz`;
    - `latest/summary.json`;
    - `latest.json` = `{run, sha256_song, sha256_artist}`, written last.
  - `run_step(bq, gcs, http, *, now) -> dict` (the summary).
  - CLI: `python -m karaoke_decide.etl.musicbrainz_refresh vocal-range` runs only this step.
- **Summary keys:**
  - `rows_per_source`;
  - `songs_per_tier`;
  - `artists_per_basis`;
  - `ultrastar: {files, parsed, matched, octave_error_rate, octave_pairs}`;
  - `gemini_song_bands`, `gemini_artist_bands` (BandStats);
  - `unmatched_per_source`.
- **Behaviour:**
  - `lead_gender` per artist comes from the same SQL 3a's catalog build uses (seam). `mbid` per artist comes from `mb_artists`.
  - The step runs after the MB publish, and also when the dump was already published. It goes inside `run()` before 3a's catalog step, so the catalog sees fresh tables.
  - A failure in this step logs one ERROR and leaves last week's tables and `latest.json` untouched. It never fails the MB refresh.
  - A missing optional input (no gen_measured yet, no Gemini files) is INFO.
  - **Joining to `song_key`:**
    - UltraStar tries `video_id` against the YouTube ids in `karaokenerds_community` first (spec §5.2). That rarely matches, because USDB links the music video, not a karaoke upload. Otherwise it uses `song_key(artist, title)`.
    - Measured and Gemini rows use `song_key(artist, title)`.
    - The summary counts each join path.

- [ ] **Step 1: Write the failing tests** (fake BQ client capturing load jobs, FakeGCS, `httpx.MockTransport` serving a tiny zip of Task 5 fixtures):
  - `test_zip_fetched_once_then_reused`;
  - `test_tables_written_and_pointer_last`;
  - `test_summary_has_octave_error_rate` (one fixture also present as nomad_measured, an octave off);
  - `test_step_failure_keeps_previous_pointer_and_logs_one_error`;
  - `test_runs_when_dump_already_published`;
  - `test_missing_gen_measured_is_info`.
- [ ] **Step 2: Run** `poetry run pytest tests/unit/etl/test_vocal_range_refresh.py tests/unit/test_musicbrainz_refresh.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `poetry run pytest tests/unit -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(vocal-range): mb-refresh vocal_range step (UltraStar, measured, Gemini → song/artist ranges)`.

### Task 12: `vr_*` in catalog.db and offline.db (offline schema 2)

**Files:**
- Modify:
  - 3a's catalog builder (seam: the `songs`/`artists` table writer in the mb-refresh catalog step);
  - `karaoke_decide/song_search/offline.py` (`OFFLINE_SCHEMA_VERSION = 2`, `_add_offline_tables`, `build_offline_db(..., vocal_range: Path | None)`);
  - `karaoke_decide/etl/song_index_build.py` (download `vocal-range/latest/*.tsv.gz` from `nomadkaraoke-musicbrainz-data`; record `vocal_range_run` in the manifest; rebuild when it changes);
  - `infrastructure/__main__.py` (song-index-build SA: `storage.objectViewer` on `nomadkaraoke-musicbrainz-data`, condition prefix `vocal-range/`);
  - `scripts/emit_search_parity_fixtures.py` + `tests/fixtures/song_search/offline_fixture.db` (re-emit with a fixture vocal-range TSV);
  - `tests/fixtures/vocal_range/song_vocal_range_fixture.tsv`, `artist_vocal_range_fixture.tsv` (ranges for the search and catalog fixture songs: baritone-fit, soprano, duet, rough-only, none).
- Test: `tests/unit/song_search/test_offline.py`, `tests/unit/etl/test_song_index_build.py`, 3a's catalog build tests

**Interfaces:**
- Produces:
  - **catalog.db `songs`:** `vr_low, vr_high, vr_p10, vr_p50, vr_p90 REAL`, `vr_tier TEXT` (one of the four tiers), `vr_octave_conf REAL`, `vr_duet INTEGER`. Filled from `song_vocal_range`, else from `artist_vocal_range` by `artist_key` with tier `rough`, else NULL.
  - **catalog.db `artists`:** `vr_p10, vr_p50, vr_p90 REAL`, `vr_basis TEXT`.
  - **offline.db `songs`:** the same five REALs, plus `vr_tier INTEGER` (4/3/2/1), `vr_octave_conf REAL`. Same fallback via `identity_normalize(artist)`. `meta.vocal_range_run`.
- **Degrade:**
  - If the TSVs are missing or forbidden (IAM not applied yet), offline.db is still schema 2 with NULL `vr_*`, logged as WARNING.
  - The catalog eval gate adds `vr coverage %` as informational only (it never blocks).

- [ ] **Step 1: Write the failing tests:**
  - `test_offline_schema_is_2`;
  - `test_offline_vr_columns_song_then_artist_fallback` (song row → tier code 3; rough-only song → 1; unknown → NULL);
  - `test_offline_builds_without_vocal_range`;
  - `test_index_build_rebuilds_when_vocal_range_run_changes`;
  - `test_index_build_missing_tsv_is_warning`;
  - `test_catalog_vr_columns_and_rough_fallback` (in 3a's catalog test module).
- [ ] **Step 2: Run** `poetry run pytest tests/unit/song_search/test_offline.py tests/unit/etl/test_song_index_build.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes, then re-emit the parity fixtures with `poetry run python scripts/emit_search_parity_fixtures.py`.
- [ ] **Step 4: Run** `poetry run pytest tests/unit -q`. Expected: PASS, including `test_parity_fixture_is_fresh`.
- [ ] **Step 5: Commit** `feat(vocal-range): vr_* in catalog.db and offline.db (offline schema 2) + song-index-build reads vocal ranges`.

  Once this deploys, phones on schema 1 treat the new list as incompatible and show "no offline list" (`offlineIndexStore` status `none`) until they get Task 19. Tell Tonight (nomadkaraoke-a7) before merging this, and land the mobile bump soon after.

---

## Part C: decide API

### Task 13: Voice profile endpoints

**Files:**
- Create: `backend/api/routes/voice.py`, `backend/services/voice_profile_service.py`
- Modify:
  - `backend/api/routes/__init__.py` (`router.include_router(voice_router, prefix="/my", tags=["voice"])`);
  - `backend/api/deps.py` (`VoiceProfileServiceDep`);
  - 3a's test API (`/api/test/*`): add `PUT /api/test/voice` `{email, profile}` and include `voice_profile` in its read-profile response.
- Test: `backend/tests/test_voice_routes.py`

**Interfaces:**
- **Models:**
  - `VoiceType = Literal['bass','baritone','tenor','alto','mezzo','soprano']`.
  - `VoiceProfileIn(BaseModel, extra="forbid")` with:
    - `low_midi`, `high_midi`, `comfort_low`, `comfort_high`: `int` in 24–96;
    - `voice_type: VoiceType | None`, `voice_type_between: VoiceType | None = None`, `register: Literal['lower','middle','higher'] | None = None`;
    - `confidence: Literal['low','medium','high']`, `method: Literal['mic','self']`, `measured_at: datetime`.
  - The model validator requires `low ≤ comfort_low ≤ comfort_high ≤ high`, and exactly one of `voice_type` / `register` set. It also requires that `method == 'self'` implies `confidence == 'low'`.
  - `VoiceProfileOut(VoiceProfileIn)` + `updated_at`.
- **Endpoints:**
  - `GET /api/my/voice` → `{"profile": VoiceProfileOut | null}`.
  - `PUT /api/my/voice` → `VoiceProfileOut` (422 on validation).
  - `DELETE /api/my/voice` → 204.
- Storage: the `voice_profile` map on the user's `decide_users` doc, found through `UserDataService._get_user_document`'s lookup (doc id may be the sha256 key, 3a §4.2). A PUT with an older `measured_at` than the stored one still overwrites (the last explicit save wins).
- Produces for Task 14: `VoiceProfileService.get(user_id) -> VoiceProfileOut | None`.

- [ ] **Step 1: Write the failing tests:**
  - `test_put_then_get`;
  - `test_delete`;
  - `test_get_none_when_unset`;
  - `test_rejects_extra_fields` (`{"samples": [0.1]}` → 422; the privacy pin);
  - `test_rejects_comfort_outside_range`;
  - `test_self_requires_low_confidence`;
  - `test_requires_type_or_register`;
  - `test_requires_auth` (401);
  - `test_gen_session_user_profile_doc` (3a's gen-token fixture);
  - `test_test_api_seed_voice` (only with `DECIDE_TEST_API=1`).
- [ ] **Step 2: Run** `poetry run pytest backend/tests/test_voice_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `poetry run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): voice profile endpoints (GET/PUT/DELETE /api/my/voice)`.

### Task 14: Fit in recommendations v2, Singable filter, fit sort, per-song range endpoint

**Files:**
- Modify (3a seams):
  - the v2 filter/SQL builder;
  - the scoring weights module;
  - the `RecSong` model;
  - the v2 route params;
  - the catalog router (`backend/api/routes/catalog.py`);
  - 3a's fixture catalog source (add the Task 12 fixture TSVs).
- Test: 3a's `backend/tests/test_recommendations_v2*.py` (new cases), `backend/tests/test_catalog_vocal_range.py`

**Interfaces:**
- Consumes: `fit_song` (Task 3), `VoiceProfileService.get` (Task 13), catalog `vr_*` (Task 12).
- **Produces:**
  - Query params: `singable: bool = False`, plus `sort` gains the value `fit`.
  - `RecSong.fit: {bucket, transpose, octave, tier} | null`. It is null without a profile or without `vr_*`.
  - The response gains `voice: {has_profile: bool, method: 'mic'|'self'|null}`.
  - `singable=true` without a profile is ignored and left out of `filters_applied`.
  - **SQL prefilter** for `singable` / `sort=fit` (a necessary condition, since transposition doesn't change span): `vr_p10 IS NOT NULL AND (vr_p90 - vr_p10) <= (comfort_high - comfort_low) + 2*tol(vr_tier) + STRETCH_MAX`. Then `fit_song` in Python.
  - `singable` keeps buckets `fits` and `fitsIn`. Songs with no `vr_*` are excluded under `singable` only.
  - `sort=fit`: one flat section, ordered by `score` ascending, then popularity descending.
  - **Best-match scoring** adds `W_FIT = 0.15 × affinity`, where affinity is fits 1.0, fitsIn 0.7, stretch 0.2, outside −0.5, unknown 0.
  - `GET /api/catalog/songs/{song_key}/vocal-range` (public) → `{song_key, range: {low, high, p10, p50, p90, tier, octave_confidence, is_duet} | null}`. It returns 503 `warming_up` when catalog.db is not loaded (3a §6).

- [ ] **Step 1: Write the failing tests:**
  - `test_singable_filters_to_fitting_songs` (baritone profile → the soprano fixture song is absent; a `fitsIn −2` song is present);
  - `test_singable_keeps_rough_tier_songs`;
  - `test_singable_ignored_without_profile`;
  - `test_sort_fit_orders_by_score`;
  - `test_rec_song_carries_fit`;
  - `test_fit_term_raises_fitting_song_in_best_match`;
  - `test_singable_and_library_filters_combine`;
  - `test_vocal_range_endpoint` (hit, rough fallback, unknown → `range: null`, 503 warming_up);
  - `test_singable_prefilter_limits_fit_calls` (patch `fit_song` and count: it is called only for rows that pass the SQL prefilter, never for songs without `vr_*`).
- [ ] **Step 2: Run** `poetry run pytest backend/tests -q -k "v2 or vocal_range"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `poetry run pytest backend/tests tests/unit -q`. Expected: PASS. Then `make test`: coverage ≥ 70% unit / 60% backend.
- [ ] **Step 5: Commit** `feat(recs): vocal fit term, Singable filter, fit sort, per-song vocal range`. Then bump `pyproject.toml`, run `/coderabbit`, and open the decide PR(s): Part D + C, either as one PR or as data (Tasks 3, 5–12) followed by API (13–14).
- [ ] **Step 6: After merge and deploy:**
  - List for Andrew: `pulumi up` (Task 8 job/SA/IAM; Task 12 IAM) via `/gcp-admin`; then `gcloud run jobs execute vocal-range-gen --args=run,--reseparate`; then `gcloud run jobs execute mb-refresh --args=vocal-range` and the catalog step (or wait for Sunday).
  - Verify: `GET /api/catalog/songs/<a known song_key>/vocal-range` on prod returns a tier.
  - Copy `vocal-range/latest/summary.json` (coverage per tier, UltraStar octave-error rate, Gemini band errors) into the session record.

---

## Part B: Mobile mic test

### Task 15: Dependencies, permission strings in 33 locales, decide client

**Files:**
- Modify:
  - `apps/mobile/package.json` (`npx expo install pitchy`; pitchy pulls `fft.js`);
  - `jest.shared.js` (add `pitchy|fft\.js` to `transformIgnorePatterns`);
  - `apps/mobile/app.json` (add the plugin `["expo-audio", {"microphonePermission": "Allow $(PRODUCT_NAME) to hear you sing so it can measure your vocal range. Audio stays on your phone.", "recordAudioAndroid": true}]`, and `ios.infoPlist.CFBundleAllowMixedLocalizations: true`);
  - `apps/mobile/app.config.ts` (`locales` = one entry per locale in `@nomad/i18n` `LOCALES`, pointing at `./locales/<code>.json`);
  - `packages/i18n/messages/en.json` (`permissions.microphone` + all `voice.*` and `fit.*` keys used in Tasks 18–19);
  - `openapi/decide.json` + `packages/api-decide` (regenerate from the decide local stack via 3a's `decide` snapshot command).
- Create: `scripts/gen-native-locales.mjs` (writes `apps/mobile/locales/<code>.json` = `{"ios": {"NSMicrophoneUsageDescription": <permissions.microphone>}}`; `--check` mode for CI), `apps/mobile/locales/*.json` (33 generated files)
- Test: `apps/mobile/src/__tests__/appConfig.test.ts` (extend), `scripts/__tests__/genNativeLocales.test.mjs` or a jest test under `apps/mobile/src/__tests__/nativeLocales.test.ts`

**Interfaces:**
- Produces:
  - The facades `getVoiceProfile()`, `putVoiceProfile(p)`, `deleteVoiceProfile()`, `getSongVocalRange(songKey)` in `packages/api-decide/src/` (same style as the existing facades).
  - Recs v2 client types now include `singable`, `sort: 'fit'`, `RecSong.fit` and `voice`.

- [ ] **Step 1: Write the failing tests:**
  - `appConfig.test.ts`: the resolved config has the `expo-audio` plugin with `recordAudioAndroid: true`, and `locales` has 33 entries whose files exist.
  - `nativeLocales.test.ts`: every `locales/<code>.json` equals `permissions.microphone` in `messages/<code>.json`.
  - A facade test for `putVoiceProfile` sending exactly the profile fields.
- [ ] **Step 2: Run** `pnpm test -- appConfig nativeLocales api-decide`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the keys, then `env -u GEMINI_API_KEY pnpm i18n:translate`, then `node scripts/gen-native-locales.mjs`, then `pnpm gen:api:offline`. Add `node scripts/gen-native-locales.mjs --check` to the CI lint job.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm i18n:check`. Expected: PASS. Then `cd apps/mobile && npx expo prebuild --clean --no-install` and check that `ios/*/ar.lproj/InfoPlist.strings` contains `NSMicrophoneUsageDescription` and the Android manifest contains `RECORD_AUDIO`. (Prebuild output is not committed.)
- [ ] **Step 5: Commit** `feat(mobile): mic permission (33 locales), pitchy, decide voice client`.

### Task 16: PitchSource: mic and fake, frame pipeline

**Files:**
- Create:
  - `apps/mobile/src/voice/pitchSource.ts` (types);
  - `apps/mobile/src/voice/framer.ts`;
  - `apps/mobile/src/voice/useMicPitchSource.ts`;
  - `apps/mobile/src/voice/useFakePitchSource.ts`;
  - `apps/mobile/src/voice/usePitchSource.ts`;
  - `scripts/make-fake-mic-wav.mjs`;
  - `apps/mobile/assets/fake-mic/baritone-scale.wav` (generated, 16 kHz mono PCM16, 14.4 s, ≈ 460 KB).
- Modify: `apps/mobile/src/config.ts` (`FAKE_MIC: string | null` = `EXPO_PUBLIC_FAKE_MIC` only when `isLocalUrl(GEN_API_URL)`)
- Test: `apps/mobile/src/voice/__tests__/framer.test.ts`, `micPitchSource.test.ts`, `fakePitchSource.test.ts`, `apps/mobile/src/__tests__/config.test.ts` (extend)

**Interfaces:**
- Consumes: `PitchFrame` and `parseWav` (Tasks 1–2).
- **Produces:**
  - `type PcmBuffer = { samples: Float32Array; sampleRate: number; timestamp: number }`.
  - `type MicPermission = 'granted' | 'denied' | 'blocked'`.
  - `type VoiceSection = 'low' | 'high' | 'sing'`.
  - `interface PitchSource { kind: 'mic' | 'fake'; requestPermission(): Promise<MicPermission>; start(onBuffer: (b: PcmBuffer) => void, section: VoiceSection): Promise<void>; stop(): void }`. The mic ignores `section`.
  - `createFramer(onFrame: (f: PitchFrame) => void, opts?: { frameSize?: 2048; hop?: 512 }): { push(b: PcmBuffer): void; reset(): void }`. It uses `PitchDetector.forFloat32Array(frameSize)` from pitchy; `t` = sample index / sampleRate; it recreates the detector if `sampleRate` changes.
  - `usePitchSource(): PitchSource` returns the fake source when `FAKE_MIC` is set, else the mic source.
- **Mic source:**
  - `useAudioStream({ sampleRate: 48000, channels: 1, encoding: 'float32', onBuffer })`. It takes channel 0 when `channels > 1`.
  - `requestRecordingPermissionsAsync()` maps to `blocked` when `!granted && !canAskAgain`.
  - `start` calls `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })` and then `stream.start()`.
  - `stop` calls `stream.stop()` and then `setAudioModeAsync({ allowsRecording: false })`.
  - Read the SDK 57 expo-audio docs before writing this (AGENTS.md).
- **Fake source:**
  - It loads the asset (`expo-asset` + expo-file-system `File(...).bytes()`; check the SDK 57 docs) and runs `parseWav`.
  - It emits 1600-sample buffers on a real-time `setInterval(100 ms)`.
  - Each `start(…, section)` plays that section of the file: `FAKE_MIC_SECTIONS = { low: [0, 4.4], high: [4.4, 7.2], sing: [7.2, 14.4] }` (seconds). The section stops at its end, so the step's own timeout or Done applies.
  - `requestPermission` resolves `granted`.
  - Unknown name → throws `Error('unknown fake mic')`.
- **WAV content** (synthetic, fundamental + 3 harmonics at 1, 0.5, 0.25, 0.125, 5 ms fades). Each section opens with 1.2 s of silence (the quiet second):
  - low: then 0.8 s each of A3 57, E3 52, C3 48, A2 45;
  - high: then 0.8 s each of C4 60, E4 64;
  - sing: then 0.6 s each of 55 57 59 60 57 55 59 57 53 55.
  - This gives range 45–64 and comfort P10/P90 = 53/59, so cc 56 → baritone (Task 2 maths).

- [ ] **Step 1: Write the failing tests:**
  - `framer.test.ts`: a 48 kHz 220 Hz sine pushed in uneven 4800-sample buffers gives frames with `hz ≈ 220 ± 1` and clarity > 0.95, and the frame count is `floor((N − 2048)/512) + 1`. A 44.1 kHz stereo input uses channel 0 (the right channel is noise). Silence gives `hz: null` or clarity < 0.9.
  - `micPitchSource.test.ts`, mocking `expo-audio`:
    - `stop` calls `setAudioModeAsync({ allowsRecording: false })` (Review Focus 4);
    - a denied permission with `canAskAgain: false` gives `blocked`;
    - `start` sets `allowsRecording: true` before `stream.start`.
  - `fakePitchSource.test.ts`, with fake timers:
    - 1 s emits 10 buffers with `sampleRate` 16000;
    - `stop` halts them;
    - the `high` section's first non-silent frames detect ≈ 261.6 Hz (C4) through `createFramer`.
  - `config.test.ts`: `FAKE_MIC` is null for a non-local gen URL.
- [ ] **Step 2: Run** `pnpm test -- voice config`. Expected: FAIL.
- [ ] **Step 3: Implement.** Generate the WAV with `node scripts/make-fake-mic-wav.mjs` (deterministic; a test asserts its sha256 is stable).
- [ ] **Step 4: Run** `pnpm test -- voice config`. Expected: PASS. Also run a quick device check: `npx expo run:android`, a temporary dev log of frames per second (≥ 80 on the emulator), then remove the log.
- [ ] **Step 5: Commit** `feat(mobile): PitchSource (expo-audio stream + fake WAV) and pitchy framer`.

### Task 17: `useVoiceTest` state machine

**Files:**
- Create: `apps/mobile/src/voice/useVoiceTest.ts`
- Test: `apps/mobile/src/voice/__tests__/useVoiceTest.test.ts`

**Interfaces:**
- Consumes: `PitchSource`, `createFramer`, `noiseFloor`, `gateFrames`, `findHeldNotes`, `summarizeRange`, `classifyVoice`.
- **Produces:**
  - `type VoiceStep = 'intro' | 'permission-denied' | 'permission-blocked' | 'low' | 'high' | 'sing' | 'result' | 'no-notes'`.
  - `useVoiceTest(source: PitchSource): { step; phase: 'quiet' | 'listening'; livePitch: number | null; held: HeldNote[]; result: { range: RangeSummary; voice: Classification } | null; begin(); done(); retry(); skipSing() }`.
  - `livePitch` is the latest voiced midi, throttled to 15 Hz.
- **Rules:**
  - Each of low/high/sing calls `source.start(onBuffer, step)` and starts with 1.0 s `quiet` (noise floor), then `listening`.
  - `done()` on low/high is enabled once that step has ≥ 1 held note.
  - Low/high time out after 20 s with no held note → `no-notes` (`retry()` returns to that step).
  - Sing ends at 15 s or on `skipSing()`.
  - `result` is computed from all held notes plus the sing frames. If `summarizeRange` returns null, the step is `no-notes`.
  - Unmount and every step change call `source.stop()`. Buffers that arrive after stop are ignored.

- [ ] **Step 1: Write the failing tests** (a fake `PitchSource` that pushes scripted buffers from `testSignals` through `createFramer`, with fake timers):
  - `walks intro→low→high→sing→result and classifies baritone`;
  - `denied → permission-denied; blocked → permission-blocked` (Review Focus 1);
  - `20 s of silence on low → no-notes, retry returns to low` (Review Focus 2);
  - `one held note overall → no-notes, never result`;
  - `unmount calls stop and late buffers do nothing` (Review Focus 4);
  - `noise floor from the quiet second gates a constant hum`.
- [ ] **Step 2: Run** `pnpm test -- useVoiceTest`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): voice test state machine`.

### Task 18: Piano strip, voice screens, profile store and save

**Files:**
- Create:
  - `packages/ui/src/PianoStrip.tsx` (export from `packages/ui/src/index.ts`);
  - `apps/mobile/src/voice/VoiceTestScreen.tsx`, `apps/mobile/src/voice/SelfReportStep.tsx`, `apps/mobile/src/voice/VoiceResult.tsx`;
  - `apps/mobile/src/voice/voiceStore.ts`, `apps/mobile/src/voice/useVoiceProfile.ts`;
  - `apps/mobile/src/app/discover/voice.tsx` (route; registered like 3a's `discover/quiz`, as a modal).
- Test: `packages/ui/src/__tests__/PianoStrip.test.tsx`, `apps/mobile/src/__tests__/voiceTestScreen.test.tsx`, `apps/mobile/src/__tests__/voiceProfile.test.ts`

**Interfaces:**
- **PianoStrip:** `PianoStripProps = { lowMidi: number; highMidi: number; marks?: { midi: number; color: string }[]; band?: { from: number; to: number; color: string }; live?: number | null; height: number; testID: string }`. White and black keys come from `lowMidi..highMidi`; `pianoKeyLayout(low, high, width)` is exported for tests.
- **Voice store:** `useVoiceStore` (zustand, MMKV-persisted) holds `{ profile: LocalVoiceProfile | null; pending: boolean }`. `LocalVoiceProfile` = the decide `VoiceProfileIn` fields in camelCase.
- **Profile hooks:**
  - `useVoiceProfile()`: the server profile (TanStack Query). It reconciles with local by newer `measuredAt`; a server profile newer than local replaces it.
  - `useSaveVoiceProfile()`: sets local and `pending = true` first, then PUTs. On success `pending = false`. On network, 5xx or 503 it stays pending.
  - `useFlushPendingVoice()`: runs on Discover mount and app foreground when signed in.
  - `toVoiceProfileIn(local)` sends exactly the API fields.
  - `profileFromResult(range: RangeSummary, c: Classification, measuredAt: string): LocalVoiceProfile` (`method: 'mic'`, `voiceTypeBetween` from `c.between`).
  - `profileFromSelfReport(choice: VoiceType | Register, measuredAt: string): LocalVoiceProfile` (`method: 'self'`, `confidence: 'low'`).
  - `toUserRange(p: LocalVoiceProfile): UserVoiceRange` (for `fitSong`).
- **Pinned copy** (spec §4.2):
  - intro "Find a quiet spot. Sing \"laaa\". Takes about a minute.";
  - low "Slide down to the lowest note you can hold comfortably";
  - high "Now slide up to the highest note you can hold comfortably";
  - sing "Sing something you know" (15 s, optional);
  - quiet "Stay quiet for a second…";
  - no-notes "We couldn't hear a held note";
  - the result always says "Likely …".
- **Screens and testIDs:**
  - `voice-start`, `voice-skip` (to self-report), `voice-low-done`, `voice-high-done`, `voice-sing-skip`, `voice-retry`, `voice-open-settings`.
  - Result: `voice-result-range` ("A2–E4"), `voice-result-type` ("Likely Baritone" / "Between Baritone and Tenor"), `voice-result-confidence`, `voice-save`, `voice-try-again`, `voice-saved`.
  - Self-report: `voice-self-<bass…soprano|lower|middle|higher>`, `voice-self-save`.
  - Signed out, Save opens `openSignIn('/discover/voice')` and keeps the local result.

- [ ] **Step 1: Write the failing tests:**
  - `PianoStrip.test.tsx`: `pianoKeyLayout(45, 64, 300)` has 12 white keys and the black keys sit between them.
  - `voiceTestScreen.test.tsx` (scripted fake source via a jest mock of `usePitchSource`):
    - a full run shows "Likely Baritone"; Save PUTs the `toVoiceProfileIn` payload with no extra keys;
    - blocked permission shows `voice-open-settings` and `voice-skip`;
    - self-report tenor saves `method: 'self', confidence: 'low', voice_type: 'tenor'`;
    - the RTL (ar) render puts the range text in `isolate()`.
  - `voiceProfile.test.ts`:
    - a 503 on save keeps `pending: true` and the local profile, and a flush after recovery PUTs once (Review Focus 5);
    - a newer server profile replaces local; an older one does not.
- [ ] **Step 2: Run** `pnpm test -- PianoStrip voiceTestScreen voiceProfile`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. Then take simulator screenshots of each step (fake mic Metro) and check them against the copy.
- [ ] **Step 5: Commit** `feat(mobile): voice test screens, piano strip, self-report, profile save with offline retry`.

### Task 19: Fit in Discover, song page and Me

**Files:**
- Create: `apps/mobile/src/voice/FitBadge.tsx`, `apps/mobile/src/voice/useSongFit.ts`, `apps/mobile/src/voice/VoiceProfileSection.tsx`
- Modify:
  - `packages/core/src/search/offline.ts` (`offlineVocalRange`; `OFFLINE_SCHEMA_VERSION = 2`), `packages/core/src/index.ts`, `apps/mobile/src/test-utils/memoryFs.ts` (default schema 2);
  - 3a's Discover filter bar (Singable chip `discover-filter-singable`; sort option `fit`);
  - 3a's recommendation row (render `FitBadge` from `RecSong.fit`);
  - 3a's "Improve your picks" card list (`discover-improve-voice` → `/discover/voice`; hidden when a profile exists);
  - `apps/mobile/src/app/song/[id].tsx` (badge + tier line);
  - 3a's music profile screen (add `VoiceProfileSection`).
- Test: `packages/core/src/search/__tests__/offlineVocalRange.test.ts`, `apps/mobile/src/__tests__/fitBadge.test.tsx`, `discoverScreen.test.tsx` (extend), `songScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: `fitSong`, `tierFromCode`, `useVoiceStore`, `getSongVocalRange`, recs v2 `singable` / `sort=fit` / `RecSong.fit`.
- **Produces:**
  - `offlineVocalRange(db: SqlReader, songKey: string): SongVocalRange | null`. It returns null on NULL columns or any SQLite error.
  - `useSongFit(songKey): { range: SongVocalRange | null; fit: FitResult | null; source: 'api' | 'offline' | null }`. It uses the API (`getSongVocalRange`) when online, else the offline db, and computes fit with `fitSong` against the local profile.
  - `FitBadge({ fit, testID })` copy:
    - fits → "Fits your voice";
    - fitsIn with t<0 → "Try it {n} keys down"; t>0 → "Try it {n} keys up";
    - octave −12 → "Fits an octave down"; +12 → "Fits an octave up"; an octave plus t → "An octave down, {n} keys {dir}";
    - stretch → "A stretch";
    - outside → renders nothing.
  - Song page tier line `fit-tier`: "Range measured from the recording" / "from note data" / "estimated" / "rough guess from the artist".
  - Singable chip: disabled with a "Test your voice" hint (`discover-filter-singable-cta` → `/discover/voice`) when there is no local profile.
  - **Me section** (`VoiceProfileSection`): range on `PianoStrip`, type, method, `voice-redo`, and `voice-remove` (DELETE plus local clear).

- [ ] **Step 1: Write the failing tests:**
  - `offlineVocalRange` against a fixture db built in the test (better-sqlite3) with codes 3 and 1 and NULL;
  - `fitBadge` copy for each bucket, the octave variants and outside → null;
  - Discover:
    - tapping Singable calls recs v2 with `singable: true`;
    - without a profile the chip shows the CTA;
    - rows render `fit-badge-<song_key>`;
  - Song page offline (force-offline) uses `offlineVocalRange` and shows the tier line; with no data, no badge and no tier;
  - the Me section remove clears local and calls DELETE.
- [ ] **Step 2: Run** `pnpm test -- offlineVocalRange fitBadge discoverScreen songScreen`. Expected: FAIL.
- [ ] **Step 3: Implement.** First sync the schema-2 parity fixtures (`DECIDE_DIR=… node scripts/sync-search-fixtures.mjs`).
- [ ] **Step 4: Run** `pnpm test && pnpm test:coverage && pnpm typecheck && pnpm lint && pnpm i18n:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): fit badges, Singable filter + fit sort, song-page range, Me voice section`.

---

## Part E: End-to-end, screenshots, ship

### Task 20: Maestro voice-1..3 and screenshots

**Files:**
- Create: `maestro/flows/voice-1-test.yaml`, `maestro/flows/voice-2-self-report.yaml`, `maestro/flows/voice-3-singable.yaml`
- Modify:
  - `maestro/scripts/stack.js` (decide actions from 3a, plus `ACTION: voice-seed` (`EMAIL`, `PROFILE` JSON → `PUT /api/test/voice`) and `ACTION: voice-assert` (`EMAIL`, `EXPECT_TYPE`, `EXPECT_METHOD` → reads 3a's profile test endpoint));
  - `scripts/e2e-local.sh` (Metro env adds `EXPO_PUBLIC_FAKE_MIC=baritone-scale`; the decide local stack serves the Task 12 fixture `vr_*`);
  - `CLAUDE.md` (E2E section: fake mic and the voice flows).

**Flows** (screenshots to `${SHOTS}` = `docs/screenshots/phase3c/<platform>/`):
- **voice-1-test:** gen setup + sign-in (3a common) → Discover → `discover-improve-voice` → `voice-start`.
  - Low: wait for `voice-low-done` to be enabled (≤ 15 s), tap it.
  - High: the same for `voice-high-done`.
  - Sing: tap `voice-sing-skip` after 5 s.
  - Assert `voice-result-type` contains "Baritone" → `voice-save` → `voice-saved`.
  - `stack.js voice-assert EXPECT_TYPE=baritone EXPECT_METHOD=mic`.
- **voice-2-self-report:** → `voice-skip` → `voice-self-tenor` → `voice-self-save` → `voice-assert EXPECT_TYPE=tenor EXPECT_METHOD=self`. Then Me → profile shows "Tenor".
- **voice-3-singable:** `voice-seed` a baritone profile + 3a quiz seed → Discover → `discover-filter-singable`.
  - Assert the fixture soprano song is not visible.
  - Assert `fit-badge-<baritone fixture song_key>` reads "Fits your voice".
  - Assert a `fitsIn` fixture shows "Try it 2 keys down".
  - Open that song → `fit-tier` visible.

- [ ] **Step 1: Write the three flows.**
- [ ] **Step 2: Run** `scripts/e2e-local.sh --platform ios voice-`. Expected: 3/3 PASS. Then run `--platform android voice-` (never concurrently). Expected: 3/3 PASS.
- [ ] **Step 3: Run the full suites** on each platform in turn: `scripts/e2e-local.sh --platform ios` then `--platform android`. Expected: no regressions; the offline flows still pass with schema 2.
- [ ] **Step 4: Screenshot UX review** of every voice screen, the Singable chip and the badges in en and ar (RTL) on both platforms. Fix copy and layout issues and re-run the affected flows.
- [ ] **Step 5: Commit** `test(mobile): Maestro voice-1..3 + phase3c screenshots`.

### Task 21: Release APK, docs, PR

**Files:**
- Modify: `CLAUDE.md` (status line, Phase 3c spec/plan links, `apps/mobile/src/voice/` in the workspace map, gotchas found), `docs/VISION.md` (3c status), decide `docs/` (the data doc for `song_vocal_range*`, the vocal-range step, the `vocal-range-gen` job, the Gemini batch run).

- [ ] **Step 1: Build the release APK** against prod with no `EXPO_PUBLIC_FAKE_MIC` (Phase 1/2 release recipe) and copy it to `~/Downloads/nomad-karaoke-phase3c-release.apk`. Check that the APK has no fake-mic code path: `FAKE_MIC` is null for prod URLs; the bundled WAV is acceptable at ~460 KB.
- [ ] **Step 2: Do a prod smoke test** on the emulator with the release APK:
  - the self-report path saves to prod decide (`GET /api/my/voice` with the session token);
  - Singable returns results once catalog.db has `vr_*`.
- [ ] **Step 3: Test the real mic** on the emulator (host mic). Record the observed accuracy and note that the phone test is Andrew's (spec §9.2).
- [ ] **Step 4:** Run `/test-review`, `/docs-review`, `/coderabbit`, then `/pr` (mobile). Message Tonight first about shared files: i18n, ui index, core index, `offline.ts` schema 2, app.json/app.config, package.json/lock and `jest.shared.js`.
- [ ] **Step 5: Write the session record**:
  - coverage counts per tier, the UltraStar octave-error rate and the Gemini calibration per band (from `summary.json`);
  - the NomadPC row and skip counts, the Gemini actual cost;
  - Andrew's to-dos: Pulumi apply + job runs (Task 14 Step 6), the phone test of the mic flow, an optional USDB account.

  Then `/backlog-add` the follow-ups:
  - a vocal-range step in gen's audio worker for new jobs (spec §5.1);
  - incremental USDB refresh once an account exists;
  - Phase 4 crowd singability into the reserved `crowd_*` fields.
