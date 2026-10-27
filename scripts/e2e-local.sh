#!/usr/bin/env bash
# Maestro E2E against the gen local stack (real FastAPI backend, fake workers), decide's local stack (the main
# API on :8030 with a fixture catalog and the test API, plus the search service on a fixture song index on :8020)
# and kjbox's local stack (the singer API on :8040 with the fixture night, event code 2121, and the test API)
# on an iOS simulator or an Android emulator. Needs the dev client already installed (npx expo run:ios /
# run:android in apps/mobile).
#
#   scripts/e2e-local.sh --platform ios                  # every flow in maestro/flows
#   scripts/e2e-local.sh --platform android make-4       # flows whose file name contains "make-4"
#   scripts/e2e-local.sh --platform ios --locale he --screen review-tour
#                                     # a screenshot-only flow (maestro/screens/<name>.yaml) with the app in that
#                                     # language (default en); shots go to docs/screenshots/phase2/review/<platform>/<locale>
#                                     # (discover-* screens: docs/screenshots/phase3a/<platform>/<locale>;
#                                     # tonight-* screens: docs/screenshots/phase5/<platform>/<locale>;
#                                     # voice-* / fit-* screens: docs/screenshots/phase3c/<platform>/<locale>;
#                                     # voice-session-* screens: docs/screenshots/phase3d/<platform>/<locale>;
#                                     # me-* screens: docs/screenshots/phase4/<platform>/<locale>)
#                                     # store-tour: $STORE_SHOTS, default docs/store/screenshots/<platform>/<locale>)
#   scripts/e2e-local.sh --platform ios voice-           # the vocal range flows (voice-1…3, Phase 3c) and voice-session-*
#   scripts/e2e-local.sh --platform ios --skip tonight   # every flow except those whose name contains "tonight"
#   scripts/e2e-local.sh --platform ios tonight          # the Tonight flows (tonight-1…11)
#   scripts/e2e-local.sh --platform ios voice-session    # the voice session flows (decide's fixture voice.db)
#   scripts/e2e-local.sh --platform ios --flows make-1-happy-path,review-1-approve   # exactly these flows (a CI shard)
#   scripts/e2e-local.sh --platform ios me-              # the Me flows (me-1…9, Phase 4a; decide >= v0.29)
#
# Env: GEN_DIR (gen checkout with scripts/local-stack.sh, at least v0.278.2 plus the fake match judge; default
#      ../karaoke-gen, the main clone: pull it first, or point GEN_DIR at a gen worktree with the code you want),
#      DECIDE_DIR (decide checkout with scripts/local-stack.sh, the main API + search stack; default
#      ../karaoke-decide-phase3-discover while that branch is unmerged and the worktree exists, else
#      ../karaoke-decide; the voice flows need decide with the vocal range fixtures and /api/test/voice/*, v0.25+),
#      DECIDE_GEN_PARTNER_SECRET (shared by both stacks so decide's
#      /resolve reaches gen; default local-stack-secret), KJBOX_DIR (kjbox checkout with
#      kj-controller/scripts/local-stack.sh; default ../kjbox; only used when the run has Tonight flows; reset fresh every such run unless KJBOX_KEEP=1), IOS_DEVICE (simulator name or UDID; default
#      "iPhone 17 Pro"), ANDROID_SERIAL (default emulator-5554), METRO_PORT (default 8081), DECIDE_PORT / SEARCH_PORT
#      (decide's main API and search service, default 8030 / 8020; passed to decide's local-stack.sh as
#      DECIDE_LOCAL_PORT / SEARCH_LOCAL_PORT when this script starts it). Another port set lets a second session run
#      its own Metro and decide stack beside the default one (on its own simulator / emulator).
#      MAESTRO_TEST_ARGS (extra `maestro test` options, e.g. "--format junit --output r-{run}.xml"; CI; {run} becomes
#      the Maestro run's number, since a suite is up to four runs: online, Hebrew, offline),
#      E2E_LAUNCH_TIMEOUT (ms, default 60000: launch.yaml's waits; CI uses 240000),
#      E2E_POINT_DEV_CLIENT=1 (iOS: point a freshly installed dev client at Metro even on :8081; CI),
#      E2E_NO_LOCK=1 (skip the local device lock, scripts/device-lock.sh; CI sets CI=true, which skips it too).
#
# Metro also bundles with EXPO_PUBLIC_FAKE_IAP=1 (credit packs "bought" through gen's /api/test/fake-iap/purchase) and
# EXPO_PUBLIC_PUSH=0 (no push entitlement; the app registers a fake Expo token so gen's and the box's fake push
# outboxes record what they would send; the notify-* flows read them, emptied first by this script).
#
# Connect flows (connect-*, Phase 3b) pick fixture files: when the run has any, scripts/make-import-fixtures.ts
# writes the Spotify export zip and maestro/scripts/push-fixtures.sh puts it and a screenshot on the device.
#
# Both platforms use the same http://127.0.0.1 URLs: on Android, `adb reverse` maps the gen API (8010), gen web
# (3010), decide search (8020), decide main API (8030) and kjbox (8040) ports, so one set of stacks serves both and every link opens on either.
# Metro is the exception on Android: the dev launcher loads it from 10.0.2.2:$METRO_PORT (maestro/common/launch.yaml).
# If adb reports "device offline" mid-run (it wipes the reverse rules), give the AVD more RAM and -gpu host
# (see CLAUDE.md § E2E).
#
# Metro bundles with EXPO_PUBLIC_FAKE_MIC=baritone-scale: the voice test hears a bundled synthetic singer instead of
# the mic (honoured only against a local gen host), so voice-1 and the voice tour measure a baritone.
#
# Flows tagged `force-offline` (search-4) need a bundle built with EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1, so they
# run after the others, on a Metro restarted with it (only when this script started Metro itself). Flows tagged
# `offline-warmup` (discover-6a: loads a signed-in user's picks so the phone keeps them) run right before the
# force-offline ones, after every flow that signs out or clears the app. Flows tagged `locale-he` (review-9) run
# with the app in Hebrew (RTL), set before and reset after them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GEN_DIR="${GEN_DIR:-$ROOT/../karaoke-gen}"
if [[ -z "${DECIDE_DIR:-}" ]]; then
  if [[ -x "$ROOT/../karaoke-decide-phase3-discover/scripts/local-stack.sh" ]]; then
    DECIDE_DIR="$ROOT/../karaoke-decide-phase3-discover"
  else
    DECIDE_DIR="$ROOT/../karaoke-decide"
  fi
