#!/usr/bin/env bash
# CI (.github/workflows/e2e.yml): the debug dev-client build the Maestro flows run on, the same build
# `npx expo run:ios|android` makes locally (it loads the JS from Metro, so a JS-only change never needs a new one).
#
#   scripts/ci/build-dev-client.sh fingerprint ios|android   # print the native fingerprint (the build cache key)
#   scripts/ci/build-dev-client.sh build ios|android OUT_DIR # prebuild + build; OUT_DIR gets NomadKaraoke.app or app-debug.apk
#
# iOS: a simulator build, ad-hoc signed like `expo run:ios` (unsigned, the app gets no keychain: SecureStore and
# expo-notifications fail with ERR_..._KEYCHAIN_ACCESS). Android: x86_64 (hosted Linux emulators) + arm64-v8a (the
# self-hosted Mac's); ANDROID_ABI overrides.
set -euo pipefail
# EXPO_PUBLIC_PUSH=0, like the eas.json e2e-test profile: no push (aps-environment) entitlement, which an ad-hoc
# signed simulator build can't carry; the E2E Metro bundles with it too, so the app registers a fake Expo token
# and the notify flows read gen's and the box's fake push outboxes. Set for both commands, since app.config.ts
# reads it: the fingerprint (the build cache key) must match the build it names.
export EXPO_PUBLIC_PUSH=0

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
    out="$(cd "$out" && pwd)"
    cd "$APP"
    CI=1 npx expo prebuild --platform "$platform" --no-install --clean
    if [[ "$platform" == ios ]]; then
      # The self-hosted Mac builds with the app's Xcode (26.6) but runs Maestro on its default Xcode (27.1): under the
      # 26.6 copy Maestro's XCTest driver never started ("iOS driver not ready in time"), under 27.1 in 8 s. Its runners
      # set E2E_BUILD_DEVELOPER_DIR for this build step only.
      if [[ -n "${E2E_BUILD_DEVELOPER_DIR:-}" ]]; then export DEVELOPER_DIR="$E2E_BUILD_DEVELOPER_DIR"; fi
      (cd ios && pod install)
      xcodebuild -workspace ios/NomadKaraoke.xcworkspace -scheme NomadKaraoke -configuration Debug \
        -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build \
        CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= COMPILER_INDEX_STORE_ENABLE=NO -quiet
      rm -rf "$out/NomadKaraoke.app"
      cp -R ios/build/Build/Products/Debug-iphonesimulator/NomadKaraoke.app "$out/"
    else
      (cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures="${ANDROID_ABI:-x86_64,arm64-v8a}" --no-daemon -q)
      cp android/app/build/outputs/apk/debug/app-debug.apk "$out/"
    fi
    ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
