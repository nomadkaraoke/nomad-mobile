# Phase 3a "Discover core": one account, quiz, recommendations, filters, library filter

**Phase:** VISION.md Phase 3 "Discover" (use case 1), first of three sub-phases agreed with Andrew on 2026-10-21:

- **3a (this spec):** one Nomad account across gen and decide (app + decide website), the quiz, a first pass at a properly good recommendation engine, rich filters and sorting, the library filter, decide's cold start.
- **3b:** music data ([2026-10-21-mobile-phase3b-music-data-design.md](2026-10-21-mobile-phase3b-music-data-design.md)).
- **3c:** vocal range and the singable filter ([2026-10-21-mobile-phase3c-vocal-range-design.md](2026-10-21-mobile-phase3c-vocal-range-design.md)).

Repos: karaoke-decide (backend, website, data jobs) and nomad-mobile. Every learning from the survey is in [2026-10-21-mobile-phase3-discover-survey.md](2026-10-21-mobile-phase3-discover-survey.md) (cited below as "survey §n"); read it before building.

## 1. Intent

A singer at any karaoke night opens the app, answers a few quick questions, and within 30 seconds sees songs they would actually enjoy singing, filtered to what the venue can play. That's use case 1, and today decide's website only looks like it does this: several of its inputs and filters do nothing (survey §5).

Andrew (2026-10-21): "we do need fix those issues and generally do the work to make decide's recommendation engine *actually good* - though i'm ok with us building a first pass at this then continuing to brainstorm and iterate to improve the quality of the decide recommendations with more thought and creativity in future sessions."

He also wants gen and decide to converge into one platform: "eventually I want the main nomad karaoke website to present a single unified platform for users anyway, helping them find songs to sing and make karaoke videos for anything which lacks one rather than two fully separate products". 3a takes the first real step: **one account** (the gen account) for the app, gen web and decide web.

## 2. Goals, non-goals, anti-goals

**Goals**
1. decide accepts gen session tokens; the gen account is the only identity. The app sends one token to both backends. decide web signs in with gen's email code (and Google once its origin is authorised).
2. A short native quiz plus "artists and songs you love", saved to the user's decide profile, then straight to recommendations.
3. Recommendation engine v2: every input and filter works; fast (p50 < 500 ms warm, no BigQuery on the request path); sections that explain *why*.
4. Filters and sorting: genre, mood, energy, decade, popularity, voice gender (lead singer), duration, karaoke classic, explicit, has-karaoke, and the **library filter** (any / community release / KaraFun).
5. The library filter as a shared module that Phase 5 Tonight imports.
6. decide main service cold start < 10 s spawn-to-serving (from 35–45 s), plus keep-warm pinging like the search service.
7. A decide local stack for the main API that shares gen's local stack (same Firestore emulator), with test seeding, so Maestro covers sign-in → quiz → recommendations → filters.

**Non-goals (3a)**
- Music service connections and imports (3b). The app shows no "Connect your music" card until 3b ships.
- Vocal range and the singable filter (3c).
- Merging `decide_users` into `gen_users` (see §4.4).
- Singa / Karaoke Cloud libraries (no clean source; survey §7).
- History, ratings, playlists (Phase 4).

**Anti-goals** (failure even if it technically works)
- Recommendations that are the same list for everyone, or that hide the songs a user just told us they love.
- A filter control that does nothing.
- A decide problem (401, outage, cold start) that signs the user out of the app or blocks search and Make.
- Any new spend beyond pennies without asking (no min-instances).
- Live MusicBrainz API calls (workspace rule; survey §4).

## 3. Constraints

- VISION.md principles: all native, same endpoints as the web, one gen account, offline states stated, no accounts or spend without asking.
- Same Firestore project/database for gen and decide (`(default)`); gen owns `gen_users` (doc id = lowercase email) and `sessions` (doc id = token, `secrets.token_urlsafe(32)`, no dots). decide JWTs always contain dots.
- i18n: every new string in 33 locales (mobile `packages/i18n`, decide `frontend/messages`).
- Coordination: Phase 5 Tonight (session nomadkaraoke-a7) works in parallel in nomad-mobile; message it before merging shared files (tabs, i18n, ui, core, package.json/lock, CI). Keep 3a's mobile code under `src/discover/`, `src/find/library/`, `packages/core/src/library/` and `packages/core/src/discover/`.

