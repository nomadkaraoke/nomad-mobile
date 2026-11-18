#!/usr/bin/env bash
# Start the nightly full E2E run (both platforms, main) by dispatching .github/workflows/e2e.yml.
# Runs on the build host at 03:00 local from LaunchAgent com.nomadkaraoke.mobile-nightly-e2e
# (scripts/ci/install-nightly-agent.sh). GitHub's own `schedule:` trigger started the 02:23 cron 7-10 h late
# (Nov 2026: 09:15-13:00 ET, fans on while Andrew was home) and sometimes skipped days; a dispatch starts at once.
#
# Token: a fine-grained PAT, resource owner nomadkaraoke, only nomad-mobile, permission Actions: read and write,
# in ~/.config/nomad-ci/nomad-mobile-dispatch-token (mode 600). Nothing else on the Mac uses it.
set -euo pipefail
TOKEN_FILE="${NIGHTLY_TOKEN_FILE:-$HOME/.config/nomad-ci/nomad-mobile-dispatch-token}"
REPO="${NIGHTLY_REPO:-nomadkaraoke/nomad-mobile}"
REF="${NIGHTLY_REF:-main}"
log() { echo "$(date '+%F %T') $*"; }

if [[ ! -r "$TOKEN_FILE" ]]; then
  log "no token at $TOKEN_FILE; nightly E2E not started"
  exit 1
fi
code=$(curl -sS --connect-timeout 15 --max-time 60 -o /tmp/nightly-dispatch.out -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $(<"$TOKEN_FILE")" \
  -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "User-Agent: nomad-mobile-nightly" \
  "https://api.github.com/repos/$REPO/actions/workflows/e2e.yml/dispatches" \
  -d "{\"ref\":\"$REF\"}") || code=000
if [[ "$code" == 204 ]]; then
  log "dispatched E2E on $REPO@$REF"
else
  log "dispatch failed: HTTP $code $(head -c 300 /tmp/nightly-dispatch.out 2>/dev/null)"
  exit 1
fi
