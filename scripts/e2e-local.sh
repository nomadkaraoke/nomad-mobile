#!/usr/bin/env bash
# Maestro E2E against the gen local stack (real FastAPI backend, fake workers) and decide's search local stack
# (the search service on a fixture song index) on an iOS simulator or an Android emulator. Needs the dev client
# already installed (npx expo run:ios / run:android in apps/mobile).
#
#   scripts/e2e-local.sh --platform ios                  # every flow in maestro/flows
#   scripts/e2e-local.sh --platform android make-4       # flows whose file name contains "make-4"
#   scripts/e2e-local.sh --platform ios --locale he --screen review-tour
#                                     # a screenshot-only flow (maestro/screens/<name>.yaml) with the app in that
#                                     # language (default en); shots go to docs/screenshots/phase2/review/<platform>/<locale>
#
# Env: GEN_DIR (gen checkout with scripts/local-stack.sh, at least v0.278.2 plus the fake match judge; default
#      ../karaoke-gen, the main clone: pull it first, or point GEN_DIR at a gen worktree with the code you want),
#      DECIDE_DIR (decide checkout with scripts/search-local-stack.sh; default ../karaoke-decide-search-parity
#      when it exists, else ../karaoke-decide), DECIDE_GEN_PARTNER_SECRET (shared by both stacks so decide's
#      /resolve reaches gen; default local-stack-secret), IOS_DEVICE (simulator name or UDID; default
#      "iPhone 17 Pro"), ANDROID_SERIAL (default emulator-5554).
#
# Both platforms use the same http://127.0.0.1 URLs: on Android, `adb reverse` maps the gen API (8010), gen web
# (3010) and decide search (8020) ports, so one set of stacks serves both and every link opens on either.
# Metro is the exception on Android: the dev launcher loads it from 10.0.2.2:8081 (maestro/common/launch.yaml).
# If adb reports "device offline" mid-run (it wipes the reverse rules), give the AVD more RAM and -gpu host
# (see CLAUDE.md § E2E).
#
# Flows tagged `force-offline` (search-4) need a bundle built with EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1, so they
# run after the others, on a Metro restarted with it (only when this script started Metro itself). Flows tagged
# `locale-he` (review-9) run with the app in Hebrew (RTL), set before and reset after them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GEN_DIR="${GEN_DIR:-$ROOT/../karaoke-gen}"
if [[ -z "${DECIDE_DIR:-}" ]]; then
  if [[ -x "$ROOT/../karaoke-decide-search-parity/scripts/search-local-stack.sh" ]]; then
    DECIDE_DIR="$ROOT/../karaoke-decide-search-parity"
  else
    DECIDE_DIR="$ROOT/../karaoke-decide"
  fi
fi
PARTNER_SECRET="${DECIDE_GEN_PARTNER_SECRET:-local-stack-secret}"
STACK="http://127.0.0.1:8010"
WEB="http://127.0.0.1:3010"
SEARCH="http://127.0.0.1:8020"
MAESTRO="${MAESTRO:-$(command -v maestro || echo "$HOME/.maestro/bin/maestro")}"
PLATFORM=""
FILTER=""
LOCALE=""
SCREEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --locale) LOCALE="$2"; shift 2 ;;
    --screen) SCREEN="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) FILTER="$1"; shift ;;
  esac
done
[[ "$PLATFORM" == ios || "$PLATFORM" == android ]] || { echo "usage: $0 --platform ios|android [flow-filter]" >&2; exit 2; }

# 1. The gen local stack (API :8010, web :3010). LOCAL_STACK_API_URL is what fake-checkout and handoff
#    links point at; 127.0.0.1 works on both platforms (adb reverse on Android). The partner secret lets
#    decide's /resolve call gen's catalog resolve (the fake judge's global verdict).
if ! curl -sf -m 3 "$STACK/api/health" >/dev/null; then
  echo "Starting the gen local stack from $GEN_DIR"
  (cd "$GEN_DIR" && DECIDE_GEN_PARTNER_SECRET="$PARTNER_SECRET" LOCAL_STACK_API_URL="$STACK" scripts/local-stack.sh up --frontend)
fi
curl -sf -m 5 "$STACK/api/test/status" >/dev/null || { echo "gen stack at $STACK has no /api/test (FAKE_WORKERS off?)" >&2; exit 1; }
curl -sf -m 5 -o /dev/null "$WEB" || echo "warning: gen web isn't answering on $WEB (make-5 opens the web review there)" >&2

