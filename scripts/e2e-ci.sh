#!/usr/bin/env bash
# Run the Maestro suites in GitHub Actions (.github/workflows/e2e.yml) instead of on this Mac, and read the results.
#
#   scripts/e2e-ci.sh run                         # full suite, iOS + Android, on the current branch (pushed)
#   scripts/e2e-ci.sh run --platforms android --filter tonight
#   scripts/e2e-ci.sh run --affected              # only the flows the branch's changes affect (like a PR run)
#   scripts/e2e-ci.sh run --gen-ref my-gen-branch # against unmerged gen (also --decide-ref, --kjbox-ref)
#   scripts/e2e-ci.sh run --self-hosted           # both platforms on the self-hosted Mac's lanes (label nomad-mbp)
#   scripts/e2e-ci.sh run --hosted                # both platforms on GitHub-hosted runners
#   scripts/e2e-ci.sh run --no-wait               # print the run URL and return
#   scripts/e2e-ci.sh pr                          # wait for the newest E2E run of this branch (PR or dispatch)
#   scripts/e2e-ci.sh results RUN_ID              # the failed shards' reports + failing flows' screenshots, summary
#   scripts/e2e-ci.sh results RUN_ID --all        # every shard, every flow's debug output (hundreds of MB)
#
# run/pr wait for the run, then call results. Artifacts land in .e2e-ci/<run id>/e2e-<platform>-<shard>/:
# junit-<n>.xml, debug-<n>/<flow>/ (Maestro's screenshots and command logs; by default only for flows that failed,
# including a first try that passed on retry; logs over 1 MB are gzipped), final.png (where a failed shard stopped),
# android-guard.log. The
# GitHub job summary has the full pass/fail list; locally only the failed shards are fetched. Old runs are pruned:
# the newest E2E_CI_KEEP (default 5) are kept while .e2e-ci stays under E2E_CI_MAX_MB (default 2048). A full download
# of every run filled Andrew's disk (23 GB). The branch must be pushed: CI runs what is on GitHub, not your working tree.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${E2E_REPO:-nomadkaraoke/nomad-mobile}"
cd "$ROOT"

# Keep .e2e-ci small: drop runs beyond the newest E2E_CI_KEEP, then the oldest while it is over E2E_CI_MAX_MB.
prune() {
  local base="$ROOT/.e2e-ci" keep="${E2E_CI_KEEP:-5}" max="${E2E_CI_MAX_MB:-2048}" runs=() d
  [[ -d "$base" ]] || return 0
  while IFS= read -r d; do runs+=("$d"); done < <(ls -1t "$base" 2>/dev/null)
  local i=0
  for d in ${runs[@]+"${runs[@]}"}; do
    i=$((i + 1))
    (( i > keep )) && rm -rf "${base:?}/$d"
  done
  while (( $(du -sm "$base" | cut -f1) > max )); do
    d="$(ls -1t "$base" | tail -1)"
    [[ -n "$d" && "$(ls -1 "$base" | wc -l)" -gt 1 ]] || break
    echo "pruning .e2e-ci/$d (over ${max} MB)"
    rm -rf "${base:?}/$d"
  done
}

