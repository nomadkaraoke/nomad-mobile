# Testing nomad-mobile

| What | Where it runs | Command |
|---|---|---|
| Unit / component tests (jest) | your machine, CI on every PR | `pnpm test` (`pnpm test:coverage` enforces 70%+) |
| Lint, typecheck, i18n, OpenAPI drift | your machine, CI on every PR | `pnpm lint && pnpm typecheck && pnpm i18n:check` |
| **Maestro E2E, iOS + Android** | **GitHub Actions** (default) | `scripts/e2e-ci.sh run` |
| Maestro E2E while writing a flow | the local simulator / emulator | `scripts/e2e-local.sh --platform ios make-4` |
| Real-device checks | Andrew's Pixel, the iPad (USB) | see CLAUDE.md § App identity, `/phone-adb` |

## E2E in CI (use this instead of a local full suite)

`.github/workflows/e2e.yml` runs the Maestro flows off Andrew's MacBook: on the self-hosted Mac's three lanes by
default, or on GitHub-hosted runners (free: the repo is public). Each shard is its own runner with its own gen + decide + kjbox local
stacks (fake workers, emulators, fixture data), so branches and platforms run in parallel without breaking each
other's global fake-config.

- **Android:** `ubuntu-latest` with KVM, an API 35 `google_apis` x86_64 emulator (Pixel 7 profile, 4 GB), 5 shards.
- **iOS:** `macos-26` (Xcode 26.x, "iPhone 17 Pro" simulator), 4 shards; best-effort (a 3-core, 7 GB runner can stall
  under the simulator plus three stacks). The self-hosted lanes below are the default for this repo's PRs.
- **When:**
  - every PR runs only the flows its changes affect (path rules in `scripts/e2e-plan-lib.mjs`). An unmapped app or
    package path, a dependency change or a change to `maestro/common`, `maestro/scripts` or the E2E scripts runs
    everything; docs and tests run nothing. Add the label **`e2e-full`** to a PR to run every flow.
  - nightly (03:23 ET) and `scripts/e2e-ci.sh run`: the full suite on both platforms.
- **Native builds are cached by the Expo fingerprint** (`scripts/ci/build-dev-client.sh fingerprint`), so a JS-only
  change reuses the last dev client and only rebundles in Metro. A new native dependency, config plugin or
  `app.config.ts` change rebuilds (iOS ~15–20 min, Android ~10 min).
- **Shards** are balanced by `maestro/durations.json` (median seconds per flow from local runs). Flows tagged
  `offline-warmup` / `force-offline` stay together in one shard (e2e-local.sh's offline Metro restart).

### From a session

```bash
git push                                          # CI runs what is on GitHub
scripts/e2e-ci.sh run                             # full suite, both platforms, current branch; waits, then prints the summary
scripts/e2e-ci.sh run --platforms ios --filter review-   # narrow it
scripts/e2e-ci.sh run --affected                  # like a PR run
scripts/e2e-ci.sh run --gen-ref feat/sess-…       # against an unmerged gen branch (also --decide-ref / --kjbox-ref)
scripts/e2e-ci.sh pr                              # wait for this branch's newest E2E run (e.g. the PR's) and fetch results
scripts/e2e-ci.sh results <run id>
```

`results` downloads every shard's artifacts into `.e2e-ci/<run id>/e2e-<platform>-<shard>/` (gitignored):
`junit-<n>.xml`, `debug-<n>/` (Maestro's per-flow screenshots, command JSON and logs; open the failing flow's
screenshots with the Read tool) and `final.png` (where a failed shard stopped). The job log also prints every stack's
log on failure (`scripts/ci/setup-stacks.sh logs`). Artifacts are kept 7 days.

`workflow_dispatch` (so `e2e-ci.sh run`) needs `e2e.yml` on main, which it is once this lands; on a branch that
changes the workflow, a PR run tests the changed workflow.

### The self-hosted runners (`nomad-mbp`): the default for this repo's own PRs

A spare Mac at Andrew's place runs three self-hosted runners for this repo (label `nomad-mbp`), one per **lane**
(`scripts/e2e-lane.sh`): `LANE=N` moves every port up by 100·N (gen 8010+100N, decide 8030+100N, kjbox 8040+100N,
Metro 8081+100N, …) and gives the lane its own Firestore project, GCS bucket, state dirs, simulator and Android
emulator, so three shards run side by side on one machine. Builds use Xcode 26.6 (`E2E_BUILD_DEVELOPER_DIR`), Maestro and the simulators the Mac's
default Xcode 27.1 (Maestro's iOS driver doesn't start under the 26.6 copy). Its setup, the USB iPad on it and how to see and click
its screen are in the **private** workspace doc `docs/BUILD-HOST.md` (workspace root, not this public repo).

- **Routing.** Repo variables `E2E_IOS_RUNNER` / `E2E_ANDROID_RUNNER` = `self-hosted` (set since 2026-10-26) send
  this repo's own PRs and the nightly run there: dev-client builds (minutes on the Mac: Android ~5 min, iOS ~10 min
  cold, vs ~15 / ~33 on hosted) and shards (3 per platform, one per lane, queued over the 3 lanes). A dispatch picks
  with `ios_runner` / `android_runner` (`scripts/e2e-ci.sh run --self-hosted` for iOS). To fall back to GitHub-hosted,
  unset the variables or dispatch with `github`.
