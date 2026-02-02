# Claude Code Instructions for Nomad Mobile

## Project Overview

React Native + Expo mobile app for Nomad Karaoke - a mobile frontend for the Decide song discovery platform.

**Status:** Phase 1 Foundation complete - basic project structure and navigation set up

## Tech Stack

- **Framework:** React Native with Expo SDK
- **Language:** TypeScript
- **Navigation:** Expo Router (file-based)
- **State:** Zustand + React Query
- **Styling:** NativeWind (Tailwind for RN)
- **Storage:** MMKV (fast), Expo SecureStore (auth)

## Related Projects

| Project | Relationship |
|---------|--------------|
| `karaoke-decide` | Backend API - this app is a frontend for Decide |
| `karaoke-gen` | Future integration - video generation orders |
| `public-website` | Brand/style reference |

## API Integration

Backend: `https://karaoke-decide-718638054799.us-central1.run.app`

See `karaoke-decide/docs/API.md` for full endpoint documentation.

Key endpoints:
- `POST /api/auth/magic-link` - Authentication
- `GET /api/catalog/songs?q=` - Search
- `GET /api/my/recommendations` - Personalized songs
- `GET /api/playlists` - User playlists

## Key Documentation

- [Implementation Plan](docs/IMPLEMENTATION-PLAN.md) - Full project plan
- [karaoke-decide/docs/API.md](../karaoke-decide/docs/API.md) - API reference
- [karaoke-decide/docs/VISION.md](../karaoke-decide/docs/VISION.md) - UX philosophy

## Development Commands

```bash
# Start development
npx expo start

# Run on iOS simulator
npx expo run:ios

# Run on Android emulator
npx expo run:android

# Run tests
npm test

# Run tests with coverage (target: 70%+)
npm run test:coverage

# Build for production
eas build --platform all
```

## App Store Info

- **iOS Bundle ID:** `com.nomadkaraoke.mobile`
- **Android Package:** `com.nomadkaraoke.mobile`
- **App Name:** Nomad Karaoke

## Code Conventions

Follow patterns from `karaoke-decide` frontend:
- Functional components with hooks
- TypeScript strict mode
- API calls through typed client
- Zustand for global state
- React Query for server state