## 4. One account (decide backend + decide web)

### 4.1 decide accepts gen sessions
- `get_current_user` (decide `backend/api/deps.py`): a bearer token **without** dots is a gen session token. Validate it against gen's `sessions` collection with exactly gen's rules (`karaoke-gen/backend/services/user_service.py` `validate_session`): doc exists, `is_active`, `expires_at` (naive → UTC), 7-day `last_activity_at` idle limit, then `gen_users/{email}` exists and `is_active`.
- **Tenant sessions** (`tenant_id` set and not the default Nomad tenant) are rejected with 401: decide is Nomad-only (Claude's call).
- **User lookup** copies gen's `get_user`: `gen_users/{lowercase email}`, falling back to a query on the `email` field (hash-keyed legacy docs).
- **Sliding the idle window:** gen writes `last_activity_at` on every validation; decide writes it at most once per hour per token (a deliberate divergence to save writes; a decide-only user would otherwise be signed out after 7 days).
- **Cache:** validated tokens are cached in-process for 60 s (positive) / 10 s (negative) to avoid a Firestore read per request.
- **Parity test:** a test in decide runs the same table of session cases as gen's `validate_session` tests (copied fixtures); a comment in both files points at the other.
- **Legacy decide JWTs** (dotted) keep validating until 2026-11-30 so existing website sessions and guests survive the switch; a backlog item removes JWT auth and decide's magic links after that.

### 4.2 Profile resolution
- decide keeps its own profile collections (`decide_users`, `user_songs`, `user_artists`, `music_services`, …). For a gen user, the profile doc is `decide_users/{sha256(lowercase email)}` (decide's existing verified-user key), so an existing decide website user with the same email keeps their quiz, artists, songs and connections.
- First request from a gen user with no decide profile creates one (`is_guest=false`, `email`, `gen_linked_at`). Existing profiles get `gen_linked_at` set once.
- `User.id` stays decide's `user_<hex>` id (all decide data is keyed by it); nothing is re-keyed.
- Admin flag: decide's `is_admin` stays as is; gen admin status is not imported (Claude's call).

### 4.3 decide website switches to gen sign-in
- Login page: email → `POST {GEN_API}/api/users/auth/send-code` → code entry → `POST {GEN_API}/api/users/auth/verify-code` → store the returned gen session token where the decide JWT was stored; `api.ts` sends it as the bearer. gen's CORS already allows `*`.
- Google button: rendered only when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set and calls gen `POST /api/users/auth/google`. **Andrew to-do:** add `https://decide.nomadkaraoke.com` to the web OAuth client's authorised JavaScript origins (GCP console; Claude's ADC is read-only). Until then, email code only.
- Logout calls gen `POST /api/users/auth/logout`.
- **No new guests:** "Try without an account" is removed; the quiz and recommendations require sign-in, as on mobile (Andrew: "make everyone sign in so we can start storing their quiz data").
- **Claim a guest profile:** if the browser still holds a guest decide JWT when the user signs in with gen, the website calls `POST /api/auth/claim-guest` (bearer = gen token, body = guest JWT). decide migrates the guest's `user_songs` (no 1000 cap), `user_artists`, `music_services`, quiz fields and playlists onto the gen user's profile, then deletes the guest doc. This also fixes the existing guest-upgrade gaps (survey §2).
- decide's own magic-link endpoints stay mounted until the JWT sunset but the website no longer calls them.
- The sign-in code email is gen's (Nomad Karaoke branding), which is correct for a unified platform. Accepted side effects (no gen change in 3a): `send-code` creates the gen account and runs gen's welcome-credit check, so decide sign-ups become gen users who may get the welcome credit (wanted, for one platform); the email's magic link opens gen web rather than decide. A backlog item adds a `return_to`-style origin to gen's send-code so the link can land on decide.

### 4.4 Why not merge the collections now (recorded decision)
Profiles are a different kind of data from gen accounts and credits; `gen_users` sits on payment paths; moving 1000-song lists and service tokens into it adds risk without user-visible gain. The user-visible convergence is the single account. Revisit a single profile store when the websites merge.

