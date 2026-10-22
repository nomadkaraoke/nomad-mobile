# Nomad Karaoke mobile app: "Tonight" design (Phase 5)

*2026-10-21. Backlog Frog 4.5. Read [docs/VISION.md](../../VISION.md) first. This spec delivers VISION Phase 5 "Tonight" (use case 3 at Andrew's own nights, plus a personal karaoke log at any other bar). It was agreed with Andrew in a brainstorm on 2026-10-21; decisions that aren't quoted from him are marked* (call) *where they matter. Appendix A lists every learning from the kjbox singer web UI's history that this phase must carry over; section references like "A.27" point into it.*

## 1. Intent

### 1.1 What the app is for (Andrew, 2026-10-21)

sing.nomadkaraoke.com (the kjbox singer web UI) **stays** as the way anyone at Andrew's nights enters and manages songs with nothing but a free-text name:

> i want sing.nomadkaraoke.com to continue to exist as a way for singers who come to my live events using my own kjbox tech to enter and manage their songs in the rotation easily without needing to log in (they only have to enter a free text name).

The app is the richer, **signed-in** option. Its advantages, in his words:

> 1) nomad karaoke customer acquisition: visibility in the app stores, capturing more users who discover through those stores & hopefully converting some to become paying customers for karaoke-gen by delivering a solid mobile-friendly experience
>
> 2) helping users have a better karaoke experience over time regardless of whether they're at my own karaoke nights or they go out to any random karaoke bar, by building up a profile of songs they know, songs they've sung at karaoke, what their experience was like with those sung songs, etc. to give them much richer recommendations for songs to sing. this inevitably requires a login so we can store the user data server side, so the mobile app will require login.
>
> 3) giving patrons of my own karaoke nights who choose to install the mobile app an even richer experience than they already get using the name-only web ui; by installing the mobile app and logging in, they should be able to do everything they can already do through the singer web ui, but any song they sing will be stored against their persistent server-side user profile so they get the above discovery benefits (number 2) and some other technical benefits such as more reliable push notifications, a persistent app icon to place on their home screen and launch whenever they're at my karaoke night rather than needing to re-scan the QR code, etc.

At any other bar:

> a user at a random karaoke bar would use the Tonight feature just to record what song(s) they've requested and sung tonight, and optionally answer the post-song survey for any sung song to collect data about whether it was good to sing, too high/low, crowd pleaser or not, any free text notes they wanna write (which could also then be processed server side using some kinda llm-powered semantic auto tagging or something …). in general the key value for a user at a non-nomad karaoke night is: 1) opt-in data collection to let the user see what songs they usually sing at karaoke, record what they do/don't enjoy so they can browse their own personal karaoke song collection easily if they do just want to sing something they've sung before for a given mood/event/headspace etc. 2) leverage that data to give the user truly useful karaoke song recommendations

Claiming songs sung on the web:

> that's assuming someone who uses the kjbox singer web UI who then chooses to use the discover feature in that kjbox web ui, which will require sign-in and can then link their kjbox web singer profile for the night to their logged-in account

And: "once we add discovery features to the kjbox singer web ui, it'll make sense for those to be gated behind logging in too."

### 1.2 What this changes from the original brief and VISION

- **The app requires sign-in** (the whole app, as already agreed with Phase 3). "Singing needs only a name" now describes the web page only. In the app, Tonight always knows the singer's gen account.
- **"Claim later"** means a web singer who signs in on the web page links that night's web identity to their account (§5.6). There is no signed-out mode in the app to claim from.
- **"Tonight's setlist with YouTube links" at other bars** becomes a personal karaoke log for tonight (§6), with a light *planned* state and YouTube links only where one exists.
- **Sung history and the post-song survey** are recorded in this phase (server-side in decide, §7). Phase 4 "Me" builds the browsable collection, playlists and "get this made" on top of the same data.

### 1.3 The person and the moments

**At a Nomad night** (signed-in app user):
1. Scans the QR on the screen, or taps the home-screen icon, and is in tonight's night in one step. The first time, they confirm the name the host will call (prefilled from their profile).
2. Searches, confirms the version, requests. Sees the song in "Your songs" with its place in the queue and a wait estimate.
3. Watches the rotation, gets a clear "you're up in 3" warning while the app is open, reorders/changes/cancels their own songs, requests for a friend, adds a duet partner.
4. Can't find a song: makes it on the spot with their own gen account (free show credit), and it joins the rotation as "Being made"; they can review it natively in Make if gen asks.
5. After singing, a short survey slides up. The song is in their history whether or not they answer it.

