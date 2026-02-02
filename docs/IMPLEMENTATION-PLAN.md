# Nomad Karaoke Mobile App - Implementation Plan

## Executive Summary

Build a new **React Native + Expo** mobile app for iOS and Android that provides mobile access to the Nomad Karaoke song discovery platform (Decide). This replaces the legacy KaraokeHunt Flutter app with a modern, maintainable codebase integrated with the existing backend APIs.

**Key decisions:**
- New app store listings under "Nomad Karaoke" brand
- React Native + Expo for cross-platform development
- MVP scope: Decide features only (no video generation)
- Magic link authentication (matching web apps)
- Legacy KaraokeHunt app: final update redirecting to new app

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Project Setup

**Create Expo project:**
```bash
npx create-expo-app nomad-mobile --template blank-typescript
```

**Directory structure:**
```
nomad-mobile/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Auth screens (login, magic-link)
│   ├── (tabs)/            # Main tab navigation
│   │   ├── discover.tsx   # Recommendations / Home
│   │   ├── search.tsx     # Catalog search
│   │   ├── playlists.tsx  # User playlists
│   │   └── settings.tsx   # Settings / Profile
│   ├── _layout.tsx        # Root layout
│   └── index.tsx          # Entry point
├── src/
│   ├── api/               # API client for Decide backend
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # Zustand stores (auth, songs, playlists)
│   ├── types/             # TypeScript types
│   └── utils/             # Utilities
├── assets/                # Images, fonts
├── docs/                  # Documentation
└── CLAUDE.md              # Agent instructions
```

**Key dependencies:**
- `expo-router` - File-based routing
- `zustand` - State management (lightweight, same pattern as web)
- `react-native-mmkv` - Fast local storage for offline data
- `expo-linking` - Deep linking for magic links
- `expo-secure-store` - Secure JWT storage
- `@tanstack/react-query` - Data fetching/caching
- `nativewind` - Tailwind CSS for React Native (matches web styling)
- `@react-native-firebase/app` - Firebase core
- `@react-native-firebase/crashlytics` - Crash reporting (free)

### 1.2 API Client

Create typed API client for Decide backend endpoints:

```typescript
// src/api/client.ts
const BASE_URL = 'https://karaoke-decide-718638054799.us-central1.run.app';

// Key endpoints to implement:
// POST /api/auth/guest         - Anonymous session
// POST /api/auth/magic-link    - Request magic link
// POST /api/auth/verify        - Verify magic link token
// GET  /api/catalog/songs      - Search catalog
// GET  /api/my/songs           - User's known songs
// GET  /api/my/recommendations - Personalized recommendations
// GET  /api/playlists          - User playlists
// POST /api/playlists          - Create playlist
// POST /api/services/connect/spotify - Spotify OAuth
```

### 1.3 Authentication Flow

**Magic link flow:**
1. User enters email → app calls `POST /api/auth/magic-link`
2. User receives email with link: `nomadkaraoke://auth/verify?token=xxx`
3. App intercepts deep link → calls `POST /api/auth/verify`
4. JWT stored securely → user authenticated

**Guest flow:**
1. On first launch, call `POST /api/auth/guest`
2. Store guest JWT (30-day expiry)
3. Prompt for email upgrade periodically

**Deep link configuration:**
- iOS: `nomadkaraoke://` scheme in Info.plist
- Android: `nomadkaraoke://` scheme in AndroidManifest.xml
- Universal links: `app.nomadkaraoke.com` (optional, for better UX)

---

## Phase 2: Core Screens (Week 2-4)

### 2.1 Screen Map

| Screen | Route | Description |
|--------|-------|-------------|
| Welcome | `/` | First-time user, "Get Started" CTA |
| Login | `/(auth)/login` | Email input for magic link |
| Magic Link Sent | `/(auth)/magic-link-sent` | "Check your email" |
| Discover | `/(tabs)/discover` | Personalized recommendations |
| Search | `/(tabs)/search` | Catalog search with filters |
| Playlists | `/(tabs)/playlists` | User's playlists |
| Playlist Detail | `/playlist/[id]` | Songs in a playlist |
| Song Detail | `/song/[id]` | Song details, add to playlist |
| Settings | `/(tabs)/settings` | Account, connections, preferences |
| Connect Spotify | `/connect/spotify` | Spotify OAuth flow |

### 2.2 Screen Specifications

#### Discover (Home)
- **Purpose**: Show personalized song recommendations
- **API**: `GET /api/my/recommendations`
- **UI Elements**:
  - Greeting with user name
  - "Songs for you" carousel
  - Genre/mood filters
  - Quick actions: Search, Playlists
- **Empty state**: Prompt to connect Spotify or take quiz

#### Search
- **Purpose**: Search 275K song catalog
- **API**: `GET /api/catalog/songs?q={query}`
- **UI Elements**:
  - Search bar with autocomplete
  - Filter chips: Genre, Decade, Energy, Popularity
  - Results list with song cards
  - "Add to playlist" action on each card