- **Fork PRs never run there.** On a public repo a fork's PR runs its own copy of the workflow, so the machine enforces
  it itself: a job-started hook refuses every job that isn't a dispatch, schedule, push or same-repo PR. Never approve
  workflow runs for a fork's PR.
- **Memory is the limit**, not CPU: three lanes fill its 36 GB (an emulator is ~5 GB with its stack and Metro). Don't
  add lanes without measuring.
- **Offline** (`gh api repos/nomadkaraoke/nomad-mobile/actions/runners`): jobs wait in the queue; unset the variables
  or dispatch with `github` to use hosted runners.
- Lanes work locally too: `LANE=1 scripts/e2e-local.sh --platform ios make-4` runs beside a lane-0 run on another
  simulator (needs gen/decide/kjbox with the lane env overrides, all merged 2026-10-26).

### Public repo rules

Logs and artifacts are world-readable. The E2E workflow uses **no secrets** and only the local stacks' fake
credentials and fixture users (`e2e-…@example.com`). Never add a prod token, a real account or a `secrets.*`
reference to it; never point a flow at prod. Fork PRs need approval before any workflow runs (repo setting:
all outside contributors), and the self-hosted runners refuse fork PRs themselves (a job-started hook on the machine).

## E2E locally

Still the right tool while writing or debugging one flow (Maestro MCP, quick reruns). Run only what you are working
on, then let CI run the suite. See CLAUDE.md § E2E for the stacks, env and gotchas.

- **Device lock:** `scripts/e2e-local.sh` waits for the device it uses, the gen stack (its search knobs and step
  delay are global fake-config) and, with Maestro older than 2.2, the fixed iOS driver port. Parallel sessions
  queue there instead of breaking each other. `scripts/device-lock.sh status` shows who holds what; hold a device for
  anything else (a manual check, the iPad, the Pixel) with `scripts/device-lock.sh acquire ipad "what"` …
  `release ipad`, or `scripts/device-lock.sh run <key> -- <cmd>`. A lock whose holder died is taken over.
- **Maestro ≥ 2.2** picks a free iOS driver port per run (2.1 always used 7001), so two iOS runs on two simulators
  no longer collide. CI pins `MAESTRO_VERSION` in `e2e.yml`; upgrade locally with
  `curl -fsSL https://get.maestro.mobile.dev | MAESTRO_VERSION=<v> bash` when no run is in progress.
- `--flows a,b,c` runs exactly those flows (how CI runs a shard); `MAESTRO_TEST_ARGS` adds `maestro test`
  options (`{run}` becomes the Maestro run's number).
