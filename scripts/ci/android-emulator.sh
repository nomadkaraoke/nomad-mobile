#!/usr/bin/env bash
# Self-hosted runner (.github/workflows/e2e.yml): the lane's Android emulator, headless. Hosted Linux runners use
# reactivecircus/android-emulator-runner instead.
#
#   scripts/ci/android-emulator.sh start   # create AVD nomad_lane<LANE> if missing, boot it on the lane's port, wait
#   scripts/ci/android-emulator.sh stop    # `adb emu kill` that emulator, else kill its qemu process (never
#                                          # `adb kill-server`: other lanes and sessions share the adb server)
#   scripts/ci/android-emulator.sh alive   # exit 0 when the lane's emulator process is running
#
# start waits for memory first (scripts/ci/mem-gate.sh: a boot while another lane's xcodebuild ran froze QEMU), bounds
# every wait (an unbounded `adb wait-for-device` hung two shards for 73 min) and retries a boot that doesn't finish once.
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

# The lane's qemu process (adb can't stop an emulator whose transport is offline).
qemu_pid() { pgrep -f "qemu-system.*-avd $AVD( |$)" 2>/dev/null | head -1 || true; }
# The lane's own netsimd (-netsim-args --instance=LANE+1). After an emulator crash (SIGSEGV mid-shard, 2026-10-31) both
# reboots on that lane froze at once ("hanging thread 'QEMU2 CPU0 thread'"), the same symptom as the frozen boots of
# 2026-10-30: something the dead emulator left behind wedges the next boot. stop clears the lane's netsimd and the
# AVD's lock files; a failed boot prints what was still around (diagnose).
netsim_pids() { pgrep -f "netsim.*instance[= ]$((LANE + 1))( |$)" 2>/dev/null || true; }
diagnose() {
  echo "--- emulator $AVD diagnostics" >&2
  pgrep -fl "netsim|qemu-system" 2>/dev/null | cut -c1-220 >&2 || true
  ls -la "$HOME/.android/avd/$AVD.avd/"*.lock 2>/dev/null >&2 || echo "(no AVD lock files)" >&2
  vm_stat 2>/dev/null | head -6 >&2 || true
}
# AVD config keys, set (not appended: the older script appended a second hw.ramSize to the avdmanager default).
set_cfg() {
  local cfg="$HOME/.android/avd/$AVD.avd/config.ini" k="$1" v="$2"
  if grep -q "^$k=" "$cfg"; then sed -i '' -e "/^$k=/d" "$cfg" 2>/dev/null || sed -i -e "/^$k=/d" "$cfg"; fi
  echo "$k=$v" >>"$cfg"
}

boot() { # -> 0 when booted within BOOT_S
  local log="/tmp/emulator-$AVD.log"
  nohup "$SDK/emulator/emulator" -avd "$AVD" -port "$EMULATOR_PORT" -no-window -no-audio -no-boot-anim \
    -no-snapshot -wipe-data -memory "${EMULATOR_RAM_MB:-3072}" -gpu "${EMULATOR_GPU:-swiftshader_indirect}" \
    -netsim-args "--instance=$((LANE + 1))" >"$log" 2>&1 &
  # The launcher's own pid: qemu starts a moment after it, so "no qemu yet" isn't "exited".
  local launcher=$! deadline=$((SECONDS + ${BOOT_S:-300}))
  until [[ "$(adb_ get-state 2>/dev/null)" == device ]]; do
    if (( SECONDS >= deadline )) || { ! kill -0 "$launcher" 2>/dev/null && [[ -z "$(qemu_pid)" ]]; }; then
      echo "emulator $AVD: no adb device within ${BOOT_S:-300} s (or it exited)" >&2; tail -15 "$log" >&2; return 1
    fi
    sleep 3
  done
  until [[ "$(adb_ shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do
    (( SECONDS < deadline )) || { echo "emulator $AVD didn't finish booting within ${BOOT_S:-300} s" >&2; tail -15 "$log" >&2; return 1; }
    sleep 3
  done
}

start() {
  if ! "$SDK/emulator/emulator" -list-avds | grep -qx "$AVD"; then
    echo no | "$SDK/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d pixel_8 --force >/dev/null
  fi
  set_cfg hw.ramSize "${EMULATOR_RAM_MB:-3072}"; set_cfg hw.cpu.ncore 4; set_cfg disk.dataPartition.size 6G
  set_cfg hw.keyboard yes
  # A leftover emulator on this port from a cancelled job: stop it first.
  stop
  "$ROOT/scripts/ci/mem-gate.sh"
  local try
  for try in 1 2; do
    boot && break
    echo "emulator $AVD: boot attempt $try failed; killing it" >&2
    diagnose
    stop
    (( try == 2 )) && exit 1
    "$ROOT/scripts/ci/mem-gate.sh"
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

stop() {
  adb_ emu kill >/dev/null 2>&1 || true
  local pid i
  for i in $(seq 1 10); do pid="$(qemu_pid)"; [[ -n "$pid" ]] || break; sleep 1; done
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true; sleep 3
    pid="$(qemu_pid)"; [[ -z "$pid" ]] || kill -9 "$pid" 2>/dev/null || true
  fi
  # This lane's netsimd and the AVD's locks (see netsim_pids): never another lane's.
  for pid in $(netsim_pids); do kill "$pid" 2>/dev/null || true; done
  sleep 1
  for pid in $(netsim_pids); do kill -9 "$pid" 2>/dev/null || true; done
  rm -f "$HOME/.android/avd/$AVD.avd/"*.lock 2>/dev/null || true
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  alive) [[ -n "$(qemu_pid)" ]] ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
