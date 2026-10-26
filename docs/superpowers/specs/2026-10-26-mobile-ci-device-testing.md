# Mobile E2E off the Mac: research and decision (2026-10-26)

**Problem (Andrew):** "i'm getting a little fed up with the time and resources it takes on my macbook to run all
these android and ios regression test suites locally, i feel like it's slowing down development of this app
significantly". Every phase session ran Maestro on one iOS simulator and one Android emulator on his M3 Max
(36 GB, 15 GB free disk) against the gen/decide/kjbox local stacks, and sessions queued for hours.

**Decision (Andrew, 2026-10-26):** make nomad-mobile public and run the suites on GitHub-hosted runners (free for
public repos): Android on `ubuntu-latest` + KVM, iOS on `macos-26`, sharded per branch, every shard with its own
local stacks. Add the spare MacBook Pro (M3 Max, 36 GB) as a self-hosted runner and shared device box. Keep the
AWS Activate credits for gen. Plus the free local wins: Maestro ≥ 2.2 (per-run iOS driver port), affected-flow
PR runs, fingerprint-cached native builds, a local device lock.

## Baseline (from `~/.maestro/tests`, 1,284 local runs)

- 75 flows across branches (56 on main): ~90 min of pure flow time per platform serially (main: ~72 min), plus
  stacks, Metro and native builds, so a full iOS + Android regression took about 3.5–4 h on the Mac.
- 24% of flow runs failed (dev iteration, plus load flakes on a busy Mac).
- Maestro 2.1's iOS driver used fixed port 7001, so only one iOS run per Mac. Maestro 2.2+ picks a free port per
  run (`TestCommand.selectPort()` → `ServerSocket(0)`, checked in the cli-2.12.0 source).

## Options costed (iOS + Android, per month; "smart" = affected flows on PRs + nightly full ≈ 9.5k device-min/platform)

| Option | Smart / heavy (32k min) | Verdict |
|---|---|---|
| **Public repo + GitHub-hosted** (ubuntu KVM + macos-26) | **$0 / $0** | **Chosen.** 20 concurrent jobs (5 macOS); backends run in-job |
| Private: Android GitHub Linux + iOS on own Mac mini (~$999 once) | ~$40–110 + $0 | Fallback (the spare MBP makes the Mac free) |
| Private: Android on AWS c8i spot (nested virt) + Mac mini | $20–63 of credits (10–30% of $205/mo) | Not needed; keep credits for gen |
| GitHub-hosted, private repo | ~$680 / $2,380 | No |
| Dedicated Mac rental (Scaleway M4 €199, MacStadium $249) | flat | Not needed (spare MBP) |
| EC2 Mac (24 h minimum; mac2 $0.65/h, mac-m4 $1.23/h) | $475–900 | No: 230–440% of the credit budget |
| EAS Workflows `type: maestro` (Starter+, VM minutes) | $1.1k / $3.8k | No |
| Codemagic fixed team plan | $333 | No |
| Maestro Cloud ($250/device) | $500+ | No: needs a public backend (IP allowlist only) |
| BrowserStack / Sauce / TestMu / AWS Device Farm | $550–1,800 | No: no adb/simctl shell for device prep, public backend or tunnel; real devices only for spot checks |
| Firebase Test Lab | — | Can't run Maestro; shutting down 2027-09-30 |

Sources (fetched 2026-10-26): docs.github.com actions-runner-pricing (macOS $0.062/min, Linux 2-core $0.006;
self-hosted platform fee postponed), expo.dev/pricing, maestro.dev/pricing, browserstack.com/pricing,
aws.amazon.com/ec2/instance-types/mac + dedicated-host price list, docs.aws.amazon.com nested virtualization (C8i/M8i/R8i,
Feb 2026), genymotion.com/pricing, firebase.google.com/docs/test-lab/usage-quotas-pricing, codemagic.io/pricing,
cirruslabs.org (Cirrus CI shut down 2026-06-01; Tart relicensed, free).

## Going public: what was checked (2026-10-26)

- gitleaks over all 14 remote branches' history: clean; trufflehog (verified): none. No tags.
- `EXPO_PUBLIC_*` client keys (RevenueCat SDK, PostHog project, Sentry DSN) and `google-services.json` (Phase 6
  branch) ship inside the app binary anyway. **Follow-up:** confirm the Firebase Android API key is restricted to
  `com.nomadkaraoke.mobile` + the signing SHA-1s (needs Andrew's gcloud login).
- 37 prod screenshots + a sample of local ones: no emails, tokens or payment data; some prod shots show a real
  account's music tastes (no name or email).
- Repo settings after the flip: fork-PR workflows need approval for all outside contributors; artifact/log
  retention 7 days; the E2E workflow references no secrets; the self-hosted runner only takes `workflow_dispatch`.
