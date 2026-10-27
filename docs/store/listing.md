# Store listing copy (English, draft for Andrew)

Phase 6 spec §9. Nothing here is submitted. Once Andrew approves the English, the other 32 locales go
through the i18n pipeline (a follow-up, not blocking).

The copy only describes features that exist on main as of 2026-10-25. **Before submitting, re-check it
against what has shipped by then**: Phase 4 (Me: playlists, the browsable collection) is not mentioned
yet, and neither is the guided voice session (3d), which is admin-only until it's tuned.

Character counts were checked with `python3 len()` (Apple and Google count characters, not bytes).

## Shared fields

| Field | Value | Notes |
|---|---|---|
| App name (both stores) | Nomad Karaoke (13) | The home-screen name is "Karaoke" (`CFBundleDisplayName` in `app.json`). Apple allows the two to differ. |
| Category | Music (primary). Apple secondary: Entertainment | Play: Music & Audio |
| Support URL | https://nomadkaraoke.com/en/ | The public site has no contact or support page. The footer and the About section (`/#about`) both link to `mailto:andrew@nomadkaraoke.com`, and the app's own support link is `support@nomadkaraoke.com` (`src/account/deleteAccount.ts`). **Suggest:** add a small `/support` page to public-website (the email address, "Missing credits?", how to delete your account), then use it here. Check that `support@` actually delivers (Cloudflare Email Routing). |
| Marketing URL (Apple) / Website (Play) | https://nomadkaraoke.com | |
| Privacy policy URL | https://nomadkaraoke.com/en/privacy/ | `/privacy` 302s here (checked 2026-10-25). The app's sign-in screen links `https://nomadkaraoke.com/privacy`, which works through the redirect. Update the policy first (see `privacy-policy-additions.md`). |
| Account deletion URL (Play data safety; also in the privacy policy) | https://gen.nomadkaraoke.com/en/account/delete/ | Route `frontend/app/[locale]/account/delete/page.tsx` in karaoke-gen. Live and 200 (the no-slash form 308s to it). It **shows a 404 state until `ACCOUNT_DELETION_ENABLED` is on in prod**, so turn the flag on before submitting the Play data safety form. |
| Support email (Play, required) | support@nomadkaraoke.com | Or andrew@nomadkaraoke.com if `support@` doesn't route. |
| Copyright (Apple) | 2026 Nomad Karaoke LLC | |

## App Store (iOS)

**Name** (max 30): `Nomad Karaoke` (13)

**Subtitle** (max 30): `Find songs. Make karaoke.` (25)

Alternatives: `What to sing, and how to sing` (29), `Karaoke picks, videos and more` (30).

**Promotional text** (max 170; can be changed without a new build):

> Not sure what to sing? Get picks from the music you already love. Can't find a karaoke version? Make one on your phone and hand the YouTube link to the KJ.

(155)

**Keywords** (max 100, comma-separated, no spaces after the commas, and no words already in the name or subtitle):

```
singing,songs,lyrics,KJ,vocal range,sing along,duets,nightlife,bar,YouTube,instrumental,KaraFun
```

(95). Apple ignores words already in the name and subtitle, so "karaoke" isn't repeated. No "setlist" until Phase 4 ships playlists. "KaraFun" is another company's trademark, and Apple can reject trademarked keywords (Guideline 2.3.7): if in doubt, end with `party` instead (`singing,songs,lyrics,KJ,vocal range,sing along,duets,nightlife,bar,YouTube,instrumental,party`, 93).

**Description** (max 4000):

