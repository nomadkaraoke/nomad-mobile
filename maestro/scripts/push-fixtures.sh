#!/usr/bin/env bash
# Puts the connect flows' fixtures where the phone's pickers find them:
#   - the screenshot (connect-1): any image; decide's fake extractor ignores the pixels. iOS Photos / Android Pictures.
#   - the Spotify Extended export (connect-3), written by scripts/make-import-fixtures.ts: iOS Files "On My iPhone"
#     (the simulator's local File Provider storage) / Android Downloads.
#
#   maestro/scripts/push-fixtures.sh ios       # IOS_DEVICE = simulator UDID (default: the booted one, if only one)
#   maestro/scripts/push-fixtures.sh android   # ANDROID_SERIAL = emulator serial (default emulator-5554)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="$ROOT/apps/mobile/assets/images/icon.png"
ZIP="$ROOT/maestro/fixtures/generated/spotify-extended.zip"
[[ -f "$ZIP" ]] || { echo "no $ZIP: run node scripts/make-import-fixtures.ts first" >&2; exit 1; }
# One image name per run, so the picker's newest photo is always ours.
SHOT_NAME="connect-screenshot.png"

case "${1:-}" in
  ios)
    UDID="${IOS_DEVICE:-}"
    if [[ -z "$UDID" || ! "$UDID" =~ ^[0-9A-F-]{36}$ ]]; then
      NAME="$UDID"
      UDID="$(xcrun simctl list devices booted | { if [[ -n "$NAME" ]]; then grep -F "$NAME ("; else cat; fi; } \
        | grep -oE '[0-9A-F-]{36}' | head -1 || true)"
    fi
    [[ -n "$UDID" ]] || { echo "no booted simulator (set IOS_DEVICE)" >&2; exit 1; }
    tmp="$(mktemp -d)"
    cp "$IMAGE" "$tmp/$SHOT_NAME"
    xcrun simctl addmedia "$UDID" "$tmp/$SHOT_NAME"
    rm -rf "$tmp"
    # "On My iPhone" is the FileProvider.LocalStorage app group's "File Provider Storage" folder. It exists once
    # the Files app has run; launch it once if it doesn't yet.
    find_storage() {
      local meta
      for meta in "$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Containers/Shared/AppGroup"/*/.com.apple.mobile_container_manager.metadata.plist; do
        [[ -f "$meta" ]] || continue
        if plutil -extract MCMMetadataIdentifier raw "$meta" 2>/dev/null | grep -qx 'group.com.apple.FileProvider.LocalStorage'; then
          echo "$(dirname "$meta")/File Provider Storage"
          return 0
        fi
      done
      return 1
    }
    if ! STORAGE="$(find_storage)"; then
      xcrun simctl launch "$UDID" com.apple.DocumentsApp >/dev/null 2>&1 || true
      sleep 5
      xcrun simctl terminate "$UDID" com.apple.DocumentsApp >/dev/null 2>&1 || true
      STORAGE="$(find_storage)" || { echo "the simulator has no local File Provider storage" >&2; exit 1; }
    fi
    mkdir -p "$STORAGE"
    cp "$ZIP" "$STORAGE/"
    echo "iOS $UDID: $SHOT_NAME in Photos, spotify-extended.zip in Files > On My iPhone"
    ;;
  android)
    SERIAL="${ANDROID_SERIAL:-emulator-5554}"
    adb -s "$SERIAL" push "$IMAGE" "/sdcard/Pictures/$SHOT_NAME" >/dev/null
    adb -s "$SERIAL" push "$ZIP" /sdcard/Download/spotify-extended.zip >/dev/null
    # Let MediaStore index both (the photo picker and the Downloads provider read it).
    for f in "/sdcard/Pictures/$SHOT_NAME" /sdcard/Download/spotify-extended.zip; do
      adb -s "$SERIAL" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$f" >/dev/null 2>&1 || true
    done
    adb -s "$SERIAL" shell content call --method scan_volume --uri content://media --arg external_primary >/dev/null 2>&1 || true
    echo "Android $SERIAL: $SHOT_NAME in Pictures, spotify-extended.zip in Download"
    ;;
  *)
    echo "usage: $0 ios|android" >&2
    exit 2
    ;;
esac