# 2. decide's search local stack (:8020, fixture song index). Its offline-list URL is on 127.0.0.1 too.
if ! curl -sf -m 3 "$SEARCH/api/search/ready" >/dev/null; then
  echo "Starting decide's search local stack from $DECIDE_DIR"
  (cd "$DECIDE_DIR" && DECIDE_GEN_PARTNER_SECRET="$PARTNER_SECRET" GEN_API_URL="$STACK" scripts/search-local-stack.sh up)
fi

# 3. Device prep.
if [[ "$PLATFORM" == android ]]; then
  SERIAL="${ANDROID_SERIAL:-emulator-5554}"
  adb -s "$SERIAL" wait-for-device
  for port in 8010 3010 8020; do adb -s "$SERIAL" reverse "tcp:$port" "tcp:$port" >/dev/null; done
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
  # The dev menu's floating gear sits over the header's right buttons (the review's ⋯ menu) and takes their taps.
  if APP_DATA="$(xcrun simctl get_app_container "$DEVICE" com.nomadkaraoke.mobile data 2>/dev/null)"; then
    xcrun simctl spawn "$DEVICE" defaults write "$APP_DATA/Library/Preferences/com.nomadkaraoke.mobile" \
      EXDevMenuShowFloatingActionButton -bool false
  fi
fi