### 4.5 Mobile
- `apps/mobile/src/api/setup.ts`: decide clients get `getToken` = the gen token. decide's `onUnauthorized` does **not** sign out (gen's `useSessionCheck` remains the authority); it marks Discover's personal data stale and shows a retry.
- Search and song pages stay usable signed out. Quiz, recommendations, profile editing require sign-in: Discover shows a "Sign in to get your picks" card that calls `openSignIn('/discover')`.
- Phase 0 spec §4.2 (`exchange-gen-session`) is superseded by this section; update its text to point here.

## 5. Recommendation engine v2 (decide)

### 5.1 Data: `catalog.db` (one SQLite file, built daily)
Per-request BigQuery is the root of the cost, latency and cold-start problems. Replace it with a SQLite artifact built by decide's existing daily song-index-build job (same job that builds the search indexes, same eval gates and GCS publish), and loaded by the main API:

- `songs(song_key PK, artist, title, artist_key, brand_count, is_classic, has_community, has_commercial, karafun, explicit, duration_ms, year, decade, lb_listeners, spotify_pop, popularity (0–100 blend), energy, valence, danceability, tempo, mood, lead_gender, genres_json)` for every KaraokeNerds song (~300k) plus "no karaoke version yet" songs that matter (§5.3).
- `artists(artist_key PK, name, mbid, lb_listeners, popularity, gender, genres_json)`.
- `artist_similar(artist_key, similar_key, score, source)` top 30 per artist, from ListenBrainz/MLHD+ similarity already in BigQuery (no live calls).
- `genre_map(raw_genre, genre_id)`: Spotify/MB tags → decide's 22 quiz genre ids.
- `song_libraries(song_key, library_code)` and `libraries` (same as the search indexes, §7).
- Mood = a small fixed set derived from valence × energy (happy, chill, sad, intense, romantic? — the builder picks 4–6 buckets and documents thresholds).
- Sources (survey §6): genre from `spotify_artist_genres` + `mb_artist_tags`; energy/valence/danceability/tempo from `spotify_audio_features` (**one row per key chosen by popularity, never per-column MAX**); decade/year from `mb_release_groups.first_release_date` via `karaoke_recording_links`; popularity blend of LB `listeners` and the Spotify snapshot; lead gender from `mb_artists.gender` plus band lead-vocal member gender; duration from MB/Spotify; explicit from Spotify where present.
- **Where it's built (correction after the builder check):** the search service's `song-index-build` job reads only gen's GCS TSV shards and has no BigQuery roles, so it is *not* reused. `catalog.db` is built as an extra final step of decide's existing weekly **`mb-refresh`** Cloud Run job (its service account already has BigQuery jobUser/dataEditor and GCS objectAdmin), so no new infrastructure is needed. Facets change slowly; weekly is enough. Daily-changing availability (has karaoke, community/commercial, libraries) is **not** in `catalog.db`: the main API also loads the search service's daily `availability.db` from GCS (already published) and joins by `song_key`.
- A `catalog/latest.json` pointer (run id, sha256, bytes) is written last, like the search indexes. Eval gate: coverage percentages per facet; the pointer isn't moved on a sharp drop.
- First build: trigger the job once after merge (CI or `gcloud run jobs execute` if the session has rights; otherwise it lands on the next Sunday run and the API serves `warming_up` / v1 fallback until then — see §6).
- Size target < 150 MB uncompressed (< 50 MB gzipped).

### 5.2 Scoring
Per request: load the user context from Firestore (profile, `user_artists` from all sources, `user_songs`, hidden songs), then score candidates from `catalog.db`:

- **Candidates:** songs by known artists; songs by artists similar to known artists; songs in the user's quiz genres; crowd-pleaser classics; "no karaoke version yet" songs by known artists.
- **Features:** artist affinity (source weights from decide VISION, now including `user_artists` top artists and quiz affinities occasionally/like/love), similar-artist affinity, known song (a *boost* and a "You know this" label, not an exclusion), genre match, decade match, energy match, popularity, brand count / classic, explicit penalty only when the user asked.
- **Diversity:** max 3 songs per artist per section, no song in two sections.
- **Hidden:** songs the user marked "Not for me" never appear.
- **Cold user** (quiz only): genre + decade + energy drive candidates, so two users with different answers get different lists.
- Weights live in one module with a test table of personas (rock/90s/high-energy vs pop/2010s/chill vs a Last.fm-style heavy profile) asserting the top results differ and make sense; quality iteration continues in later sessions.

