# Phase 3 "Discover": survey of prior learnings (2026-10-21)

Input to the Phase 3 design spec (memory `feedback_mobile_port_existing_learnings`). Paths: `decide/` = karaoke-decide, `mobile/` = nomad-mobile, workspace = nomadkaraoke root. Collected by five survey agents; nothing here is decided yet.

## 1. Mobile app today
- Discover tab (`apps/mobile/src/app/(tabs)/discover.tsx`) is search only: query + "Describe it" + popular list + outcomes + MakeBar. No recs, filters, personalisation.
- Me: credits, sign-in, language, offline list. No services/quiz/range.
- `packages/api-decide` already generates main-API ops (quiz, recommendations, services, my-data, playlists) with no facades. `exchange-gen-session` is not in `openapi/decide.json`.
- `configureClient` applies one config (one `getToken`) to both decide clients; mobile passes `getToken: () => null` and a no-op `onUnauthorized`.
- Recommendations return KN `song_id`; search/song page use `song_key`. Needs mapping.
- offline.db has `libraries(code,name,kind,source)` + `song_libraries(song_key, library_code)` and `versions.kind`; nothing on the phone reads the library tables yet. No genre/decade/mood/energy/duration anywhere on the phone or in the search API.
- No mic permission, no recorder. `expo-audio ~57.0.5` installed (playback only). Skia available via `@nomad/ui`.
- OAuth return pattern exists: `openAuthSessionAsync(url, 'nomadkaraoke://checkout')` (`src/credits/useCheckout.ts`); Android delivers the scheme return to Expo Router too (`+native-intent.tsx`).
- E2E: only decide's search stack (:8020); `maestro/scripts/stack.js` talks only to gen `/api/test/*`; no decide test API.

## 2. Sign-in (decide ↔ gen)
- decide auth = own magic link + HS256 JWT (7 d verified, 30 d guest), `decide_users` keyed by sha256(email) / `guest_…`; random `user_<hex>` ids unrelated to gen (`decide/backend/services/auth_service.py`).
- No gen-token support anywhere. Phase 0 spec §4.2: `POST /api/auth/exchange-gen-session` with gen Bearer → read gen `sessions` read-only → upsert `decide_users` by email (migrating a guest) → decide JWT; app keeps both, re-exchanges on expiry.
- Must mirror gen `validate_session` (`karaoke-gen/backend/services/user_service.py:965-1030`): `is_active`, `expires_at`, 7-day idle, naive datetimes, disabled users, tenant sessions.
- Guest upgrade only migrates `user_songs` (cap 1000), not `user_artists` / `music_services` (`auth_service.py:487`).
- Both apps write `magic_links` in the same Firestore; decide's verifier would likely accept a gen magic link (fence it).
- Services connect/sync need `VerifiedUser`; quiz/recs/my-data/YT Music import accept guests.

