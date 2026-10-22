# Phase 3d "voice session": handoff for a fresh session

## Read first (in this order)
1. `docs/VISION.md` (nomad-mobile): use cases, release bar, Phase 3 roadmap.
2. Spec `docs/superpowers/specs/2026-10-22-mobile-phase3d-voice-session-design.md`. §10a and §10b override earlier sections (Spotify-only audio via flacfetch under a 24 h rolling budget, default 12 h; YouTube embed spike with link-out fallback; separate-only GPU job; overall-range feedback only).
3. Plan `docs/superpowers/plans/2026-10-22-mobile-phase3d-voice-session.md` (31 tasks, Parts A–G). Its "Self-review notes" list the spec gaps and how they were resolved.
4. 3c spec + plan (`specs/2026-10-21-mobile-phase3c-vocal-range-design.md`, `plans/2026-10-21-mobile-phase3c-vocal-range.md`): 3d reuses `PitchSource`, `packages/core/src/voice`, `fit`, `song_vocal_range`, `PUT /api/my/voice`.
5. 3a plan (`plans/2026-10-21-mobile-phase3a-discover-core.md`) for catalog.db, recs v2, the test API and the Discover components; survey `specs/2026-10-21-mobile-phase3-discover-survey.md` §8, §12, §13.
6. Workspace session record `docs/sessions/2026-Q4/2026-10-21-mobile-phase3-discover.md` and the repos' `CLAUDE.md` files (mobile, decide, gen, flacfetch).

## Prerequisites
- 3a merged (decide is; check the mobile 3a PR) and **3c merged and deployed** (decide `vocal_range/*`, `/api/my/voice`, the `vocal-analysis` image; mobile `voice/*`, fake mic). 3b is optional.
- If 3c's merged names differ from the plan's "3a/3c seams" list, follow the code and log a ledger "Ruling:".
- Task D1 (device spike) and Task A1 (flacfetch budget) have no 3c dependency: they can start right away.

## How the 3a session ran (do the same)
- `superpowers:subagent-driven-development`: one fresh implementer subagent per task (sonnet), then a fresh reviewer (`feature-dev:code-reviewer`) per task; up to 5 fix rounds; the controller never writes code itself.
- **Ledger** per repo, gitignored: `<repo>/.superpowers/sdd/phase3d/progress.md`. One line per event: `Task X: dispatched (BASE <sha>)`, `review 1 needs fixes (…)`, `fix round n/5 (…)`, `complete (commits a..b, review clean)`, `minor (deferred): …`, and `Ruling: <decision> — <why> — <cost if wrong>` for every judgement call. Copy the Ruling lines into the final session record.
- Before each PR: `/test-review` → `/docs-review` → `/coderabbit` (max 3 cycles) → `/pr`. Bump versions per the plan.
- UI tasks are done only with simulator screenshots plus passing Maestro flows (mobile `CLAUDE.md` rule 1). Never run iOS and Android Maestro suites at the same time.

## Steps that need Andrew
- Deploy flacfetch on flacup after the A1 PR (pull + `pip install -e .[api,spotify]` + restart; the ledger path env comes from `deploy/provision.sh`).
- `pulumi up` in gen `infrastructure/` before merging A5, and in decide `infrastructure/` after A8 (via `/gcp-admin`); resume the `voice-pool-fetch` scheduler; later the `VOICE_SESSION_OPEN` flag (G1).
- gcloud user auth to read the `admin-tokens` secret for the sheet import (B4 step 2).
- Sessions as himself with the release APK, debug-screen reviews, and the sign-off (E2); approve the $20/month personal-pool budget guard (F1).

## Coordination with Phase 5 Tonight
- Tonight runs in parallel (backlog 4.5; worktrees `nomad-mobile-phase5-tonight` + `kjbox-singer-app-api`; earlier plans call the session nomadkaraoke-a7). Message it before merging shared files: `packages/i18n/messages/*`, `packages/core/src/index.ts`, `packages/ui`, `apps/mobile/package.json` + lockfile, `app.json`/`app.config.ts` (3d adds `react-native-webview` and the `expo-notifications` plugin), `(tabs)/*`, `_layout.tsx`, `maestro/scripts/stack.js`, `scripts/e2e-local.sh`.
- Tonight also shows YouTube links at other bars: offer it `apps/mobile/src/media/youtube.ts` (Task D3) and the D1 spike results, so both use one YouTube path.

## First concrete steps
1. Check the prerequisites (`git log origin/main` in decide and mobile; 3c tables and `/api/my/voice` on prod). If 3c isn't merged, do only D1 and A1.
2. Create worktrees: `/startnomad flacfetch spotify-budget`, `/startnomad gen voice-pool-separate`; decide and mobile get new branches from `origin/main` in the existing `*-phase3-discover` worktrees.
3. Create both ledgers and log the dispatch of Task A1 (flacfetch) and Task D1 (spike; Android emulator first, then ask Andrew for a phone check).
4. Then A2 → A3 → A4, with A5 (gen) alongside; A6–A7; A8 ships the pool PR and starts the ~1-week backfill. Do Parts B and C while the pool fills.
5. Write `/wrap` session records as you go; `/backlog-start` the 3d item so BACKLOG.md shows WIP.
