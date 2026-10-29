# Nomad Karaoke app: vision and roadmap

Agreed with Andrew on 2026-10-17. This document is the reference for scoping every phase. Each phase spec in `docs/superpowers/specs/` should name the phase it delivers and stay within it.

## The goal

One Nomad Karaoke app that brings every Nomad Karaoke project into a single experience, and makes each one quick and easy to use on a phone. It is an alternative, mobile-friendly UI on the same backends and the same account as the websites. Credits bought on the web or in the app work in both places.

In Andrew's words:

> the end goal is for there to be a single Nomad Karaoke mobile app which combines all the capabilities of all of the Nomad Karaoke projects into a single user experience, and makes them all really easy and quick to use on a mobile device.

## Release bar

**The app is not published until it has a first usable version of all four use cases.** Until then we build in phases and merge each one to main. Andrew tests each phase on his own Android phone, sideloading a locally built APK over USB with `adb`. That needs no store accounts.

Build order therefore follows dependencies and risk, not launch strategy.

## Use cases

The use cases overlap: one person can be any of them on a given night.

1. **"What should I sing?" at any karaoke night, anywhere.** Connect your music data, measure your vocal range, and get personal song recommendations. This is karaoke-decide.
2. **"There's no karaoke version" at any night that plays from YouTube.** Make one with karaoke-gen in the app, including a really easy, mobile-friendly lyrics and instrumental review. Hand the YouTube link to the KJ and sing it the same night. This should drive credit sales. App stores take a cut (up to 30%; the exact fees per platform and region get confirmed in phase 6); if that becomes a problem, emails from the system can include a link and discount code to buy credits on the website instead.
3. **At Andrew's own nights.** Frictionlessly request songs into the rotation, including making a song on the spot. sing.nomadkaraoke.com (kjbox) does this on the web today, with only a free-text name, and it stays that way. The app is the richer, signed-in option for patrons who install it (see "Why an app" below).
4. **Karaoke nerds.** Everything above, plus a history of what they've sung, a personal library of songs they enjoy singing, better data-driven recommendations, suggestions for songs to get made, and later perhaps a subscription that pre-generates tracks for them.

## Why an app (Andrew, 2026-10-21)

The web apps keep working; the app adds three things:

1. **Customer acquisition.** Visibility in the app stores brings in people who discover Nomad Karaoke there, and a solid mobile experience converts some of them into paying karaoke-gen customers.
2. **A better karaoke experience over time, at any bar.** A persistent profile of the songs you know, the songs you've sung at karaoke and how each one went, which powers much richer recommendations. This needs data stored server-side, so **the app requires sign-in.**
3. **A richer experience at Andrew's own nights** for patrons who install it. Everything the name-only web singer UI does, plus every song they sing saved to their profile automatically, more reliable push notifications, and a home-screen icon to open whenever they're at a Nomad night instead of re-scanning the QR code.

> i want sing.nomadkaraoke.com to continue to exist as a way for singers who come to my live events using my own kjbox tech to enter and manage their songs in the rotation easily without needing to log in (they only have to enter a free text name).

## Principles

- **All native.** Every screen is built natively and designed for phones, including the kjbox singer flow and gen's lyrics and instrumental review. The web apps are reference designs. A web view is allowed only as a temporary bridge while its native screen is being built, and is removed in the phase that replaces it.
- **One account, and the app requires it.** The gen user is the identity of record across gen, decide and kjbox ([Phase 0 spec §4](superpowers/specs/2026-10-14-mobile-phase0-design.md)). Credits are shared with the web. The app is signed-in; the kjbox singer web page stays name-only, and any discovery features added to that web page later are gated behind sign-in too.
- **Singers only.** The app is for singers. KJs, Andrew included, keep running nights from the kjbox KJ dashboard. Other venues are supported through use case 2: the singer hands over a YouTube link.
- **Offline where possible.** Every feature states what it does offline and what it gives up. Search works offline from an opt-in saved list of karaoke songs, with library tags. Tonight's karaoke log (songs and survey answers) is recorded on the phone first and synced to decide when there's a connection (Phase 5). Making a track, the Gemini fallback, songs with no karaoke version, and brand-new uploads need a connection.
- **Same endpoints as the web.** The app calls the same backend endpoints as the web apps, and both are tested against the same local stacks (gen's lives at `karaoke-gen/scripts/local-stack.sh`).
- **No accounts or spend without asking.** Apple, Google Play, Expo/EAS, RevenueCat, Sentry and PostHog accounts wait for Andrew's go-ahead in phase 6.

## Navigation

Four tabs, organised around what the singer is doing:

| Tab | Contents |
|---|---|
| **Discover** | Search, personal recommendations, filters (use case 1) |
| **Tonight** | Adapts to where you are. At a Nomad night: your requests, the queue, your turn, everything the web singer page does. At any other bar: a personal log of what you requested and sang tonight, with the post-song survey. |
| **Make** | Your videos, job progress, review tasks (use case 2) |
| **Me** | Sung history, playlists and library, vocal range, connected music services, credits, account (use case 4) |

Every song page offers the same actions: add to a setlist, request tonight (at a Nomad night) or add to tonight (anywhere else), make it, mark as sung.

### Tonight at a Nomad night

- Scanning Andrew's QR code or kjbox.cc link opens the app straight into that night (a deep link, plus an in-app scanner and code entry; without the app the link opens the web page as today). Opening the app from the home screen during a night you've joined goes straight back to it.
- The app is signed in, so the singer only confirms the name the host will call (prefilled from their profile). The web page keeps working with just a name.
- Everything the web singer page does works in the app: search, versions, request, your songs, the queue and your turn, change, cancel, reorder, song for a friend, duets, make a song on the spot (with the same gen account), photo consent, texts when you're up, tips.
- Every song an app singer performs is saved to their karaoke log automatically (at the time it started, not when the host ticked Done), followed by the post-song survey.
- **Claiming from the web:** a singer using the name-only web page can sign in there later that night ("Save tonight's songs to your Nomad account"). That links their web identity for the night to their account, and the songs they sang (and go on to sing) land in their profile as if they'd used the app. When discovery features come to the web page, they use the same sign-in.

### Tonight at any other bar

In Andrew's words, a user at a random karaoke bar uses Tonight "just to record what song(s) they've requested and sung tonight, and optionally answer the post-song survey for any sung song". The value:

> 1) opt-in data collection to let the user see what songs they usually sing at karaoke, record what they do/don't enjoy so they can browse their own personal karaoke song collection easily if they do just want to sing something they've sung before for a given mood/event/headspace etc. 2) leverage that data to give the user truly useful karaoke song recommendations, to help power users get great recs from the app whenever they go to karaoke, whether they're at a nomad night or not

