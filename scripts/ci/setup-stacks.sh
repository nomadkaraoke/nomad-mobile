#!/usr/bin/env bash
# CI (.github/workflows/e2e.yml): the gen, decide and kjbox local stacks on a fresh GitHub runner (Linux or macOS),
# so scripts/e2e-local.sh finds them up and starts none itself. Expects the three repos checked out beside this one
# (../karaoke-gen, ../karaoke-decide, ../kjbox, the layout e2e-local.sh defaults to) and Python 3.13, Node and Java
# 21 on PATH.
#
#   scripts/ci/setup-stacks.sh install            # poetry venvs (gen, decide), kjbox venv, gen web deps if WITH_WEB=1,
#                                                 # emulators, a static ffmpeg in $EMULATOR_CACHE/bin if none is on PATH
#   scripts/ci/setup-stacks.sh up                 # emulators + gen (+ web if WITH_WEB=1) + decide; kjbox is left to
#                                                 # e2e-local.sh (it resets it fresh for Tonight runs)
#   scripts/ci/setup-stacks.sh logs               # tail every stack log (on failure)
#
# Emulators run natively, without Docker (GitHub's macOS runners have none): the Firestore emulator jar that
# firebase-tools pins on :8080 and fake-gcs-server on :4443, with the flags gen's start-emulators.sh gives its
# container (plus -backend memory: its default store, /storage, is the container's and unwritable here). gen's
# start-emulators.sh then sees both ports taken and starts nothing. Downloads are cached in
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
# LANE (the self-hosted runner's lanes; hosted runners are lane 0): this job's ports and state (scripts/e2e-lane.sh).
GEN_DIR="$GEN" DECIDE_DIR="$DECIDE"
# shellcheck source=../e2e-lane.sh
source "$ROOT/scripts/e2e-lane.sh"
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

# gen's fake workers still transcode with ffmpeg (audio download / stems). GitHub's macOS image has none and the
# Ubuntu one may not: static builds into $CACHE/bin, which the workflow puts on PATH.
FFMPEG_STATIC=b6.1.1
fetch_ffmpeg() {
  command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null && return 0
  local plat
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) plat=darwin-arm64 ;;
    Linux-x86_64) plat=linux-x64 ;;
    *) echo "no static ffmpeg for $(uname -s)-$(uname -m)" >&2; return 1 ;;
  esac
  mkdir -p "$CACHE/bin"
  local tool
  for tool in ffmpeg ffprobe; do
    [[ -x "$CACHE/bin/$tool" ]] && continue
    curl -fsSL "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_STATIC/$tool-$plat.gz" | gunzip >"$CACHE/bin/$tool"
    chmod +x "$CACHE/bin/$tool"
  done
  echo "ffmpeg: $CACHE/bin (add it to PATH)"
}

install() {
  # Hosted runners: pip into setup-python's Python. The self-hosted Mac has Homebrew's poetry (its Python 3.13 is
  # externally managed, so pip install is refused there).
  command -v poetry >/dev/null || python3 -m pip install --quiet poetry
  poetry config virtualenvs.in-project true
  # pipefail so a failed install fails the step (a `| tail` used to hide it until "uvicorn: command not found").
  (set -o pipefail; cd "$GEN" && poetry install --no-interaction --quiet 2>&1 | tail -5) &
  local gen_pid=$!
  (set -o pipefail; cd "$DECIDE" && poetry install --no-interaction --quiet 2>&1 | tail -5)
  wait "$gen_pid"
  (cd "$GEN" && poetry run uvicorn --version >/dev/null) || { echo "gen's venv has no working uvicorn" >&2; exit 1; }
  # kjbox's local-stack.sh runs "$PYTHON": the workflow sets PYTHON to this venv's python.
  (cd "$KJBOX/kj-controller" && python3 -m venv .venv && .venv/bin/pip install --quiet -r requirements.txt)
  if [[ "${WITH_WEB:-}" == 1 ]]; then (cd "$GEN/frontend" && npm ci --legacy-peer-deps --no-audit --no-fund --loglevel=error); fi
  fetch_emulators
  fetch_ffmpeg
}

emulators_up() { (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null && (exec 3<>/dev/tcp/127.0.0.1/4443) 2>/dev/null; }

up() {
  fetch_emulators
  # Shared by every lane on a machine: start them only once.
  if emulators_up; then echo "emulators already up (shared)"; else start_emulators; fi
  local web=()
  [[ "${WITH_WEB:-}" == 1 ]] && web=(--frontend)
  # shellcheck disable=SC2046 # one VAR=value per line, no spaces
  (cd "$GEN" && env DECIDE_GEN_PARTNER_SECRET="$PARTNER_SECRET" LOCAL_STACK_API_URL="http://127.0.0.1:$GEN_PORT" \
    $(lane_gen_env) scripts/local-stack.sh up ${web[@]+"${web[@]}"})
  # shellcheck disable=SC2046
  (cd "$DECIDE" && env $(lane_decide_env) scripts/local-stack.sh up)
}

start_emulators() {
  nohup java -jar "$CACHE/cloud-firestore-emulator-v$FIRESTORE_JAR_VERSION.jar" --host 127.0.0.1 --port 8080 \
    >"$LOGS/firestore.log" 2>&1 &
  nohup "$CACHE/fake-gcs-server" -scheme http -port 4443 -external-url http://127.0.0.1:4443 \
    -public-host 127.0.0.1:4443 -backend memory >"$LOGS/gcs.log" 2>&1 &
  wait_port 8080 "Firestore emulator" 90
  wait_port 4443 "GCS emulator" 30
}

logs() {
  local f
  for f in "$LOGS"/*.log "${GEN_STATE_DIR:-$GEN/.local-stack}"/*.log "${DECIDE_STATE_DIR:-$DECIDE/.local-stack}"/*.log \
    "${KJBOX_DATA_DIR:-$HOME/kjdata-localstack}"/*.log \
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