#### Playlists
- **Purpose**: Manage song collections
- **API**: `GET /api/playlists`, `POST /api/playlists`
- **UI Elements**:
  - Playlist list with song counts
  - "Create playlist" FAB
  - Long-press to delete
  - Swipe actions on songs

#### Settings
- **Purpose**: Account and preferences
- **Sections**:
  - Account (email, sign out)
  - Connected Services (Spotify, Last.fm)
  - Preferences (notifications, theme)
  - About (version, support links)

---

## Phase 3: Data & Offline (Week 4-5)

### 3.1 Offline Support

**Cache strategy:**
- **Song catalog**: Cache last 1000 search results in MMKV
- **Playlists**: Full offline support, sync on reconnect
- **Recommendations**: Cache with 1-hour TTL
- **User data**: Cache indefinitely, sync on changes

**Implementation:**
```typescript
// React Query with persistence
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
});

// MMKV persister for offline cache
const mmkvStorage = new MMKV();
persistQueryClient({ queryClient, persister: createMMKVPersister(mmkvStorage) });
```

### 3.2 Spotify Integration

**OAuth flow on mobile:**
1. User taps "Connect Spotify"
2. Open Spotify auth URL in system browser (expo-auth-session)
3. Redirect back to app: `nomadkaraoke://spotify-callback?code=xxx`
4. App sends code to `POST /api/services/connect/spotify`
5. Backend exchanges for tokens, syncs listening history

**expo-auth-session setup:**
```typescript
const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};
```

---

## Phase 4: Polish & Platform (Week 5-6)

### 4.1 Native Features

- **Push notifications**: Job completion alerts (for future Gen integration)
- **Haptic feedback**: On playlist add, success states
- **Share sheet**: Share songs/playlists via native share
- **App icons**: Adaptive icons for Android, multiple sizes for iOS

### 4.2 App Store Assets

**iOS App Store:**
- App name: "Nomad Karaoke"
- Subtitle: "find your perfect karaoke songs"
- Bundle ID: `com.nomadkaraoke.mobile`
- Screenshots: 6.5" (iPhone 14 Pro Max), 5.5" (iPhone 8 Plus)
- Category: Music
- Minimum iOS: 15.0

**Google Play:**
- App name: "Nomad Karaoke - find your perfect karaoke songs"
- Package: `com.nomadkaraoke.mobile`
- Screenshots: Phone, 7" tablet, 10" tablet
- Category: Music & Audio
- Minimum Android: 10 (API 29)

### 4.3 Brand Assets Needed

- [ ] App icon (1024x1024 master)
- [ ] Splash screen
- [ ] Feature graphic (Play Store)
- [ ] Screenshots for both stores
- [ ] App Store Connect metadata (description, keywords)

---

## Phase 5: Legacy App Transition

### 5.1 KaraokeHunt Final Update

Push one final update to the legacy Flutter app:

**What the update does:**
1. Replace all screens with single "We've moved!" screen
2. Show Nomad Karaoke branding
3. "Download Nomad Karaoke" buttons → App Store / Play Store links
4. No functional features, just redirect

**Update metadata:**
- Version: 2.0.0 (to ensure all users get it)
- Update notes: "KaraokeHunt is now Nomad Karaoke! Download our new app."

**Timeline:** Ship after Nomad Karaoke app is live in stores

### 5.2 Data Migration

Users of old KaraokeHunt app have data in Firebase:
- User profiles in Firestore `users` collection
- Playlists (if any)

**Migration approach:**
- Option A: Don't migrate (old app had minimal real usage)
- Option B: One-time migration script if significant data exists

**Recommendation:** Option A - clean start with new auth system

---

## API Mapping

### Decide API Endpoints for Mobile

| Mobile Feature | API Endpoint | Method |
|---------------|--------------|--------|
| Guest session | `/api/auth/guest` | POST |
| Request magic link | `/api/auth/magic-link` | POST |
| Verify magic link | `/api/auth/verify` | POST |
| Search songs | `/api/catalog/songs?q=` | GET |
| Search artists | `/api/catalog/artists?q=` | GET |
| Get recommendations | `/api/my/recommendations` | GET |
| Get known songs | `/api/my/songs` | GET |
| Add known song | `/api/my/songs/{song_id}` | POST |
| Get playlists | `/api/playlists` | GET |
| Create playlist | `/api/playlists` | POST |
| Add song to playlist | `/api/playlists/{id}/songs` | POST |
| Connect Spotify | `/api/services/connect/spotify` | POST |
| Sync listening data | `/api/services/sync` | POST |
| Get user profile | `/api/users/me` | GET |

### Response Types

See `karaoke-decide/docs/API.md` for full schema. Key types:

```typescript
interface Song {
  id: string;
  title: string;
  artist: string;
  karaoke_brand: string;
  genre?: string;
  decade?: string;
  popularity?: number;
  energy?: number;
  danceability?: number;
}

interface Playlist {
  id: string;
  name: string;
  song_count: number;
  created_at: string;
  updated_at: string;
}

interface User {
  id: string;
  email?: string;
  display_name?: string;
  spotify_connected: boolean;
  lastfm_connected: boolean;
}
```