fi
PARTNER_SECRET="${DECIDE_GEN_PARTNER_SECRET:-local-stack-secret}"
KJBOX_DIR="${KJBOX_DIR:-$ROOT/../kjbox}"
# LANE (default 0) picks the port block and state of this run's stacks and Metro (scripts/e2e-lane.sh), so several
# runs can share one machine; GEN_PORT / GEN_WEB_PORT / DECIDE_PORT / SEARCH_PORT / KJBOX_PORT / METRO_PORT override.
# shellcheck source=e2e-lane.sh
source "$ROOT/scripts/e2e-lane.sh"
STACK="http://127.0.0.1:$GEN_PORT"
WEB="http://127.0.0.1:$GEN_WEB_PORT"
SEARCH="http://127.0.0.1:$SEARCH_PORT"
DECIDE="http://127.0.0.1:$DECIDE_PORT"
KJBOX="http://127.0.0.1:$KJBOX_PORT"
CONTROL="http://127.0.0.1:$CONTROL_PORT"
# The app's kjbox base: the box serves the singer API under /sing (on sing.nomadkaraoke.com the tunnel maps / to it).
KJBOX_APP="$KJBOX/sing"
MAESTRO="${MAESTRO:-$(command -v maestro || echo "$HOME/.maestro/bin/maestro")}"
PLATFORM=""
FILTER=""
SKIP=""
LOCALE=""
SCREEN=""
FLOWS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --locale) LOCALE="$2"; shift 2 ;;
    --screen) SCREEN="$2"; shift 2 ;;
    --skip) SKIP="$2"; shift 2 ;;
    --flows) FLOWS="$2"; shift 2 ;;
    -h|--help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) FILTER="$1"; shift ;;
  esac
done
[[ "$PLATFORM" == ios || "$PLATFORM" == android ]] || { echo "usage: $0 --platform ios|android [flow-filter]" >&2; exit 2; }

