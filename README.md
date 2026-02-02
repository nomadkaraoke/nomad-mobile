# Nomad Karaoke Mobile

React Native mobile app for iOS and Android - a native frontend for the Nomad Karaoke song discovery platform.

## Status

**Phase 1: Foundation complete** - See [Implementation Plan](docs/IMPLEMENTATION-PLAN.md)

Completed:
- Expo project setup with TypeScript
- Expo Router navigation (tabs + auth routes)
- Basic screens: Discover, Search, Playlists, Settings
- Auth screens: Login, Magic Link Sent
- API client with typed endpoints
- Zustand auth store
- NativeWind (Tailwind CSS) configured

## What This App Does

- Search 275,000+ karaoke songs
- Get personalized song recommendations
- Connect Spotify/Last.fm for music taste analysis
- Create and manage playlists
- (Future) Order custom karaoke videos

## Tech Stack

- React Native + Expo
- TypeScript
- Expo Router
- Zustand + React Query
- NativeWind (Tailwind CSS)

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npx expo start

# Run on iOS
npx expo run:ios

# Run on Android
npx expo run:android

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Backend

This app connects to the Decide API:
- Production: `https://karaoke-decide-718638054799.us-central1.run.app`
- API Docs: See `../karaoke-decide/docs/API.md`

## App Store Links

- iOS: Coming soon
- Android: Coming soon

## Related Projects

- [karaoke-decide](../karaoke-decide) - Backend API
- [karaoke-gen](../karaoke-gen) - Video generation (future integration)
- [public-website](../public-website) - Marketing website