### 5.3 Sections and API
`GET /api/my/recommendations/v2?filters…&sort=…&cursor=` returns:
```
{ sections: [ {id, title_key, reason_key, songs: [RecSong]} ], filters_applied, next_cursor? }
RecSong = { song_key, artist, title, reason, reason_type, score, has_karaoke_version,
            karaoke: {community: bool, commercial: bool, karafun: bool, brand_count},
            facets: {decade, genres, mood, energy, lead_gender, duration_ms, popularity, is_classic, explicit} }
```
Sections (in order, empty ones omitted): **Songs you know** · **From artists you love** · **Because you like X** (similar artists) · **Crowd pleasers for you** · **Make it** (no karaoke version yet; leads to the app's Make flow). When any sort other than "best match" is chosen, the response is one flat section.

`song_key` is the search service's key, so every row opens the existing song page. Existing `user_songs` (keyed `user_id:song_id` with KaraokeNerds or Spotify ids) are **not migrated**: `catalog.db` carries a `kn_song_map(kn_id, song_key)` table and v2 maps on read; new writes store `song_key` alongside the old id. The legacy v1 endpoints stay for decide web until its recommendations page moves to v2 (in this phase).

### 5.4 Filters and sorting (query params)
`genre` (multi), `mood` (multi), `energy` (low|mid|high), `decade` (multi), `popularity` (min 0–100), `lead_gender` (male|female|mixed), `duration` (short <3 min | medium | long >5 min), `classic` (bool), `explicit` (exclude|include), `has_karaoke` (yes|make|any), `library` (any|community|karafun). Sort: `best` (default), `popular`, `newest`, `oldest`, `shortest`, `az`. Every filter is applied in SQL against `catalog.db`; a test asserts each one changes the result set on the fixture catalog.

### 5.5 Feedback
`POST /api/my/songs/{song_key}/hide` and `DELETE` to undo ("Not for me"). `POST /api/my/songs/{song_key}/love` adds to known songs with source `manual` (the "songs you love" list).

### 5.6 Quiz backend fixes
- `ListenBrainzService`'s live `musicbrainz.org/ws/2` call moves to the BigQuery mirror / `catalog.db` (workspace rule).
- "People also like" stops reading up to 500 `decide_users` docs per call: use `artist_similar` from `catalog.db`.
- `submit` writes songs in one batch, not one read+write per song.
- Smart suggestions are ranked by score (not random) and always carry a "why" label.
- Quiz genres, decades and energy feed scoring (§5.2).

## 6. Cold start (decide main service)
- Remove the startup load of `karaokenerds_raw` into memory (~34 s). Sync matching uses `catalog.db` (SQLite lookup by normalized key) instead.
- The main service runs with CPU throttled when idle, so a background download after the port opens can stall. Instead, `catalog.db` + `availability.db` (gzipped, same region, a second or two) are downloaded **during startup behind a `/ready` startup probe**, as the search service does; lazy heavy imports (BigQuery/Firestore clients) as gen did (memory `project_gen_cold_start_reduction`). If the catalog pointer doesn't exist yet, the service starts anyway and v2 returns 503 `warming_up` (the app shows "Getting your picks ready…"). Target: spawn → serving < 10 s.
- Keep-warm: decide already has a GitHub Actions uptime monitor every 5 minutes on `/api/health`; add the main service to the search service's 60 s GCP uptime check in Pulumi (≈ $0, idle CPU released; no min-instances). Check `ci.yml` deploy flags vs Pulumi (survey §9) so memory/CPU changes stick.
- Measure before/after on prod (Cloud Run logs) and record numbers in the session record.

## 7. Library filter (shared with Tonight)

### 7.1 Definition
- **Any** (default).
- **Community release:** the song has at least one version whose `kind = 'community'` (YouTube-playable community karaoke).
- **KaraFun:** the song has a version from KaraokeNerds brand **KV** (Karaoke Version). KaraFun and Karaoke Version are the same Recisio catalogue (Andrew, 2026-10-21). Display name "KaraFun"; the info line says "KaraFun / Karaoke Version catalogue". **Data model unchanged** (no offline schema bump): library codes stay brand codes, and the filter value `karafun` maps to library code `KV` inside `matchesLibrary` and the backend.
- Fix the brand registry alias that maps "Karaoke Cloud Digitrax" to KV in decide's `version_priority.py` copy (it belongs with CB) and file a kjbox follow-up for its copy (kjbox is outside this phase's worktrees).

