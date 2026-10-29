#!/usr/bin/env bash
# Regenerates the store listing screenshots: runs maestro/screens/store-tour.yaml through scripts/e2e-local.sh
# on each store device and checks (and fixes, with sips) the sizes the stores require. Re-run after any UI change
# (Phase 7 polish). Needs the dev client installed on every device, plus the gen / decide / kjbox local stacks'
# prerequisites (see scripts/e2e-local.sh). Shots: docs/store/screenshots/<device>/<locale>/store-NN-*.png
#
# Run it on the build host (the self-hosted E2E runner Mac, docs/TESTING.md), not a developer laptop: it boots
# three simulators/emulators and the local stacks. Elsewhere it refuses unless --force-local (or --check-only).
#
#   scripts/store-screenshots.sh                       # iphone-6.9, ipad-13 and android, locale en
#   scripts/store-screenshots.sh --locale de           # another app language
#   scripts/store-screenshots.sh --devices iphone-6.9  # a subset (iphone-6.9 | ipad-13 | android, comma-separated)
#   scripts/store-screenshots.sh --check-only          # only verify / fix sizes of existing files
#   scripts/store-screenshots.sh --force-local         # run anyway on a machine that is not the build host
#
# Env: ANDROID_SERIAL (a running Pixel AVD, default emulator-5554; never a physical phone), IOS_SDK_RUNTIME
#      (default: newest installed iOS runtime). Devices are shared: Maestro's iOS driver port (7001) is global, so
#      this refuses to start while another Maestro runs (no override).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCALE="en"
DEVICES="iphone-6.9,ipad-13,android"
CHECK_ONLY=0
FORCE_LOCAL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --locale) LOCALE="$2"; shift 2 ;;
    --devices) DEVICES="$2"; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --force-local) FORCE_LOCAL=1; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# The build host runs the self-hosted GitHub Actions runners (~/actions-runner); NOMAD_BUILD_HOST=1 also marks one.
on_build_host() { [[ "${NOMAD_BUILD_HOST:-}" == 1 || -d "$HOME/actions-runner" ]]; }
if (( CHECK_ONLY == 0 && FORCE_LOCAL == 0 )) && ! on_build_host; then
  echo "store-screenshots.sh boots three devices and the local stacks: run it on the build host (docs/TESTING.md)," >&2
  echo "or pass --force-local to run it here anyway." >&2
  exit 1
fi

# Required sizes (width x height, portrait). Apple 6.9": 1320x2868 or 1290x2796; iPad 13": 2064x2752 (2048x2732
# also accepted by Apple, but we target the Pro 13 simulator's native size). Play phone: short side >= 1080 px,
# long side <= 2x the short side.
size_of() { # file -> "WxH"
  sips -g pixelWidth -g pixelHeight "$1" | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w "x" h}'
}
ok_apple() { # kind WxH
  case "$1:$2" in
    iphone-6.9:1320x2868|iphone-6.9:1290x2796|ipad-13:2064x2752|ipad-13:2048x2732) return 0 ;;
  esac
  return 1
}

# The app's dark background (packages/ui/src/tokens.ts colors.bg): padding blends into the screen's own edges.
PAD_COLOR="0F0F0F"

# Fits file into W x H: resize to fit inside, then pad the leftover (only small aspect differences) with PAD_COLOR.
fit_to() { # file W H
  local f="$1" tw="$2" th="$3" w h
  read -r w h < <(size_of "$f" | tr 'x' ' ')
  # Scale so both sides fit, then pad to the exact size.
  if (( w * th >= h * tw )); then sips --resampleWidth "$tw" "$f" >/dev/null; else sips --resampleHeight "$th" "$f" >/dev/null; fi
  sips --padToHeightWidth "$th" "$tw" --padColor "$PAD_COLOR" "$f" >/dev/null
}

SUMMARY=()
note() { SUMMARY+=("$1"); }