# The suite's flow files: those whose name contains FILTER (all when empty), minus those whose name contains SKIP
# (--skip tonight: a full run without ../kjbox).
list_flows() {
  # Match FILTER and SKIP against the file name only: a checkout path containing the term mustn't select or drop
  # every flow.
  local f name
  for f in "$ROOT"/maestro/flows/*.yaml; do
    name="${f##*/}"
    # --flows: exactly the listed flow names (comma-separated, with or without .yaml).
    if [[ -n "$FLOWS" && ",${FLOWS//.yaml/}," != *",${name%.yaml},"* ]]; then continue; fi
    [[ -n "$FILTER" && "$name" != *"$FILTER"* ]] && continue
    [[ -n "$SKIP" && "$name" == *"$SKIP"* ]] && continue
    echo "$f"
  done
}

# kjbox (and the stack-control helper) only when this run has Tonight flows or other kjbox-backed flows: a flow tagged
# `tonight` or `kjbox` (Me's past-night claims, me-13/14, R46) among the filtered ones, or a tonight* / me-tour screen tour.
# Make / Search / Review / Discover runs don't need ../kjbox.
needs_kjbox() {
  # me-tour's 4c shots (me-32/33) read past nights from the box; the store tour visits Tonight.
  if [[ -n "$SCREEN" ]]; then [[ "$SCREEN" == tonight* || "$SCREEN" == me-tour || "$SCREEN" == store* ]]; return; fi
  local f
  while IFS= read -r f; do
    grep -qE '^\s*-\s*(tonight|kjbox)\s*$' "$f" && return 0
  done < <(list_flows)
  return 1
}
NEED_KJBOX=0
if needs_kjbox; then NEED_KJBOX=1; fi

# 0. Local device lock (scripts/device-lock.sh): parallel sessions on this Mac queue here instead of breaking each
#     other's runs. The device itself, the gen stack (its search knobs and step delay are GLOBAL fake-config, so two
#     suites on one stack break each other even on different devices) and, before Maestro 2.2, the fixed iOS driver
#     port. Taken before any stack starts (kjbox's reset would wipe another run's night). Released on exit (a holder that died is taken over). Not on CI (each job has its own stacks and device).
LOCKS=()
if [[ "${CI:-}" != true && "${E2E_NO_LOCK:-}" != 1 ]]; then
  # shellcheck source=device-lock.sh
  source "$ROOT/scripts/device-lock.sh"
  if [[ "$PLATFORM" == ios ]]; then LOCK_DEVICE="${IOS_DEVICE:-iPhone 17 Pro}"; else LOCK_DEVICE="${ANDROID_SERIAL:-emulator-5554}"; fi
  LOCKS=("$PLATFORM-$LOCK_DEVICE" "gen-stack-$GEN_PORT")
  if [[ "$PLATFORM" == ios ]]; then
    mv="$("$MAESTRO" --version 2>/dev/null | tail -1)"
    if [[ "$(printf '%s\n2.2.0\n' "$mv" | sort -V | head -1)" != 2.2.0 ]]; then LOCKS+=(maestro-ios-driver); fi
  fi
  for l in "${LOCKS[@]}"; do device_lock_acquire "$l" "e2e-local.sh --platform $PLATFORM ${FILTER:-}${FLOWS:+--flows $FLOWS}${SCREEN:+--screen $SCREEN}"; done
fi
release_locks() { local l; for l in ${LOCKS[@]+"${LOCKS[@]}"}; do device_lock_release "$l"; done; }
trap release_locks EXIT

# 1. The gen local stack (API :8010, web :3010). LOCAL_STACK_API_URL is what fake-checkout and handoff
#    links point at; 127.0.0.1 works on both platforms (adb reverse on Android). The partner secret lets
#    decide's /resolve call gen's catalog resolve (the fake judge's global verdict).
# Retried: on a loaded CI runner a stack's event loop can stall for a few seconds (a single 5 s try failed a whole
# shard, and a stalled "is it up?" probe made the script start a second decide over a running one).
retry_curl() { local i; for i in $(seq 1 12); do curl -sf -m 10 "$@" >/dev/null && return 0; sleep 5; done; return 1; }
is_up() { local i; for i in 1 2 3; do curl -sf -m 5 "$1" >/dev/null && return 0; sleep 2; done; return 1; }
if ! is_up "$STACK/api/health"; then
  echo "Starting the gen local stack from $GEN_DIR"
  # shellcheck disable=SC2046 # one VAR=value per line, no spaces
  (cd "$GEN_DIR" && env DECIDE_GEN_PARTNER_SECRET="$PARTNER_SECRET" LOCAL_STACK_API_URL="$STACK" $(lane_gen_env) \
    scripts/local-stack.sh up --frontend)