## 3. Music services
### Spotify
- decide: server-side Authorization Code (secret, no PKCE), scopes `user-read-private user-read-email user-library-read user-top-read user-read-recently-played playlist-read-private`; endpoints `/me`, `/me/tracks` (500), `/me/top/{tracks,artists}` ×3 ranges, `/me/player/recently-played`. None removed by Spotify. Audio features come from our BQ dump, not the API.
- Callback 302s to the decide web frontend (hardcoded `FRONTEND_URL`, default locale); error URL carries raw exception text. Redirect URI is the Cloud Run HTTPS URL (`decide/infrastructure/__main__.py:287`, `.github/workflows/ci.yml:348`). `get_auth_url` doesn't URL-encode. Tokens stored in plain text. No `invalid_grant` handling.
- Client id/secret = `spotipy-client-id/secret`, shared with flacfetch (one Spotify app, one quota).
- Spotify policy: Nov 2024 removals (recs, audio-features, related artists) for new/dev apps; Feb/Mar 2026 dev mode = owner needs Premium, **5 allowlisted users**, `popularity`/`followers`/`email` fields removed; extended quota only for organisations with ≥250k MAU (since May 2025); refresh tokens expire 6 months after first consent (from Jul 2026); `localhost` redirects banned (loopback IP ok). Custom schemes "still work" but reportedly rejected on Android — so keep the HTTPS backend callback.
- Mobile design candidate (gen's checkout pattern): `connect` takes `return_to:"app"` (Literal, no open redirect) stored on the `oauth_states` doc; callback 302s to `nomadkaraoke://services/spotify?status=…&reason=<code>`; app refetches sync status.
### Last.fm / ListenBrainz
- Username only. Sync = `sync_jobs` doc + Cloud Task → `/internal/sync/process` on the API service (1800 s timeout): top 1000 tracks/artists, loved, full scrobbles 200/page, checkpoint every 1000. Status via `GET /sync/status`, 300 s heartbeat timeout. Retried tasks exit on `in_progress` (no auto-resume). `verify_cloud_tasks_request` only checks headers.
### YouTube Music
- Public/unlisted playlist URL import via unauthenticated `ytmusicapi` (sync). Limits 1000/500, 30 s cooldown, 20/day. Liked Music always private → UI guides copying into an unlisted playlist. Writes `user_songs` only. Stable 400/422/404/429/503 (not 502: Cloudflare replaces bodies).
### Apple Music
- Nothing built (only `"apple_music"` in a model Literal). Needs MusicKit key (ES256 dev token, ≤6 months, team `55B76HN73D`) signed server-side; user token on device; `/v1/me/library/songs`, `/v1/me/recent/played/tracks`, `/v1/me/history/heavy-rotation` (albums/playlists, not songs). `/me/*` needs an active subscription.
- Library: `@wwdrew/expo-apple-music` 1.1.3 (Expo module, SDK 56, iOS + Android via Apple's AARs, tiny adoption) best fit; Android SDK sign-in broke in Apple Music 6.5.0–6.5.2 (Jul–Sep 2026).

## 4. Quiz
- History: songs→artists (Jan 2026, recognition is faster), genre first, 22 genres + "other", multi-decade, energy/vocal comfort/hits-vs-deep-cuts, typed artists via Spotify-ID autocomplete (never free text), smart suggestions. Lessons: never remove shown artists, always say why suggested, sticky Finish, infinite scroll with `has_more` (`decide/docs/LESSONS-LEARNED.md:33-92`).
- Web flow 6 steps; smart-artist call is slow, prefetched when leaving step 3 (step 4 buys time). Progress autosaves (`PUT /api/quiz/progress`).
- Stores quiz_* fields on `decide_users`; each known artist adds top 5 songs to `user_songs` (source quiz).
- Smart suggestions final set is a random sample; "people also like" reads up to 500 `decide_users` per call (OOM history); submit writes per song serially; `ListenBrainzService` calls the **live MusicBrainz API** (breaks the BQ-mirror-only rule).

## 5. Recommendations
- `GET /api/my/recommendations` and `/categorized` (artists you know 15 / create your own 10 / crowd pleasers 10). Computed per request from Firestore context + BigQuery (KN raw ⨝ Spotify popularity); ~1.7 GiB per popular query, no cache, sync BQ `.result()` in async handlers.
- Weights: artist 0.35, Spotify pop 0.25, brand count 0.20, decade 0.08, vocal comfort 0.10, hits/deep ±0.08; max 3/artist; `MIN_BRAND_COUNT=3`.
- **Broken/ignored:** genre weight unused; decade never matches (no decade field); energy unused; explicit/duration filters echoed but not applied; `user_artists` (Spotify/Last.fm top artists) never read; songs already in `user_songs` excluded (so quiz top-5 hits never shown); cold users get one identical popular list.
- No-karaoke songs feed "Create your own"; link to gen web (mobile replaces with native make).

## 6. Filters and data sources
- Today backend applies only has-karaoke, popularity, classics (`is_classic` = brand_count ≥ 20). No sort param.
- Sources: genre = `spotify_artist_genres` / `mb_artist_tags` (artist-level); mood/energy = `spotify_audio_features` (pick one row per key by popularity, never per-column MAX); decade = `mb_release_groups.first_release_date` via `karaoke_recording_links`; popularity = Spotify static snapshot or `lb_*` listeners; voice gender = `mb_artists.gender` (solo only); duration = MB/Spotify.
- Per-request joins blow BQ byte caps → precomputed per-song facets table is the realistic path.

## 7. Library filter
- KN copies: `karaokenerds_raw` (301,862 rows, `Brands` codes) and `karaokenerds_community` (63,705). No code for KaraFun/Singa/Karaoke Cloud. kjbox registry aliases KaraFun and "Karaoke Cloud Digitrax" to KV (`kjbox/kj-controller/version_priority.py:31-32`); the Karaoke Cloud alias looks wrong (DigiTrax ≈ Chartbuster/CB).
- Phase 1b built `libraries`/`song_libraries` (source `kn_brand`, 10 community + 11 commercial brands) in the search indexes and offline.db; spec §5.4 planned real catalogues as new `source` values.
- KaraFun publishes a full CSV (karafun.com/karaoke-song-list.html) but terms say home/private use only, and the CSV link sits behind an anti-bot challenge. Singa: no export, terms "browsing only"; open Singa contact thread (Jan 2026, unanswered). Karaoke Cloud: no list.
- Community filter is buildable now from `versions.kind`.

## 8. Vocal range
- decide has only "vocal comfort" (enjoy-singing entries + quiz pref) used as an artist proxy. No pitch/tessitura data. decide VISION: crowd singability ratings → paid mic analysis → song min/max pitch.
- Backlog: best-effort LLM voice-type per song (AI Studio key only, never Vertex; memory `project_no_ai_spend_in_gcp_project`).
- On-device: `expo-audio` 57 `useAudioStream` gives live PCM (`onBuffer`) → `pitchy` MPM (MIT; avoid GPL `pitchfinder`). Fallback `react-native-audio-api`. `react-native-pitchy` can't take injected audio. Fake mic for Maestro: test-only flag feeding a bundled synthetic WAV through the same detector.
- Rule of thumb: note counts if held ≥500 ms within ±50 cents at clarity ≥0.9; report lowest/highest held + comfortable 10–90th percentile; "likely <voice type>". Ranges: bass E2–E4, baritone A2–A4, tenor C3–C5, alto F3–F5, mezzo A3–A5, soprano C4–C6.

## 9. Cold start
- decide lifespan loads all `karaokenerds_raw` (~281K rows) into memory before opening the port (~34 s), used only by sync matching (`decide/backend/main.py:31-50`, `bigquery_catalog.py:348-378`). 1 CPU/1 GiB, min 0, startup boost. CI deploy flags override Pulumi (check `ci.yml`).
- gen precedent: lazy imports + background preload thread, 39–71 s → ~14.5 s. Search service: min 0 + 60 s uptime ping (~$1–1.5/mo).
- Options: background/lazy catalog load, or reuse the search service's SQLite index; plus ping.

## 10. Local stack
- Exists: `scripts/search-local-stack.sh` (:8020), `scripts/start-emulators.sh` (Firestore :8080, fake GCS). Tests mock BigQuery.
- Missing for the main API: seeded Firestore, a BQ fake (repository layer with fixtures or bigquery-emulator), skip/fixture catalog load, gen-session exchange against gen's local stack, fake Spotify/Last.fm/LB/MB/YT Music/Apple.

## 11. ListenBrainz as the listening-history backbone (added after Andrew's 2026-10-21 pivot)
- LB account = MetaBrainz account (captcha, **verified email required** before LB accepts listens/connections). Android-only official app; no iOS app or deep link.
- MetaBrainz OAuth2/OIDC is live (https://metabrainz.org/.well-known/openid-configuration): scope `listenbrainz:submit-listens`; confidential clients only (PKCE + backend code swap); https callback only (bounce into the app like gen checkout). LB accepts `meba_` access tokens wherever a user token works.
- Restricted (ask MetaBrainz): `POST /oauth2/registration-requests` (create account in-app, email pre-verified, daily cap) and `listenbrainz:connect-services` (partner URL to connect the user's Spotify on LB from our app).
- Upload on the user's behalf: `POST /1/import-listens/` (multipart `file`, `service=spotify` zip etc., 200 MB, one running import per service per user), status `GET /1/import-listens/<id>/`. Spotify parser reads extended-history files only (not Account-data `StreamingHistory_music_*`). Stats lag up to 2 weeks (rebuild 1st/15th); listen counts update immediately → compute from raw listens, not LB stats.
- Read: `/1/user/{u}/listens` (≤1000/call, newest first; use export API for full history), `/listen-count`, `/1/latest-import`, stats endpoints (204 = not computed). Public by username. ~30 req/window rate limit. No webhooks → poll.
- LB's Spotify connect polls recently-played (last 50) under LB's extended quota, so it still works for ongoing listens. Last.fm/Libre.fm connect imports full history + new scrobbles. Apple Music: no listen import (Apple privacy export has a play-activity CSV we could parse).
- Spotify exports (spotify.com/account/privacy): Account data (~5 days; YourLibrary.json liked songs, playlists, 1 year StreamingHistory_music) vs Extended streaming history (≤30 days, lifetime, Streaming_History_Audio_*). We can parse either zip ourselves via share sheet / document picker (only way to use Account data + liked songs).
- Quick wins: logged-out `open.spotify.com/embed/playlist/{id}` returns ≤100 tracks with title+artist (grey area, may break); LB playlist import (`/1/playlist/import/spotify`) needs Spotify connected on LB; librespot = ToS violation + account-ban risk (not recommended).

## 12. Voice type → songs/artists (research 2026-10-21)
- Ground truth from our own audio: gen bucket has ~1,198 jobs with word-timed `lyrics/corrections.json` and kept inputs (retention keeps inputs+lyrics forever, `karaoke-gen/backend/services/storage_retention.py`); only 446 still have `stems/vocals_clean.flac` (stems purged 30 d; re-separate from inputs). NOMAD catalog vocals: 1,488/1,505 verified stems on NomadPC `/opt/nomad/downloads/NOMAD-vocals` (memory `project_kjbox_original_vocals_guide`). Est. ~2,000–2,700 distinct songs / 1,000–1,500 artists. Divebar/kjbox libraries are instrumentals (no lead vocal).
- Method: pyin or torchcrepe-tiny on vocal stems, frames masked to word timings; p5/p95 = robust low/high, median+IQR = tessitura. ~10–20 CPU-h total (<$2 Cloud Run Job) + re-separation <$10. NOMAD stems can be analysed on NomadPC (only the CSV leaves the box; never stream bulk via the Mac).
- Spotify BQ: key/mode/tempo/loudness only, no segment chroma; key ≠ range. Useful only for "original key" in transposition UI.
- MusicBrainz voice-type attributes: 0.5% of top-20k LB artists (classical-heavy). MB gender (solo) + lead-vocal band member gender ≈ 65% of top-20k → register prior.
- Wikidata P412 (CC0): ~4.7% of top-20k (32% of top-1k solo persons); coarse editorial labels. File: scratchpad `wd/p412_mbid.csv`.
- Range sites (Singing Carrots, Range Planet, Musicnotes, VoxNotes) proprietary → no scraping; UltraStar/USDB has per-syllable pitch but licence unclear (ask).
- Gemini Flash (AI Studio key): ~$5–20 for 20–50k artists, ~$30–80 for 100–200k songs; calibrate vs measured songs + P412, keep per popularity band where error ≤ ±3 semitones.
- Crowd: post-song "comfortable / too low / too high" + user range + key shift → per-song updates; kjbox may log KJ pitch shifts.
- Matching: semitones outside range at each end + tessitura-centring penalty, minimised over transposition t∈[−4,+4] (kjbox pitch-shifts live via mpv rubberband), ±12 octave allowance with mild penalty; artist fallback with wider tolerance; confidence tiers measured / estimated / rough.

## 13. UltraStar note data (research 2026-10-21; Andrew approved sourcing it)
- **archive.org `usdb_20250204`**: full USDB backup, 27,136 .txt in one 78 MB `usdb.zip` (`usdb/<id>.txt`), no login. Single files fetchable inside the zip. Pull straight to GCS/Cloud Run, not via the Mac.
- usdb.animux.de: login required (plain form, no email verification); ~30k ids; `index.php?link=list` (sorted by last change) + `index.php?link=gettxt&id=N` (`wd=1`, text in `<textarea>`), per bohning/usdb_syncer. Incremental refresh since 2025-02-04 ≈ 2–4k songs at 1 req/2 s. Needs one account (ask Andrew).
- ultrastar-es.org: Cloudflare + phpBB login; 10–25k songs, many copies of USDB; game-sourced editions (SingStar/Rock Band) likely octave-correct. Optional.
- GitHub collections tiny; archive.org WorldParty packs are solid .7z (no txt-only extraction); flacup torrent client supports file selection but disk is 8.6 GB.
- Format: MIDI = pitch + 60 (0 = C4); keep `:` and `*`, drop `F`, `R`, `G`; ms = GAP + beat×60000/(BPM×4); `#RELATIVE`; duets `P1`/`P2`; detect CP1252; tags `#ARTIST #TITLE #YEAR #GENRE #LANGUAGE` + USDB `#VIDEO:a=<youtubeId>` for joining.
- **Octave is untrusted**: USDX scoring folds octaves (`src/base/UNote.pas`), so 1-octave errors are common and silent; some files are transposed. Use raw files (not usdb_syncer `fix_pitch_values`). Trust span + tessitura (duration-weighted P10–P90); repair absolute octave with gender prior + our measured songs; store `octave_confidence`; prefer game-sourced / high-rated / reworked duplicates.
