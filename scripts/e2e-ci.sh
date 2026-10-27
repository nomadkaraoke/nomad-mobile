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
#   scripts/e2e-ci.sh results RUN_ID              # download reports + failure screenshots, print the summary
#
# run/pr wait for the run, then call results. Artifacts land in .e2e-ci/<run id>/e2e-<platform>-<shard>/:
# junit-<n>.xml, debug-<n>/ (Maestro's screenshots and command logs for each flow), final.png (the screen where a
# failed shard stopped). The branch must be pushed: CI runs what is on GitHub, not your working tree.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${E2E_REPO:-nomadkaraoke/nomad-mobile}"
cd "$ROOT"

results() {
  local id="$1" dir="$ROOT/.e2e-ci/$1"
  rm -rf "$dir"; mkdir -p "$dir"
  gh run download "$id" -R "$REPO" -p 'e2e-*' -D "$dir" 2>/dev/null || true
  node scripts/ci/e2e-report.mjs "$dir"
  echo "Artifacts: $dir"
  echo "Run: https://github.com/$REPO/actions/runs/$id"
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
  results) results "${1:?RUN_ID}" ;;
  *) sed -n '2,17p' "$0"; exit 2 ;;
esac