fi
retry_curl "$STACK/api/test/status" || { echo "gen stack at $STACK has no /api/test (FAKE_WORKERS off?)" >&2; exit 1; }
curl -sf -m 5 -o /dev/null "$WEB" || echo "warning: gen web isn't answering on $WEB (make-5 opens the web review there)" >&2

# 2. decide's local stack: the main API (:8030, fixture catalog, /api/test/*) on gen's Firestore emulator, so gen
#    sessions validate there, and the search service (:8020, fixture song index; its offline-list URL is on
#    127.0.0.1 too). `up` is idempotent.
echo "decide checkout: $DECIDE_DIR (DECIDE_DIR; used when its local stack has to be started)"
if ! is_up "$SEARCH/api/search/ready" || ! is_up "$DECIDE/api/ready"; then
  echo "Starting decide's local stack from $DECIDE_DIR"
  # shellcheck disable=SC2046
  (cd "$DECIDE_DIR" && env $(lane_decide_env) scripts/local-stack.sh up)
fi
retry_curl -X POST -H 'Content-Type: application/json' -d '{"email":"e2e-probe@example.com"}' \
  "$DECIDE/api/test/profile/reset" || { echo "decide at $DECIDE has no /api/test (DECIDE_TEST_API off?)" >&2; exit 1; }
# The vocal range flows and tours (voice-*, fit-*) need decide >= v0.25: the vr_* fixture catalog and
# /api/test/voice/seed. An empty body is a 422 when the route exists; an older decide answers 404.
needs_voice() {
  if [[ -n "$SCREEN" ]]; then [[ "$SCREEN" == voice* || "$SCREEN" == fit* || "$SCREEN" == store* ]]; return; fi
  # The selected flow files (FILTER minus --skip), like needs_kjbox: `--skip voice` needs no voice routes.
  list_flows | grep -qE '/(voice|fit)[^/]*\.yaml$'
}
if needs_voice; then
  code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' \
    "$DECIDE/api/test/voice/seed")"
  [[ "$code" == 422 ]] || {
    echo "decide at $DECIDE has no /api/test/voice/seed (HTTP $code; older than v0.25?). The voice flows need decide with the vocal" \
      "range fixtures: restart its local stack from an up-to-date checkout (DECIDE_DIR=$DECIDE_DIR)." >&2
    exit 1
  }
fi