# 4. Metro with the local-stack env (EXPO_PUBLIC_* are inlined at bundle time, so a Metro started without them
#    must be restarted). Started here only if nothing is serving :8081; stopped again on exit.
METRO_PID=""
METRO_LOG=/tmp/nomad-mobile-metro.log
metro_up() { curl -sf -m 2 http://127.0.0.1:8081/status | grep -q running; }
stop_metro() {
  [[ -n "$METRO_PID" ]] || return 0
  # npx → node: stop the children too. Never kill by port: the Android emulator holds a connection to 8081.
  pkill -P "$METRO_PID" 2>/dev/null || true
  kill "$METRO_PID" 2>/dev/null || true
  for _ in $(seq 1 15); do metro_up || break; sleep 1; done
  METRO_PID=""
}
trap stop_metro EXIT
# Args: extra VAR=value pairs for the bundle.
start_metro() {
  echo "Starting Metro (logs: $METRO_LOG) $*"
  # --clear: the EXPO_PUBLIC_* values are baked into cached transforms, and new special route files
  # (e.g. +native-intent) need a fresh route context.
  (cd "$ROOT/apps/mobile" && exec env EXPO_PUBLIC_GEN_API_URL="$STACK" EXPO_PUBLIC_GEN_WEB_URL="$WEB" \
    EXPO_PUBLIC_DECIDE_API_URL="$SEARCH" EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1 CI=1 "$@" \
    npx expo start --dev-client --port 8081 --clear) >"$METRO_LOG" 2>&1 &
  METRO_PID=$!
  local deadline=$((SECONDS + 120))
  until metro_up; do
    if (( SECONDS > deadline )) || ! kill -0 "$METRO_PID" 2>/dev/null; then
      echo "Metro didn't start (exited, or not up within 120s); last log lines:" >&2
      tail -n 30 "$METRO_LOG" >&2
      exit 1
    fi
    sleep 2
  done
}

# 5. The flows. Run from the repo root: takeScreenshot paths (${SHOTS}/…) are relative to the working directory.
cd "$ROOT"
SHOTS="docs/screenshots/phase1b/$PLATFORM"
# The native review flows (review-*, Phase 2) keep their shots apart.
REVIEW_SHOTS="docs/screenshots/phase2/$PLATFORM"
mkdir -p "$SHOTS" "$REVIEW_SHOTS"
ALL=()
while IFS= read -r f; do ALL+=("$f"); done < <(ls maestro/flows/*.yaml | { if [[ -n "$FILTER" ]]; then grep -F "$FILTER"; else cat; fi; } || true)
[[ ${#ALL[@]} -gt 0 ]] || { echo "no flow matches $FILTER" >&2; exit 2; }
ONLINE=()
OFFLINE=()
HEBREW=()
for f in "${ALL[@]}"; do
  if grep -qE '^\s*-\s*force-offline\s*$' "$f"; then OFFLINE+=("$f")
  elif grep -qE '^\s*-\s*locale-he\s*$' "$f"; then HEBREW+=("$f")
  else ONLINE+=("$f"); fi
done

# Flows tagged `locale-he` (review-9) run with the app's language set to Hebrew, then it goes back to the
# device language. iOS: the app's own AppleLanguages, plus React Native's stored RTL flags so the very first
# launch is already mirrored (the app itself only flips them for the next launch). Android: the per-app
# locale (API 33+), after clearing the app's data here (clearing it wipes the per-app locale too); RN's RTL
# flag is set by the first launch, so the flow relaunches once to apply it.
set_app_locale() {
  local lang="$1"
  if [[ "$PLATFORM" == android ]]; then
    # Clearing the app's data also clears its per-app locale, so the flow can't clearState itself: clear here
    # (signed out, as launch.yaml would), then set the language.
    if [[ -n "$lang" ]]; then adb -s "$DEVICE" shell pm clear com.nomadkaraoke.mobile >/dev/null
    else adb -s "$DEVICE" shell am force-stop com.nomadkaraoke.mobile; fi
    adb -s "$DEVICE" shell cmd locale set-app-locales com.nomadkaraoke.mobile --locales "$lang"
    return
  fi
  local data prefs rtl=false
  data="$(xcrun simctl get_app_container "$DEVICE" com.nomadkaraoke.mobile data)" || return 1
  prefs="$data/Library/Preferences/com.nomadkaraoke.mobile"
  # Terminating with an in-app browser still open crashes SafariViewService (macOS crash dialogs). Nothing is
  # tapped here: every flow that opens one closes it itself (onFlowComplete / maestro/common/close-browser-if-open.yaml
  # before stopApp), so by the time this runs between groups the browser is already gone.
  xcrun simctl terminate "$DEVICE" com.nomadkaraoke.mobile 2>/dev/null || true
  if [[ -n "$lang" ]]; then
    xcrun simctl spawn "$DEVICE" defaults write "$prefs" AppleLanguages -array "$lang"
    [[ "$lang" == he || "$lang" == ar ]] && rtl=true
  else
    xcrun simctl spawn "$DEVICE" defaults delete "$prefs" AppleLanguages 2>/dev/null || true
  fi
  xcrun simctl spawn "$DEVICE" defaults write "$prefs" RCTI18nUtil_allowRTL -bool "$rtl"
  xcrun simctl spawn "$DEVICE" defaults write "$prefs" RCTI18nUtil_forceRTL -bool "$rtl"
  # Leave the app running: Maestro's first view-hierarchy query (launch.yaml's browser check) 500s
  # (kAXErrorInvalidUIElement) when the app was just terminated.
  xcrun simctl launch "$DEVICE" com.nomadkaraoke.mobile >/dev/null 2>&1 || true
  sleep 6
}
run_hebrew() {
  [[ ${#HEBREW[@]} -gt 0 ]] || return 0
  set_app_locale he
  local s=0
  run_flows "${HEBREW[@]}" || s=$?
  set_app_locale ""
  return "$s"
}

run_flows() { "$MAESTRO" --device "$DEVICE" test -e STACK="$STACK" -e PLATFORM="$PLATFORM" -e SHOTS="$SHOTS" -e REVIEW_SHOTS="$REVIEW_SHOTS" "$@"; }
status=0

# --screen: one screenshot-only flow, with the app in LOCALE (it sets its own app language, so it never mixes with
# the suite's groups). Uses the running Metro, or starts one.
if [[ -n "$SCREEN" ]]; then
  [[ -f "maestro/screens/$SCREEN.yaml" ]] || { echo "no maestro/screens/$SCREEN.yaml" >&2; exit 2; }
  lang="${LOCALE:-en}"
  TOUR_SHOTS="docs/screenshots/phase2/review/$PLATFORM/$lang"
  mkdir -p "$TOUR_SHOTS"
  metro_up || start_metro
  set_app_locale "$lang"
  run_flows -e LOCALE="$lang" -e TOUR_SHOTS="$TOUR_SHOTS" "maestro/screens/$SCREEN.yaml" || status=$?
  set_app_locale ""
  exit "$status"
fi
if metro_up; then
  echo "Using the Metro already on :8081 (it must have EXPO_PUBLIC_GEN_API_URL=$STACK, EXPO_PUBLIC_DECIDE_API_URL=$SEARCH" \
    "and EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1; the force-offline flows also need EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1)"
  if [[ $(( ${#ONLINE[@]} + ${#OFFLINE[@]} )) -gt 0 ]]; then
    run_flows ${ONLINE[@]+"${ONLINE[@]}"} ${OFFLINE[@]+"${OFFLINE[@]}"} || status=$?
  fi
  run_hebrew || status=$?
else
  if [[ $(( ${#ONLINE[@]} + ${#HEBREW[@]} )) -gt 0 ]]; then
    start_metro
    if [[ ${#ONLINE[@]} -gt 0 ]]; then run_flows "${ONLINE[@]}" || status=$?; fi
    run_hebrew || status=$?
  fi
  if [[ ${#OFFLINE[@]} -gt 0 ]]; then
    stop_metro
    start_metro EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1
    run_flows "${OFFLINE[@]}" || status=$?
  fi
fi
exit "$status"