- "I'm at karaoke tonight", with an optional venue name. Add songs from search (with the library filter for KaraFun or community-only bars) as maybe, requested or sung.
- A YouTube link to hand the KJ appears where one exists: your own gen-made video, or a community version.
- Works offline; syncs later.

### The post-song survey

After any sung song, at a Nomad night or elsewhere, optional and never blocking: **how was it to sing** (great / OK / not for me), **key** (too low / about right / too high), **crowd-pleaser?**, and **free-text notes**. Notes are stored as written; LLM-powered semantic tagging of them, to sharpen recommendations, comes later (Gemini via the AI Studio key only, never AI spend in the nomadkaraoke GCP project).

## What's in the release

**Discover (use case 1)**
- Connect music services: Spotify, Last.fm and YouTube Music (decide supports these today), plus Apple Music (new).
- Personal recommendations from listening history, with decide's quiz for people with no data.
- Vocal range detection (sing a scale into the mic) and a "singable" filter.
- A guided voice session at home (about 30 minutes, 5–10 songs): the app picks songs you know from an analysed pool, plays a good community karaoke version, optionally records you, asks a short quiz after each song (how it felt, where it sat, warm-up, posture, key), and chooses the next song until it can give you a confident voice type and a list of songs that suit it. Users with rich listening history can have their own songs analysed overnight. Tuned with Andrew as the first test user before it opens to everyone (3d spec).
- Rich filters and sorting: genre, mood, energy, decade, popularity, voice gender, duration, and a karaoke-classic flag.
- **A library filter:** show or recommend only songs available in KaraFun or another commercial karaoke catalogue, for nights that use those libraries, or only songs with a community karaoke release. Phase 3 researches which commercial libraries publish an authoritative song list, starting with KaraFun, Karaoke Cloud and Singa, and supports only those that are easy to source. Phase 1b lays the data model (library tags on the offline song list).

**Make (use case 2)**
- Make a karaoke video from search; the best audio source is picked automatically.
- Native lyrics and instrumental review.
- Pay with credits: in-app purchase, plus the US web link.
- Watch the result and share its YouTube link.
- Push notifications when a video is ready or needs review.

**Me (use case 4)**
- Your karaoke collection: everything you've sung (from Tonight's log, at Nomad nights and elsewhere) with your survey answers, browsable by mood, how it went and how often you sing it.
- Multiple playlists or setlists, plus a "my songs" library.
- "Get this made" suggestions: songs you'd love that have no karaoke version, one tap to make them.
- Crowd singability data, collected from post-song ratings from day one (for example, "72% of singers with your range found this comfortable").

**Tonight (use case 3, plus a karaoke log at any bar)**
- The Nomad night flow described above, at parity with the web singer page.
- The karaoke log at any other bar, with the library filter and YouTube links where they exist.
- The post-song survey, and claiming a web night's songs.

Phase specs refine these. decide's own [VISION.md](https://github.com/nomadkaraoke/karaoke-decide/blob/main/docs/VISION.md) has more detail on the discovery modes and the staged vocal-range plan.

## Roadmap to release

