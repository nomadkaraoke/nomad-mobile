# Testing nomad-mobile

| What | Where it runs | Command |
|---|---|---|
| Unit / component tests (jest) | your machine, CI on every PR | `pnpm test` (`pnpm test:coverage` enforces 70%+) |
| Lint, typecheck, i18n, OpenAPI drift | your machine, CI on every PR | `pnpm lint && pnpm typecheck && pnpm i18n:check` |
| **Maestro E2E, iOS + Android** | **GitHub Actions** (default) | `scripts/e2e-ci.sh run` |
| Maestro E2E while writing a flow | the local simulator / emulator | `scripts/e2e-local.sh --platform ios make-4` |
| Real-device checks | Andrew's Pixel, the iPad (USB) | see CLAUDE.md § App identity, `/phone-adb` |

## E2E in CI (use this instead of a local full suite)

`.github/workflows/e2e.yml` runs the Maestro flows on GitHub-hosted runners, off Andrew's MacBook. The repo is
public, so hosted runners cost nothing. Each shard is its own runner with its own gen + decide + kjbox local
stacks (fake workers, emulators, fixture data), so branches and platforms run in parallel without breaking each
other's global fake-config.

- **Android:** `ubuntu-latest` with KVM, an API 35 `google_apis` x86_64 emulator (Pixel 7 profile, 4 GB), 5 shards.
- **iOS:** `macos-26` (Xcode 26.x, "iPhone 17 Pro" simulator), 4 shards. The org's hosted macOS concurrency is 5
  jobs in total, so iOS shards from several branches queue. `--self-hosted` runs iOS on the spare MacBook Pro
  (runner label `nomad-mbp`; dispatch only, never a fork's PR).
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

### The spare MacBook Pro runner (`nomad-mbp`)

Andrew's spare MacBook Pro (M3 Max, 36 GB, `ssh andrewmastech`, LAN `AndrewMastechMac.local`; machine setup log:
`~/Projects/build-host-setup.md` on it) is a self-hosted runner for this repo, set up 2026-10-26:

- `~/actions-runner` (runner name and label `nomad-mbp`), a launchd LaunchAgent in the auto-logged-in GUI session
  (`./svc.sh status|stop|start`). `.path` puts Homebrew and the Android SDK on PATH; `.env` sets `ANDROID_HOME`,
  `JAVA_HOME` (Temurin 17) and **`DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer`**: the machine's
  default Xcode is 27.1, but the app and flows are on Xcode 26.6 / iOS 26.5 like CI, so jobs use the 26.6 copy.
  Simulator runtimes: iOS 26.5 ("iPhone 17 Pro" created), 27.0, 27.1.
- **Only `workflow_dispatch` runs use it** (`scripts/e2e-ci.sh run --self-hosted`): on a public repo a self-hosted
  runner must never take a fork's PR. With `--self-hosted` both the iOS build (minutes instead of ~33 min cold on
  hosted) and the iOS shards run there.
- **One job at a time**: the stacks use fixed ports, so shards queue on it (4 iOS shards ≈ 4 × 20 min). For the
  shortest wall-clock use the hosted runners; use the MBP when hosted macOS is queued, for a quick iOS rebuild after a
  native change. (`scripts/ci/run-shard.sh` takes `IOS_RUNTIME=27-0` for an iOS 27 run; it isn't a dispatch input yet.)
- If it is offline (`gh api repos/nomadkaraoke/nomad-mobile/actions/runners`), `--self-hosted` jobs wait in the queue;
  rerun without it.

- **The iPad lives on it** (USB, paired 2026-10-26: "Lindrew iPad", UDID `00008120-001E11593CF80032`, iPadOS 26.6.1,
  Developer Mode on). From any session, over SSH, no root:
  `ssh andrewmastech 'xcrun devicectl device process launch --device 00008120-001E11593CF80032 --payload-url nomadkaraoke://tonight com.nomadkaraoke.mobile'`;
  screenshot with `ssh andrewmastech '~/.venvs/pmd3/bin/pymobiledevice3 developer dvt screenshot /tmp/ipad.png'` then
  `scp andrewmastech:/tmp/ipad.png .`; install a team-signed build with `xcrun devicectl device install app`. Signing on
  the MBP needs Andrew's Apple ID in its Xcode (not added yet); until then install builds signed on Andrew's laptop. Maestro flows on the real iPad are a follow-up
  (flows use simctl prep and 127.0.0.1 stacks; a device needs the MBP's LAN address).
- **Screen:** `open vnc://AndrewMastechMac.local` (macOS Screen Sharing; RealVNC can't do Apple's auth).

### Public repo rules

Logs and artifacts are world-readable. The E2E workflow uses **no secrets** and only the local stacks' fake
credentials and fixture users (`e2e-…@example.com`). Never add a prod token, a real account or a `secrets.*`
reference to it; never point a flow at prod. Fork PRs need approval before any workflow runs (repo setting:
all outside contributors), and the self-hosted runner only takes `workflow_dispatch` runs.

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
