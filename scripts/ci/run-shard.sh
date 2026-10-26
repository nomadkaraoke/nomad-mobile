#!/usr/bin/env bash
# CI (.github/workflows/e2e.yml): one Maestro shard on the runner's simulator / emulator, after
# scripts/ci/setup-stacks.sh up. Installs the dev client, then runs scripts/e2e-local.sh with the shard's flows,
# writing JUnit reports and Maestro's debug output (screenshots, command logs) to OUT_DIR.
#
#   scripts/ci/run-shard.sh ios|android APP_PATH FLOWS OUT_DIR
#     APP_PATH  NomadKaraoke.app (iOS) or app-debug.apk (Android); FLOWS  comma-separated flow names
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# LANE: this job's ports (scripts/e2e-lane.sh; e2e-local.sh reads the same), e.g. the default launcher URL's Metro.
GEN_DIR="$ROOT/../karaoke-gen" DECIDE_DIR="$ROOT/../karaoke-decide"
# shellcheck source=../e2e-lane.sh
source "$ROOT/scripts/e2e-lane.sh"
export LANE
platform="$1"; app="$2"; flows="$3"; out="$4"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
export CI=true E2E_WARM_BUNDLE=1 E2E_LAUNCH_TIMEOUT="${E2E_LAUNCH_TIMEOUT:-240000}"
export MAESTRO_TEST_ARGS="--format junit --output $out/junit-{run}.xml --debug-output $out/debug-{run} --flatten-debug-output"

if [[ "$platform" == ios ]]; then
  # The flows are tuned on iOS 26 (sheet / accessibility quirks, CLAUDE.md § Tonight gotchas): use an iOS 26 device when
  # the machine has the runtime (the spare MacBook Pro also has iOS 27), else the newest. IOS_RUNTIME overrides (e.g. 27-0).
  # One simulator per lane: "iPhone 17 Pro" on lane 0, "iPhone 17 Pro lane N" beside it.
  model="iPhone 17 Pro"
  name="${IOS_DEVICE:-$model$( (( LANE > 0 )) && echo " lane $LANE")}"
  runtimes="$(xcrun simctl list runtimes available | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+')"
  runtime="$(grep -E "iOS-${IOS_RUNTIME:-26-}" <<<"$runtimes" | tail -1 || true)"
  [[ -n "$runtime" ]] || runtime="$(tail -1 <<<"$runtimes")"
  udid="$(xcrun simctl list devices available -j | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const d = (JSON.parse(s).devices[process.argv[1]] ?? []).find((x) => x.name === process.argv[2]);
      console.log(d ? d.udid : "");
    });' "$runtime" "$name")"
  if [[ -z "$udid" ]]; then
    udid="$(xcrun simctl create "$name" "com.apple.CoreSimulator.SimDeviceType.${model// /-}" "$runtime")"
  fi
  echo "Simulator: $name on ${runtime##*.} ($udid)"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  # A fresh simulator's dev launcher has no last-opened server and its discovery never finds Metro on CI ("Searching
  # for development servers…"), so the flows' launch.yaml waited for a server row forever. Without a last server the
  # launcher opens DEV_CLIENT_DEFAULT_LAUNCHER_URL (expo-dev-launcher; simulators count as network-permitted): set it
  # in a copy of the app (the cached build stays as is).
  patched="$(mktemp -d)/$(basename "$app")"
  cp -R "$app" "$patched"
  /usr/libexec/PlistBuddy -c "Delete :DEV_CLIENT_DEFAULT_LAUNCHER_URL" "$patched/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :DEV_CLIENT_DEFAULT_LAUNCHER_URL string http://127.0.0.1:$METRO_PORT" "$patched/Info.plist"
  # The edit breaks the ad-hoc signature; re-sign the same way (the simulator reads entitlements, e.g. keychain access,
  # from the binary itself, so --sign - keeps them).
  codesign --force --sign - --timestamp=none "$patched" >/dev/null
  xcrun simctl install "$udid" "$patched"
  export IOS_DEVICE="$udid" E2E_POINT_DEV_CLIENT=1
else
  adb wait-for-device
  adb install -r -g "$app" >/dev/null
fi

status=0
"$ROOT/scripts/e2e-local.sh" --platform "$platform" --flows "$flows" || status=$?
# One retry of the failed flows (CI runners are slower than a Mac, so timing-sensitive flows can flake). The retry's
# reports are junit-retry-<n>.xml; scripts/ci/e2e-report.mjs counts a flow that passed on retry as flaky, not failed,
# and the shard passes when every failed flow passed on retry.
if [[ "$status" != 0 && "${E2E_RETRY:-1}" == 1 ]]; then
  failed="$(node -e '
    const fs = require("fs"), dir = process.argv[1];
    const names = new Set();
    for (const f of fs.readdirSync(dir).filter((x) => /^junit-\d+\.xml$/.test(x))) {
      const xml = fs.readFileSync(`${dir}/${f}`, "utf8");
      for (const m of xml.matchAll(/<testcase\b[^>]*?name="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g))
        if (/status="(ERROR|FAILURE)"/.test(m[0]) || /<(failure|error)\b/.test(m[3] || "")) names.add(m[1]);
    }
    console.log([...names].join(","));' "$out")"
  if [[ -n "$failed" ]]; then
    echo "Retrying the failed flows once: $failed"
    status=0
    MAESTRO_TEST_ARGS="--format junit --output $out/junit-retry-{run}.xml --debug-output $out/debug-retry-{run} --flatten-debug-output" \
      "$ROOT/scripts/e2e-local.sh" --platform "$platform" --flows "$failed" || status=$?
  fi
fi
# Simulator / emulator screenshots of where the last flow stopped, for a failed shard.
if [[ "$status" != 0 ]]; then
  if [[ "$platform" == ios ]]; then xcrun simctl io "$IOS_DEVICE" screenshot "$out/final.png" >/dev/null 2>&1 || true
  else adb exec-out screencap -p >"$out/final.png" 2>/dev/null || true; fi
fi
exit "$status"