| Phase | Use case | What it delivers | New backend work |
|---|---|---|---|
| **0. Foundation** ✅ | n/a | Workspace, generated API clients, 33-locale i18n, UI wrappers, CI, Maestro (PR #3) | n/a |
| **1. Make it** ✅ | 2 | Real sign-in (email code + Google; Apple built, switched on in phase 6) → search → make (best audio picked automatically) → pay with the web link through gen's fake checkout → job progress → watch and YouTube link. A job that needs review opens gen's web review as a temporary bridge. | gen `handoff-token` endpoint plus a local-stack scenario |
| **1b. Search parity** (built; prod check pending, ✅ after it) | 1, 2 | Song search as good as the websites': decide's search service (the single song-search backend), a TS matcher shared with it, an opt-in offline song list, "Did you mean" and Gemini fallback, versions and a pick screen, and the make flow's match judge | karaoke-decide search service (decide #160); gen decide-partner secret and fake judge knobs (gen #1190) |
| **2. Native review** (built, prod check pending) | 2 | Lyrics and instrumental review designed for phones; replaces the bridge. Gen web's mobile review should follow [REVIEW-UX.md](REVIEW-UX.md) and share `@nomad/review-core`. | gen local-stack review knobs (gen #1202 v0.279.5); no new prod endpoints |
| **3. Discover** (3a, 3b, 3c and 3d built; 3d tuning before opening to all) | 1 | 3a (built): quiz, personalised recommendations, filters including the library filter, Me's music profile, offline last picks. 3b (built): Connect your music hub: screenshot, playlist links, Spotify export parsed on the phone, Apple Music, ListenBrainz (OAuth, upload, daily poll), Last.fm, Android share intake. 3c (built): mic test (low, high, free sing; on-device pitch) or self-report, voice type, profile synced to decide, fit badges, the Singable filter and the song page's range tier, on decide's song vocal range data (UltraStar, note data, Gemini batch). 3d (built, admin-only until tuned): guided voice session (song pool + analysis, recordings, adaptive quiz, personal pools) | decide accepts gen session tokens directly (3a spec §4), a decide main-API local stack (:8030), recommendations v2; Apple Music for 3b |
| **4. Me** (built: 4a 2026-10-26, 4b smarter picks 2026-10-28, 4c claim past Nomad nights 2026-10-29) | 4 | The browsable karaoke collection on Tonight's log, crowd singability data from the surveys, playlists and library, "get this made" | decide playlist APIs (some exist); aggregates over `karaoke_log` |
| **5. Tonight** | 3 (+ any bar) | Nomad nights natively (deep link + scanner, signed in, web parity, make on the spot, automatic karaoke log), the karaoke log at other bars, the post-song survey, web claim. Spec: [2026-10-21-mobile-phase5-tonight-design.md](superpowers/specs/2026-10-21-mobile-phase5-tonight-design.md) | kjbox singer API v1 + history outbox + web claim + local stack; decide `karaoke_log` API |
| **6. Release readiness** ✅ (built 2026-10-29; store submission waits for the Apple org conversion and Andrew's manual pass) | all | In-app purchases (RevenueCat), push notifications, account deletion, Sentry and PostHog, store listings and privacy labels, test builds (TestFlight and Google Play internal testing), switching on Sign in with Apple (built in phase 1; needs a team-signed iOS build), a real Android release signing key (plus its Google OAuth SHA-1) | RevenueCat webhook, Expo push tokens, `DELETE /api/users/me` |

Push notifications are in the release, but Expo's push service needs an EAS project ID, so they arrive in phase 6 with the account decisions. Until then, job progress is polled.

Tonight could move ahead of Discover if Andrew wants to try it at his own nights sooner.

## After release

These are wanted, not dropped. Each has a backlog entry.

- LLM semantic tagging of post-song survey notes, feeding recommendations
- Discovery features on the kjbox singer web page, behind sign-in
- Auto-generated setlists (duration, group size, moods)
- Subscription tier (for example, 1 free generated video a week, or pre-generating tracks a user is likely to want)
- Commissioning or tipping community creators for a human-made, high-quality version
- Friends and karaoke crews: find songs your whole group knows
- Group setlists with synced turns ("Up next: James singing Starlight by Muse")
- Community playlists ("pop punk bangers", "just got dumped")
- A bar songbook filter: only songs available at the bar you're at (needs a venue and songbook database, and user submissions)
- Sending a setlist to a venue's system or a YouTube queue
- A YouTube "best version" picker (community first) and auto-play of a setlist, for YouTube-based or home karaoke
- An Android TV / Apple TV app
- Mic-based scoring and a competition mode
- "KK Slider" mode for April Fools' Day

## Sources

- Andrew's brainstorm answers, 2026-10-17 (this document), and the Phase 5 brainstorm, 2026-10-21 ("Why an app", Tonight, the survey).
- [KaraokeHunt app spec and roadmap](https://docs.google.com/document/d/19LS1aJI8YwSmkWmDdpCHpmTGiHL9l0VDJ1SxSl4l6Z8) (2023), the feature pool for use cases 1 and 4. Its tech choices (Flutter, Golang) are superseded by the stack decision (`docs/archive/2026-10-14-mobile-app-stack-research.md` in the nomadkaraoke workspace root, not this repo).
- [Phase 0 design spec](superpowers/specs/2026-10-14-mobile-phase0-design.md): MVP flow, foundation, shared auth and payments.