# 2b. kjbox's local stack (:8040): the real singer API (v1) on the fixture night, event code 2121, with
#     /sing/api/test/*. It verifies app tokens against gen (:8010) and sends sung songs to decide (:8030), so it
#     starts after both. `up` is idempotent and keeps the night (and its night_id) across restarts.
kjbox_ready() { [[ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "$KJBOX/sing/api/v1/night?t=2121")" == 401 ]]; }
CONTROL_PID=""
if [[ "$NEED_KJBOX" == 1 ]]; then
  # A fresh box every run (`reset` wipes ~/kjdata-localstack and reseeds the fixture night): a make-it from an earlier
  # run (tonight-7, the tour) lands in the box's library, after which "machu picchu strokes" has a karaoke version.
  # KJBOX_KEEP=1 keeps the running stack as it is.
  if [[ "${KJBOX_KEEP:-}" == 1 ]] && kjbox_ready; then :
  else
    echo "Starting kjbox's local stack fresh from $KJBOX_DIR"
    # shellcheck disable=SC2046
    (cd "$KJBOX_DIR/kj-controller" && env $(lane_kjbox_env) scripts/local-stack.sh reset)
  fi
  curl -sf -m 5 -o /dev/null "$KJBOX/sing/api/test/state" || { echo "kjbox at $KJBOX has no /sing/api/test (KJBOX_TEST_API off?)" >&2; exit 1; }
else
  echo "No Tonight flows in this run: kjbox's local stack not needed"
fi
# tonight-9 stops and restarts the kjbox stack mid-flow ("box unreachable"), tonight-10 and me-6 decide's (offline);
# Maestro scripts can only make HTTP calls, so a loopback helper (scripts/stack-control.py, :8049) runs
# local-stack.sh down/up for them. Started for Tonight runs and for any selected flow that stops decide.
needs_control() {
  [[ -z "$SCREEN" ]] || return 1
  [[ "$NEED_KJBOX" == 1 ]] && return 0
  local f
  while IFS= read -r f; do
    grep -qE '^\s*ACTION:\s*decide\s*$' "$f" && return 0
  done < <(list_flows)
  return 1
}
if needs_control && ! curl -sf -m 2 "$CONTROL/health" >/dev/null; then
  # It restarts this lane's kjbox and decide stacks, so it gets their env.
  # shellcheck disable=SC2046
  env $(lane_kjbox_env) $(lane_decide_env) python3 "$ROOT/scripts/stack-control.py" --kjbox-dir "$KJBOX_DIR" \
    --decide-dir "$DECIDE_DIR" --port "$CONTROL_PORT" >"/tmp/nomad-mobile-stack-control-$CONTROL_PORT.log" 2>&1 &
  CONTROL_PID=$!
fi

# 2c. The fake push outboxes (gen's /api/test/push-outbox and the box's /sing/api/test/push-outbox capture the Expo
#     pushes instead of sending them; the app registers a fake token, EXPO_PUBLIC_PUSH=0). The notify flows assert
#     what was "sent", so they start from empty outboxes. Only when the run has notify flows: gen's outbox is shared
#     by every session on that stack (its rows are per email, the box's are not).
if list_flows | grep -q '/notify-'; then
  curl -sf -m 5 -o /dev/null -X DELETE "$STACK/api/test/push-outbox" ||
    echo "warning: couldn't clear gen's push outbox at $STACK (gen older than its Expo push sink?)" >&2
  if [[ "$NEED_KJBOX" == 1 ]]; then
    curl -sf -m 5 -o /dev/null -X DELETE "$KJBOX/sing/api/test/push-outbox" ||
      echo "warning: couldn't clear the box's push outbox at $KJBOX (kjbox older than v0.137?)" >&2
  fi
fi

# 3. Device prep.
if [[ "$PLATFORM" == android ]]; then
  SERIAL="${ANDROID_SERIAL:-emulator-5554}"
  adb -s "$SERIAL" wait-for-device
  # An AVD left in airplane mode (a manual offline check) can't reach Metro on 10.0.2.2 (ENETUNREACH on every launch).
  adb -s "$SERIAL" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true
  for port in "$GEN_PORT" "$GEN_WEB_PORT" "$SEARCH_PORT" "$DECIDE_PORT" "$KJBOX_PORT"; do adb -s "$SERIAL" reverse "tcp:$port" "tcp:$port" >/dev/null; done
  # Skip Chrome's first-run screen inside the Custom Tab (the flows also tap past it if it shows).
  adb -s "$SERIAL" shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
  adb -s "$SERIAL" shell am set-debug-app --persistent com.android.chrome >/dev/null
  # tonight-1 opens the printed QR's App Link (https://kjbox.cc/2121). The local debug build's assetlinks can't verify,
  # so make the app the user-selected handler for the night-link hosts (Android 12+), else a chooser shows.
  adb -s "$SERIAL" shell pm set-app-links-user-selection --user 0 --package com.nomadkaraoke.mobile true \
    kjbox.cc www.kjbox.cc sing.nomadkaraoke.com >/dev/null 2>&1 || true
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
#    must be restarted). Started here only if nothing is serving :$METRO_PORT; stopped again on exit. The voice test and
#    the voice session hear the bundled fake singer (FAKE_MIC=baritone-scale) instead of the microphone, and the
#    session's karaoke video is a fake player (FAKE_YT) instead of YouTube; both only against a local gen. 40 s:
#    decide only uses a song's pitch summary with >= 20 s voiced (the app's own pre-fill needs 10 s), and the fake
#    singer's looped song section (1.2 s quiet + 6 s of notes) gives about 25 s of voiced frames in 40 s. With less,
#    decide ignores the pitch and the type comes from the quiz answers alone (voice-session-1 then ends at Tenor).
METRO_PID=""
if [[ "$METRO_PORT" == 8081 ]]; then METRO_LOG=/tmp/nomad-mobile-metro.log; else METRO_LOG="/tmp/nomad-mobile-metro-$METRO_PORT.log"; fi
metro_up() { curl -sf -m 2 "http://127.0.0.1:$METRO_PORT/status" | grep -q running; }
kill_tree() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done
  kill "$1" 2>/dev/null || true
}
stop_metro() {
  [[ -n "$METRO_PID" ]] || return 0
  # npx → node: stop the whole tree (on CI Metro's node is a grandchild that outlived a children-only kill, so the
  # force-offline restart kept the online bundle). Never kill everything on the port: the Android emulator holds a
  # connection to Metro's. Only the process *listening* there, as a last resort.
  kill_tree "$METRO_PID"
  for _ in $(seq 1 15); do metro_up || break; sleep 1; done
  if metro_up; then
    lsof -ti "tcp:$METRO_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
    for _ in $(seq 1 10); do metro_up || break; sleep 1; done
  fi
  METRO_PID=""
}
cleanup() {
  stop_metro
  [[ -z "$CONTROL_PID" ]] || kill "$CONTROL_PID" 2>/dev/null || true
  release_locks
}
trap cleanup EXIT
# Args: extra VAR=value pairs for the bundle.
start_metro() {
  echo "Starting Metro (logs: $METRO_LOG) $*"
  # --clear: the EXPO_PUBLIC_* values are baked into cached transforms, and new special route files
  # (e.g. +native-intent) need a fresh route context.
  (cd "$ROOT/apps/mobile" && exec env EXPO_PUBLIC_GEN_API_URL="$STACK" EXPO_PUBLIC_GEN_WEB_URL="$WEB" \
    EXPO_PUBLIC_DECIDE_API_URL="$DECIDE" EXPO_PUBLIC_DECIDE_SEARCH_URL="$SEARCH" EXPO_PUBLIC_KJBOX_API_URL="$KJBOX_APP" \
    EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1 EXPO_PUBLIC_FAKE_MIC=baritone-scale EXPO_PUBLIC_FAKE_YT=1 \
    EXPO_PUBLIC_FAKE_YT_SECONDS=40 EXPO_PUBLIC_FAKE_IAP=1 EXPO_PUBLIC_PUSH=0 CI=1 "$@" \
    npx expo start --dev-client --port "$METRO_PORT" --clear) >"$METRO_LOG" 2>&1 &
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
  # E2E_WARM_BUNDLE=1 (CI): build the bundle once now, so the first launch doesn't time out while a cold runner
  # transforms every module. Warm the exact URL the dev client will load (the launchAsset of Metro's Expo manifest:
  # Hermes, bytecode, React Compiler, lazy routes). A generic ?platform=…&dev=true URL has other transform options and
  # shares nothing with it, and on a slow runner the dev launcher's short request timeout then gave up on Metro and
  # showed its server list (every hosted iOS flow failed at launch).
  if [[ "${E2E_WARM_BUNDLE:-}" == 1 ]]; then
    local bundle
    bundle="$(curl -sf -m 120 -H "expo-platform: $PLATFORM" -H 'Accept: application/expo+json,application/json' \
      "http://127.0.0.1:$METRO_PORT" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        try { console.log(JSON.parse(s).launchAsset.url); } catch { console.log(""); } });')"
    [[ -n "$bundle" ]] || bundle="http://127.0.0.1:$METRO_PORT/node_modules/expo-router/entry.bundle?platform=$PLATFORM&dev=true&minify=false"
    echo "Warming the $PLATFORM bundle: $bundle"
    curl -sf -m 900 -o /dev/null "$bundle" || echo "warning: bundle warm-up failed; the first flow may time out" >&2
  fi
}

# iOS on another Metro port: point the dev client at it once Metro is up. A fresh `expo run:ios` build opens the
# default :8081 (another session's Metro), and launch.yaml relaunches whatever server the dev client last used.
point_dev_client() {
  [[ "$PLATFORM" == ios && ( "$METRO_PORT" != 8081 || "${E2E_POINT_DEV_CLIENT:-}" == 1 ) ]] || return 0
  xcrun simctl terminate "$DEVICE" com.nomadkaraoke.mobile 2>/dev/null || true
  # A failure here would leave the dev client on whatever Metro it used last (another session's), so stop.
  if ! xcrun simctl openurl "$DEVICE" "exp+nomad-karaoke://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$METRO_PORT"; then
    echo "Could not point the dev client on $DEVICE at Metro :$METRO_PORT (simctl openurl failed); stopping." >&2
    exit 1
  fi
  sleep 8
}

# 5. The flows. Run from the repo root: takeScreenshot paths (${SHOTS}/…) are relative to the working directory.
cd "$ROOT"
SHOTS="docs/screenshots/phase1b/$PLATFORM"
# The native review flows (review-*, Phase 2) and Discover (discover-*, Phase 3a) keep their shots apart.
REVIEW_SHOTS="docs/screenshots/phase2/$PLATFORM"
DISCOVER_SHOTS="docs/screenshots/phase3a/$PLATFORM"
TONIGHT_SHOTS="docs/screenshots/phase5/$PLATFORM"
SHOTS3B="docs/screenshots/phase3b/$PLATFORM"
# Vocal range (voice-*, Phase 3c).
VOICE_SHOTS="docs/screenshots/phase3c/$PLATFORM"
# Voice session (voice-session-*, Phase 3d).
VOICE_SESSION_SHOTS="docs/screenshots/phase3d/$PLATFORM"
# Me (me-*, Phase 4a).
ME_SHOTS="docs/screenshots/phase4/$PLATFORM"
# Purchases, account deletion and notifications (purchase-*, account-*, notify-*, Phase 6).
PHASE6_SHOTS="docs/screenshots/phase6/$PLATFORM"
mkdir -p "$SHOTS" "$REVIEW_SHOTS" "$DISCOVER_SHOTS" "$TONIGHT_SHOTS" "$SHOTS3B" "$VOICE_SHOTS" "$VOICE_SESSION_SHOTS" "$ME_SHOTS" "$PHASE6_SHOTS"
ALL=()
while IFS= read -r f; do ALL+=("maestro/flows/${f##*/}"); done < <(list_flows)
[[ ${#ALL[@]} -gt 0 ]] || { echo "no flow matches $FILTER" >&2; exit 2; }
# The connect flows pick a screenshot and a Spotify export zip from the device: write the zip, push both.
if printf '%s\n' "${ALL[@]}" | grep -q '/connect-'; then
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/make-import-fixtures.ts
  if [[ "$PLATFORM" == android ]]; then ANDROID_SERIAL="$DEVICE" maestro/scripts/push-fixtures.sh android
  else IOS_DEVICE="$DEVICE" maestro/scripts/push-fixtures.sh ios; fi
fi
ONLINE=()
WARMUP=()
OFFLINE=()
HEBREW=()
for f in "${ALL[@]}"; do
  if grep -qE '^\s*-\s*force-offline\s*$' "$f"; then OFFLINE+=("$f")
  elif grep -qE '^\s*-\s*offline-warmup\s*$' "$f"; then WARMUP+=("$f")
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

# MAESTRO_TEST_ARGS: extra `maestro test` options (CI: JUnit report, debug output). Word-split on purpose.
read -r -a EXTRA_TEST_ARGS <<<"${MAESTRO_TEST_ARGS:-}"
RUN_SEQ=0
run_flows() {
  # Each call is one Maestro run; give its report its own name so a later group doesn't overwrite it.
  RUN_SEQ=$((RUN_SEQ + 1))
  local extra=() a
  for a in ${EXTRA_TEST_ARGS[@]+"${EXTRA_TEST_ARGS[@]}"}; do extra+=("${a//\{run\}/$RUN_SEQ}"); done
  "$MAESTRO" --device "$DEVICE" test ${extra[@]+"${extra[@]}"} -e STACK="$STACK" -e DECIDE_STACK="$DECIDE" -e KJBOX_STACK="$KJBOX" -e CONTROL="$CONTROL" \
    -e KJBOX_DIR="$KJBOX_DIR" -e PLATFORM="$PLATFORM" -e SHOTS="$SHOTS" -e REVIEW_SHOTS="$REVIEW_SHOTS" \
    -e DISCOVER_SHOTS="$DISCOVER_SHOTS" -e TONIGHT_SHOTS="$TONIGHT_SHOTS" -e SHOTS3B="$SHOTS3B" -e METRO_PORT="$METRO_PORT" \
    -e VOICE_SHOTS="$VOICE_SHOTS" -e FIT_SHOTS="$VOICE_SHOTS" -e VOICE_SESSION_SHOTS="$VOICE_SESSION_SHOTS" -e ME_SHOTS="$ME_SHOTS" \
    -e LAUNCH_TIMEOUT="${E2E_LAUNCH_TIMEOUT:-60000}" -e PHASE6_SHOTS="$PHASE6_SHOTS" -e STORE_SHOTS="${STORE_SHOTS:-}" "$@"
}
status=0

# --screen: one screenshot-only flow, with the app in LOCALE (it sets its own app language, so it never mixes with
# the suite's groups). Uses the running Metro, or starts one.
if [[ -n "$SCREEN" ]]; then
  [[ -f "maestro/screens/$SCREEN.yaml" ]] || { echo "no maestro/screens/$SCREEN.yaml" >&2; exit 2; }
  lang="${LOCALE:-en}"
  # store-tour: the store listing's shots, STORE_SHOTS from the caller (scripts/store-screenshots.sh) or
  # docs/store/screenshots/<platform>/<locale>.
  STORE_SHOTS="${STORE_SHOTS:-docs/store/screenshots/$PLATFORM/$lang}"
  if [[ "$SCREEN" == store* ]]; then TOUR_SHOTS="$STORE_SHOTS"
  elif [[ "$SCREEN" == discover* ]]; then TOUR_SHOTS="$DISCOVER_SHOTS/$lang"
  elif [[ "$SCREEN" == tonight* ]]; then TOUR_SHOTS="$TONIGHT_SHOTS/$lang"
  elif [[ "$SCREEN" == voice-session* ]]; then TOUR_SHOTS="$VOICE_SESSION_SHOTS/$lang"
  elif [[ "$SCREEN" == me-* ]]; then TOUR_SHOTS="$ME_SHOTS/$lang"
  elif [[ "$SCREEN" == voice* || "$SCREEN" == fit* ]]; then TOUR_SHOTS="$VOICE_SHOTS/$lang"
  else TOUR_SHOTS="docs/screenshots/phase2/review/$PLATFORM/$lang"; fi
  mkdir -p "$TOUR_SHOTS"
  metro_up || start_metro
  point_dev_client
  set_app_locale "$lang"
  # SHOT: the name prefix long-title.yaml gives its shots (in ${SHOTS}).
  # The voice and fit tours write to ${VOICE_SHOTS} / ${FIT_SHOTS} (run_flows passes both from VOICE_SHOTS): the
  # locale's folder for a tour, the platform's folder for the flows.
  if [[ "$SCREEN" == voice* || "$SCREEN" == fit* ]]; then VOICE_SHOTS="$TOUR_SHOTS"; fi
  run_flows -e LOCALE="$lang" -e TOUR_SHOTS="$TOUR_SHOTS" -e SHOT="ux-$lang" "maestro/screens/$SCREEN.yaml" || status=$?
  set_app_locale ""
  exit "$status"
fi
# The warm-up flows go last before the force-offline ones (the Hebrew group clears the app on Android and signs
# out on iOS, which drops the picks the phone kept).
if metro_up; then
  echo "Using the Metro already on :$METRO_PORT (it must have EXPO_PUBLIC_GEN_API_URL=$STACK, EXPO_PUBLIC_DECIDE_API_URL=$DECIDE," \
    "EXPO_PUBLIC_DECIDE_SEARCH_URL=$SEARCH, EXPO_PUBLIC_KJBOX_API_URL=$KJBOX_APP, EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1, EXPO_PUBLIC_FAKE_MIC=baritone-scale," \
    "EXPO_PUBLIC_FAKE_IAP=1 and EXPO_PUBLIC_PUSH=0; the force-offline flows also need" \
    "EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1)"
  point_dev_client
  if [[ ${#ONLINE[@]} -gt 0 ]]; then run_flows "${ONLINE[@]}" || status=$?; fi
  run_hebrew || status=$?
  if [[ $(( ${#WARMUP[@]} + ${#OFFLINE[@]} )) -gt 0 ]]; then
    run_flows ${WARMUP[@]+"${WARMUP[@]}"} ${OFFLINE[@]+"${OFFLINE[@]}"} || status=$?
  fi
else
  if [[ $(( ${#ONLINE[@]} + ${#HEBREW[@]} + ${#WARMUP[@]} )) -gt 0 ]]; then
    start_metro
    point_dev_client
    if [[ ${#ONLINE[@]} -gt 0 ]]; then run_flows "${ONLINE[@]}" || status=$?; fi
    run_hebrew || status=$?
    if [[ ${#WARMUP[@]} -gt 0 ]]; then run_flows "${WARMUP[@]}" || status=$?; fi
  fi
  if [[ ${#OFFLINE[@]} -gt 0 ]]; then
    stop_metro
    start_metro EXPO_PUBLIC_SEARCH_FORCE_OFFLINE=1
    point_dev_client
    run_flows "${OFFLINE[@]}" || status=$?
  fi
fi
exit "$status"
