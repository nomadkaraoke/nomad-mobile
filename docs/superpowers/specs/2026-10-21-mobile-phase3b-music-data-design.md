# Phase 3b "Discover: your music data"

**Phase:** VISION.md Phase 3 "Discover", second sub-phase (after [3a](2026-10-21-mobile-phase3a-discover-core-design.md), before [3c](2026-10-21-mobile-phase3c-vocal-range-design.md)). Repos: karaoke-decide, nomad-mobile. Learnings: [survey](2026-10-21-mobile-phase3-discover-survey.md) §3, §11.

## 1. Intent

Recommendations get much better with real listening data, but Spotify's API is closed to us: an app in development mode is capped at 5 allowlisted users, and extended quota needs a business with ≥ 250k MAU (survey §3). Andrew's pivot (2026-10-21):

> i think we should pivot to importing users' song listening history via ListenBrainz, as they already have a working import mechanism for historic and ongoing music listening data from various sources including Spotify's extended streaming history export … we should make it as easy as possible for Nomad Karaoke users to register for ListenBrainz … and guide them to do the spotify export and import into listenbrainz, perhaps set up a process to poll for fresh data landing in listenbrainz, remind the user after <x> days and guide them again etc.
> perhaps we could get creative about ways to get _some_ user data quickly/easily in the interim too though, eg asking the user to share a few of their favourite playlists … (I'm open to grey area approaches too if viable …) we could even ask the user to screenshot the home screen in their music listening app … pass it through gemini flash to extract the artists …

So 3b offers, from quickest to richest:
1. **Quick starts (seconds):** a screenshot of your music app (Gemini Flash reads artists and songs), or a public playlist link (Spotify, YouTube Music).
2. **Your Spotify history (days):** request Spotify's data export, get reminded when it should have arrived, share the zip into the app. We read it on the phone straight away and (when the user has ListenBrainz connected) also hand it to ListenBrainz.
3. **Ongoing listening (ListenBrainz):** connect a ListenBrainz account (we guide sign-up), connect Spotify or Last.fm to it, and decide polls for new listens.
4. **Last.fm username** (decide already supports it).

## 2. Goals, non-goals, anti-goals

**Goals**
1. A "Connect your music" hub (Discover's "Improve your picks" card and Me → Your music profile → Connected) listing the options above with honest "what you'll get / how long it takes" lines.
2. Screenshot import: pick one or more screenshots → decide extracts artists/songs with Gemini Flash → the user confirms the list → saved as `user_artists`/`user_songs` with source `screenshot`.
3. Playlist link import: Spotify public playlist (best-effort via the public embed page, ≤ 100 tracks, grey area) and YouTube Music (existing decide import).
4. Spotify export: guided request (deep link to spotify.com/account/privacy, which export to tick and why), a local reminder notification after 5 days (Account data) and again at 25 days (Extended history), share-sheet / document-picker import of the zip, parsed **on the phone**, aggregated listening sent to decide (`source = spotify_export`).
5. ListenBrainz: username connect (exists) and, once MetaBrainz OAuth credentials exist, a one-tap "Sign in with ListenBrainz" that also lets decide upload the user's Spotify zip to ListenBrainz on their behalf. Guided sign-up and guided "connect Spotify to ListenBrainz" for ongoing listens.
6. decide polls ListenBrainz daily for each connected user's new listens and folds them into the profile; recommendations refresh.
7. Last.fm sync fixes: retries resume from the checkpoint instead of exiting.
8. Every import shows progress and a result ("Added 214 artists and 1,932 songs you know").

**Non-goals**
- Spotify Web API connect on mobile (the 5-user cap). decide web keeps its existing Spotify button for Andrew and testers only; it is hidden on mobile.
- librespot or any client impersonation (ToS violation and account-ban risk for users; survey §11).
- Apple MusicKit library access: needs a MusicKit key in Andrew's Apple Developer account (VISION: no accounts without asking). 3b ships the Apple **privacy export** route instead (play-activity CSV from privacy.apple.com, parsed on the phone). MusicKit becomes a backlog item for Andrew's go.
- Push notifications (Phase 6): reminders use **local** scheduled notifications (`expo-notifications`, no EAS project needed).

**Anti-goals**
- Uploading a user's whole export to our servers when an aggregate will do.
- A connection that silently stops working (expired tokens, dead polls) with no "reconnect" prompt.
- Any flow that makes the user copy-paste tokens.

## 3. Constraints
- Gemini via the AI Studio key only (Secret Manager `gemini-api-key`), never Vertex. decide's main API has no Gemini key mounted today (decide's resolve forwards to gen): mount `GEMINI_API_KEY=gemini-api-key:latest` in `ci.yml`'s `--set-secrets` and grant the runtime service account `secretAccessor` on that secret in Pulumi (Andrew applies; the screenshot card stays hidden while the key is absent) (memory `project_no_ai_spend_in_gcp_project`). Screenshot import cost: Flash, ~1–2k tokens per image ⇒ fractions of a cent; rate-limit to 10 images/user/day.
- ListenBrainz rate limit ~30 requests per window per token/IP; poll politely (one call per user per day, back off on 429).
- MetaBrainz OAuth needs an app registered at metabrainz.org/profile/applications by Andrew (an account). Until then, build and test against a fake MetaBrainz in the local stack, and ship with the OAuth button hidden (`LISTENBRAINZ_OAUTH_ENABLED=false`). Andrew to-do list in §8.
- Spotify export zips can be large (extended history: tens of MB of JSON). Parse streaming on the phone (`fflate` unzip + incremental JSON parse per file) on a background-friendly schedule; never load the whole archive into memory at once.

## 4. Backend (decide)

### 4.1 Imports API
- `POST /api/services/screenshot/extract` (multipart images ≤ 5, ≤ 4 MB each) → `{candidates: [{kind: artist|song, artist, title?, confidence}]}`. Gemini Flash prompt asks for artists and songs visible on a music app screen, JSON only; results are matched to `catalog.db` artists/songs (normalized keys) and unmatched artists still accepted (they help similarity via MB mirror later). Nothing is saved until confirm.
- `POST /api/services/screenshot/confirm` `{items}` → saves.
- `POST /api/services/spotify-playlist/import {url}` → fetches `open.spotify.com/embed/playlist/{id}` server-side, parses `trackList` (title, artist), ≤ 100 tracks, saves `user_songs` source `spotify_playlist`. Same limits/cooldowns as the YouTube Music import; stable error codes (400 bad URL, 404 not found/private, 422 unparseable, 429, 503). Marked best-effort in code and docs; a daily canary on one known public playlist alerts to #noise when the embed format changes (not #alerts: nothing is broken for users beyond this feature).
- `POST /api/services/spotify-export` `{kind: account|extended, generated_at, tracks: [{artist, title, ms_played, plays, first_ts, last_ts}], liked: [{artist, title}], playlists: [{name, tracks:[…]}]}` (aggregated on the phone; ≤ 20k tracks per request, chunked) → `user_songs` (play counts drive the same weights as Last.fm plays), `user_artists` (aggregated), playlist tracks as known songs. Idempotent per (user, kind, generated_at).
- `POST /api/services/apple-export` (same shape, from Apple's play-activity CSV).
- `GET /api/services` gains per-source summaries (`artists`, `songs`, `last_import_at`, `status: ok|needs_reconnect|importing`).

### 4.2 ListenBrainz
- Username connect (exists): validates the user exists; stores it.
- OAuth (behind the flag): `GET /api/services/listenbrainz/oauth/start?return_to=app|web` → MetaBrainz authorize URL (scopes `profile listenbrainz:submit-listens`, PKCE, state doc like Spotify's `oauth_states`); `GET /api/services/listenbrainz/oauth/callback` swaps the code with the client secret, stores access + refresh tokens (encrypted at rest with a KMS-free app key from Secret Manager, `decide-token-key`; Claude's call — also used for the existing Spotify tokens going forward), then 302s to `nomadkaraoke://services/listenbrainz?status=…` (app) or the web page. The https callback lives on decide's domain; same bounce pattern as gen's checkout (`return_to` is a Literal, never a URL).
- `POST /api/services/listenbrainz/upload-export` (multipart zip, only when OAuth-connected): forwards the user's Spotify zip to `POST https://api.listenbrainz.org/1/import-listens/` with their token, stores the import id, and the poller tracks its status. The app offers this as a checkbox after a successful on-phone import of an extended-history zip ("Also add it to ListenBrainz so new listens keep flowing").
- **Poller:** Cloud Scheduler → `POST /internal/listenbrainz/poll` (OIDC-verified, fixing `verify_cloud_tasks_request`'s header-only check) once a day; for each connected user (batched, ≤ 25 req/min), `GET /1/user/{u}/listens?min_ts=<last_ts>&count=1000` until caught up, folding listens into `user_songs` play counts and `user_artists`; also checks pending import ids. Users with no new listens for 30 days get `status: stale` and the app shows a nudge ("Connect Spotify to ListenBrainz so new listens arrive").
- Guided sign-up: the app opens `https://listenbrainz.org/login/` in the in-app browser with a short checklist (create MetaBrainz account → verify email → come back). If MetaBrainz later grants `registration-requests`, decide can create the account in-app (backlog).

### 4.3 Sync fixes
- Last.fm: a retried Cloud Task resumes from the saved checkpoint instead of exiting on `in_progress` (survey §3); heartbeat timeout → resumable, not failed.
- Spotify (web only): handle `invalid_grant` → `needs_reconnect`; URL-encode the authorize URL; error redirects carry codes, not exception text.

## 5. Mobile

### 5.1 "Connect your music" hub (`/discover/connect`)
Cards, each with a one-line "what you get · how long":
- **Screenshot your music app** · "artists in seconds" → image picker (multi) → progress → confirm list (checkboxes, all on) → done.
- **Paste a playlist link** · Spotify or YouTube Music → text field (+ clipboard paste button) → import result. YouTube Music "Liked songs" hint reuses decide's unlisted-playlist guide copy.
- **Your Spotify history** · "your whole listening history · takes Spotify 5–30 days" → a 3-step guide (request at spotify.com/account/privacy: tick Account data now, Extended streaming history too; we'll remind you; when the email arrives, open the zip link, then Share → Nomad Karaoke, or pick the file here) → schedules local reminders → import screen.
- **ListenBrainz** · "keeps your picks fresh as you listen" → username field (or "Sign in with ListenBrainz" when enabled) + "Don't have one? Create a free account" guide + "Connect Spotify to ListenBrainz" guide link.
- **Last.fm** · username.
- **Apple Music** · privacy export guide (privacy.apple.com → request a copy → Apple Media Services information) + file import of the play-activity CSV.
- Connected sources list with status, counts, last import, Disconnect/Remove data.

### 5.2 File intake
- `expo-document-picker` for zips/CSVs; iOS share extension is out of scope (needs an extension target), so iOS uses "Save to Files → pick here"; Android registers an intent filter for `application/zip` shares (Expo config plugin) so Share → Nomad Karaoke opens the import screen.
- Parsing in `packages/core/src/imports/` (pure TS, unit-tested with synthetic fixtures — no real user data, no real lyrics): Spotify Account data (`StreamingHistory_music_*.json`, `YourLibrary.json`, `Playlist*.json`), Extended (`Streaming_History_Audio_*.json`, skip podcasts/audiobooks, skip < 30 s plays), Apple play-activity CSV. Aggregate per (artist, title).

### 5.3 Reminders
`expo-notifications` local notifications scheduled at request time (+5 days, +25 days); permission asked only when the user taps "Remind me". Tapping opens the import screen.

### 5.4 Offline
All of 5.x needs a connection except parsing; a picked file is parsed offline and the upload waits for a connection (queued, shown as "Waiting for connection").

## 6. Tests
- decide unit: screenshot extract (Gemini mocked), playlist embed parser (fixture HTML), export ingestion idempotency, LB OAuth flow (fake MetaBrainz), poller (fake LB: pagination, 429 back-off, stale), Last.fm resume.
- decide local stack: fake LB + fake MetaBrainz + fake Gemini (deterministic) + fake Spotify embed, toggled by `DECIDE_FAKE_EXTERNALS=1`.
- mobile jest: parsers (synthetic zips built in-test), hub and every import screen.
- Maestro (iOS + Android): `connect-1-screenshot` (pick a bundled fixture image → confirm → profile counts), `connect-2-playlist`, `connect-3-spotify-export` (pick a bundled synthetic zip → imported counts → recommendations change), `connect-4-listenbrainz-username`, `connect-5-lastfm`. Media pickers in Maestro: push fixtures with `xcrun simctl addmedia` / `adb push` beforehand.
- Screenshot UX review; release APK `~/Downloads/nomad-karaoke-phase3b-release.apk`.

## 7. Claude's calls
- Spotify export parsed on the phone, only aggregates uploaded.
- Spotify public playlist via the embed page (grey area, best-effort, canary to #noise).
- Apple privacy export instead of MusicKit for now.
- Local notifications for reminders.
- Service tokens encrypted at rest with a Secret-Manager key (needs the secret created: Andrew to-do, or created by CI Pulumi if the session has rights).
- ListenBrainz OAuth shipped dark behind a flag until Andrew registers the MetaBrainz app.

## 8. Andrew to-dos (not blocking the ship)
1. Register a MetaBrainz OAuth application (callback `https://decide.nomadkaraoke.com/api/services/listenbrainz/oauth/callback`), put client id/secret in Secret Manager (`metabrainz-client-id`, `metabrainz-client-secret`), flip `LISTENBRAINZ_OAUTH_ENABLED`.
2. Optionally ask MetaBrainz for `registration-requests` and `listenbrainz:connect-services` (in-app sign-up and in-app "connect Spotify to ListenBrainz").
3. Decide on Apple MusicKit (key in the Apple Developer account).

## 9. As built (2026-10-23)

Rulings made during execution (plan, "Execution amendments"), where the build differs from the sections above:

- **A1 Apple Music:** MusicKit connect shipped first (decide #172–176, mobile #12/#15). The privacy export stays as a "No Apple Music subscription?" link on the Apple card. §2's non-goal and §8 item 3 are superseded.
- **A2 ListenBrainz OAuth is live,** not dark. Andrew registered the MetaBrainz app. The button still hides itself if a secret is missing. Uploading the Spotify zip to ListenBrainz works end to end.
- **A3 Shared `user_songs` rows with Tonight:** imports merge into the row `{user_id}:{kn_id}`, else `loved_doc_id`, additively, using the same rule as the karaoke log.
- **A4 New sources** (`screenshot`, `spotify_playlist`, `spotify_export`, `apple_export`) are added to every source enumeration (models, recs v2, web badge, disconnect allowlist).
- **A5 Versions:** decide shipped as v0.21 to v0.26 (one minor per PR), not 0.15.x.
- **A6 Four decide PRs:** #177, #179, #182, #183 (Parts A to D), one per part.
- **A7 Ports:** the 3b stack runs decide on :8031 and search on :8022 (macOS launchd holds :8021), Metro :8083.
- **A8 The ListenBrainz poller is a Cloud Run Job,** not a request on the API service, like `mb-refresh` and `lb-refresh`.
- **A9 Capacity:** decide returned 0 s 500s during an Apple sync, which led to Task 27.
- **A10 Names:** test API router `test_support.py`, Maestro helper `maestro/scripts/stack.js`.
- **A11 `decide-token-key`** was created by hand (Fernet), not declared in Pulumi. CI mounts it unconditionally.
- **Spotify playlist embed:** at most 50 tracks (the plan said 100 at first), best-effort, canary posts to #noise.
- **Upload of screenshots and the LB export** sends expo-file-system `File`s: SDK 57's fetch rejects React Native `{uri}` parts.
- **The Connect hub got a back button** (found by connect-1…5).
- **Android share intake** accepts only other apps' `content://` URIs and caps the copy at 256 MiB.
- **Not yet done:** the screen tour (ar, en), the release APK and its prod check run after the PR merges. Open asks to MetaBrainz and the iOS share extension are tracked in BACKLOG.md.

