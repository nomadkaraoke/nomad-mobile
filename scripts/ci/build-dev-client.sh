#!/usr/bin/env bash
# CI (.github/workflows/e2e.yml): the debug dev-client build the Maestro flows run on, the same build
# `npx expo run:ios|android` makes locally (it loads the JS from Metro, so a JS-only change never needs a new one).
#
#   scripts/ci/build-dev-client.sh fingerprint ios|android   # print the native fingerprint (the build cache key)
#   scripts/ci/build-dev-client.sh build ios|android OUT_DIR # prebuild + build; OUT_DIR gets NomadKaraoke.app or app-debug.apk
#
# iOS: a simulator build (no signing). Android: x86_64 only (the CI emulator's ABI; ANDROID_ABI overrides).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/apps/mobile"
cmd="${1:-}"; platform="${2:-}"
[[ "$platform" == ios || "$platform" == android ]] || { sed -n '2,8p' "$0"; exit 2; }

case "$cmd" in
  fingerprint)
    (cd "$APP" && npx --no-install fingerprint fingerprint:generate --platform "$platform") |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hash))'
    ;;
  build)
    out="${3:?OUT_DIR}"
    mkdir -p "$out"
    cd "$APP"
    CI=1 npx expo prebuild --platform "$platform" --no-install --clean
    if [[ "$platform" == ios ]]; then
      (cd ios && pod install)
      xcodebuild -workspace ios/NomadKaraoke.xcworkspace -scheme NomadKaraoke -configuration Debug \
        -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build \
        CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO -quiet
      rm -rf "$out/NomadKaraoke.app"
      cp -R ios/build/Build/Products/Debug-iphonesimulator/NomadKaraoke.app "$out/"
    else
      (cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures="${ANDROID_ABI:-x86_64}" --no-daemon -q)
      cp android/app/build/outputs/apk/debug/app-debug.apk "$out/"
    fi
    ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