---

## Technical Decisions

### Why React Native + Expo?

| Factor | React Native | Flutter | Native |
|--------|--------------|---------|--------|
| Code sharing with web | High (TypeScript) | Low | None |
| Team familiarity | High (same as web) | Low | Medium |
| Development speed | Fast | Fast | Slow |
| Native feel | Good | Good | Best |
| Maintenance | 1 codebase | 1 codebase | 2 codebases |

**Decision:** React Native + Expo provides the best balance of development speed, code sharing with existing web apps, and maintainability.

### Why Not Reuse FlutterFlow Code?

1. **Vendor lock-in**: FlutterFlow generates code but ongoing development requires their platform
2. **Code quality**: Generated code is verbose and hard to maintain
3. **Authentication mismatch**: Old app uses Firebase Auth, new apps use magic links
4. **API mismatch**: Old app doesn't integrate with Decide/Gen APIs
5. **Brand mismatch**: KaraokeHunt branding throughout

**Decision:** Clean slate with React Native is faster than migrating FlutterFlow code.

---

## Success Criteria

### MVP Launch Checklist

- [ ] Authentication works (magic link + guest)
- [ ] Can search 275K song catalog
- [ ] Can view personalized recommendations
- [ ] Can create and manage playlists
- [ ] Spotify OAuth integration works
- [ ] Offline mode for cached data
- [ ] App Store approved (iOS)
- [ ] Play Store approved (Android)
- [ ] Analytics tracking (via Decide API, with mobile context)
- [ ] Crashlytics error tracking integrated

### Post-MVP Features (Future Phases)

1. **Gen integration**: Order karaoke videos from app
2. **Native lyrics review**: Review/edit lyrics on mobile
3. **Vocal range detection**: Use microphone to detect range
4. **Social features**: Share playlists, see friends' songs
5. **Apple Music integration**: Alternative to Spotify
6. **Watch app**: Quick song lookup from Apple Watch

---

## Timeline Estimate

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Foundation | 1-2 weeks | Project setup, API client, auth |
| Phase 2: Core Screens | 2-3 weeks | All main screens functional |
| Phase 3: Data & Offline | 1 week | Caching, Spotify OAuth |
| Phase 4: Polish | 1 week | Native features, store assets |
| Phase 5: Launch | 1 week | Store submission, legacy update |

**Total estimate:** 6-8 weeks for MVP launch

---

## Resolved Decisions

### 1. Deep Linking Strategy

**Decision:** Use both custom scheme AND universal links with smart app banners.

- **Custom scheme**: `nomadkaraoke://` for magic link auth redirects
- **Universal links**: `app.nomadkaraoke.com` for QR codes and marketing links
- **Smart app banner**: When users visit web URLs on mobile, show iOS/Android smart banner offering app download, but don't force - let users choose web or app

**Implementation:**
- QR codes link to `https://app.nomadkaraoke.com/...`
- Server returns web page with smart app banner meta tags
- If app installed, universal link opens app directly
- If not installed, user sees web version + "Get the app" banner

This respects user choice - the web apps are already responsive, so users who prefer web aren't blocked.

### 2. Analytics

**Decision:** Extend existing analytics (same backend integration).

Since the mobile app uses the same Decide API, analytics events will flow through the existing backend. Add mobile-specific context:
- Platform (ios/android)
- App version
- Device model

No separate mobile analytics platform needed.

### 3. Error Tracking

**Decision:** Firebase Crashlytics (free, GCP-integrated).

**Why Crashlytics:**
- **Free**: No monthly fees, unlimited crashes
- **GCP integration**: Already using Firebase/GCP, data stays in same project
- **Good for debugging**: Stack traces, device info, breadcrumbs
- **Claude-friendly**: Crash reports are text-based, easy to analyze in future sessions

**Setup:**
```bash
npx expo install @react-native-firebase/app @react-native-firebase/crashlytics
```

Crashes and non-fatal errors logged to Firebase Console → Crashlytics dashboard.

### 4. App Name

**Decision:** "Nomad Karaoke - find your perfect karaoke songs"

- Store listing title: "Nomad Karaoke"
- Subtitle/tagline: "find your perfect karaoke songs"
- This matches the Decide product positioning

### 5. Minimum OS Versions

**Decision:** Start with iOS 15+ / Android 10+, raise if needed.

- iOS 15+: ~95% of active devices (reasonable)
- Android 10+: ~85% of active devices (reasonable)

If we hit significant technical challenges from supporting older versions, acceptable to raise to:
- iOS 17+ (~80% of devices)
- Android 12+ (~70% of devices)

---

## Next Steps

1. Create Expo project with TypeScript template
2. Set up Expo Router navigation structure
3. Implement API client with types
4. Build authentication flow (magic link)
5. Create first screen (Discover/Home)

Ready to begin implementation when approved.