**At any other bar** (signed-in app user):
1. "I'm at karaoke tonight" → optional venue name.
2. Adds songs they plan to sing or have requested (search, with Discover's library filter for KaraFun / community bars), marks one sung, answers the optional survey.
3. Next week, Me and Discover know what they sing and how it went.

**On the web, at a Nomad night** (no app): nothing changes, except an optional "Save tonight's songs to your Nomad account" entry point (§5.6).

### 1.4 What success looks like

- From the QR (Android, app installed) or the home-screen icon to tonight's Nomad night screen in under 3 s on a warm API; first-time name confirm is one tap.
- Everything a singer can do on sing.nomadkaraoke.com they can do in the app (parity list, §4.1), with the hard-won behaviours of Appendix A intact.
- Every song an app singer (or a claimed web singer) performs at a Nomad night appears in their decide karaoke log within a minute of the host marking it Done, with the time it **started** (A.96), exactly once, even across a mid-show kjbox deploy.
- A night at another bar can be logged fully offline and syncs when the phone reconnects.
- Nothing about the web singer flow gets worse.

## 2. Goals, non-goals, anti-goals

**Goals**
1. **kjbox singer API v1** for the app: stable, versioned JSON endpoints under `/api/v1/` on sing.nomadkaraoke.com, authenticated with the user's gen session token, with server-side ownership (no edit tokens on the phone), committed OpenAPI contract + contract tests (§5).
2. **kjbox → decide history**: an outbox on the box that writes every performed song of a linked singer to decide (§5.5); web sign-in links a web device to an account (§5.6).
3. **decide karaoke log API**: per-user song log with states, survey and idempotent upserts, plus a partner endpoint for kjbox; updates `user_songs.times_sung` / `last_sung_at` (§7).
4. **App: Tonight tab** with two modes, Nomad night (§4) and Other bar (§6), plus the post-song survey (§6.3) shared by both.
5. **Getting in**: in-app QR scanner and code entry (both platforms), Android App Links for `kjbox.cc` and `sing.nomadkaraoke.com`, the `nomadkaraoke://tonight` scheme; iOS universal links built but switched off until the team-signed build of Phase 6 (§4.2).
6. **kjbox local stack** for Maestro, built on the existing `dev_server.py`, with a test API and fixtures derived from the 2026-09-24 night recording (§8.1).
7. **Tests**: kjbox unit + integration + contract tests; decide tests; mobile component tests for every Tonight screen; Maestro on iOS and Android against the gen, decide and kjbox local stacks; a screenshot UX review (§8).
8. **VISION.md** updated with the decisions in §1 (done with this spec).

**Non-goals** *(calls unless quoted)*
- **Changing the web singer UI** beyond the claim entry point (§5.6) and whatever server changes it shares with v1. Discovery features on the web (which will be gated behind sign-in, per Andrew) are a later item.
- **Remote push notifications.** Expo push needs an EAS project id (Phase 6, Andrew's account decision). This phase: in-app polling plus an in-app "you're up soon" banner and haptic while the app is open; kjbox stores Expo push tokens and can dispatch to Expo once the app registers them (§5.4), so Phase 6 only adds the app-side registration.
- **The browsable collection, playlists, "get this made", crowd singability aggregates**: Phase 4, on this phase's data.
- **LLM auto-tagging of survey notes.** Notes are stored verbatim; tagging is a recorded follow-up (VISION "After release" + backlog). Constraint for it: Gemini via the AI Studio key only, never Vertex or any AI spend in the `nomadkaraoke` GCP project (memory `project_no_ai_spend_in_gcp_project`).
- **KJ tools.** Singers only; the KJ dashboard is untouched.
- **iOS universal links in a shipped build** (needs the team-signed build, Phase 6).
- **CD+G preview playback in the app** (web keeps it; the app shows "Preview on the web" for CD+G-only versions) *(call)*.

**Anti-goals (fail even if everything else works)**
- **Breaking or slowing the web singer flow**, or any mid-show regression on the live box. Every kjbox change keeps the existing `/sing/*` endpoints byte-compatible.
- **Impersonation.** An app user must never see or move another singer's songs; identity comes from the verified gen account, never from a name the client sends (A.2, A.5).
- **Double-logging or wrong-time logging** of a sung song (one decide record per singer per rotation entry; sung time = start, A.96, A.97).
- **A gen session token stored on the box or logged.** kjbox forwards it per request and keeps only a hash in a short-lived cache.
- **Losing a request to a flaky connection** (client idempotency keys; the app retries safely).
- **Treating the event token as "tonight"** (A.89): every read is night-scoped.

## 3. Constraints

- **Coordination (shared nomad-mobile files).** Phase 3 Discover (session nomadkaraoke-5a, branch `feat/sess-20261021-1515-phase3-discover`) merges first. Tonight code lives in `apps/mobile/src/tonight/`, `apps/mobile/src/app/tonight/`, `packages/api-kjbox/`, and the existing `(tabs)/tonight.tsx`. Shared files this phase touches: `packages/i18n/messages/*`, `apps/mobile/src/app/_layout.tsx` (Tonight stack routes), `app.config.ts` / `app.json` (intent filters, camera permission), `apps/mobile/src/app/song/[id].tsx` (one "Add to tonight / Request tonight" action), `apps/mobile/src/app/+native-intent.tsx`, `scripts/e2e-local.sh`, `maestro/scripts/stack.js`, `package.json` / lock (`expo-camera`). Rebase onto main after Discover merges, re-run `pnpm i18n:translate`, and message nomadkaraoke-5a and the orchestrator nomadkaraoke-12 before merging.
- **Library filter** comes from Phase 3a, not rebuilt: `packages/core/src/library/index.ts` (`LibraryFilter = 'any' | 'community' | 'karafun'`, `matchesLibrary`, `songLibraries`, `LIBRARY_FILTERS`) and `apps/mobile/src/find/library/` (`useLibraryFilter`, `LibraryFilterPicker` with testIDs `library-filter-<value>`, `LibraryBadge`).
- **decide auth** comes from Phase 3a §4.1: decide accepts gen session tokens (bearer without dots) and resolves the profile `decide_users/{sha256(email)}`. It is already merged (decide #164); this phase's decide endpoints build on it.
- **kjbox production safety.** Merging to kjbox main deploys to the live box within ~60 s (auto-deploy). Deploying mid-show is safe for playback but drops in-memory state (rate-limit deques, caches), so all new state that matters lives in SQLite (memory `project_kjbox_autodeploy_paused_live_shows`). pytest does not run in kjbox CI: run it locally before every merge.
- **Same endpoints as the web where they exist.** v1 handlers reuse the same store/manager functions the `/sing/*` handlers call (refactor shared logic into functions both call), so behaviour can't drift.
- **Infra.** Cloudflare changes go through the `nomad-cloudflare` Pulumi stack (karaoke-gen `infrastructure/cloudflare/`, local apply). GCP is read-only for Claude: the new decide partner secret needs Andrew's `/gcp-admin`; code must degrade (kjbox outbox holds records) until it exists. Record every API/dashboard change in the relevant infra doc.
- **No accounts or spend** (VISION). Nothing here needs a new account.
- **i18n**: 33 locales in the app; singer-facing copy says "host", not "KJ"; whole sentences with placeholders; no idioms (A.109). The host's free-text message is shown as typed (A.90).

## 4. App: Tonight at a Nomad night

### 4.1 Parity with the web singer UI

The app must cover every singer capability of sing.nomadkaraoke.com (kjbox `docs/FUNCTIONALITY-MAP.md` lists them). Each row names the v1 endpoint (§5.3) and the Appendix A learnings it must honour.

| Capability | App behaviour | Learnings |
|---|---|---|
| Join tonight | QR / link / code → night screen; first time: "The host will call you…" name confirm, prefilled (first name from gen profile, else email local part) | A.87–A.90 |
| Closed / not open | Clear "Tonight's night hasn't started / is closed" state with the host's message; retry | A.37 |
| Search | Debounced (700 ms web; app may use 300 ms with a generation guard), latest-response-wins, results grouped by song with versions, ranking from the server, joined-word queries, "not open" state | A.17, A.20, A.28, A.34–A.36 |
| Ignore taps on a list that just changed | 300 ms arm delay, but a tap during it is queued, not swallowed *(call: the web's silent swallow, A.18, is a known flaw)* | A.18 |
| Versions | Community/Commercial pills + explainer, brand name and blurb, format pill → tech sheet, availability tier copy, "Auto-select best version" default, single-version songs get the full row | A.20–A.23 |
| Preview | ▶ audio/video preview for local, divebar, YouTube and entry sources (expo-video/expo-audio on the existing preview stream/HLS); CD+G → "Preview on the web" | A.21, A.43 |
| Auto-correct / did-you-mean | Only on empty results; "✓ Corrected to X — you typed …, Undo"; ambiguous → chips; "Checking the spelling…" | A.29, A.33 |
| No karaoke version | "No karaoke version yet · Make it now" card on a confident identification; sticky "Not seeing your song? Make it" bar when not confident; near-misses capped at 3 + "Show N more"; offers logged by placement | A.31–A.33 |
| Confirm | Mandatory, hardened: title/artist dominate, source line, "you searched" breadcrumb (hidden for make), "Yes, send" / "Pick a different song" | A.19 |
| Request | Idempotent (client key); a 400 refunds the rate-limit slot server-side; specific error copy per code | A.24–A.27 |
| kj_pick | Send all versions; server trims to best 50 | A.24 |
| Duet partners | Up to 3, picked from tonight's singers (filterable A–Z list, "+ Add 'X' as a new singer"), canonicalised server-side | A.1, A.4, A.113 |
| Song for a friend | Its own flow and banner ("Picking a song for X · Cancel — it's for me"); friend cards labelled "For X"; excluded from rename/consent/"your next song" | A.10–A.14 |
| Your songs | Ordered by queue position; status tile "Your next song" with real song name, wait "1h 28m", urgent green at ≤3 away; host-added and partner-added songs included ("Added by the host" / "Added by X"); sung songs collapsed "✓ Already sung tonight (N)"; host-removed songs stay with honest copy + Dismiss | A.3, A.44, A.47, A.49–A.54 |
| Make-its in Your songs | Phases making / review / rendering / needs host, with "Review it now" opening the app's native review (`/review/[jobId]`, the job is in the user's own gen account); quick version ▶ Preview + ⚡ "Sing it now" | A.69–A.71, A.75 |
| Cancel | Instant; 15 s "Cancelled: X" notice; not while on stage; 409 already sung → refresh | A.53, A.56 |
| Change song | Keeps the queue slot; visible "Replacing X" banner; cleared when leaving search/confirm; not into a make-it; not once sung | A.39, A.40 |
| Reorder | Explicit ▲/▼ buttons and row numbers (no hidden drag); own songs only; polling paused mid-edit; one request; "✓ New order saved" | A.57, A.58 |
| Rotation | Now on stage / Up next tile, full rotation list with estimates and preview; excludes Cancelled; host rules collapsed on this view | A.44, A.46, A.63, A.115 |
| Freshness | Paint cached state first, refresh in place with same-size skeletons, honest "updated Ns ago" ticking, pull to refresh, poll every 15 s (Your songs) / 30 s (Rotation) while visible, ETag/304 on the rotation revision, merge partial responses (no flicker) | A.44, A.45, A.48, A.62, A.85 |
| Name | Edit name with the rename guard ("Rename yourself to X?" / "X is a friend: request a song for them" / Cancel); spelling fixes and renames with no songs go straight through; never rewrite Done entries | A.6–A.11 |
| Phone / SMS | Optional "Text me when I'm up" with region example; add later; show delivery status, not "sent" | A.80, A.83, A.114 |
| Photo / clip consent | Only when the host asks (`ask_photo_consent`); once per night, optional, never blocks; unknown = no; per-song toggle on own cards; yes→no after singing asks "Just this song / Nothing from tonight"; Instagram handle optional; debounced, skip unchanged | A.91–A.95 |
| Venue info | Host notices, message, socials, "Contact us" (text/call) from event info | A.90 |
| Tips | Tip screen (amount-first deep links: CashApp, Venmo, PayPal, Zelle copy, card), claim → host confirms; status polled | A.64 |
| Sung here before | Your own history comes from the decide log (all bars), plus tonight's crowd favourites from kjbox `my-stats` top songs | A.38 |

### 4.2 Getting into the night

- **In-app scanner** (both platforms, works today): Tonight's empty state offers "Scan the host's QR code" (`expo-camera` barcode scanning) and "Enter the night code". Accepted payloads: `http(s)://kjbox.cc/<code>` (any case, A.87), `https://sing.nomadkaraoke.com/?t=<code>`, `nomadkaraoke://tonight?t=<code>`.
- **Android App Links**: verified intent filters for `kjbox.cc` (http and https; the printed QR is `HTTP://KJBOX.CC/<code>`, uppercase for the alphanumeric QR mode) and `sing.nomadkaraoke.com` (path `/` with `t`). `assetlinks.json` is served by kjbox for `sing.nomadkaraoke.com` (host guard allows `/.well-known/*`) and by Cloudflare for `kjbox.cc` (a redirect-rule exception for `/.well-known/*` plus a tiny Worker route returning the JSON, in the Pulumi stack). It lists the debug keystore SHA-256 now and the release key's in Phase 6. The builder must verify on the emulator that a camera-scanned **uppercase** URL opens the app (Android host matching is case-sensitive); if it doesn't, add the uppercase host to the filter or record the gap and rely on the in-app scanner.
- **iOS universal links**: `associatedDomains` (`applinks:kjbox.cc`, `applinks:sing.nomadkaraoke.com`) behind `EXPO_PUBLIC_ASSOCIATED_DOMAINS=1` (off; same reason as Apple sign-in: needs the team-signed build), and `apple-app-site-association` served alongside `assetlinks.json` with team `55B76HN73D`. Universal links require https, so the uppercase `HTTP://` QR only reaches the app on iOS through the in-app scanner until the QR changes (a Phase 6 decision: switching the printed QR to https costs a larger QR, A.87).
- **Web fallback**: without the app the link just opens the web page, as today. No store badge until there's a listing (Phase 6).
- **No internet at the venue** (Andrew, 2026-10-21: the app needs internet; point to the web): the app reaches the box only through sing.nomadkaraoke.com and checks the account with gen. When it can't reach the box (network error, tunnel down, 503 `gen_unavailable`), Tonight shows "Can't reach tonight's night. Connect to the Nomad KJ Box wifi and use the web page" with a button opening `http://l.kjbox.cc/` in the browser, keeps the last-known Your songs read-only, and retries. No LAN fallback inside the app in this phase.
- **Not signed in** (fresh install via a link): sign-in first (`openSignIn('/tonight/join?t=…')`), then straight into the night.
- **The home-screen icon**: opening the app on a night where the user has joined a still-open Nomad night lands on Tonight's night screen. "Still open" = the box's current night marker equals the one recorded at join (§5.2); otherwise Tonight shows the empty state. A deep link always wins.

### 4.3 Make on the spot

- Same flow as Phase 1's make (search audio → pick → confirm), but submitted through kjbox v1 (`source_type: make`) so the job gets the box's show-credit top-up (A.67), the "Being made" rotation entry pinned to the bottom (A.60, A.69) and the quick version (A.75). kjbox forwards the app's gen token to gen per call; the job lands in the user's own gen account, so the Make tab, native review and the finished video all work as in Phase 1/2.
- Errors map to specific copy (`youtube_blocked`, `gen_rejected`, `already_generating`, `not_open`, `busy_retry`, A.27, A.74). Make is hidden when the box says make is off, in Simple Mode or in change-song mode, showing "Ask the host" (A.78).
- Copy promises an ETA ("usually about 30 minutes; we'll show it here and email you"), not 4 minutes (A.71, A.76).
- The audio pick uses the app's existing ranking (`@nomad/core` audio-search ranking, which mirrors gen's, A.73).

### 4.4 Turn awareness without remote push

While the app is in the foreground: the status tile goes urgent at ≤3 away, plus a one-time haptic and banner at "up next" and "you're on". When the app is backgrounded, nothing fires in this phase *(call; Phase 6 adds remote push through the token registration in §5.4)*. The SMS option (§4.1) covers singers who want a guaranteed nudge tonight.

## 5. kjbox singer API v1

### 5.1 Shape

- Flask blueprint `app_api_bp` mounted at `/sing/api/v1/` (so the public-host rewriter serves it as `https://sing.nomadkaraoke.com/api/v1/...`), allowed by the host guard. JSON only, `Content-Type: application/json`.
- **Versioning**: the path carries the major version. Additive changes only within v1; every response includes `api_version: "1.N"`. A breaking change means `/api/v2/` alongside v1 until the app's minimum supported version moves.
- **Contract**: `kj-controller/docs/api/singer-v1.openapi.json`, hand-maintained, with a pytest contract test that validates every v1 response in the integration suite against it. nomad-mobile vendors it as `openapi/kjbox.json` and generates `packages/api-kjbox` with the same pinned `@hey-api/openapi-ts`, plus facades and zod overrides as needed (mobile CLAUDE.md rule 5 applies: no storage access in the client).
- **Errors**: `{"error": "<code>", "message"?: "<english detail>", "retry_after"?: s}` with the HTTP status. Codes are a closed, documented enum in the contract; the app maps each to translated copy (A.27).
- **Night scoping**: every read and write is scoped to the current night (`night_started_at`), failing closed when unset (A.89). The night id exposed to the app is `night_id = sha256(box_id + night_started_at)[:16]`, where `box_id` is a new config value (default `nomadpc`).

### 5.2 Identity and auth

- `Authorization: Bearer <gen session token>` on every v1 call, plus the event code `t` (query or body), which gates the night exactly as on the web.
- kjbox verifies the token by calling gen `GET /api/users/me` (same `X-Client-Id` as other calls), caching the result in memory by `sha256(token)` for 60 s (positive) / 10 s (negative). Gen 401 → v1 401 `unauthenticated` (the app's gen session check then decides whether to sign out; a kjbox 401 must not sign the user out on its own). Gen unreachable → 503 `gen_unavailable` *(call: fail closed; the web flow is unaffected)*.
- **Singer identity**: `app_device_id = HMAC-SHA256(app_identity_secret, "app:" + gen_user_email_lowercase)[:32]`, with `app_identity_secret` 32 random bytes persisted on the box (so the id cannot be derived from an email and replayed on the web endpoints) (32 hex characters, so every existing `device_id`-keyed mechanism works unchanged: aliases, rate limits, "songs I'm named on", push keys). Two phones signed into one account are one singer.
- **Ownership is server-side**: a v1 mutation on request `id` succeeds only when that request's `device_id` belongs to the caller's account tonight, meaning it is the caller's `app_device_id` **or a web device linked to the same account tonight** in `singer_accounts` (§5.6), and the request belongs to tonight. Andrew, 2026-10-21: someone who starts on the web page and then uses the app (or uses both) manages all their songs in the app once the web page is linked. This is safe because linking a web device requires the gen email-code sign-in on that device. `/me` lists songs from all linked devices; rename, phone and consent changes apply to all of them. No `edit_token` is ever sent to or required from the app. Host-added and partner-added entries naming the singer are reorder-only (A.3). The app cannot see the phone browser's storage, so it doesn't link the web page itself: the web page's "Save tonight's songs" sign-in does (§5.6), and the app's Your songs shows a hint ("Requested songs on the web page too? Open it and tap Save tonight's songs") only when entries naming the singer come from an unlinked device.
- **Account linking table** `singer_accounts(device_id PK, gen_email, linked_at, origin app|web, night_started_at)` records which devices belong to which account: app devices on first v1 call, web devices on claim (§5.6). The history outbox (§5.5) reads it.
- **Name**: `POST /api/v1/join {t, name}` sets the device's alias (`singer_aliases`, origin `self`) for tonight; first join with an unknown alias returns `needs_name: true` with the suggested name.

### 5.3 Endpoints (v1)

All need `t` and the bearer token. Response shapes are the contract's; summaries here.

| Method + path | Purpose (reuses) |
|---|---|
| `GET /night` | `{open, night_id, kj_name, footer_message, notices, social, contact, features{make, simple_mode, ask_photo_consent, quick_version, tips}, rev}` (event-info + flags) |
| `POST /join` | `{name}` → `{me}`; sets alias; records `singer_accounts` |
| `GET /me` | `{me{name, phone?, photo_consent, instagram?}, songs[…], next{entry, position, eta_s, range}, sung_tonight[…]}`; server builds the list from the device's requests plus entries naming the singer (no client id list, A.52); each song carries `history_id` (§7.2) |
| `PUT /me` | rename (rename-guard semantics, A.6–A.9), phone, photo consent, Instagram |
| `GET /search`, `GET /search/identify`, `GET /search/resolve`, `POST /search/event` | the web's search, identify, auto-correct (rate-limited per device) and analytics |
| `GET /singers` | tonight's names for duet partners |
| `POST /requests` | submit; body as the web's `/submit` minus `device_id`/`singer_name` (derived), plus `client_request_id` (UUID, idempotent for 24 h), `for_friend`, `friend_name` |
| `POST /requests/{id}/cancel`, `POST /requests/{id}/change`, `POST /requests/reorder` | as the web, ownership server-side |
| `PUT /requests/{id}/consent` | per-song consent |
| `GET /rotation` | as the web, with `ETag: "<rev>"` / `If-None-Match` → 304 |
| `GET /now` | now on stage / up next |
| `POST /preview/resolve`, `POST /preview/close` | returns an absolute stream/HLS URL on the public host |
| `POST /make/check`, `POST /make/search`, `POST /make/validate-url`, `POST /make/use-quick/{id}` | make-it, forwarding the bearer token to gen per call (no `sing_gen_accounts` row) |
| `GET /tips`, `POST /tips/claim` | tip info and claim |
| `GET /my-stats` | tonight's crowd favourites (top songs) |
| `POST /push-token` | `{expo_push_token, platform}` stored per `app_device_id` (§5.4) |

Rate limits: as the web (per device, with the per-IP ceiling, A.25, A.26), persisted in SQLite for anything that must survive a deploy *(call: the current in-memory deques reset on deploy; acceptable for the web, but v1 idempotency keys must be in SQLite)*.

### 5.4 Push readiness

`sing_push_subscriptions` gains a `kind` (`webpush|expo`) and `expo_token`. The dispatcher sends `expo` subscriptions to the Expo push API (`https://exp.host/--/api/v2/push/send`, free, no account) for the same steps as web push (`up_in_2`, `up_next`, `now_singing`, decisions, `quick_ready`, and a new `sung` step that triggers the survey). The app does not register tokens until Phase 6; this is unit-tested with a mocked Expo endpoint.

### 5.5 History outbox (kjbox → decide)

- When a rotation entry becomes **Done**, kjbox enqueues one `history_outbox` row per **linked singer** on it: the owning device's account (if in `singer_accounts`) and any duet partner whose name maps to a linked device tonight. A song a friend requested for someone is attributed to the named singer only if that singer's device is linked; never to the requester *(call)*.
- Record: `{history_id, gen_email, source:"kjbox", box_id, night_id, night_date, entry_id, artist, title, sung_at, ended_at, singers[], venue:{kind:"nomad", name: kj_name}, media{brand_code?, gen_job_id?, source_type}}`.
- `sung_at` = the entry's play-event `started_at` (A.96); `ended_at` = `done_at`. An entry ticked Done without a play event is sent with `sung_at = null` and `state: "sung_unplayed"` *(call: keep it, flagged, A.97)*.
- `history_id = "kj_" + sha256(box_id + ":" + entry_id + ":" + gen_email)[:24]`; deterministic, so the app can write the survey to the same record before or after the outbox delivers (§7.2), and retries are idempotent.
- Delivery: a background worker POSTs to decide's partner endpoint with `X-Kjbox-Secret`, exponential backoff (cap 30 min), rows survive restarts (SQLite). Undeliverable rows (4xx other than 429) are logged at WARNING, retried daily for 7 days, then surfaced once in the KJ dashboard's health area, not in #alerts *(call; alert rules, CLAUDE.md)*.
- Entries are matched night-scoped (A.15). Brand codes are never used as song identity (A.16): artist/title always travel.
- Undo: if the host moves a Done entry back (un-done), kjbox enqueues a delete for the same `history_id`.

### 5.6 Claim from the web page

- On the web page's "Your songs" and "Sung tonight" views: a small "Save tonight's songs to your Nomad account" link. It reuses the existing make-it email-code sign-in (`/sing/make/send-code`, `/verify-code`, which already stores a per-device gen session). After verifying, kjbox writes `singer_accounts(origin='web')` for the device and enqueues every Done entry tonight that names the device's identity. Copy says what happens ("We'll save the songs you sing tonight to your Nomad Karaoke account"); a "Stop saving" link removes the link for tonight.
- A web singer who signed in only for make-it is **not** linked automatically *(call: explicit consent; the link is offered right after a make-it sign-in with one tap)*.
- Web copy goes through the kjbox web i18n (33 locales, `static-sing/messages`).

### 5.7 kjbox changes outside v1 (kept minimal)

- Shared logic extracted from `sing.py` / `sing_make.py` handlers into functions both `/sing/*` and v1 call (no behaviour change for the web; the web's integration tests must pass untouched).
- Host guard: allow `/api/v1/*` and `/.well-known/*` on the public host.
- `docs/FUNCTIONALITY-MAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/CHANGELOG.md` updated; version bump.

## 6. App: Tonight at any other bar

### 6.1 Model

- A **night** is a local record `{night_id (uuid), kind:"other", venue_name?, started_at, ended_at?}`; a Nomad night is `{kind:"nomad", night_id (from kjbox), box event code, kj_name}`. Only one night is active at a time; an Other night auto-ends 12 h after its last activity *(call)*, or with "End night".
- A **log entry** is the decide karaoke-log record (§7.1) mirrored locally: `planned → requested → sung` (or `skipped`), with the survey.
- **Offline first** (VISION principle): entries live in MMKV and sync to decide through a small outbox (idempotent PUTs by id). The app shows tonight's list from local state; decide is the server of record.

### 6.2 Screens

- **Empty state** (no active night): "At a Nomad Karaoke night? Scan the host's QR code" / "Enter a night code", and "At another karaoke night? Start logging tonight".
- **Other night**: venue name (optional, editable), tonight's songs grouped *Sung* / *Up next (requested)* / *Maybe (planned)*, "Add a song" → the existing search with Discover's `LibraryFilterPicker` above results; on a song: "I've requested it" / "Maybe later" / "I sang it". A requested song can be marked sung with one tap; sung opens the survey.
- **YouTube link**: a song row shows "Copy YouTube link" / "Share with the host" only when a link exists: the user's own gen-made video for that song (Phase 1's job data), else a community version's `youtube_url` from decide search *(call)*.
- **Song page** (`song/[id].tsx`) gains one action that adapts: "Request tonight" during a Nomad night (runs the kjbox v1 search for artist + title and opens the confirm with the best match, or the results if ambiguous), "Add to tonight" during an Other night, hidden otherwise.

### 6.3 Post-song survey (both modes)

- Shown as a bottom sheet when a song becomes sung (Nomad: when `/me` reports it sung while the app is open, or on next open; Other: when marked sung). Also reachable from any sung row ("How did it go?"). Dismissable; never blocks.
- Questions (Andrew's list, which supersedes the older KaraokeHunt "why" list in decide `docs/USER-DATA-VISION.md`; Phase 4 may add those reasons as optional chips): **How was it to sing?** (great / OK / not for me), **Key** (too low / about right / too high), **Crowd-pleaser?** (yes / not really), **Notes** (free text, optional). All optional; saved as answered.
- Saves to decide (`PUT /api/my/karaoke-log/{history_id}` with the survey), through the local outbox.

## 7. decide: karaoke log

### 7.1 Data

Firestore collection `karaoke_log`, doc id = the record id (`kj_…` from kjbox, or a client UUID `app_…` for Other nights):

```
user_id, email_hash, id, source (kjbox|app), state (planned|requested|sung|sung_unplayed|skipped),
artist, title, song_key? (decide search service key, resolved best-effort server-side), song_key_status,
night{id, kind (nomad|other), venue_name?, date}, sung_at?, ended_at?, created_at, updated_at,
survey{feel (great|ok|bad)?, key (too_low|right|too_high)?, crowd_pleaser (bool)?, notes?, answered_at?},
media{brand_code?, gen_job_id?, source_type?}, deleted (bool)
```

**Song identity** (decide CLAUDE.md "Music Data Modeling": store catalog ids, names only as denormalised display fields). Entries the app logs at other bars normally come from search, so they carry decide's `song_key`. But the catalog link must never get in the way of the experience (Andrew, 2026-10-21: "the rigidness of 'There's no free-text entry' may need to soften to protect some aspects of the user experience gracefully even without a decide catalog link, eg. if we find there are things in the kjbox full song library (4tb ssd + youtube downloads on demand) which don't map to any known song in musicbrainz/spotify data"). So **uncatalogued songs are first-class log entries**: they show, count in "what I sing", take the survey and appear in Me like any other, just without catalog-derived features (recommendation signals, facets) until they resolve. At other bars, search stays the main path; when nothing matches, a "Log "<what you typed>" anyway" row (artist + title fields, prefilled from the query) creates an unresolved entry. kjbox records arrive with artist/title strings (rotation entries are names; brand codes are never identity, A.16), so decide resolves `song_key` asynchronously with its search matcher and keeps `song_key_status: resolved|unresolved|ambiguous`; unresolved records still count in the log and are re-tried when the catalog refreshes (and when decide's search index grows). `user_songs` counters below apply to resolved records; unresolved ones are counted per normalised artist + title so nothing a singer sang goes missing from their history.

On transition to `sung`, decide increments `user_songs.times_sung` and sets `last_sung_at` for the resolved song (creating the `user_songs` row with source `karaoke_log` if needed), and decrements on delete. Survey answers are kept per record; Phase 4 builds aggregates.

### 7.2 Endpoints

- `GET /api/my/karaoke-log?since=<iso>&night_id=` (bearer gen token, 3a auth): the user's records, newest first, paginated.
- `PUT /api/my/karaoke-log/{id}`: upsert by id with **field-level merge** (the app's survey and kjbox's facts can arrive in either order; kjbox owns `sung_at/ended_at/state/media`, the user owns `survey`; an app write to a `kj_` id may set only `survey` and `deleted`).
- `DELETE /api/my/karaoke-log/{id}`: soft delete (user removes a mistaken log).
- `PUT /api/partner/kjbox/karaoke-log/{id}` (header `X-Kjbox-Secret`, secret `decide-kjbox-secret` in Secret Manager; Andrew creates it with `/gcp-admin`), body includes `gen_email`; resolves the decide profile by email the same way 3a does (creating it if missing). `DELETE` likewise for un-done.
- `song_key` resolution: decide's search/match on artist + title, best effort, async; never blocks the write.

### 7.3 Tests

Unit + API tests for merge rules, idempotency, the partner secret, `user_songs` counters (including delete), profile creation for an email with no decide profile, and auth via a gen token from the shared local stack.

## 8. Local stacks and tests

### 8.1 kjbox local stack

- `kj-controller/scripts/local-stack.sh up|down|reset` runs the real Flask app (no Caddy, no tunnel, no GTK overlay, no player) on `127.0.0.1:8040` against `~/kjdata-localstack/` with:
  - `gen_api_url = http://127.0.0.1:8010` and the gen local stack's kjbox partner secret, so token verification and make-it go to gen's local stack (fake workers).
  - `decide_api_url = http://127.0.0.1:8030` with a local partner secret, so the outbox reaches decide's local stack.
  - A **fixture night** built by a committed script from the redacted 2026-09-24 recording (`~/nomad-nights/2026-09-24/`, via `night_fixture.py`): real first names, fake phones, the catalog subset those songs need (local, divebar, KN and community rows, including a >50-version song for kj_pick, A.24). The generated fixture is committed under `tests/fixtures/localstack/` only after checking it contains no phone numbers, tokens or emails *(call: first names are OK to publish, per the night-recording record)*. Event code `2121`.
  - A **test API** under `/sing/api/test/*`, mounted only when `KJBOX_TEST_API=1` and never on a non-loopback bind: reset, seed singers/entries, advance the rotation (start next, mark Done, un-done), set flags (make on/off, simple mode, ask photo consent, closed night), host-add an entry for a name, host-remove, set rate-limit knobs, and drain the outbox now.
- Maestro's `stack.js` gains `ACTION: kjbox` for those calls; `scripts/e2e-local.sh` starts the kjbox stack (from `KJBOX_DIR`, default `../kjbox`) after gen and decide, `adb reverse tcp:8040`, and Metro gets `EXPO_PUBLIC_KJBOX_API_URL=http://127.0.0.1:8040/sing` (the box serves the singer API under `/sing`; the bare origin 404s every call) (local-host allowlisted in `config.ts` like the others; prod default `https://sing.nomadkaraoke.com`).

### 8.2 kjbox tests

Unit (identity derivation, ownership checks, night scoping, outbox record building incl. started_at vs done_at, history_id, retries, Expo push payloads); integration (every v1 endpoint against the contract, web endpoints unchanged, claim flow, rate-limit refunds, idempotent requests, ETag/304, real-night edge cases from `docs/TESTING.md`); a **night replay** test that replays the fixture night's singer actions through v1 and checks the final rotation and outbox (the first piece of the replay suite TESTING.md promises).

### 8.3 Mobile tests

- Component tests (jest-expo, RNTL) for every Tonight screen and sheet: empty state, scanner (mocked camera), code entry, name confirm, night home (status tile states), search + results + versions + auto-correct + no-karaoke card, confirm, Your songs (all row kinds and phases), change/cancel/reorder, rename guard, friend flow, duet picker, rotation, consent, phone, tips, make-on-the-spot error states, survey, Other-night screens, offline outbox. `packages/api-kjbox` facades tested against recorded contract responses.
- Maestro (iOS and Android, against gen + decide + kjbox local stacks), `maestro/flows/tonight-*`:
  1. `tonight-1-join-link`: deep link → sign in → name confirm → night screen (Android: App Link; iOS: scheme link).
  2. `tonight-2-scan-code`: code entry and scanner fallback.
  3. `tonight-3-request`: search → versions → confirm → Your songs shows it with position.
  4. `tonight-4-queue-turn`: test API advances the rotation → status tile updates → urgent at ≤3 → "you're on".
  5. `tonight-5-change-cancel-reorder`.
  6. `tonight-6-friend-duet`: song for a friend + duet partner.
  7. `tonight-7-make`: no karaoke version → make → "Being made" → quick version → Sing it now.
  8. `tonight-8-sung-survey`: Done → survey → decide log has one record with started_at.
  9. `tonight-9-edge`: box unreachable → "use the web page on the box wifi" state; host-added song appears, host-removed song honest copy, closed night, 429 copy, kjbox restart mid-flow (stack restart) recovers.
  10. `tonight-10-other-bar`: start a night, add with library filter, mark sung, survey, offline then reconnect syncs.
  11. `tonight-11-rename-guard`.
- Screenshot UX review of every screen (`maestro/screens/tonight-tour.yaml`, `docs/screenshots/phase5/<platform>/`), including Arabic/Hebrew RTL and a long-title locale.
- A release APK for Andrew (not phone-tested per phase; he'll try it at a night when he chooses).

### 8.4 Prod checks (no phone)

After deploys: v1 `GET /night` and `GET /rotation` against sing.nomadkaraoke.com with a real gen token (Claude's own test account); `assetlinks.json` on both hosts (Google's Digital Asset Links API check); the web singer page loads and submits unchanged (Playwright, test name, then cancel); decide partner endpoint reachable once the secret exists; outbox drains (KJ dashboard health or box logs).

## 9. Shipping order

1. **kjbox PR**: v1 API, identity, ownership, outbox (delivery inert until configured), push readiness, claim, host guard, local stack + test API + fixture, tests, docs. Merge when not mid-show (or accept: deploys are safe). Verify on prod (§8.4).
2. **gen local-stack PR** (small, like gen #1190 / #1202): a kjbox partner secret in the local stack's config and fake quick-version output, so the kjbox local stack's make-it and `tonight-7-make` work end to end.
3. **decide PR**: karaoke log + partner endpoint + counters. Infra: `decide-kjbox-secret` (Andrew, `/gcp-admin`); then configure the box (`decide_api_url`, secret) over SSH and record it in kjbox's infra doc.
4. **Cloudflare (Pulumi)**: `kjbox.cc/.well-known/*` exception + Worker route; record in the stack README.
5. **nomad-mobile PR** (after Phase 3 Discover merges): rebase, translate, message nomadkaraoke-5a / nomadkaraoke-12 before merging.

## 10. Decisions and Claude's calls

**Andrew's answers to the builder check (2026-10-21):** the app needs internet at the venue and points to the web page on the box wifi when it can't reach the box (§4.2); songs from a web device linked to the same account are fully manageable in the app (§5.2).

**Claude's calls (for Andrew to check):**

- App identity on kjbox = a device id derived from the gen email; two phones on one account are one singer.
- kjbox verifies gen tokens via gen `/api/users/me` (60 s cache), forwards them per call, never stores them; fails closed (503) if gen is down.
- Web claim needs an explicit tap (signing in for make-it alone doesn't link).
- Sung time = play start; Done-without-play is logged flagged `sung_unplayed`.
- Friend requests are attributed to the named singer only if their own device is linked.
- History lives in decide `karaoke_log`; Phase 4 browses it.
- No remote push this phase; kjbox can send to Expo once the app registers tokens in Phase 6.
- The 300 ms list-arm delay queues taps instead of swallowing them.
- CD+G previews stay on the web.
- Other nights auto-end after 12 h idle.
- YouTube links only where one exists (your gen video, else a community version).
- The committed local-stack fixture keeps real first names from the recorded night.

### 10.1 As built (2026-10-22): recorded deviations

- **No tip-claim status polling yet.** The tips screen sends the claim but doesn't poll its status: that needs kjbox `/me` to report `tip_claims`.
- **Brand blurbs and the format tech sheet are deferred.**
- **The failed-outbox dashboard notice is deferred**: a karaoke-log write decide drops for good is logged on the phone only.
- **Remote push is Phase 6** (with token registration); turn alerts this phase are the in-app banner while the app is open.
- The kjbox source for `pnpm gen:api` is the kjbox main clone's `kj-controller/docs/api/singer-v1.openapi.json` (`KJBOX_OPENAPI_PATH` overrides); `scripts/e2e-local.sh` starts the kjbox stack only for runs with Tonight flows.

## Appendix A. Learnings from the kjbox singer web UI

*(Survey of docs/sessions 2026-Q3/Q4 kjbox singer records and MEMORY.md kjbox entries, 2026-10-21. S = `docs/sessions/`, M = the agent memory directory.)*

Items are numbered globally; "A.27" in the spec body means item 27.

### How the web UI carries singer identity 

- **Event token `t` (gate, not identity).** A 4-digit code (e.g. `2121`) arrives as `?t=` (also accepted in the JSON body or form). `_extract_token()` then falls back to the Flask session cookie `sing_token`. On the LAN host `l.kjbox.cc` the token is implied. The token is never rotated between nights; KJs pin a memorable code. So matching the token never means "tonight". Every read must also check `created_at >= night_started_at`, and fail closed if that marker is unset. (M `project_kjbox_your_songs_tonight_cross_night.md`; code `kj-controller/sing.py` `_extract_token`, `_belongs_to_current_night`)
- **`device_id`.** The client mints it and keeps it in localStorage `sing_device_id`. It must be 32 hex characters, because make-it looks up the singer's stored gen sign-in by it.
  - Every singer POST must send it inline in the body. A static guard test (`tests/unit/test_sing_js_device_id.py`) enforces this.
  - GET endpoints take it as `?device_id=`.
  - It is the rate-limit key, the source of server-side identity (`device_singer_names` plus the alias), and the key for push subscriptions and the stored gen session (`sing_gen_accounts`).
- **Per-request `edit_token`.** `/sing/submit` returns it once. The phone stores ids and tokens in localStorage `sing_my_request_ids` (scoped by event token, plus a `.friends` map). It gates cancel, change, reorder, update-phone, photo-consent, song-consent, `make/review-link` and `make/use-quick`. Links of the form `?r=id:edit_token[,…]` hand full control to another browser; a bare id is read-only.
- **Other localStorage keys:** `sing_name`, `sing_phone`, `sing_photo_consent`, `sing_instagram`, `sing_lang`, `sing_rules_commercial_community_seen`.
- **Server side:** `singer_aliases` maps `device_id` to a canonical name, with `origin` = `kj` or `self`.

### Singer endpoints (all under `/sing/`)

- **Search:** `search`, `search/resolve`, `search/identify`, `search/event`
- **Requests:** `submit`, `validate`, `requests/<id>/cancel`, `requests/<id>/change`, `requests/reorder`, `my-requests`, `status/<id>`
- **Queue and venue info:** `now`, `rotation`, `singers`, `my-stats`, `event-info`, `tip-info`, `tip-claim`
- **Identity and preferences:** `rename`, `forget`, `update-phone`, `photo-consent`, `song-consent`, `push/subscribe`, `push/unsubscribe`
- **Media and preview:** `media-info`, `preview/resolve`, `preview/stream|hls|cdg/<tok>…`, `preview/close`, `lib/<name>`
- **Make-it:** `make/account`, `make/send-code`, `make/verify-code`, `make/sign-out`, `make/check`, `make/search`, `make/validate-url`, `make/review-link/<id>`, `make/use-quick/<id>`
- **Plumbing:** `telnyx/webhook`, `manifest.json`, `sw.js`

### Identity and naming

1. **Singers are display-name strings on `rotation_entries`; there are no accounts.** Duet partners have to be canonicalised at submit with `match_known_singer`: folded exact match, then unique first name, then length-scaled Damerau-Levenshtein. An ambiguous match stops hard. Without this, "Jasmine" and "Jasmine!" become two singers. (S `2026-Q3/2026-09-23-kjbox-singer-ui-overhaul.md`)
2. **"My songs" identity is derived on the server from `device_id`, never from a name the client claims.** The first version trusted `name=`; Andrew rejected it as an impersonation risk. Another phone typing "Ashlee A" sees and can move nothing. (S `2026-09-25-kjbox-kj-added-songs-singer-selfserve.md`)
3. **Songs the KJ typed in, or a partner submitted for a duet, still appear on the singer's phone.** They come back as synthetic items (`id:null`, `source_type:"rotation"`, `entry_id`, `added_by_host`, `added_by`) labelled "Added by the host" / "Added by {name}". They can be reordered only; cancel and change need the `edit_token`. (same)
4. **Duet membership is `singers_json`, or a KJ-typed label split on `&`/`+` only, compared after `_fold_name`.** `/sing/singers` splits labels the same way. (same; S `2026-09-24-kjbox-singer-ui-polish-shell-picker-cancelled.md`)
5. **A singer who has never submitted from their phone tonight has no identity on it.** Fix: submit once under the same name, or the KJ uses **Merge singers**. A "claim this identity" button on the phone was rejected as an impersonation route. (S kj-added-songs)
6. **Merge unifies identity, not just the rows.** `singer_aliases.origin` is `kj` for a KJ merge or rename and `self` for a singer rename. Only `kj` aliases count as a canonical identity. A self-rename widens to a whole-group rename only when the old name is canonical and a night marker exists. (M `project_kjbox_merge_singer_identity.md`)
7. **A self-rename must not rewrite Done entries, or entries that already contain the new name.** Bryan and Roy shared a phone, and Roy's rename turned a sung duet into "Roy O & Roy O", erasing Bryan from the night. Shared phones are common. (S `2026-Q4/2026-10-02-kjbox-self-rename-sung-history.md`)
8. **A self-rename still rewrites queued duets.** That is correct for the same person and wrong if a different person has taken the phone. The switch/forget flow (`POST /sing/forget` drops the device alias) is the right path for a new person. (same; `sing.py forget_me`)
9. **A rename always rewrites the device alias, so a bad rename poisons every future submission from that phone.** Repairs must reset `singer_aliases`, not only the entries. (M `project_kjbox_song_for_friend_rename_guard.md`)
10. **"Song for a friend" is its own flow.** `/sing/submit` takes `for_friend:true`, which skips the alias override and ignores photo consent. The phone records friend ids in `sing_my_request_ids.friends` and labels those cards "For X". This came from the "Nats renamed to Alex" incident: a "(not you?)" link opened the rename form. (S `2026-Q4/2026-10-08-kjbox-singer-song-for-friend-rename-guard.md`)
11. **Rename guard.** If the first name changes while the phone has its own songs queued, ask "Rename yourself to X?". The buttons are, in order: "X is a friend: request a song for them", "Yes, I'm X: rename me", then Cancel. Spelling fixes, and renames with no songs, go straight through. (same)
12. **Friend songs keep the owner's `device_id`.** The owner can cancel or reorder them and gets their notifications. Side effect: the friend's name joins that device's names, so KJ-added songs for the friend can show on that phone (accepted). (same)
13. **Exclude friend requests from rename, update-phone and photo-consent (`_ownRequestItems`).** Known gap: the "Your next song (of N)" tile still counts friend songs as the owner's. (same)
14. **Entry points to the friend flow:** the search hint ("✏️ edit my name · 🎤 song for a friend"), My songs, and a note on the edit-name form. The search screen shows a "Picking a song for X" banner with "Cancel — it's for me". (same)
15. **Rotation entry ids are globally monotonic; never reset the sequence.** Any lookup from an entry to a request must be night-scoped. A reused id once routed SMS and push to the wrong person (the "Connie" bug). (M `project_kjbox_cross_night_id_reuse_bug.md`)
16. **Gen recycles NOMAD brand codes on purpose.** Editing a job frees its code and the next job takes it. Never treat a brand code alone as song identity; compare artist and title as well. (S `2026-Q4/2026-10-09-kjbox-recycled-brand-code-identity.md`)

### Requesting: search, versions, caps, duplicates

17. **Search must not be clobbered by a slow earlier response.** Use a generation guard (`searchGen`, latest-owner rule), a 700ms debounce, an instant "Searching…" state, and skip re-renders when nothing changed. The "wrong song" reports came from lists re-rendering under the singer's finger. (M `project_kjbox_singer_ui_request_safety.md`)
18. **Ignore taps for 300ms after a list changes (`armed()`).** Note: this swallows a fast tap silently. (same; S walkthrough-i18n)
19. **The confirm screen is mandatory and hardened.** Title and artist dominate, with a source line, a "you searched" breadcrumb, and "Yes, send" / "Pick a different song". Singers breeze past weak confirms. "You searched" is hidden for make-its. (M request_safety; S make-it-feedback-polish)
20. **Results are grouped by song with versions underneath.** Use one "Request this song →" call to action. A plain tap on a multi-version song submits a `kj_pick` that carries a snapshot of all versions, and the server binds the best one. The wording is "Auto-select best version". Server ranking uses the same `rank_version` as the KJ's ⭐ BEST. (S singer-ui-overhaul)
21. **Version rows show** Community/Commercial pills with an explainer, the full brand name (`priority_display`), hand-written brand blurbs (never scrape KN), a format pill that opens a tech modal (`POST /sing/media-info`, file path withheld), and ▶ Preview. Singer previews don't count toward KJ audition stats. (same)
22. **Single-version songs also need the enriched row (Preview, pills).** Shortcutting `version_count===1` to a bare button was a real bug. A collapsed multi-version card shows the auto-pick (`versions[0]`) as a compact row with Best, pills, availability and a pink ▶ Preview. (S singer-ui-overhaul; S `2026-09-26-kjbox-singer-ui-batch-autocorrect-folding.md`)
23. **Availability tiers:** local = "Definitely available — works even offline"; divebar/cloud = "Very reliable · 9 MB"; YouTube/KN = "Almost always works — downloads occasionally fail". Avoid jargon like "plays instantly". (S polish-shell)
24. **The `kj_pick` 50-version cap trims, it doesn't refuse.** Popular songs have more than 50 versions (Owen's "I Want It That Way" had 60), and a hard 400 locked singers out. The server keeps the best 50 by rank and refuses only above 1000. Mobile must send the full versions array or rely on the server trim. (S `2026-09-24-kjbox-kj-pick-version-cap-singer-submit.md`)
25. **A 400 on submit refunds that exact device rate-limit slot.** Honest retries shouldn't lock a singer out with a 429 "You've submitted a lot". The per-IP slot is kept as the flood backstop. (same)
26. **Rate limits are per device (8 per 5 min) with a per-IP ceiling (60).** A venue wifi shares one IP, and the old per-IP limit of 5 tripped the whole bar. Note that `config.py` defaults override code constants. Many singers are on cellular or iCloud Private Relay, so IPs vary. (S `2026-09-25-kjbox-real-night-edge-cases.md`)
27. **The singer UI showed one generic "Couldn't send" for every 400; the real reason was only in the response body.** Mobile should map known error codes (`youtube_blocked`, `gen_rejected`, `already_sung`, `already_generating`, `busy_retry`, `not_open`…) to specific, translated messages. (S kj-pick-cap; S real-night)
28. **Rank results by relevance:** title match, then in library, then version count. The local catalog cap was raised from 10 to 60 because popular songs were being truncated. (S walkthrough-i18n)
29. **Auto-correct runs only on empty results.** `GET /sing/search/resolve` calls gen's Gemini resolve and is limited to 20 per 5 min per device. A confident verdict re-runs search and shows "✓ Corrected to X — you typed '…'. Undo"; an ambiguous one shows "Did you mean…?" chips, with a "Checking the spelling…" animation. (M `project_kjbox_search_autocorrect_community_fold.md`)
30. **Fold a community YouTube track into the matching local file** only when it's unambiguous: exactly one local video with the same song key and brand, and exactly one KN upload of that brand. Never fold commercial into community, or CD+G into video. (same)
31. **"No karaoke version yet" card.** On a confident identification where no result row is that song (and the index doesn't say `karaoke:true`), the song card becomes "No karaoke version yet · Generate it on demand →". Near-misses go under "Other songs with similar names", capped at 3 with "Show N more". The `karaoke:true` veto exists because a false "no version" is worse than a missed offer. (S `2026-Q4/2026-10-14-kjbox-missing-song-make-card.md`)
32. **Show a sticky "Not seeing your song? Generate it" bar only when identification isn't confident.** It sits above the tab bar. Log offers by placement (`make_offer_shown`/`make_offer_tap` with `where`). (same)
33. **Keep `kind:"same"` identifications as corrections.** Dropping them threw away the knowledge that the song was missing. (same)
34. **Joined-word indexing.** "overthinking" must find "(Over)Thinking": the index side stores adjacent word pairs joined, and queries are never joined. Within a brand, MP4 beats CD+G, but source still dominates (a local CD+G beats a not-yet-downloaded MP4). Song groups take the best local version's name. (S `2026-Q4/2026-10-16-kjbox-joined-word-search-mp4-tiebreak.md`)
35. **Search and grouping use different normalisers.** `normalize` (search) keeps featured-artist names; `identity_normalize` (grouping, song_key) strips them. Never delete from the end of a concatenated "artist title" string. (M `project_song_text_normalization.md`)
36. **Known normaliser gaps:** a trailing ", The" isn't folded ("Adults Are Talking, The" forms its own group), and artist variants ("A & B" vs "A, B") still split groups. (S autocorrect-folding; S walkthrough-i18n)
37. **`/sing/search` returns `{"error":"not_open"}` outside an event.** Mobile needs a "not open" state. (S joined-word)
38. **"🎤 Sung here before? Need ideas?" (`GET /sing/my-stats`)** shows the singer's own history plus crowd favourites; tapping a row fills the search. (S singer-ui-overhaul)
39. **Change song is kept, not replaced by cancel-then-request,** because a change keeps the queue slot (`supersedes_request_id`). The change mode needs a visible banner, a "Replaces X" line, and must clear when the singer leaves search or confirm so an abandoned change can't misroute a new submit. You can't change a song once it's sung (409), and you can't change a song into a make-it. (M request_safety; S walkthrough-i18n; S make-it-gen-flow)
40. **Song changes must also auto-approve.** They didn't, so every slow request one night was a change waiting on the KJ. (S `2026-Q4/2026-10-16-kjbox-rotation-durations-auto-approve-ux.md`)
41. **Auto-approve covers every request type (kj_pick binds the best version that resolves, and reorders apply instantly) — except tip claims,** which always need the KJ to confirm the money arrived. (M `project_kjbox_auto_approve_try_another.md`)
42. **The KJ sees "⏳ Adding automatically…" for requests being auto-approved, or "⚠ Needs you: <reason>" on failure.** `claim_approval` makes automatic and manual approval mutually exclusive. The singer should see a short pending state. (S durations-auto-approve)
43. **Singers can preview (▶) on My songs and on rotation rows** via `/sing/preview/resolve` with `{source:"entry"}`. It's rate-limited at 12 per 60s per IP. (S walkthrough-i18n; M singer_ui_search_ux)

### Queue, rotation and turn display

44. **One status-tile component for every view:** "Your next song" and "Now on stage / Up next". Paint from cache first, then refresh in place, with same-size skeletons. Separately built widgets each repainted after their own fetch and caused visible jumps. (S polish-shell)
45. **Double paint (cache, then poll) wipes anything shown "until the next paint".** Time-box notices instead (15s for reorder and cancel notices). (same)
46. **The status stack is not sticky.** Two pinned tiles over a 70-person rotation ate the phone screen. The bottom tab bar already reaches My songs. (same)
47. **The next-song bar names the actual song.** It shows on the Rotation tab, or anywhere when the singer is 3 or fewer from the mic (green, urgent). Waits format as "1h 28m". (S singer-ui-overhaul)
48. **Be honest about freshness:** an age label that ticks every 5s, auto-refresh every 30s while visible, and a manual ↻. A label that rendered once caused the "updated just now" lie. (same)
49. **My songs order follows the queue (position), not submission order.** Use `_activeSortKey`: now singing, then position, then approved-without-estimate, then pending, then rejected. (M request_safety, follow-on 2)
50. **Sung songs leave the live list** (`performed:true`) and sit in a collapsed "✓ Already sung tonight (N)" section. They're read-only, so actions would 409. A sung song has no estimate, because `get_rotation()` holds only the active queue. (same)
51. **On reload, go straight back to My songs if the device has any live song tonight.** Retry boot 3 times with backoff. A refresh used to strand singers on "Request a song". (same, follow-on 1)
52. **Prune stale request ids only if they were queried AND not returned.** This avoids losing a song submitted mid-refresh. Cap ids sent to `/my-requests` at 20, or the server rejects the call and blanks the list. (same; M your_songs_tonight)
53. **A song the singer cancelled hides immediately, with a 15s "Cancelled: X" notice.** That includes the original of an approved change. (S polish-shell)
54. **A song the host removed (Cancelled or deleted) stays visible with honest copy and ✕ Dismiss.** `removed:true` reads "The host took this song off the list — ask them if that's a surprise". It doesn't count as live. Rejected songs also get Dismiss. (same)
55. **Possible estimate bug (not fixed): host-Cancelled entries stay in `get_rotation()`.** `compute_estimate` filters only done/left, so they may inflate other singers' positions. (same)
56. **A cancel is instant.** Pending → deleted. Approved → soft "Cancelled" (the KJ row pulses about 4s and auto-removes). Done/Left → 409 `already_sung`. No Change or Cancel while the singer is on stage. (M request_safety; M cancel_auto_remove; S walkthrough-i18n)
57. **Singers reorder their own songs only.** The original press-hold-drag-save confused people, so v0.115 added an explicit hint, ▲/▼ buttons, row numbers and a bigger handle. Pause polling mid-drag. Send one reorder request; it auto-applies and says "✓ New order saved". (S kj-added-songs; M request_safety)
58. **Auto Order (KJ setting).** Rows 1–3 are sacred and rows 4–10 soft-protected. Each singer's own songs keep submission order. New singers go first; spacing targets 5 or more others between a singer's songs; the target is nobody waiting over about 60 minutes. It re-runs on every add. A singer's reorder only swaps their own slots. (M `project_kjbox_auto_order_rotation.md`)
59. **`priority_bias` (−1/0/+1) is a strong Auto Order term.** It never overrides rows 1–3 or the "being made" pin to the bottom. A confirmed tip at or above the threshold gives +1 and re-weaves immediately. A bump re-runs Auto Order. (M `project_kjbox_priority_bias_bump.md`; S singer-ui-overhaul)
60. **"Being Made" make-its sit pinned at the bottom of the rotation** until their video is ready. (M priority_bias)
61. **Wait estimates now use real song durations.** Durations are probed in the background for every linked file; they used to exist only for YouTube downloads. (S durations-auto-approve)
62. **Every rotation change bumps `rev` and makes each phone refetch `/rotation`** (430–610ms mid-show, against about 55ms idle). Throttle polling, and coalesce updates when many arrive at once. (same)
63. **Rotation status values:** Waiting, Now Singing, Done, Left, Cancelled, "Being Made (!)". The singer-facing now/next must exclude Cancelled. (M request_safety)
64. **Tips:** a Tip tab, last in the tab bar. Amount-first deep links for CashApp, Venmo, PayPal, Zelle (copy) and card. The zero-config default is the live nomadkaraoke.com/tip page. A claim (`/sing/tip-claim`) is a meta-request that is never auto-approved; the Tip tab polls its status every 15s. Tip claims are filtered out of the songs list. (M singer_ui_search_ux)

### Making a song on the spot

65. **Singers are never sent off to gen.nomadkaraoke.com.** The make wizard lives inside the singer UI: email, then a 6-digit code, then a correction notice, then audio choice, then confirm. Andrew chose a code over a magic link so singers never leave the page. (S `2026-09-26-kjbox-singer-make-it-gen-flow.md`)
66. **The singer's gen session token never reaches the phone.** The box holds it in `sing_gen_accounts`, keyed by `device_id`, and the phone only sees the email address. The server proxies gen so it controls rate limits and the `X-Client-Id` header. (same) For mobile, this conflicts with the app's own gen sign-in; the spec has to decide which session owns Tonight's make-its.
67. **Make-its are free at shows.** A quiet +1 "show credit" is granted only when the balance is empty at search time, using the same idempotency key at submit (5 per user per 24h). (same)
68. **Gen's per-IP signup cap (2 per 24h) is silent, and a whole venue shares an IP.** Partner signups bypass it and have their own cap (100 verified per 24h). (same)
69. **Order of operations:** create the gen job first, then the entry goes in as "Being Made (!)" with no approval step and no reject. A singer cancel does not cancel the gen job. GenPoller links only the synced NOMAD-#### master, which flips the entry to Waiting. (same)
70. **My-songs phases:** `making`, `review`, `review_self`, `review_host`, `rendering`, `needs_host`. "Tap here" calls `POST /sing/make/review-link/<id>`, which mints a single-use 72h link per tap. The web opens a blank tab synchronously to dodge popup blockers. gen's `review_started_by` = "admin" shows as "the host is reviewing". (S `2026-09-26-kjbox-make-it-feedback-polish.md`)
71. **Make-it copy:** "Generate on demand". The confirm screen promises the rotation entry is kept at the bottom until ready, "typically ~30 minutes", and that the finished video and YouTube link are emailed. (same)
72. **The audio pick screen mirrors gen's Choose Audio step:** filename, release, quality, availability badge (seeders ≥50 / ≥10), categories, "Wrong track?" / "Title match" badges, and "Hide other options". (same)
73. **Ranking:** a confirmed title match from a torrent or Spotify (never YouTube, whose titles almost always "match") competes; the requested artist wins among those; then seeders, then popularity. Prefer torrents over Spotify over YouTube. Hide the YouTube box behind "Can't find your song?" at confidence tiers 1 and 2. Keep the ranking 1:1 with gen's `audio-search-utils.ts` (shared via `audio_rank.js`). (S `2026-Q4/2026-10-03-make-it-youtube-blocked-spotify-ranking.md`)
74. **Map gen errors:** when the detail mentions YouTube and a bot check, return `youtube_blocked`; otherwise `gen_rejected`. A generic "requests are paused" sends singers to the host for the wrong reason. The YouTube bot check recurs periodically. (same)
75. **Quick version.** For kjbox jobs, gen renders a fast scrolling-lyrics draft about 4 minutes after audio arrives. The singer gets a push plus a My-songs card with ▶ Preview (`entry_quick`) and ⚡ "Sing it now" (`POST /sing/make/use-quick/<id>`). The full master swaps in automatically unless the song is now singing or done. No SMS for this (Andrew). (S `2026-Q3/2026-09-28-make-it-quick-version.md`)
76. **The real end-to-end latency is dominated by gen's audio-download container start (1m40s–4m).** Promise an ETA, not 4 minutes. (same)
77. **Known make-it gaps:** a timed-out YouTube-link submit can create a duplicate job; private (non-NOMAD) jobs poll forever; the full flow was barely exercised live. One real night (Bryan) failed 5 times, and the host remade the song with the KJ Gen button. (S make-it-gen-flow; S youtube-blocked)
78. **Make-it is hidden when the partner secret is unset, when the KJ switches make requests off, in Simple Mode, or in change-song mode.** Those cases show "Ask the host". The review-link route deliberately skips `_guard` so it still works if make-it is switched off. (S missing-song-make-card; S feedback-polish)
79. **The KJ's Gen button (admin token, job created before the entry, 409 `already_generating`) is KJ-only,** but it explains why some "Being Made" entries have no singer gen account. (S `2026-Q4/2026-10-01-kjbox-kj-gen-button.md`)

### Notifications (push, SMS) and flicker

80. **"🔔 When you're up" shows per-channel status.** A singer can add a phone number later via `POST /sing/update-phone`, which writes it onto the requests they own and enables SMS after the fact. (S singer-ui-overhaul)
81. **Push must work without a phone number.** Subscriptions are keyed by phone or `device_id` (phone stored as `''`). Requiring a phone silently left phone-less singers without pushes. Check `resp.ok` and show a "browser failed" state. (S real-night)
82. **Push events:** your turn is near, a decision on your request, `quick_ready`. Decision pushes combine phone and device subscriptions, deduplicated. (same; S quick-version)
83. **SMS goes through Telnyx and needs 10DLC registration plus the number linked to the campaign.** A send marked "sent" only means queued; delivery receipts later flip it to `delivery_failed`. Messages bounced for weeks unnoticed. Show delivery status, not an optimistic "sent". STOP/START opt-outs are honoured. (M `project_kjbox_telnyx_number_assignment.md`, `project_kjbox_telnyx_10dlc.md`)
84. **Auto-text for the next singer (KJ opt-in):** 20s after slot 1 starts, slot 2 gets an SMS, after a full server-side re-check. (M `project_kjbox_auto_sms_next_singer.md`)
85. **Flicker lesson:** any per-entry computed field must be added in the single `_decorate_rotation_entries`. Otherwise endpoints that omit it make the UI flicker on every action. For mobile, merge partial responses rather than replacing state. (M `project_kjbox_sms_button_flicker_mutation.md`)
86. **Notification and social-media preferences are collapsible sections.** They're open until set up, collapsed with a status line afterwards, and stay open once the singer interacts. (S feedback-polish)

### Links and QR codes

87. **The QR on screen is `HTTP://KJBOX.CC/<code>`.** Uppercased, it uses QR alphanumeric mode (21×21; https would be 25×25). Cloudflare 302s it to `sing.nomadkaraoke.com/?t=<code>`, so singers stay on one origin and keep localStorage, push and the installed PWA. Mobile needs deep or universal links for `kjbox.cc/<code>` and `sing.nomadkaraoke.com/?t=`. (S `2026-09-26-kjbox-cc-short-qr-links.md`)
88. **Offline/LAN:** `http://l.kjbox.cc/` (no code, plain HTTP) resolves only on the "Nomad KJ Box" wifi. The token is implied only for non-tunnel requests from private IPs. The app must cope with plain HTTP to a LAN host (iOS ATS / Android cleartext). (same)
89. **The event token never changes, so a saved link stays valid across nights.** Don't treat it as "tonight" (see the identity section). (M your_songs_tonight)
90. **The KJ can configure** venue notices (editable icon and text plus custom notices, max 12), a free-text host message (shown as typed, not translated), socials, and a "Contact us" phone that opens Text/Call. All come from `GET /sing/event-info`. (S autocorrect-folding; S walkthrough-i18n)

### Consent (photos and clips)

91. **Unknown consent = NO** (Andrew: "assume no consent unless explicitly spoken"). Never show unknown as permissive. (S `2026-09-24-kjbox-footer-social-photo-consent.md`)
92. **The question is behind a KJ toggle (`ask_photo_consent`).** It's asked once per device on the confirm step, is optional, and never blocks a request. The device remembers it and re-sends `photo_consent` on each submit. Consent is keyed by folded singer name and scoped to the night. (same)
93. **Rename and merge carry consent across; on a conflict "no" wins.** (same)
94. **Per-song consent:** a 📷 "OK to post / Don't post" toggle on each of the singer's own cards. Switching yes→no after singing asks "Just one song" or "Nothing from tonight". An optional Instagram handle is collected. Resolution order: any song override "no" means no, then song "yes", then the night default, then unknown = no. Hide the toggle on friend songs. (S `2026-Q4/2026-10-14-kjbox-instagram-night-clips.md`)
95. **Debounce consent buttons and skip the POST when the value hasn't changed.** One singer tapped 11 times in 10s and hit 429s. (S real-night)

### Sung history and the Night Log

96. **⚠ `sung_at` in Night Log / night-media = `done_at` = when the KJ ticked Done, which is the song's END.** For "when was this on stage" use `started_at` (the play-event start). Before v0.129 reconstructed nights used the start time, so don't reinterpret old data blindly. (S `2026-Q4/2026-10-16-night-clips-first-carousel-fixes.md`)
97. **Some songs are ticked Done without ever playing** (5 on one night). Only Done entries get a sung time. (same; S `2026-Q4/2026-10-14-kjbox-night-log.md`)
98. **A night runs noon to noon.** A reset before 06:00 counts as the previous night. `play_events.played_at` is UTC. (S night-log)
99. **Last-sang times need `done_at`, not `updated_at`,** because reorders bump `updated_at`. (M `project_kjbox_last_sang_pill.md`)
100. **KJ endpoints `/history/nights`, `/history/night` and `/history/night-media`** are the source if Tonight ever shows "you sang X tonight / last week". Cross-night per-singer history doesn't exist yet. (S night-log; S instagram)
101. **Night data before 2026-10-14 is reconstructed and approximate.** (M `project_kjbox_night_log.md`)

### Real-night edge cases (from the ActionRecorder)

102. **Scanner probes against the public singer host** (`/sing/.env` and the like) are normal; filter them out. (S kj-pick-cap)
103. **When the library drive drops out, `/play` returns 503 `library_drive_offline`** (KJ side). It can surface to singers as a song that can't be played. (S real-night)
104. **Shared phones, people taking over a phone mid-night, and same-name walk-ins are all real.** Design for them (sections A7–A12). (S self-rename)
105. **Singers misunderstand subtle affordances** (drag-to-reorder, a make link at the bottom of a long list, "(not you?)"). Prefer explicit, labelled actions. (S kj-added; S missing-song; S friend)
106. **Results for popular songs are huge** (hallelujah 57 rows, love song 80), so long lists need a compact layout. The compact-card idea (#4) was deferred. (S missing-song)
107. **Deploys mid-show are safe** (playback survives restarts), but in-memory state is lost, so the app must ride out brief API blips and 5xx. (M `project_kjbox_autodeploy_paused_live_shows.md`)
108. **Test entries left on the live box pollute the next night.** Clear them with New Rotation before a show. (S walkthrough-i18n)

### i18n and UX polish

109. **33 locales, and say "host", not "KJ", in singer copy.** No idioms. Whole sentences with `{token}` placeholders rather than split before/strong/after fragments (Japanese and Korean produced empty fragments). Avoid strings that quote button labels; they drift in about a third of locales. (S walkthrough-i18n; S polish-shell)
110. **RTL:** the "→" arrows in calls to action weren't mirrored in Arabic and Hebrew. (S walkthrough-i18n)
111. **A poisoned translation cache needs a renamed key and reworded English.** (M walkthrough_i18n)
112. **There's no landing screen; boot goes to search or identity.** Identity carries the welcome copy and "Switch singer". (S singer-ui-overhaul)
113. **Picker filters autofocus only on a fine pointer;** on phones the keyboard would cover the list. The existing-singer picker is a filterable A–Z list with sticky letters, 46px rows and "+ Add 'X' as a new singer". There's no auto-list of everyone tonight, which felt uncomfortable. (S polish-shell)
114. **Show a region-appropriate phone-number example.** (S walkthrough-i18n)
115. **House rules appear only on the Rotation tab, collapsed.** A footer "Follow us" row uses icons. (M singer_ui_search_ux; S photo-consent)

### Testing fixtures

116. **Real nights are recorded:** the ActionRecorder writes `~/kjdata/action-logs/<night>.jsonl` (request bodies and responses), and a sidecar records DB diffs. `night_fixture.py` turns these into redacted fixtures with stable fake phone numbers. Real first names are OK to publish. These are the source for realistic singer-flow fixtures. (S `2026-09-26-kjbox-night-recording-fixtures.md`)
117. **The 2026-09-24 fixture (13 singer devices, 1,043 singer actions, Owen's 60-version kj_pick) is at `~/nomad-nights/2026-09-24/`.** The night-replay E2E suite (step 3) was never built. (same)
118. **kjbox `docs/TESTING.md` § "Edge cases from real nights"** lists the regressions any client must survive. `docs/FUNCTIONALITY-MAP.md` lists all 32 singer endpoints with their side effects. (S kj-pick-cap)
119. **The dev harness** (`dev_server.py --night biggest --as Name,…`) prints per-singer `?r=id:token` URLs against a copy of a real night. Its DB contains real phone numbers, so keep it local. (S singer-ui-overhaul)
120. **Verify against prod by loading `sing.nomadkaraoke.com/?t=<token>` in a fresh context;** `window.__sing_state` is live there. Local E2E on the `/sing/` mount missed a public-host asset-path bug. (S walkthrough-i18n; S missing-song)

**Open decisions for the mobile spec:**
- Whether the app reuses the web's `device_id` and `edit_token` model or adds a gen-account binding (item 66).
- The server-side ownership gap for friend songs.
- The estimate inflation from host-Cancelled entries.
- Specific error-code messages (never done on web).
- The "Your next song" tile counting friend songs.