### 7.2 Shared module (the interface promised to Tonight)
- `packages/core/src/library/index.ts`:
  ```ts
  export type LibraryFilter = 'any' | 'community' | 'karafun';
  export interface LibraryTagged { libraries?: readonly string[]; versions?: readonly { kind: 'community' | 'commercial'; brand_code?: string }[]; }
  export function matchesLibrary(song: LibraryTagged, filter: LibraryFilter): boolean;
  export function songLibraries(song: LibraryTagged): Set<'community' | 'karafun'>;
  export const LIBRARY_FILTERS: readonly LibraryFilter[];
  ```
- `apps/mobile/src/find/library/`: `useLibraryFilter()` (zustand, persisted in MMKV, one global choice: "the library tonight's venue uses"), `LibraryFilterPicker` (segmented control, testIDs `library-filter-<value>`), `LibraryBadge` (row-level pill: "Community" / "KaraFun").
- Offline: the offline song list already carries `versions.kind` and `song_libraries`; `packages/core/src/search/offline.ts` gains a reader for `song_libraries` so offline search and Tonight's setlist can filter without a connection.
- Backend: recommendations (`library=`), and the search service's `GET /api/search` and `GET /api/search/popular` accept `library=` too, so search results can be filtered the same way.
- Send Tonight (nomadkaraoke-a7) the final module paths and names once 3a's PR merges.

## 8. Mobile UX

### 8.1 Discover tab
Top to bottom, `apps/mobile/src/app/(tabs)/discover.tsx` composing components from `src/discover/`:
1. Search field and "Describe it" (unchanged, Phase 1b). With a query, the existing search outcomes take over the screen as today (plus the library filter applied).
2. Library filter chip row ("Any · Community · KaraFun") — always visible, affects search and recommendations.
3. Without a query:
   - **Signed out:** "Sign in to get your picks" card (one-tap Google / email code) above the popular list.
   - **Signed in, no profile yet:** "Get your picks in 30 seconds" card → quiz; popular list below.
   - **Signed in with a profile:** filter/sort bar (chips: Sort, Genre, Decade, Mood, Energy, More…; each opens a `@nomad/ui` Sheet) and the recommendation sections (section header + reason line + song rows; "Make it" section rows open the Make flow). Pull to refresh. "Improve your picks" card at the end: "Add artists and songs you love" (3b and 3c add their cards here).
4. Song row: title, artist, reason chip ("You know this", "Like Muse", "Crowd pleaser"), library badges, and a ⋯ menu (Not for me / Love it). Tap → existing song page (`/song/[song_key]`).