# Delete the debug output of flows that passed first time (the failures' and flaky first tries' stay).
trim_passing() {
  local shard="$1" keep
  keep="$(node -e '
    const fs = require("fs"), dir = process.argv[1], bad = new Set();
    for (const f of fs.readdirSync(dir).filter((x) => /^junit-(retry-)?\d+\.xml$/.test(x)))
      for (const m of fs.readFileSync(`${dir}/${f}`, "utf8").matchAll(/<testcase\b[^>]*?name="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g))
        if (/<(failure|error)\b/.test(m[3] || "")) bad.add(m[1]);
    console.log([...bad].join("\n"));' "$shard")"
  local d f
  for d in "$shard"/debug-*/; do
    [[ -d "$d" ]] || continue
    for f in "$d"*/; do
      [[ -d "$f" ]] || continue
      grep -qxF "$(basename "$f")" <<<"$keep" || rm -rf "$f"
    done
  done
}

results() {
  local id="$1" all="${2:-}" dir="$ROOT/.e2e-ci/$1" names=() n
  rm -rf "$dir"; mkdir -p "$dir"
  if [[ "$all" == --all ]]; then
    names=($(gh api "repos/$REPO/actions/runs/$id/artifacts" --paginate -q '.artifacts[].name | select(startswith("e2e-"))'))
  else
    # Shards whose job didn't succeed: job "android 1 (~32 min)" uploads artifact e2e-android-1.
    names=($(gh run view "$id" -R "$REPO" --json jobs -q '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != null)
      | .name | capture("^(?<p>ios|android) (?<n>[0-9]+)") | "e2e-\(.p)-\(.n)"'))
  fi
  for n in ${names[@]+"${names[@]}"}; do
    gh run download "$id" -R "$REPO" -n "$n" -D "$dir/$n" 2>/dev/null || { echo "($n: no artifact)" >&2; continue; }
    [[ "$all" == --all ]] || trim_passing "$dir/$n"
  done
  # Device and driver logs are most of the bytes (437 of 511 MB on one nightly): gzip the big ones (zgrep / zless).
  find "$dir" -type f \( -name '*.log' -o -name '*.txt' \) -size +1M -exec gzip -q {} + 2>/dev/null || true
  if [[ ${#names[@]} -eq 0 ]]; then echo "No shard failed: nothing downloaded (results $id --all fetches everything)."
  else
    node scripts/ci/e2e-report.mjs "$dir"
    [[ "$all" == --all ]] || echo "(failed shards only; the run's job summary lists every shard)"
  fi
  echo "Artifacts: $dir ($(du -sh "$dir" | cut -f1))"
  echo "Run: https://github.com/$REPO/actions/runs/$id"
  prune
  [[ "$(gh run view "$id" -R "$REPO" --json conclusion -q .conclusion)" == success ]]
}

wait_run() {
  local id="$1"
  echo "Watching https://github.com/$REPO/actions/runs/$id"
  gh run watch "$id" -R "$REPO" --interval 30 --exit-status >/dev/null 2>&1 || true
  results "$id"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  run)
    ref="$(git rev-parse --abbrev-ref HEAD)"
    fields=(); wait=1
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --ref) ref="$2"; shift 2 ;;
        --platforms) fields+=(-f "platforms=$2"); shift 2 ;;
        --filter) fields+=(-f "filter=$2"); shift 2 ;;
        --skip) fields+=(-f "skip=$2"); shift 2 ;;
        --affected) fields+=(-f affected=true); shift ;;
        --self-hosted) fields+=(-f ios_runner=self-hosted -f android_runner=self-hosted); shift ;;
        --hosted) fields+=(-f ios_runner=github -f android_runner=github); shift ;;
        --ios-shards) fields+=(-f "ios_shards=$2"); shift 2 ;;
        --android-shards) fields+=(-f "android_shards=$2"); shift 2 ;;
        --gen-ref) fields+=(-f "gen_ref=$2"); shift 2 ;;
        --decide-ref) fields+=(-f "decide_ref=$2"); shift 2 ;;
        --kjbox-ref) fields+=(-f "kjbox_ref=$2"); shift 2 ;;
        --no-wait) wait=""; shift ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
      esac
    done
    if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$ref" 2>/dev/null || echo none)" ]]; then
      echo "note: HEAD isn't what origin/$ref points at; CI runs origin/$ref (push first to test your latest commit)" >&2
    fi
    since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    gh workflow run e2e.yml -R "$REPO" --ref "$ref" ${fields[@]+"${fields[@]}"}
    id=""
    for _ in $(seq 1 30); do
      id="$(gh run list -R "$REPO" --workflow e2e.yml --branch "$ref" --event workflow_dispatch --limit 5 \
        --json databaseId,createdAt -q "[.[] | select(.createdAt >= \"$since\")][0].databaseId // empty")"
      [[ -n "$id" ]] && break
      sleep 2
    done
    [[ -n "$id" ]] || { echo "dispatched, but couldn't find the run; see gh run list --workflow e2e.yml" >&2; exit 1; }
    if [[ -z "$wait" ]]; then echo "https://github.com/$REPO/actions/runs/$id"; exit 0; fi
    wait_run "$id"
    ;;
  pr)
    ref="$(git rev-parse --abbrev-ref HEAD)"
    id="$(gh run list -R "$REPO" --workflow e2e.yml --branch "$ref" --limit 1 --json databaseId -q '.[0].databaseId // empty')"
    [[ -n "$id" ]] || { echo "no E2E run for $ref yet" >&2; exit 1; }
    wait_run "$id"
    ;;
  results) results "${1:?RUN_ID}" "${2:-}" ;;
  *) sed -n '2,23p' "$0"; exit 2 ;;
esac
