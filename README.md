# Nomad Karaoke Mobile

The combined Nomad Karaoke app for iOS and Android. Find a song (karaoke-decide), make a karaoke video of it (karaoke-gen), pay, and watch. Built with Expo SDK 57, React Native and TypeScript.

## Status

**Phase 0 (foundation), 2026-10-14.** This phase delivers:

- the pnpm workspace
- generated API clients
- 33-locale i18n
- UI wrappers
- CI
- Maestro smoke flows
- placeholder screens: live decide search, plus a mock email-code sign-in

Phase 1 builds the MVP flow (make → pay → watch). See the [design spec](docs/superpowers/specs/2026-10-14-mobile-phase0-design.md).

## Quick start

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm lint

cd apps/mobile
npx expo run:ios --device "iPhone 17 Pro"   # or: npx expo run:android
maestro test ../../maestro/
```

In development, sign in with any email and the code `123456`. The real gen email-code endpoints arrive in Phase 1.

## Layout

| Path | What |
|---|---|
| `apps/mobile` | Expo Router app |
| `packages/core` | Pure TS domain logic |
| `packages/i18n` | Messages for 33 locales, locale resolution, translation scripts |
| `packages/api-gen`, `packages/api-decide` | OpenAPI-generated clients for karaoke-gen and karaoke-decide |
| `packages/ui` | Design tokens and primitives; the only place that imports FlashList or Skia |
| `openapi/` | Committed OpenAPI snapshots |
| `maestro/` | E2E flows |

See [CLAUDE.md](CLAUDE.md) for conventions and commands.

## Backends

- karaoke-gen: `https://api.nomadkaraoke.com`
- karaoke-decide: `https://decide.nomadkaraoke.com` (`/api/*`)
