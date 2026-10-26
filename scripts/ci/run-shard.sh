#!/usr/bin/env bash
# CI (.github/workflows/e2e.yml): one Maestro shard on the runner's simulator / emulator, after
# scripts/ci/setup-stacks.sh up. Installs the dev client, then runs scripts/e2e-local.sh with the shard's flows,
# writing JUnit reports and Maestro's debug output (screenshots, command logs) to OUT_DIR.
#
#   scripts/ci/run-shard.sh ios|android APP_PATH FLOWS OUT_DIR
#     APP_PATH  NomadKaraoke.app (iOS) or app-debug.apk (Android); FLOWS  comma-separated flow names
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
platform="$1"; app="$2"; flows="$3"; out="$4"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
export CI=true E2E_WARM_BUNDLE=1
export MAESTRO_TEST_ARGS="--format junit --output $out/junit-{run}.xml --debug-output $out/debug-{run} --flatten-debug-output"

if [[ "$platform" == ios ]]; then
  # The flows are tuned on iOS 26 (sheet / accessibility quirks, CLAUDE.md § Tonight gotchas): use an iOS 26 device when
  # the machine has the runtime (the spare MacBook Pro also has iOS 27), else the newest. IOS_RUNTIME overrides (e.g. 27-0).
  name="${IOS_DEVICE:-iPhone 17 Pro}"
  runtimes="$(xcrun simctl list runtimes available | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+')"
  runtime="$(grep -E "iOS-${IOS_RUNTIME:-26-}" <<<"$runtimes" | tail -1 || true)"
  [[ -n "$runtime" ]] || runtime="$(tail -1 <<<"$runtimes")"
  udid="$(xcrun simctl list devices available -j | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const d = (JSON.parse(s).devices[process.argv[1]] ?? []).find((x) => x.name === process.argv[2]);
      console.log(d ? d.udid : "");
    });' "$runtime" "$name")"
  if [[ -z "$udid" ]]; then
    udid="$(xcrun simctl create "$name" "com.apple.CoreSimulator.SimDeviceType.${name// /-}" "$runtime")"
  fi
  echo "Simulator: $name on ${runtime##*.} ($udid)"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$app"
  export IOS_DEVICE="$udid" E2E_POINT_DEV_CLIENT=1
else
  adb wait-for-device
  adb install -r -g "$app" >/dev/null
fi

status=0
"$ROOT/scripts/e2e-local.sh" --platform "$platform" --flows "$flows" || status=$?
# Simulator / emulator screenshots of where the last flow stopped, for a failed shard.
if [[ "$status" != 0 ]]; then
  if [[ "$platform" == ios ]]; then xcrun simctl io "$IOS_DEVICE" screenshot "$out/final.png" >/dev/null 2>&1 || true
  else adb exec-out screencap -p >"$out/final.png" 2>/dev/null || true; fi
fi
exit "$status"
