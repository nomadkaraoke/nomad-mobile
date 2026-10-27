#!/usr/bin/env bash
# Self-hosted runner (.github/workflows/e2e.yml): the lane's Android emulator, headless. Hosted Linux runners use
# reactivecircus/android-emulator-runner instead.
#
#   scripts/ci/android-emulator.sh start   # create AVD nomad_lane<LANE> if missing, boot it on the lane's port, wait
#   scripts/ci/android-emulator.sh stop    # `adb emu kill` that emulator (never `adb kill-server`: other lanes and
#                                          # sessions share the adb server)
#
# AVD: Pixel 8, system-images;android-35;google_apis;arm64-v8a (the image the flows were written on), 4 cores, booted
# with 3 GB RAM (EMULATOR_RAM_MB; three lanes share 36 GB), ANR / crash dialogs hidden. Each lane is isolated from the
# others: its own netsim instance (by default every emulator on a machine shares one netsimd, and when one lane's
# emulator stopped the others lost their network: "Netsim Wifi … is gone", then device-not-found) and a software GPU
# (EMULATOR_GPU; with -gpu host, headless emulators preempted each other's GL contexts).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GEN_DIR="$ROOT/../karaoke-gen" DECIDE_DIR="$ROOT/../karaoke-decide"
# shellcheck source=../e2e-lane.sh
source "$ROOT/scripts/e2e-lane.sh"
SDK="${ANDROID_HOME:?ANDROID_HOME}"
AVD="nomad_lane$LANE"
IMAGE="system-images;android-35;google_apis;arm64-v8a"
adb_() { "$SDK/platform-tools/adb" -s "$ANDROID_SERIAL" "$@"; }

start() {
  if ! "$SDK/emulator/emulator" -list-avds | grep -qx "$AVD"; then
    echo no | "$SDK/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d pixel_8 --force >/dev/null
    cfg="$HOME/.android/avd/$AVD.avd/config.ini"
    { echo "hw.ramSize=4096"; echo "hw.cpu.ncore=4"; echo "disk.dataPartition.size=6G"; echo "hw.keyboard=yes"; } >>"$cfg"
  fi
  # A leftover emulator on this port from a cancelled job: stop it first.
  adb_ emu kill >/dev/null 2>&1 || true
  sleep 2
  nohup "$SDK/emulator/emulator" -avd "$AVD" -port "$EMULATOR_PORT" -no-window -no-audio -no-boot-anim \
    -no-snapshot -wipe-data -memory "${EMULATOR_RAM_MB:-3072}" -gpu "${EMULATOR_GPU:-swiftshader_indirect}" \
    -netsim-args "--instance=$((LANE + 1))" >"/tmp/emulator-$AVD.log" 2>&1 &
  adb_ wait-for-device
  local deadline=$((SECONDS + 300))
  until [[ "$(adb_ shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do
    (( SECONDS < deadline )) || { echo "emulator $AVD didn't boot in 300 s" >&2; tail -30 "/tmp/emulator-$AVD.log" >&2; exit 1; }
    sleep 3
  done
  for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb_ shell settings put global "$k" 0; done
  # Three lanes' emulators at once are memory-tight: the Pixel Launcher could miss its ANR deadline right after boot
  # and its "isn't responding" dialog covered the app for a whole shard (19/20 flows failed at launch). Never show
  # ANR / crash dialogs, and let the launcher settle before the shard starts.
  adb_ shell settings put global hide_error_dialogs 1
  adb_ shell settings put secure anr_show_background 0
  local settle=$((SECONDS + 90))
  until adb_ shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus=.*[Ll]auncher"; do
    (( SECONDS < settle )) || { echo "warning: the launcher didn't take focus within 90 s" >&2; break; }
    adb_ shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
    sleep 3
  done
  adb_ shell input keyevent 82 >/dev/null 2>&1 || true
  echo "emulator $AVD up as $ANDROID_SERIAL"
}

stop() { adb_ emu kill >/dev/null 2>&1 || true; }

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
