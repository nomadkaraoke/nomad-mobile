# Nomad Karaoke Mobile

The combined Nomad Karaoke app for iOS and Android. Find a song (karaoke-decide), make a karaoke video of it (karaoke-gen), pay, and watch. Built with Expo SDK 57, React Native and TypeScript.

## Status

**Phase 1 ("Make it"), 2026-10-17.** Real gen sign-in (email code, Google, Apple behind a flag), the make flow
(gen picks the audio, you confirm), credits through Stripe checkout that returns to the app, the Make tab with
progress and needs-you actions, and the ready screen (YouTube link, Copy, Share, MP4). Nine Maestro flows run it
end to end on iOS and Android against the gen local stack.

Phase 0 (2026-10-14) laid the foundation: the pnpm workspace, generated API clients, 33-locale i18n, UI wrappers
and CI. The vision, release bar and phase roadmap are in [docs/VISION.md](docs/VISION.md); Phase 1's design is
[docs/superpowers/specs/2026-10-17-mobile-phase1-make-it-design.md](docs/superpowers/specs/2026-10-17-mobile-phase1-make-it-design.md).

## Quick start

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm lint

cd apps/mobile
npx expo run:ios --device "iPhone 17 Pro"   # or: npx expo run:android
cd ../..
scripts/e2e-local.sh --platform ios         # or: --platform android
```

The app talks to prod gen by default. For development and E2E, point it at the
[gen local stack](../karaoke-gen/docs/TESTING.md) (real backend, fake workers): `scripts/e2e-local.sh` starts the
stack and a Metro with `EXPO_PUBLIC_GEN_API_URL=http://127.0.0.1:8010` and `EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN=1`.
Sign-in codes come from the stack's `/api/test/emails`. See CLAUDE.md § E2E.

## Sideload on your Android phone

The release APK talks to prod (gen, decide, Stripe), so anything you do in it is real.

1. On the phone: Settings → About phone → tap **Build number** 7 times, then Settings → System → Developer options →
   turn on **USB debugging**. Plug it into the Mac and accept the "Allow USB debugging?" prompt.
2. `adb devices` should list it. Then: `adb install -r dist/nomad-karaoke-phase1-release.apk`
   (or copy the APK to the phone and open it, allowing installs from that app).

To build the APK yourself (it's signed with the Expo template's debug keystore, which is the one the Google
Android OAuth client is registered for; don't set any `EXPO_PUBLIC_*` local-stack variables):

```bash
cd apps/mobile
CI=1 npx expo prebuild --platform android --no-install   # only if apps/mobile/android doesn't exist yet
# arm64-v8a only: every current Android phone (and the Apple-silicon emulator); a universal build is ~170 MB
cd android && ANDROID_HOME=~/Library/Android/sdk ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
cp app/build/outputs/apk/release/app-release.apk ../../../dist/nomad-karaoke-phase1-release.apk
```

## Layout

| Path | What |
|---|---|
| `apps/mobile` | Expo Router app |
| `packages/core` | Pure TS domain logic |
| `packages/i18n` | Messages for 33 locales, locale resolution, translation scripts |
| `packages/api-gen`, `packages/api-decide` | OpenAPI-generated clients for karaoke-gen and karaoke-decide |
| `packages/ui` | Design tokens and primitives; the only place that imports FlashList or Skia |
| `openapi/` | Committed OpenAPI snapshots |
| `maestro/` | E2E flows (`flows/`), shared steps (`common/`), local-stack helpers (`scripts/stack.js`) |
| `docs/screenshots/phase1/` | Screenshots the flows capture, per platform |

See [CLAUDE.md](CLAUDE.md) for conventions and commands.

## Backends

- karaoke-gen: `https://api.nomadkaraoke.com`
- karaoke-decide: `https://decide.nomadkaraoke.com` (`/api/*`)