check_dir() { # kind dir
  local kind="$1" dir="$2" f dims w h count=0
  for f in "$dir"/store-*.png; do
    [[ -f "$f" ]] || continue
    count=$((count + 1))
    dims="$(size_of "$f")"; w="${dims%x*}"; h="${dims#*x}"
    if [[ "$kind" == android ]]; then
      local short=$(( w < h ? w : h )) long=$(( w < h ? h : w ))
      if (( short < 1080 )); then
        # Upscale so the short side reaches 1080 (keeps the ratio).
        if (( w <= h )); then sips --resampleWidth 1080 "$f" >/dev/null; else sips --resampleHeight 1080 "$f" >/dev/null; fi
        note "resized $f ($dims) to a 1080 px short side"
        # The 2:1 padding below must use the upscaled size, not the original.
        local now; now="$(size_of "$f")"; w="${now%x*}"; h="${now#*x}"
        short=$(( w < h ? w : h )); long=$(( w < h ? h : w ))
      fi
      if (( long > short * 2 )); then
        local tw th
        if (( w <= h )); then tw="$w"; th=$(( w * 2 )); else th="$h"; tw=$(( h * 2 )); fi
        fit_to "$f" "$tw" "$th"
        note "padded $f ($dims) to Play's 2:1 limit"
      fi
    elif ! ok_apple "$kind" "$dims"; then
      local tw th
      if [[ "$kind" == iphone-6.9 ]]; then tw=1320; th=2868; else tw=2064; th=2752; fi
      fit_to "$f" "$tw" "$th"
      note "resized/padded $f ($dims) to ${tw}x${th}"
    fi
  done
  if (( count == 0 )); then note "$kind: no store-*.png in $dir"; return 1; fi
  note "$kind: $count shots in $dir, sizes ok ($(size_of "$dir/store-01-discover.png"))"
}

if (( CHECK_ONLY == 0 )); then
  # The shared-device rule: Maestro's iOS driver listens on the global port 7001, so two runs collide.
  if pgrep -f 'maestro.cli' >/dev/null; then
    echo "another Maestro process is running (pgrep maestro.cli); devices and :7001 are shared. Try again when it ends." >&2
    exit 1
  fi
fi

ios_runtime() {
  local r="${IOS_SDK_RUNTIME:-}"
  [[ -n "$r" ]] || r="$(xcrun simctl list runtimes -j | python3 -c '
import json,sys
rs=[r for r in json.load(sys.stdin)["runtimes"] if r["platform"]=="iOS" and r["isAvailable"]]
rs.sort(key=lambda r:[int(x) for x in r["version"].split(".")])
print(rs[-1]["identifier"])')"
  echo "$r"
}

# A simulator named NAME of the device type matching TYPE_RE (newest first), created when missing; booted. Prints the name.
ensure_sim() { # name type_regex
  local name="$1" re="$2" type rt
  if ! xcrun simctl list devices available | grep -qF "    $name ("; then
    type="$(xcrun simctl list devicetypes | grep -E "$re" | head -1 | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9.-]+')"
    [[ -n "$type" ]] || { echo "no simulator device type matching $re (Xcode SDK 26 installed?)" >&2; return 1; }
    rt="$(ios_runtime)"
    echo "creating simulator \"$name\" ($type on $rt)" >&2
    xcrun simctl create "$name" "$type" "$rt" >/dev/null
  fi
  xcrun simctl list devices booted | grep -qF "$name (" || xcrun simctl boot "$name" 2>/dev/null || true
}

run_device() { # kind
  local kind="$1" platform=ios dir
  dir="docs/store/screenshots/$kind/$LOCALE"
  mkdir -p "$dir"
  rm -f "$dir"/store-*.png
  case "$kind" in
    iphone-6.9) ensure_sim "iPhone 17 Pro Max" 'iPhone 17 Pro Max'; export IOS_DEVICE="iPhone 17 Pro Max" ;;
    # "iPad Pro 13-inch (M5)": native 2064x2752, the App Store's 13" iPad size.
    ipad-13) ensure_sim "iPad Pro 13-inch (M5)" 'iPad Pro 13-inch \(M5\)'; export IOS_DEVICE="iPad Pro 13-inch (M5)" ;;
    android)
      platform=android
      export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
      [[ "$ANDROID_SERIAL" == emulator-* ]] || { echo "ANDROID_SERIAL must be an emulator (a Pixel AVD), not $ANDROID_SERIAL" >&2; return 1; }
      adb devices | grep -q "^${ANDROID_SERIAL}[[:space:]]*device" || { echo "no running emulator $ANDROID_SERIAL (start a Pixel AVD first)" >&2; return 1; } ;;
    *) echo "unknown device $kind" >&2; return 2 ;;
  esac
  echo "== $kind ($platform) -> $dir"
  STORE_SHOTS="$dir" scripts/e2e-local.sh --platform "$platform" --locale "$LOCALE" --screen store-tour
}

rc=0
IFS=',' read -r -a LIST <<< "$DEVICES"
for kind in "${LIST[@]}"; do
  if (( CHECK_ONLY == 0 )); then
    run_device "$kind" || { note "$kind: tour FAILED"; rc=1; continue; }
  fi
  check_dir "$kind" "docs/store/screenshots/$kind/$LOCALE" || rc=1
done

echo; echo "Summary (locale $LOCALE):"
printf '  %s\n' "${SUMMARY[@]}"
exit "$rc"