```
Nomad Karaoke helps you pick the right song, make the karaoke version if there isn't one, and keep track of how each one went.

WHAT SHOULD I SING?
Connect the music you already listen to and get karaoke picks you actually know. You can link Spotify, Apple Music, Last.fm or ListenBrainz, paste a playlist link, or add a few screenshots of your music app. No music data? A short quiz gets you started.
Sing a scale into the mic and the app works out your vocal range, then marks which songs sit well for your voice. The vocal range test runs on your phone.
Filter by genre, decade, energy and more, or show only songs on KaraFun or with a community karaoke version, so you can match the bar you're at.

THERE'S NO KARAOKE VERSION
Search for the song and make one. The app finds good audio, separates the vocals, and syncs the lyrics. When a video needs a quick check, you can fix the lyrics and choose the backing track right on your phone. We'll send a notification when it's ready.
Then hand the YouTube link to the KJ and sing it the same night, or save the video to your phone.
1 credit = 1 karaoke video. Credits work in the app and on nomadkaraoke.com, with the same account.

AT ANY KARAOKE NIGHT
Tell the app you're out at karaoke and keep a log of what you requested and what you sang. After each song you can answer a quick, optional survey: how it felt to sing, whether the key suited you, and whether the crowd loved it. The log works offline and syncs later.

AT A NOMAD KARAOKE NIGHT
Scan the host's QR code to join the night. Request songs, see the queue, and get a notification when you're up next and when it's your turn. Sing a duet, request a song for a friend, tip the host, or make a song on the spot if it isn't in the library yet. Every song you sing is saved to your karaoke log.

YOUR ACCOUNT
Sign in with email, Google or Apple. It's the same account as nomadkaraoke.com. You choose which notifications you get, and you can delete your account from Me in the app at any time.

Nomad Karaoke is made by a small karaoke business in Columbia, South Carolina. Questions or ideas? Email support@nomadkaraoke.com.
```

(2,133 characters)

**What's New** (first version): `First release of the Nomad Karaoke app.`

## Google Play

**Title** (max 30): `Nomad Karaoke` (13)

Google discourages keyword stuffing in the title. If Andrew wants one, `Nomad Karaoke: Song Picks` (25).

**Short description** (max 80):

> Karaoke picks from your music, and make the karaoke version if there isn't one.

(79)

Alternative: `Find songs to sing, make karaoke videos, and log your karaoke nights.` (69)

**Full description** (max 4000): same text as the App Store description above. Play allows no HTML here, so the plain-text headings are fine as they are.

## Claims checked against the code

| Claim | Where it lives |
|---|---|
| Spotify, Apple Music, Last.fm, ListenBrainz, playlist link, screenshots | `src/discover/connect/*` (ConnectHub, ScreenshotImport, ListenBrainzConnect, AppleExportGuide); decide `services.py` |
| Quiz | `src/discover/quiz` |
| Vocal range test on the phone | `src/voice/useMicPitchSource.ts` (pitch is computed on the device; only the notes go to decide) |
| KaraFun / community library filter | `discover.libraryKarafun`, `discover.libraryCommunity` in en.json |
| Native lyrics review and backing track choice | `src/review/*` |
| Push notifications for ready, review, problems, up next, your turn | `src/notifications/*`, `settings.notifications` copy |
| Save the video to the phone | `src/jobs/downloadMp4.ts` (expo-media-library, write-only) |
| Karaoke log and survey, offline-first | `src/tonight/log/*` (logStore, outbox, SurveySheet) |
| Nomad night: QR scan, requests, queue, duets, friend, tips, make on the spot | `src/tonight/{ScanScreen,JoinScreen}.tsx`, `src/tonight/manage/*`, `src/tonight/make/TonightMake.tsx` |
| Email, Google, Apple sign-in; shared account | `src/auth/social.ts`, `signIn` copy ("Same account as nomadkaraoke.com") |
| Delete account in the app | `src/app/me/delete-account.tsx` (behind `ACCOUNT_DELETION_ENABLED`) |

Not claimed, on purpose:

- "Your first video is free." The sign-in sheet says it, but the welcome credit goes through gen's abuse check (`credit_evaluation_service.py`) and can be refused. A store claim that doesn't always hold is a review risk.
- Prices or "save X%". The IAP and web prices match (spec §2).