### 8.2 Quiz (`/discover/quiz`, modal stack)
Three short steps plus a finish, each skippable except genres:
1. **Genres** (multi-select chips, decide's 22 ids + "Something else").
2. **Decades and energy** (multi-select decade chips; energy: Chill / Mixed / Big energy).
3. **Artists you love** — search-as-you-type against decide's artist search (never free text; survey §4), plus suggestion grid seeded from genres+decades, refreshed by smart suggestions as picks are made; each suggestion shows why. Love / like / occasionally via long-press or a tap cycle (Claude's call: tap = like, second tap = love).
4. **Songs you love** (optional): the existing search component; picks go to "songs you love".
- Smart-suggestion prefetch starts when leaving step 2 (decide web's latency trick).
- Progress autosaves (`PUT /api/quiz/progress`); reopening resumes.
- Finish submits and lands on Discover with recommendations loading.

### 8.3 Me → "Your music profile"
A transparency screen (decide's My Data, survey §0/USER-DATA-VISION): quiz answers (editable, reopens the quiz at that step), artists you love (remove), songs you love (remove), hidden songs (unhide). 3b adds connected services here; 3c adds vocal range.

### 8.4 Offline
Recommendations need a connection; offline, Discover shows the last fetched recommendations (a TanStack Query persister on MMKV — new dependency `@tanstack/query-persist-client-core` or a small hand-rolled MMKV snapshot of the recommendations query only; max 7 days old) with an "Offline: showing your last picks" banner, and the library filter still applies to offline search.

## 9. Local stacks and tests

### 9.1 decide local stack
- `scripts/local-stack.sh up` in decide runs the **main API on :8030** and the search service on :8020, both on gen's Firestore emulator (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `GOOGLE_CLOUD_PROJECT=test-project`) so gen sessions created by gen's local stack validate in decide. `search-local-stack.sh` keeps working (thin wrapper).
- Fixture `catalog.db` built from a checked-in fixture set (the search stack's fixture songs + ~200 more covering every filter value), no BigQuery.
- Test API (`/api/test/*`, mounted only when `DECIDE_TEST_API=1`): reset a user's decide profile, seed quiz answers / artists / songs, read a user's profile.
- mobile: `EXPO_PUBLIC_DECIDE_API_URL` = main API, new `EXPO_PUBLIC_DECIDE_SEARCH_URL` (defaults to the same host; locally :8020). `scripts/e2e-local.sh` starts both and `adb reverse tcp:8030`.

### 9.2 Tests
- decide unit: gen-session validation parity table, profile resolution and claim-guest, every filter and sort, scoring personas, catalog build (fixture BQ rows → SQLite), library mapping, cold-start (app starts without catalog; 503 warming_up), quiz fixes.
- decide web: login via gen (Playwright against gen + decide local stacks), claim-guest.
- mobile jest: `packages/core` library + discover logic (≥ 70% coverage); a component test for every new screen (Discover states, quiz steps, filter sheets, profile screen).
- Maestro (iOS and Android, against gen + decide local stacks): `discover-1-signin-card`, `discover-2-quiz` (complete quiz → sections render), `discover-3-filters` (library filter + one sheet filter change the list), `discover-4-hide` (Not for me removes a song), `discover-5-profile` (edit genres → list changes), `discover-6-offline` (force-offline shows last picks). Screenshots in `docs/screenshots/phase3a/<platform>/`.
- Screenshot UX review of every screen (light + dark? the app is dark-only today; en + ar for RTL).
- Release APK `~/Downloads/nomad-karaoke-phase3a-release.apk` for Andrew's phone test.

## 9.3 decide website scope in 3a
gen sign-in (§4.3), claim-guest, removal of guest-only paths (guest session creation, collect-email step), and the recommendations page switched to v2: the existing filter UI wired to v2 params (so every control works), plus sort and the library filter, rendering v2's sections. The web quiz keeps its current steps (its backend fixes from §5.6 apply).

## 9.4 Infrastructure and credentials policy
Claude's GCP credentials are read-only and decide's CI never runs Pulumi. So: infra changes (uptime check, IAM, secrets) are written in `infrastructure/__main__.py` in the PR and listed for Andrew to apply with `/gcp-admin`; code must work (degrade gracefully) before they're applied; prod verification of anything depending on them waits for that. Everything else ships through CI's normal deploy.

## 10. Shipping order
1. decide: gen-session auth + profile resolution + claim-guest (PR 1, deploy, verify with a real gen token on prod).
2. decide: catalog build + v2 engine + filters + library + quiz fixes + cold start (PR 2; verify cold start numbers and recs on prod).
3. decide web: gen sign-in + v2 recommendations page (PR 3 or part of 2).
4. mobile: Discover core (PR, after messaging Tonight about shared files).

## 11. Claude's calls (for Andrew to check)
- Tenant gen sessions rejected by decide.
- decide slides gen's idle window (hourly).
- Legacy decide JWTs accepted until 2026-11-30, then removed.
- No guest creation on decide web; guests can claim their data by signing in.
- Recommendations from a daily SQLite `catalog.db` instead of per-request BigQuery; 503 `warming_up` before it loads.
- Known songs are boosted and labelled, not excluded.
- KaraFun = KaraokeNerds brand KV.
- Quiz is 3 steps + optional songs; artist tap = like, double tap = love.
- Keep-warm ping instead of min-instances.
