#!/usr/bin/env bash
# Maestro E2E against the gen local stack (real FastAPI backend, fake workers) on an iOS simulator or an
# Android emulator. Needs the dev client already installed (npx expo run:ios / run:android in apps/mobile).
#
#   scripts/e2e-local.sh --platform ios                  # every flow in maestro/flows
#   scripts/e2e-local.sh --platform android make-4       # flows whose file name contains "make-4"
#
# Env: GEN_DIR (gen checkout with scripts/local-stack.sh, at least v0.278.2; default ../karaoke-gen, the main
#      clone: pull it first, or point GEN_DIR at a gen worktree with the code you want to test),
#      IOS_DEVICE (simulator name or UDID; default "iPhone 17 Pro"), ANDROID_SERIAL (default emulator-5554).
#
# Both platforms use the same http://127.0.0.1 URLs: on Android, `adb reverse` maps the stack's API (8010)
# and web (3010) ports, so one stack serves both and its fake-checkout / handoff links open on either.
# Metro is the exception on Android: the dev launcher loads it from 10.0.2.2:8081 (maestro/common/launch.yaml).
# If adb reports "device offline" mid-run (it wipes the reverse rules), give the AVD more RAM and -gpu host
# (see CLAUDE.md § E2E).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GEN_DIR="${GEN_DIR:-$ROOT/../karaoke-gen}"
STACK="http://127.0.0.1:8010"
WEB="http://127.0.0.1:3010"
MAESTRO="${MAESTRO:-$(command -v maestro || echo "$HOME/.maestro/bin/maestro")}"
PLATFORM=""
FILTER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) FILTER="$1"; shift ;;
  esac
done
[[ "$PLATFORM" == ios || "$PLATFORM" == android ]] || { echo "usage: $0 --platform ios|android [flow-filter]" >&2; exit 2; }

# 1. The gen local stack (API :8010, web :3010). LOCAL_STACK_API_URL is what fake-checkout and handoff
#    links point at; 127.0.0.1 works on both platforms (adb reverse on Android).
if ! curl -sf -m 3 "$STACK/api/health" >/dev/null; then
  echo "Starting the gen local stack from $GEN_DIR"
  (cd "$GEN_DIR" && LOCAL_STACK_API_URL="$STACK" scripts/local-stack.sh up --frontend)
fi
curl -sf -m 5 "$STACK/api/test/status" >/dev/null || { echo "gen stack at $STACK has no /api/test (FAKE_WORKERS off?)" >&2; exit 1; }

# 2. Device prep.
if [[ "$PLATFORM" == android ]]; then
  SERIAL="${ANDROID_SERIAL:-emulator-5554}"
  adb -s "$SERIAL" wait-for-device
  adb -s "$SERIAL" reverse tcp:8010 tcp:8010 >/dev/null
  adb -s "$SERIAL" reverse tcp:3010 tcp:3010 >/dev/null
  # Skip Chrome's first-run screen inside the Custom Tab (the flows also tap past it if it shows).
  adb -s "$SERIAL" shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
  adb -s "$SERIAL" shell am set-debug-app --persistent com.android.chrome >/dev/null
  DEVICE="$SERIAL"
else
  DEVICE="${IOS_DEVICE:-iPhone 17 Pro}"
  xcrun simctl boot "$DEVICE" 2>/dev/null || true
  # Maestro wants the UDID.
  if [[ ! "$DEVICE" =~ ^[0-9A-F-]{36}$ ]]; then
    NAME="$DEVICE"
    DEVICE="$(xcrun simctl list devices booted | grep -F "$NAME (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)"
    [[ -n "$DEVICE" ]] || { echo "no booted iOS simulator named \"$NAME\" (set IOS_DEVICE to a name or UDID)" >&2; exit 1; }
  fi
fi

# 3. Metro with the local-stack env (EXPO_PUBLIC_* are inlined at bundle time, so a Metro started without them
#    must be restarted). Started here only if nothing is serving :8081; stopped again on exit.
METRO_PID=""
cleanup() { [[ -n "$METRO_PID" ]] && kill "$METRO_PID" 2>/dev/null || true; }
trap cleanup EXIT
if ! curl -sf -m 2 http://127.0.0.1:8081/status | grep -q running; then
  METRO_LOG=/tmp/nomad-mobile-metro.log
  echo "Starting Metro (logs: $METRO_LOG)"
  # --clear: the EXPO_PUBLIC_* values are baked into cached transforms, and new special route files
  # (e.g. +native-intent) need a fresh route context.
  (cd "$ROOT/apps/mobile" && EXPO_PUBLIC_GEN_API_URL="$STACK" EXPO_PUBLIC_GEN_WEB_URL="$WEB" \
    EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1 CI=1 exec npx expo start --dev-client --port 8081 --clear) >"$METRO_LOG" 2>&1 &
  METRO_PID=$!
  deadline=$((SECONDS + 120))
  until curl -sf -m 2 http://127.0.0.1:8081/status | grep -q running; do
    if (( SECONDS > deadline )) || ! kill -0 "$METRO_PID" 2>/dev/null; then
      echo "Metro didn't start (exited, or not up within 120s); last log lines:" >&2
      tail -n 30 "$METRO_LOG" >&2
      exit 1
    fi
    sleep 2
  done
else
  echo "Using the Metro already on :8081 (it must have EXPO_PUBLIC_GEN_API_URL=$STACK and EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1)"
fi

# 4. The flows. Run from the repo root: takeScreenshot paths (docs/screenshots/phase1/<platform>/…) are
#    relative to the working directory.
cd "$ROOT"
mkdir -p "docs/screenshots/phase1/$PLATFORM"
if [[ -n "$FILTER" ]]; then
  FLOWS=()
  while IFS= read -r f; do FLOWS+=("$f"); done < <(ls maestro/flows/*.yaml | grep -F "$FILTER")
  [[ ${#FLOWS[@]} -gt 0 ]] || { echo "no flow matches $FILTER" >&2; exit 2; }
else
  FLOWS=(maestro/flows)
fi
"$MAESTRO" --device "$DEVICE" test -e STACK="$STACK" -e PLATFORM="$PLATFORM" "${FLOWS[@]}"
