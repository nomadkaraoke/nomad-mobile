#!/usr/bin/env bash
# CI (.github/workflows/e2e.yml): the gen, decide and kjbox local stacks on a fresh GitHub runner (Linux or macOS),
# so scripts/e2e-local.sh finds them up and starts none itself. Expects the three repos checked out beside this one
# (../karaoke-gen, ../karaoke-decide, ../kjbox, the layout e2e-local.sh defaults to) and Python 3.13, Node and Java
# 21 on PATH.
#
#   scripts/ci/setup-stacks.sh install            # poetry venvs (gen, decide), kjbox venv, gen web deps if WITH_WEB=1
#   scripts/ci/setup-stacks.sh up                 # emulators + gen (+ web if WITH_WEB=1) + decide; kjbox is left to
#                                                 # e2e-local.sh (it resets it fresh for Tonight runs)
#   scripts/ci/setup-stacks.sh logs               # tail every stack log (on failure)
#
# Emulators run natively, without Docker (GitHub's macOS runners have none): the Firestore emulator jar that
# firebase-tools pins on :8080 and fake-gcs-server on :4443, with the flags gen's start-emulators.sh gives its
# container. gen's start-emulators.sh then sees both ports taken and starts nothing. Downloads are cached in
# $EMULATOR_CACHE (default ~/.cache/nomad-emulators; the workflow caches it).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WS="$(cd "$ROOT/.." && pwd)"
GEN="$WS/karaoke-gen"
DECIDE="$WS/karaoke-decide"
KJBOX="$WS/kjbox"
CACHE="${EMULATOR_CACHE:-$HOME/.cache/nomad-emulators}"
LOGS="${STACK_LOGS:-$WS/stack-logs}"
FIRESTORE_JAR_VERSION=1.22.0
FIRESTORE_JAR_SHA256=9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c
FAKE_GCS_VERSION=1.56.1
PARTNER_SECRET=local-stack-secret
mkdir -p "$CACHE" "$LOGS"

wait_port() { # PORT NAME SECONDS
  local deadline=$((SECONDS + $3))
  until (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; do
    (( SECONDS < deadline )) || { echo "$2 not listening on :$1 after $3 s" >&2; return 1; }
    sleep 1
  done
  echo "$2 up on :$1"
}

fetch_emulators() {
  local jar="$CACHE/cloud-firestore-emulator-v$FIRESTORE_JAR_VERSION.jar"
  if [[ ! -f "$jar" ]]; then
    curl -fsSL -o "$jar.tmp" "https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v$FIRESTORE_JAR_VERSION.jar"
    echo "$FIRESTORE_JAR_SHA256  $jar.tmp" | shasum -a 256 -c - >/dev/null
    mv "$jar.tmp" "$jar"
  fi
  local os arch
  os="$(uname -s)"; arch="$(uname -m)"; [[ "$arch" == x86_64 ]] && arch=amd64; [[ "$arch" == aarch64 ]] && arch=arm64
  if [[ ! -x "$CACHE/fake-gcs-server" ]]; then
    curl -fsSL "https://github.com/fsouza/fake-gcs-server/releases/download/v$FAKE_GCS_VERSION/fake-gcs-server_${FAKE_GCS_VERSION}_${os}_${arch}.tar.gz" |
      tar -xz -C "$CACHE" fake-gcs-server
  fi
}

install() {
  python3 -m pip install --quiet poetry
  poetry config virtualenvs.in-project true
  (cd "$GEN" && poetry install --no-interaction --quiet 2>&1 | tail -5) &
  local gen_pid=$!
  (cd "$DECIDE" && poetry install --no-interaction --quiet 2>&1 | tail -5)
  wait "$gen_pid"
  # kjbox's local-stack.sh runs "$PYTHON": the workflow sets PYTHON to this venv's python.
  (cd "$KJBOX/kj-controller" && python3 -m venv .venv && .venv/bin/pip install --quiet -r requirements.txt)
  if [[ "${WITH_WEB:-}" == 1 ]]; then (cd "$GEN/frontend" && npm ci --legacy-peer-deps --no-audit --no-fund --loglevel=error); fi
  fetch_emulators
}

up() {
  fetch_emulators
  nohup java -jar "$CACHE/cloud-firestore-emulator-v$FIRESTORE_JAR_VERSION.jar" --host 127.0.0.1 --port 8080 \
    >"$LOGS/firestore.log" 2>&1 &
  nohup "$CACHE/fake-gcs-server" -scheme http -port 4443 -external-url http://127.0.0.1:4443 \
    -public-host 127.0.0.1:4443 >"$LOGS/gcs.log" 2>&1 &
  wait_port 8080 "Firestore emulator" 90
  wait_port 4443 "GCS emulator" 30
  local web=()
  [[ "${WITH_WEB:-}" == 1 ]] && web=(--frontend)
  (cd "$GEN" && DECIDE_GEN_PARTNER_SECRET="$PARTNER_SECRET" LOCAL_STACK_API_URL=http://127.0.0.1:8010 \
    scripts/local-stack.sh up ${web[@]+"${web[@]}"})
  (cd "$DECIDE" && GEN_API_URL=http://127.0.0.1:8010 scripts/local-stack.sh up)
}

logs() {
  local f
  for f in "$LOGS"/*.log "$GEN"/.local-stack/*.log "$DECIDE"/.local-stack/*.log "$HOME"/kjdata-localstack/*.log \
    /tmp/nomad-mobile-metro*.log /tmp/nomad-mobile-stack-control.log; do
    [[ -f "$f" ]] || continue
    echo "::group::$f"
    tail -n 200 "$f"
    echo "::endgroup::"
  done
}

case "${1:-}" in
  install) install ;;
  up) up ;;
  logs) logs ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
