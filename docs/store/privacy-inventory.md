# Data inventory: Apple privacy labels and Google Play data safety (draft)

Phase 6 spec §9. Each row was checked against the code on 2026-10-25: the app (`apps/mobile/src`, this
branch), karaoke-gen (`karaoke-gen-phase6-release`), karaoke-decide (`karaoke-decide-phase6-deletion`,
v0.29.0) and kjbox (`kjbox-phase6-push-deletion`). Recheck before submitting if any of those change how
data is collected.

## Summary answers

- **Tracking (Apple):** none. No advertising SDK, no IDFA, no data broker, and no linking our data with
  other companies' data for ads. **No App Tracking Transparency prompt.** All three SDKs are configured
  without PII: Sentry's user is `app_user_id` only with `sendDefaultPii: false`; PostHog is never
  identified, and session replay and lifecycle autocapture are off (`src/observability.ts`); RevenueCat
  gets `app_user_id` only.
- **Data sold or shared (Play):** nothing is shared in Play's sense. Every third party below is a service
  provider processing data for us, which Play excludes from "shared". Data a user sends on purpose (their
  name on the night's queue, a YouTube link they hand to a KJ) also counts as user-initiated, not shared.
- **Encrypted in transit (Play):** yes. Every backend is HTTPS: gen `api.nomadkaraoke.com`, decide, the
  search service, and kjbox through the Cloudflare tunnel (`sing.nomadkaraoke.com`, `kjbox.cc`). Only the
  local stacks use cleartext, and only debug builds.
- **Users can request deletion (Play):** yes, in the app (Me → Account and notifications → Delete account)
  and on the web at https://gen.nomadkaraoke.com/en/account/delete/ (spec §6). This needs
  `ACCOUNT_DELETION_ENABLED` on in prod before the form is submitted.
- **Location:** **not collected.** There is no `expo-location`, no `navigator.geolocation` and no
  location permission in `app.json`. `expo-localization` reads the device's language and region
  settings, which is not location. The night is chosen by QR code or code entry, not by position. The
  venue name a user may type at another bar is free text (listed under the karaoke log).
- **Contacts, calendar, health, browsing history, messages:** not collected (no such modules).

## The inventory

Apple legend: **L** = linked to the user, **NL** = not linked. Nothing is used for tracking, so that
column is left out. Play purposes: AF app functionality, AN analytics, PZ personalisation,
AM account management, FP fraud prevention / security. "Optional" means the user can use the app
without providing it.

| # | Data (what, where) | Apple category | Apple: purposes, linked | Play data type | Play: collected? purposes, optional? | Kept until | Deletion |
|---|---|---|---|---|---|---|---|
| 1 | **Email address.** Sign-in (email code, Google, Apple); gen `gen_users` (the document id), decide `decide_users` (keyed by sha256 of the email), kjbox `sing_gen_accounts.gen_email` | Contact Info → Email Address | AF; **L** | Personal info → Email address | Yes. AF, AM. **Required** (the app needs sign-in) | The account is deleted | Account deletion. gen keeps only `sha256(email)` in `deleted_users`, so a repeat signup doesn't get a second welcome credit. |
| 2 | **Name.** Apple or Google profile name and the "Singing as" name (gen `display_name`; kjbox `singer_accounts`, rotation rows). Friend and duet names typed at a night. | Contact Info → Name | AF; **L** | Personal info → Name | Yes. AF. Optional (a night name is needed only to join a night) | The account is deleted. A past night's rotation (the name as called) stays as that night's record, with its account link removed. | Account deletion (gen anonymises; kjbox removes accounts, aliases and links) |
| 3 | **User ID.** gen's opaque `app_user_id` (UUID4), sent to RevenueCat and Sentry. The session token. | Identifiers → User ID | AF, AN (crash grouping); **L** | Personal info → User IDs | Yes. AF, AN. Required | The account is deleted | Account deletion: the RevenueCat subscriber is deleted, and the gen mapping goes with the user |
| 4 | **Device ID.** A random install id (`src/device/deviceId.ts`, MMKV, reset on uninstall), sent as `X-Device-Id` to decide's search service for rate limits and search logs, and as `device_id` with push tokens. **Expo push tokens** (gen `expo_push_tokens`, kjbox `sing_push_subscriptions`). | Identifiers → Device ID | AF; **L** (push tokens sit on the account; search's device id is not tied to the account, but it's simpler to declare it once as linked) | Device or other IDs | Yes. AF. Push is optional | Push tokens: until sign-out, deletion or `DeviceNotRegistered`. Search logs: Cloud Logging retention (30 days by default). | Sign-out unregisters push; account deletion removes the tokens |
| 5 | **Phone number** for "Text me when I'm up" (kjbox `PhoneSheet`, sent through **Telnyx** SMS, `kj-controller/sms.py`) | Contact Info → Phone Number | AF; **L** | Personal info → Phone number | Yes. AF. **Optional** | Until the singer removes it or deletes the account | Account deletion (kjbox pull, spec §6.3) |
| 6 | **Purchases.** IAP transactions (RevenueCat → gen `store_payments`, `credit_transactions`) and web checkout (Stripe → `stripe_payments`). Card details go to Apple, Google or Stripe, never to us. | Purchases → Purchase History | AF; **L** | Financial info → Purchase history | Yes. AF. Optional (only when buying) | **Kept after deletion** for accounting, anonymised (spec §2) | Records kept, email removed. Declare "some data may be kept for legal and accounting reasons". |
| 7 | **Listening history and imported music data.** Apple Music library and recent plays (the MusicKit user token is stored encrypted), Last.fm username, ListenBrainz OAuth or username, playlist links (Spotify embed, YouTube Music), screenshot-derived artists and songs, a Spotify or Apple export file parsed on the phone (only per-song aggregates are uploaded), quiz answers, Love / Not for me (decide `user_songs`, `user_artists`, `music_services`, `lastfm_users`, `user_imports*`, `quiz_progress`, `user_hidden_songs`) | Other Data → Other Data Types ("music listening history and preferences") | AF, PZ; **L** | App activity → Other actions (Play has no music category; describe it as "music listening history" in the form) | Yes. AF, PZ. **Optional** | The user disconnects or deletes it, or deletes the account | Account deletion (decide `USER_DATA_STORES` registry) |
| 8 | **Voice recordings (3d).** Recorded only with the session's opt-in (`setup.record`), AAC/WAV in the private bucket `nomadkaraoke-voice-recordings`, **no expiry**. Andrew (admin) can listen to them for tuning; the consent copy says "Only you and our team can access it". | User Content → Audio Data | AF, PZ; **L** | Audio → Voice or sound recordings | Yes. AF, PZ. **Optional** (off unless chosen per session) | Until "Delete my recordings" (Me) or account deletion. Bucket soft delete is off, so deletion is real erasure. | Me → Delete my recordings; account deletion |
| 9 | **Pitch and vocal range data.** The mic test computes pitch on the phone; only the range summary, voice type and held notes go to decide (`/api/my/voice`, `voice_sessions`, `voice_attempts`, `voice_labels`). | Other Data → Other Data Types ("vocal range"). This isn't health data. | AF, PZ; **L** | App activity → Other actions (or "Other user-generated content") | Yes. AF, PZ. **Optional** | Until removed (Me → Remove my voice) or account deletion | Account deletion (`erase_voice_data`) |
| 10 | **Karaoke log, survey answers and notes.** Songs requested or sung, venue name (free text), how it went, key, crowd-pleaser, free-text notes (decide `karaoke_log`, offline outbox on the phone). Nomad night requests, consent answers and tip claims on the box. | User Content → Other User Content | AF, PZ; **L** | App activity → Other user-generated content | Yes. AF, PZ. **Optional** | Until deleted or account deletion. Crowd-pleaser and survey answers also feed an anonymous per-song tally (decide `song_crowd_stats`, counts only, no user link), which stays after deletion. | Account deletion (the anonymous per-song tally is kept) |
| 11 | **Photo and clip consent** at Nomad nights, plus an optional **Instagram handle** for tagging (kjbox `singer_photo_consent`, `song_media_consent`, append-only `photo_consent_events`) | User Content → Other User Content | AF; **L** | Personal info → Other info | Yes. AF. **Optional** | Consent rows: the account is deleted. The events log keeps its rows (it's the consent record) but loses the device link (spec §6.3). | Account deletion (link removed) |
| 12 | **Photos (screenshots)** picked for screenshot import. Sent to decide, passed to **Google Gemini** (AI Studio key), and **not stored**: `screenshot_import_service.py` reads the bytes, keeps only the extracted artist and title candidates, and writes nothing but a per-day counter. | User Content → Photos or Videos. Arguably not "collected" under Apple's real-time exception, but declare it to be safe. | AF; **L** | Photos and videos → Photos | Yes, **"processed ephemerally" = Yes**. AF. **Optional** | Not kept (only the songs the user confirms are saved, under row 7) | n/a |
| 13 | **Search history.** Search text and picks, logged by decide's search service with the device id and an in-memory `sid`. Text with no catalog match may go to Gemini (resolve fallback through gen). | Search History | AF, AN; **NL** (device id only, no account) | App activity → In-app search history | Yes. AF, AN. Required for search | Log retention (about 30 days) | Not tied to the account; expires |
| 14 | **Jobs (Make).** Artist and title, chosen audio source, lyrics edits, the job's notification email. **Published videos** go to Nomad Karaoke's YouTube channel. | User Content → Other User Content | AF; **L** | App activity → Other user-generated content | Yes. AF. Optional (only when making) | Job records are kept after deletion, anonymised. Inputs (uploads, `jobs/{id}/input/**`) are deleted. **Outputs and YouTube videos are kept** (spec §2). | Account deletion removes personal data and inputs only |
| 15 | **Crash data** (Sentry: stack traces, breadcrumbs, device model, OS, app version), user = `app_user_id` | Diagnostics → Crash Data (and Performance Data, since tracing samples 10%) | AN, AF; **L** (opaque id) | App info and performance → Crash logs, Diagnostics | Yes. AN. **Required** (the SDK isn't opt-in). Play: declare it as collected. | Sentry plan retention (check the org's plan) | `Sentry.setUser(null)` on deletion. Past events age out. |
| 16 | **Usage data** (PostHog: the fixed list of 11 events in `APP_EVENTS`, props limited to ids and enums, anonymous id reset on sign-out and deletion) | Usage Data → Product Interaction | AN; **NL** | App activity → App interactions | Yes. AN. Required (no opt-out in the app today) | PostHog plan retention | Not linked; `posthog.reset()` |
| 17 | **IP address** (gen stores `signup_ip` on new accounts for abuse checks; every server sees request IPs) | Not a label category on its own. Declare nothing extra unless it's used for location. | n/a | Play has no IP type. Google's guidance: declare Approximate location only if location is derived from it. | Used only for FP (welcome-credit abuse). No location is derived. | The account is deleted | Account deletion |
| 18 | **Camera** (QR scan of the night code) | Not collected (frames are decoded on the device and never sent) | n/a | Not collected | No | n/a | n/a |
| 19 | **Saved videos** (MP4 written to Photos, write-only; `READ_MEDIA_*` blocked on Android) | Not collected | n/a | Not collected | No | n/a | n/a |

Rows 8, 9, 12 and the mic: **the iOS and Android microphone permission text says "Audio stays on your
phone."** (`app.json` `expo-audio.microphonePermission`, and en.json `permissions.microphone`,
`voice.introPrivacy`, `voice.micDeniedBody`). That holds for the vocal range test. It **isn't true for
the 3d voice session**, which uploads opt-in recordings. Before 3d opens to everyone, change the
permission string to something like "...to measure your vocal range. Recordings are only saved if you
choose to keep them." Apple checks purpose strings against behaviour (5.1.1).

## Third parties that receive user data

| Service | What it gets | Role | Already in the privacy policy? |
|---|---|---|---|
| Google Cloud (Firestore, GCS, Cloud Run, Logging) | Everything above that's stored | Hosting | Yes ("Google Cloud") |
| **Google Gemini API** (AI Studio, paid key) | Screenshot images (row 12); search text with no match; artist and title for the make-flow match judge; at signup, the **email, signup IP and device fingerprint** for gen's welcome-credit abuse check (`credit_evaluation_service.py`); lyrics for translation when a user asks for it | Processor (AI) | **No** |
| Sentry | Crash data, `app_user_id` | Processor | **No** |
| PostHog (US cloud) | Anonymous events, plus the IP and device info its SDK sends | Processor | No (the policy names Google Analytics) |
| RevenueCat | `app_user_id`, store receipts, storefront country, device and OS | Processor (IAP) | **No** |
| Apple App Store and Google Play billing | Purchases (they are the merchant of record) | Store | No |
| Stripe | Web checkout: email, payment | Processor | Yes |
| Expo Push Service, then APNs and FCM | Push tokens and notification text (which can include a song title) | Processor | **No** |
| Telnyx | Phone number and the "you're up next" text (name, song) | Processor (SMS) | **No** |
| Postmark (SMTP fallback) | Email address, sign-in codes, job emails | Processor | **No** |
| Dropbox | Delivered job files, with the customer's share link revoked on deletion | Processor | No |
| YouTube (Google) | Published karaoke videos (song content, not user data). The voice session plays community videos in an embedded YouTube player (youtube.com receives the viewer's IP and the usual player data). | Publisher / embed | No |
| Apple MusicKit, Last.fm, ListenBrainz | Only what the user connects. We read from them; nothing is sent to them except the auth the user grants. | The user's own services | No |
| NomadPC (kjbox box, a PC at Andrew's home, not cloud) | Night data from rows 2, 4, 5, 10 and 11 | Own hardware | No |

## Settings to change in the vendor dashboards (no code)

- **PostHog:** Project settings → "Discard client IP data" **on**. Otherwise PostHog stores the IP and
  adds GeoIP (city-level) properties to every event, which would make "Coarse location" a fair
  question for both labels.
- **Sentry:** Project → Security & Privacy → "Prevent storing of IP addresses" **on**, and turn on data
  scrubbing (both cost nothing). `sendDefaultPii: false` already stops the SDK from attaching it.
- **RevenueCat:** no customer attributes are set (`$email`, `$displayName`); keep it that way.

## Third-party AI: Apple Guideline 5.1.2(i) (action needed before submitting)

Apple's current 5.1.2(i) (read 2026-10-25 at https://developer.apple.com/app-store/review/guidelines/):
"You must clearly disclose where personal data will be shared with third parties, including with
third-party AI, and obtain explicit permission before doing so."

Today the app sends personal data to Google Gemini in two places **without an in-app disclosure or
explicit permission**:

1. **Screenshot import** (row 12). The intro says "We'll read the names and you check them before
   anything is saved". It doesn't say that an AI provider reads the images. **Fix (app):** add a line to
   `connect.screenshot.intro`, e.g. "Your screenshots are sent to Google's Gemini AI to read the names,
   and aren't kept.", plus a one-time "OK, continue" consent before the first upload (stored per account).
2. **gen's welcome-credit check** (`credit_evaluation_service.py`). At signup, the prompt includes the
   **email, signup IP and device fingerprint** of the new user and of matching accounts. **Fix (gen),
   preferred:** send Gemini pseudonymised signals instead (counts, "same IP as N accounts", hashed ids).
   Gemini doesn't need the raw email or IP to decide, and then no personal data reaches the AI. The
   alternative is a disclosure plus consent at sign-up, which is awkward. Either way, add Gemini to the
   privacy policy (see `privacy-policy-additions.md`).

Song search text (the resolve fallback), the make-flow match judge (artist and title) and lyrics
translation send no personal data, so a privacy policy mention is enough for those.
