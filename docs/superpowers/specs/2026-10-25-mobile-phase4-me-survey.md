# Phase 4 "Me": survey of earlier learnings (2026-10-25)

Raw survey for the Phase 4 spec ([2026-10-25-mobile-phase4-me-design.md](2026-10-25-mobile-phase4-me-design.md)), per memory feedback_mobile_port_existing_learnings. Three read-only passes: mobile session records + code, karaoke-decide docs + code, kjbox + memories + backlog. Paths are relative to the nomadkaraoke workspace unless absolute. The spec's §3 condenses what matters.

## A. Mobile session records and code

I've read every record you listed in full, plus the relevant code in the phase4-me worktree (branch `feat/sess-20261024-0045-phase4-me`, at main ba5d975). I also checked `docs/VISION.md`, the Phase 5 SDD ledger and BACKLOG 4.4.

### 1. Learnings, gotchas and decisions relevant to Me

### Andrew's words and UX decisions
- **Why the collection exists** (VISION.md, Phase 5 spec §1.1): "opt-in data collection to let the user see what songs they usually sing at karaoke, record what they do/don't enjoy so they can browse their own personal karaoke song collection easily if they do just want to sing something they've sung before for a given mood/event/headspace etc. 2) leverage that data to give the user truly useful karaoke song recommendations, to help power users get great recs from the app whenever they go to karaoke, whether they're at a nomad night or not".
- **BACKLOG 4.4 quote:** "collect data about songs they've sung, build up their own library of songs they enjoy singing at karaoke, leverage that data to give them a better experience at future karaoke nights by giving them much better data-driven recommendations, recommending karaoke-gen submissions".
- **VISION Me list:** your karaoke collection "browsable by mood, how it went and how often you sing it"; "Multiple playlists or setlists, plus a 'my songs' library"; "Get this made" = "songs you'd love that have no karaoke version, one tap to make them"; crowd singability "collected from post-song ratings from day one (for example, '72% of singers with your range found this comfortable')".
- **Song page actions:** "Every song page offers the same actions: add to a setlist, request tonight … or add to tonight …, make it, mark as sung." Only request/add to tonight and make it exist today.
- **Uncatalogued songs are first-class.** Andrew: "the rigidness of 'There's no free-text entry' may need to soften to protect some aspects of the user experience gracefully even without a decide catalog link". They must show in Me, count in "what I sing" and take the survey (Phase 5 spec §7.1).
- **Survey questions** are Andrew's list. It supersedes decide's older KaraokeHunt "why" list in `docs/USER-DATA-VISION.md`, and "Phase 4 may add those reasons as optional chips".
- **Survey notes** are stored verbatim. LLM tagging comes later, via the AI Studio key only, never AI spend in the nomadkaraoke GCP project.
- **Sign-in:** the app requires it, and decide accepts the gen token. "make everyone sign in so we can start storing their quiz data."
- **Recommendations:** "make decide's recommendation engine *actually good* … first pass … then continuing to brainstorm and iterate".
- **One platform:** Andrew wants "a single unified platform … helping them find songs to sing and make karaoke videos for anything which lacks one".

### Explicitly deferred to Phase 4
- 3a non-goal: "History, ratings, playlists (Phase 4)".
- Phase 5 non-goal: "The browsable collection, playlists, 'get this made', crowd singability aggregates: Phase 4". Also: "Survey answers are kept per record; Phase 4 builds aggregates", and "History lives in decide `karaoke_log`; Phase 4 browses it".
- 3c non-goal: "Crowd singability ratings (Phase 4 collects them; 3c only reserves the fields)". BACKLOG 4.4 adds that BigQuery `karaoke_decide.song_vocal_range` reserves NULL `crowd_comfortable`, `crowd_too_low` and `crowd_too_high` INT64 fields "— fill them here."
- Agreed between Phase 3 and Tonight: "recs consume sung history in Phase 4". Recs v2 already weights loved songs at 1.0 and unloved-but-sung songs at 0.6 (by design).
- Ledger E9-R8: the stored artist is the untranslated sentinel `"Unknown Artist"`, shown translated. "Phase 4/decide display should treat it the same."
- CLAUDE.md: "Me's sung history will be recorded on the phone first and synced later (Phase 4), per VISION's offline principle."

### Offline, sign-out and privacy patterns
- **Per-account MMKV keys use `userKeyFor(email)`** (sha256, `apps/mobile/src/auth/userKey.ts`). The karaoke log is `tonight.log.v1.<userKey>`, the outbox `tonight.outbox.v1.<userKey>`, survey marks `tonight.surveyed.v1.<userKey>`. Each store rehydrates in a `useAuth.subscribe` when the account changes (ruling E8-R1).
- **These keys are not wiped on sign-out.** They are only swapped. Contrast with:
  - `useClearDiscoverOnSignOut` (`apps/mobile/src/discover/useClearDiscoverOnSignOut.ts`), which removes the recs, profile and services queries, the quiz draft, offline picks and voice profile. Me's new queries and caches need adding to it, or to an equivalent.
  - `importQueue`, which purges the previous owner's data when a DIFFERENT account signs in ("another person's listening history must not stay on the phone").
  - The voice profile, which is cleared on sign-out even when it is still pending.
- **Offline snapshot pattern:** `apps/mobile/src/discover/recsSnapshot.ts` keeps one MMKV key, `{key, savedAt, data}`, where the key starts with `email\n` (`ownsRecsSnapshot`). It checks the shape on load and uses `isFresh` from `@nomad/core` (7 days).
- **Outbox pattern:** `apps/mobile/src/tonight/log/outbox.ts`.
  - FIFO, one item per id, coalesced with `mergePatch` (survey, night and media merge one level down). Revs guard writes that coalesce while one is in flight.
  - Drops 400/403/404/422 as permanent. On 401 it waits for the next trigger. Other errors back off from 5 s to 5 min.
  - A put after a delete is dropped for `app_` ids but wins for `kj_` ids.
  - `synced` counts accepted writes. `useKaraokeLogFreshness` (in `IdeasPanel.tsx`) uses it to invalidate `['decide', userKey, 'karaoke-log']`.
  - `useLogSync` flushes on mount, on reconnect and on foreground.
- **decide errors:** a decide 401 never signs out; it marks things stale (CLAUDE.md rule 5, `staleStore`). "Is this offline?" means `ApiError` status 0, not `!(e instanceof ApiError)`.
- **Two Firestore row rules:**
  - `user_songs` rows: use `{uid}:{kn_id}` if it exists, else `loved_doc_id`. Karaoke log, love and imports all merge additively into the same row, and `love()`/`unlove()` keep sung history.
  - `karaoke_log` docs: per user, doc id `{user_id}:{entry_id}`.
- **kjbox owns the facts on `kj_` records.** The app may write only `survey` and `deleted` (E8-R4). A 403 `not_owner` (kjbox hasn't delivered yet) is dropped as permanent.
- **Song ids:** recs use KN `song_id` but search and the song page use `song_key`; v2 maps via catalog.db `kn_song_map`. Anything new should store `song_key`.
- **offline.db must stay at schema 1, with additive changes only.** A bump would drop every installed phone's offline list; readers must probe columns.
- **The decide API loads catalog.db only at startup.** A new catalog needs a new revision.

### Maestro, E2E and i18n gotchas
- **iOS keeps app data across `launch.yaml`.** `clearKeychain` is not a sign-out and MMKV survives, so Me flows need explicit local cleanup, like `common/voice-clear-local.yaml`.
- **iOS 26 sheets:**
  - An RN Modal sheet opened right after another sheet or the keyboard sometimes has an empty accessibility tree, and it then sticks until a relaunch. Use `common/tonight-open-sheet.yaml` (relaunch and retry).
  - iOS drops an `Alert` raised while a Modal is dismissing; raise it from `onDismiss`.
  - Gesture-handler gestures get no touches inside Sheet; use Pressable.
- **Matching text:** container `View` testIDs don't carry their children's text on iOS. `isolate()` adds invisible marks, so text regexes should start with `.*`.
- **Android:**
  - `eraseText` on a prefilled field only deletes what is before the cursor.
  - The dev Tools button covers top-right controls.
  - An AVD left in airplane mode can't reach Metro.
  - `npx expo run:android` installs on any adb device, including Andrew's phone over wireless adb.
- **Ports and parallel runs:** iOS runs collide on driver port 7001. Maestro hangs if adb has no device and something listens on :5560/5561. Never run the iOS and Android suites at once against one stack. Tonight flows need decide on its default :8030.
- **Tests must not live under `src/app`.** `renderRouter` switches jest to fake timers.
- **Picks rows:** match them by accessibility text. To detect a change, compare the `rec-menu-…` button instead, because a row's text changes when it gains a badge.
- **i18n:** 33 locales, `pnpm i18n:translate` before commit (`env -u GEMINI_API_KEY`, via `scripts/gcp-admin` when gcloud has lapsed). No JSX literals. Use whole sentences with placeholders and say "host", not "KJ". Hermes lacks `Intl.PluralRules` and `DisplayNames` (polyfilled).
- **Process:**
  - Pulumi applies must come from main and be agreed across sessions.
  - CodeRabbit's CLI token is invalid; use a reviewer subagent.
  - Never use mouse or click automation on Andrew's Mac (the 3d incident).
  - Andrew phone-tests only after all phases.

### 2. Karaoke log record shape and survey enums

**On the phone** (`apps/mobile/src/tonight/log/logStore.ts`):
```ts
type LogState = 'planned' | 'requested' | 'sung' | 'skipped';
type LogEntry = { id: string; source: 'app' | 'kjbox'; state: LogState; artist: string; title: string;
  song_key?: string; night?: LogNight; sung_at?: string; survey?: Survey; updatedAt: number /* local ms */ };
```
- **Ids:** `app_<uuid>` for other bars; `kj_` + sha256(box_id:entry_id:gen_email)[:24] for Nomad nights.
- **Nomad entries reach the local store only through `noteNomad`,** which `useSurveyTrigger` calls while the night screen is showing. **The local store is not a full history mirror.** Nothing pulls `GET /api/my/karaoke-log` into it, and `IdeasPanel` queries decide directly with `limit: 500`.
- **Survey marks** (`surveyed`) are pruned after 30 days.
- Store methods: `addOther`, `noteNomad`, `setState`, `saveSurvey`, `skipSurvey`, `remove`, `rehydrate`.

**Generated decide types** (`packages/api-decide/src/client/types.gen.ts`):
- `KaraokeLogEntry` fields:
  - `id`, `user_id`, `email_hash?`, `source`, `deleted?`
  - `state?: planned|requested|sung|sung_unplayed|skipped`
  - `artist?`, `title?`, `song_key?`, `song_key_status?: resolved|unresolved` ("ambiguous" was dropped)
  - `night?: LogNight`, `sung_at?`, `ended_at?`, `created_at?`, `updated_at?`
  - `survey?: Survey`, `media?: LogMedia`
  - `box_id?`, `entry_id?`, `singers?: string[]`
- `LogNight = {id?, kind?: nomad|other, venue_name?, date?}` (date is YYYY-MM-DD).
- `LogMedia = {brand_code?, gen_job_id?, source_type?}`.
- `KaraokeLogPage = {entries, next_cursor?}`.

**Survey:**
```ts
Survey = { feel?: 'great'|'ok'|'bad'; key?: 'too_low'|'right'|'too_high'; crowd_pleaser?: boolean;
           notes?: string /* ≤2000 */; answered_at?: string }
```
- There is no mood field in the survey.
- **Facades** (`packages/api-decide/src/index.ts`):
  - `listKaraokeLog({since, nightId, limit, cursor})`: newest `updated_at` first; with `since`, deleted records are included.
  - `putKaraokeLog(id, KaraokeLogPatch)`: field-level merge.
  - `deleteKaraokeLog(id)`: soft delete.
- **Server side** (Phase 5 spec §7.1): on the transition to sung, decide increments `user_songs.times_sung` and sets `last_sung_at` (source `karaoke_log`), and decrements on delete. Unresolved records are counted by normalised artist + title and re-resolved daily.

### 3. The Me tab today

`apps/mobile/src/app/(tabs)/me.tsx` is a single scroll screen:
- Title.
- Signed in: credits, Buy credits, "Signed in as", and a **Your music profile** button (`me-music-profile` → `/me/music-profile`).
- Signed out: a Sign in button.
- `OfflineSongList` card, language, Sign out.

**There is no history, playlist or library UI yet.**

`apps/mobile/src/app/me/music-profile.tsx` uses `ProfileSection` cards (`apps/mobile/src/discover/profile/ProfileSection.tsx`, props `testID/title/empty/isEmpty/action`):
- Quiz answers (edit genres, decades), artists you love (remove), songs you love (remove), hidden songs (unhide).
- Music services (Apple connect).
- Connected sources (+ add more → `/discover/connect`).
- `VoiceProfileSection` (3c).

3d's "Find your voice", the recording-consent toggle and "Delete my recordings" aren't in mobile yet (3d D2–D8 are pending).

### 4. Reusable pieces
- **Song rows:**
  - `apps/mobile/src/discover/components/RecSongRow.tsx` takes `RecSong`: title, artist, reason chip, `LibraryBadge`, `FitBadge`, a loved heart, and a ⋯ menu. testIDs are `rec-row-*` and `rec-menu-*`.
  - `RecSection.tsx` provides `sectionTestId`.
  - `apps/mobile/src/tonight/other/LogRow.tsx` takes `LogEntry` and has the requested/sung/maybe actions, "How did it go?", copy/share YouTube link (`useYouTubeLink`: own gen job, then community) and remove.
- **Menu and feedback:**
  - `SongMenuSheet.tsx` offers only Not for me and Love it. There is **no "add to setlist" and no "mark as sung" anywhere yet.**
  - `useSongFeedback.ts` does optimistic hide with undo, plus love.
  - Facades: `hideSong`, `unhideSong`, `loveSong`, `unloveSong`, `listLovedSongs`, `listHiddenSongs` (`packages/api-decide/src/discover.ts`).
- **Survey and aggregation:**
  - `SurveySheet` (`apps/mobile/src/tonight/log/SurveySheet.tsx`, props `entryId/artist/title/initial/onDone`) is reusable from Me. It is wrapped in `TonightSheet` (`holdsSurvey={false}`).
  - `mostSung()` in `IdeasPanel.tsx` is an existing aggregation (NFKC-normalised artist + title, counting sung and sung_unplayed).
- **Song page** (`apps/mobile/src/app/song/[id].tsx`): `SongTonightAction` (Request tonight / Add to tonight, hidden with no night), `SongFitCard`, and Make it.
- **Make entry point:**
  - `useMakeIntent.getState().set(identifiedIntent({artist, title, song_key}))`, then `router.push('/make/new')`, or `openSignIn('/make/new')` when signed out.
  - The intent persists in MMKV `make.intent.v1` with a 30-minute TTL (`apps/mobile/src/make/intentStore.ts`).
  - Discover's "Make it" section rows already do this (`makeIdentified` in `(tabs)/discover.tsx`, where `section.id === "make_it"`). "Get this made" can reuse it.
  - Free text goes to `/song/new` with `typedIntent`.
- **decide APIs that exist but have no app facades:**
  - `GET/POST /api/playlists`, `GET/PUT/DELETE /api/playlists/{id}`, `POST /api/playlists/{id}/songs` (`{song_id}`), `DELETE …/songs/{song_id}`.
  - `GET /api/my/songs` (`UserSongResponse` has `times_sung`, `is_saved`, `source`, `play_count`).
- **Playlist gap:** `PlaylistResponse` holds only `song_ids[]` and a count, with no `song_key`, artist/title or ordering. Setlists will likely need decide changes.
- **"Make it" recs:** v2 already has a "Make it" section (songs with no karaoke version; catalog.db has about 30k such songs).

### 5. Open follow-ups Phase 4 should pick up
- **Crowd singability:** fill the `crowd_comfortable`, `crowd_too_low` and `crowd_too_high` fields in `song_vocal_range` from survey `key` answers, with privacy thresholds. Nothing exists yet.
- **Recs v2 from sung history and survey answers** (agreed with Tonight). Also measure prod warm latency of recs v2 with a voice profile (BACKLOG item, and a deferred 3c minor).
- **Optional "why" chips** from USER-DATA-VISION on the survey (Phase 5 spec §6.3).
- **Treat the `"Unknown Artist"` sentinel the same way** in Me and decide display (E9-R8).
- **Prune per-night MMKV keys** (BACKLOG Phase 6 hooks). This includes the `turnAlerts` keys, and the local log, which is never pruned.
- **Phase 5 ledger minors:**
  - A permanent 4xx drops a whole coalesced put (E8).
  - An expired token waits for the next trigger.
  - Renaming the venue doesn't update earlier entries (E9).
  - decide C1: a user-supplied `song_key` is trusted as resolved without an existence check.
  - The failed-outbox notice is phone-log-only.
- **First real Nomad night check** before 4.5 is finished: a linked singer's Done should reach decide's `/api/my/karaoke-log`.
- **3d before G1:** account deletion must cover the voice deletion set. Phase 6 `DELETE /api/users/me` must also cover karaoke_log and playlists.
- **Gen Pulumi stack has drift** from other worktrees: use `--target` for new resources. Any decide `pulumi up` must come from main.
- **Release:** `/backlog-finish` 4.3 only after 3d ships. The release APK and phone testing wait until all phases are done.

## B. karaoke-decide docs and code

### Karaoke-decide survey for nomad-mobile Phase 4 "Me"

All paths are under `/Users/andrew/Projects/nomadkaraoke/karaoke-decide-phase4-me` unless noted. HEAD is d73e772 (v0.28.1).

#### 0. The 3d branch is already merged
`/Users/andrew/Projects/nomadkaraoke/karaoke-decide-voice-session` (`feat/sess-20261022-1808-voice-session`) has the same tree as squash commit **02252db (#187, v0.28.0)**, which is on origin/main. `git diff 02252db HEAD` is empty. `git diff origin/main --stat` only shows #188's files as "deletions" because the branch predates #188. So there is no separate merge-conflict risk: best-of-`sources` weighting and `voice_session` are already in main, and Phase 4 should build on top of them. Details in §3.

#### 1. Endpoints and schemas you can reuse
Every user route uses `CurrentUser` (`backend/api/deps.py:get_current_user`), which accepts a decide JWT **or a gen session token**. Mobile can call all of these with its gen token.

- **Karaoke log** (`backend/api/routes/karaoke_log.py`, `backend/services/karaoke_log_service.py`, model `backend/models/karaoke_log.py`). Full contract is in `docs/API.md` around lines 95-133.
  - `GET /api/my/karaoke-log?since=&night_id=&limit=100&cursor=` returns `{entries, next_cursor}`, newest `updated_at` first. With `since` it is a sync pull that includes deleted records.
  - `PUT /api/my/karaoke-log/{id}` upserts with a field-level merge. The app owns all fields on `app_` ids; on `kj_` ids it may only set `survey` and `deleted`.
  - `DELETE /api/my/karaoke-log/{id}` soft-deletes.
  - Entry: `{id, source: kjbox|app, state: planned|requested|sung|sung_unplayed|skipped, artist, title, song_key, song_key_status, night{id,kind,venue_name,date}, sung_at, ended_at, created_at, updated_at, survey{feel: great|ok|bad, key: too_low|right|too_high, crowd_pleaser: bool, notes≤2000, answered_at}, media{brand_code,gen_job_id,source_type}, deleted, box_id, entry_id, singers}`.
  - There is no per-song aggregation endpoint and no "history" endpoint. `GET /api/my/history` and `POST /api/my/songs/{id}/sung` are listed under "Not Yet Implemented" (`docs/API.md:1835`).
- **Loved / hidden** (`backend/api/routes/my_songs.py`, `backend/services/song_feedback_service.py`).
  - `GET /api/my/songs/loved` and `GET /api/my/songs/hidden` return `{songs: [{song_key, artist, title, created_at}]}`.
  - `POST` / `DELETE /api/my/songs/{song_key}/love` and `/hide` return 204. The optional body `{artist,title}` skips the catalog lookup.
  - Love writes onto the same `user_songs` row the karaoke log counts into. The row is picked by `choose_user_song_row`: `{user_id}:{kn_id}` if that row exists, else `loved_doc_id`. `list_loved` runs two queries, `loved==True` and legacy `source=="manual"`.
- **Library** (`backend/api/routes/recommendations.py:get_my_songs` calling `RecommendationService.get_user_songs`).
  - `GET /api/my/songs?page&per_page` returns `{songs:[{id, song_id, artist, title, source, play_count, playcount, rank, spotify_popularity, is_saved, times_sung}], total, page, per_page, has_more}`.
  - It sorts by playcount/rank in memory over at most 1000 docs. There is no loved/sung filter, and `loved`, `last_sung_at`, `sources` and the session fields are not returned.
  - **Likely bug (from reading the code, not run):** the `UserSong.source` Literal in `karaoke_decide/core/models.py:114` has no `"karaoke_log"`, but the karaoke log (`_inc`) and `import_ingest_service.remove_source_data` both write rows with `source: "karaoke_log"`. `get_user_songs` builds `UserSong(source=doc.get("source"))`, so this endpoint would probably fail with a 500 for anyone who has sung a song that wasn't already in their library. No test covers that case.
- **Playlists** (`backend/api/routes/playlists.py`, `backend/services/playlist_service.py`, collection `playlists`). Mounted at `/api/playlists`.
  - Routes: `GET ?limit&offset` returns `{playlists, total}`. `POST {name≤100, description≤500}` returns 201. `GET`/`PUT`/`DELETE /{id}`. `POST /{id}/songs {song_id}` ignores duplicates. `DELETE /{id}/songs/{song_id}`.
  - Response: `{id, name, description, song_ids: [str], song_count, created_at, updated_at}`.
  - `song_ids` are opaque strings with no artist/title stored and no ordering or reorder API. The web page (`frontend/src/app/[locale]/playlists/page.tsx`) just prints the raw ids. For setlists you'd want song_key plus denormalised artist/title, and an order.
  - `list_playlists` orders by `updated_at` with a `user_id` filter. That needs a composite index which `docs/ARCHITECTURE.md` lists as "needed" but `infrastructure/__main__.py` does not declare. It may exist only by hand; check before relying on it.
- **Known songs / enjoy singing**: `/api/known-songs*` (`docs/API.md:1662`) is the older manual-add flow.
- **Web frontend**: there is no history or "Me" page. `/my-songs` redirects to `/my-data`. `/playlists` exists. Nav: recommendations, music-i-know, playlists, settings. `frontend/src/components/MyData/YourSongsSection.tsx` uses `/api/my/songs`.

#### 2. karaoke_log in Firestore
- Doc id is `karaoke_log/{user_id}:{entry_id}` (`log_doc_id`). It stores the fields above plus `user_id`, `email_hash`, and `counted: {collection, doc_id}`. Timestamps are ISO strings. A placeholder has `state` None, created when the app writes a survey to a `kj_` id before kjbox delivers it.
- Counters are kept in one transaction (`_transact`, `_inc`, `_dec`):
  - A resolved song increments `user_songs.times_sung` and `last_sung_at`. If no row exists, one is created with `source: "karaoke_log"`, `song_id = song_key`, `song_key`.
  - An unresolved song increments `user_karaoke_unresolved/{user_id}:{sha1(norm)[:24]}` (`norm_key`, `times_sung`).
  - Unresolved records are retried at most once per 24h per user, on GET (`retry_unresolved`, marker `karaoke_log_retry_at` on the `decide_users` doc).
- **The survey is never copied to `user_songs` or anywhere else.** It lives only on log docs.
- **Indexes: none.** `list_for_user` and `retry_unresolved` run one equality query on `user_id`, then filter, sort and page in Python ("no composite index"). Pulumi only declares indexes for `sync_jobs` and `decide_users` (`infrastructure/__main__.py:196-260`). Any cross-user aggregation, such as crowd stats by song_key, has no index today.

#### 3. Recs v2 and where sung history and survey answers would plug in
Pipeline (`backend/services/recs_v2/`): `service.py` runs `context.build_context`, then `candidates.gather_candidates`, then `scoring.score`, then `sections.build_sections`.

- **`context.py`**
  - `build_context` gathers the user doc, every `user_songs` row, `user_artists` and hidden keys.
  - `_map_songs` turns each row into `known_songs[song_key] = max(_base_weight(d), w.session_song_weight(d))`. It also fills `known_without_karaoke`, a per-artist song count, and `session_no`.
  - **Plug-in point A (sung history):** `times_sung` and `last_sung_at` are on the same rows but are ignored. A `karaoke_log`-source row falls through `weights.song_weight` to `SONG_DEFAULT = 0.6`. Add a sung-weight term here, next to `session_song_weight`.
  - **Plug-in point B (survey):** survey answers aren't on `user_songs`. Either denormalise the latest or aggregated survey onto the row inside the karaoke-log transaction (the way 3d writes `session_*` fields), or have `build_context` also query `karaoke_log` by `user_id`. The analogues are `session_no` (a penalty set) and the `session_*` boosts.
- **`weights.py`** holds all constants: `song_weight`, `session_song_weight`, `SESSION_NO_PENALTY = 0.15`, `SCORE_*`, `W_FIT = 0.15`, `FIT_AFFINITY`. New `SONG_SUNG_*` and `SURVEY_*` weights go here.
- **`scoring.py:score`** is a weighted sum plus the `session_no` penalty and the `crowd_pref` bonus.
  - A survey penalty (`feel: bad`) or key adjustment (`key: too_high/too_low` changing the fit transpose) would go here or in fit.
  - A `crowd_pleaser` survey answer could feed a crowd term.
  - `ReasonType` would need new values, for example `sung_before`, plus matching `REASON_TEXT` entries in `service.py`.
- **`sections.py:_best`**: sections are `songs_you_know`, `artists_you_love`, `because_*` (at most 2), `crowd_pleasers`, `make_it`, with limits in `SECTION_LIMITS`. A "your go-tos / sung before" shelf would be a new `_Slot` before `songs_you_know`.
- **What 3d changed (all in main now):**
  - `context._row_sources` / `_base_weight` use the best of `sources`. Imports only add to `sources` and keep the first `source`.
  - `SESSION_SOURCE = "voice_session"` rows weigh 0 unless labelled or loved.
  - Added `session_no` / `SESSION_NO_PENALTY`, and session-only rows don't count toward their artist.
  - `UserSong` gained the `session_*` fields and `"voice_session"`.
  - Phase 4 edits to `_map_songs`, `weights.song_weight` and `scoring.score` touch exactly the lines 3d wrote. There is no branch conflict left, but keep the best-source `max()` and session semantics intact. `backend/tests/recs_v2/test_context.py` pins them.
- The karaoke log never adds `"karaoke_log"` to `sources`, and `UserSong` doesn't list it (the bug in §1).

#### 4. "No karaoke version" songs, and the existing "Make it" section
- **Truth:** `HAS_KARAOKE_SQL` (`filters.py:60`) is `catalog.db songs.in_kn = 1` OR the key is in `availability.db av.songs`. The search service's daily index carries `versions.kind` (community/commercial), and the library flags come from `library_clause` (`karafun` = KN brand `KV`). `Candidate.has_karaoke`, `community`, `commercial` and `karafun` come from `_Gatherer.availability()`. `CatalogReader.has_karaoke_key` and `match_kn` are used for user rows.
- **API:** each `RecSong` has `has_karaoke_version` and `karaoke{community, commercial, karafun, brand_count}`. The filter `has_karaoke=yes|make|any`.
- **Recs already produce these songs:**
  - `make_it` section, limit 10, `reason_type: "make_it"`.
  - Candidates come from `g.per_artist(known_artists, MAKE_IT_SONGS=10, g.no_karaoke_cond())`.
  - Known songs without karaoke (`ctx.known_without_karaoke`) are added as facet-less `_outside_catalog` candidates, but only on unfiltered requests.
  - Known songs with no karaoke version are kept out of `songs_you_know` and land in `make_it`.
- So a "Get this made" list is effectively `GET /api/my/recommendations/v2?has_karaoke=make` (flat or best) or the `make_it` section. The gen handoff is a frontend concern (`docs/VISION.md` "Integration with Karaoke Generator").
- `catalog.db` drops songs with no LB/Spotify popularity, so rare songs only appear through `known_without_karaoke`.

#### 5. Crowd aggregates
- **The placeholders already exist:** BigQuery `nomadkaraoke.karaoke_decide.song_vocal_range` has `crowd_comfortable`, `crowd_too_low`, `crowd_too_high` (INT64, always NULL). They're set in `karaoke_decide/etl/vocal_range_refresh.py:164` (`CROWD_FIELDS`), filled with None around lines 600-601 (`dict.fromkeys`), and documented in `docs/DATA-CATALOG.md:1033`. They are **not** carried into `catalog.db` or `offline.db`: the `vr_*` columns in `karaoke_decide/catalog/build.py` and `bq_source.py` have no crowd columns. Serving crowd data from recs means adding `catalog.db` columns, which needs a schema bump and the gate.
- **Natural home for the job:** the weekly `mb-refresh` `vocal_range` step (Sunday 10:00 UTC, scheduler `mb-refresh-weekly`, Pulumi `infrastructure/__main__.py:595-680`). The catch is that **the `mb-refresh` SA has no Firestore role** (only BigQuery jobUser/dataEditor and bucket objectAdmin). Reading `karaoke_log` from there needs a `roles/datastore.viewer` grant like `vocal-range-gen` has (line ~1365), or an export of survey rows to BigQuery. Other Pulumi job patterns:
  - `lb-poll`: daily, `datastore.user`.
  - `voice-pool-*`: hourly, `datastore.user` + BigQuery.
- **Firestore-side pattern:** 3d's `voice_version_stats/{video_id}` counters are bumped inside the attempt transaction (`backend/services/voice_session_outputs.py:bump_version_stats`). The same approach could keep per-song survey counters live in `KaraokeLogService._transact`. But "72% of singers with your range" needs counts by voice-range bucket, so either key the counters by `song_key` + voice bucket, or compute them in batch, joining each user's `decide_users.voice_profile`.
- **Privacy rules: none in code or docs.** There are no k-anonymity or minimum-count thresholds anywhere (I grepped for crowd/privacy/k-anon). The only personal-data rules are `docs/ARCHITECTURE.md` § "Personal data", covering voice recordings and the Phase 6 account-deletion contract (`DELETE /api/users/me` must purge voice data and undo session writes to `user_songs`). Phase 4 would set the first threshold policy. It should also add karaoke_log, survey and aggregate cleanup to that deletion contract. `POST /api/test/voice/reset` (`test_support.py::reset_voice`) is named there as the template.

#### 6. Guidance from the vision docs
- **`docs/USER-DATA-VISION.md` § "Future: Songs You Enjoy Singing":**
  - Keep "Songs You Know" (listening) separate from "Songs You Enjoy Singing" (sung and rated).
  - The post-song survey covers whether they enjoyed it and why: out of range, too hard, crowd didn't respond, awkward instrumentals, too long, or perfect.
  - Goals: build a personal "safe songs" list, inform recs, remember what worked.
  - Two archetypes: rich-data users with Last.fm, who mainly need sung tracking, and limited-data users, who need easy manual entry.
  - Manual known songs should show in "Songs You Know" with a manual badge, and songs should show whether a karaoke version exists.
  - Principle: keep each source's data separate, with source badges.
- **`docs/VISION.md`:**
  - Playlists are "saved karaoke lists" (line 46).
  - "Personal History Mode": track songs sung and how they went, build a go-to list, learn from ratings and notes (lines 105-110).
  - No karaoke version leads to a "Make it with Nomad Karaoke Generator" one-click handoff (lines 30-33, 112-120).
  - Vocal range Phase 1 is crowd-sourced singability: after singing, ask how comfortable it was (Easy / Just Right / Challenging / Too Hard), aggregate per song, optionally split by self-reported vocal type. Sample model `song_singability_ratings{song_id,user_id,rating,user_vocal_type}` (lines 156-185). Phase 2 is a paid personal analysis cross-referenced with crowd data.
  - Weighting table: loved song 1.0, hated -1.0 (lines 330-342).
  - § "Transparency Over Library Illusion": don't pretend to have data you don't. "My Data" § 5 Feedback lists loved, hidden, vocal range and karaoke history (lines 345-430).
  - MVP checklist has "post-song survey and tracking" and "social / group playlists" as future items (lines 458-465).
- **`CLAUDE.md`:** song and artist input must use autocomplete with catalog/Spotify IDs, never free text. Store IDs and denormalise names. TDD is mandatory, plus i18n for frontend strings, and version bumps.

#### 7. Test API and local-stack hooks for Maestro
`backend/api/routes/test_support.py`. These routes are mounted only with `DECIDE_TEST_API=1` outside production (`backend.main._mount_test_support`). Setup is in `docs/TESTING.md` § Local stack: decide on :8030 and search on :8020, sharing gen's Firestore emulator at 127.0.0.1:8080 (project `test-project`), with gen tokens from :8010 `POST /api/users/auth/google {"id_token":"fake:me@example.com"}`. Commands: `scripts/local-stack.sh up|status|down|env`, or `make stack-up`.

- `POST /api/test/profile/reset {email}`: `_clear_user_data` clears `user_songs`, `user_artists`, `user_hidden_songs`, `karaoke_log`, `user_karaoke_unresolved` and `quiz_progress`. **It does not clear `playlists`** (not in `USER_OWNED`), so Me flows that use playlists need that added.
- `POST /api/test/profile/seed {email, artists[{name,affinity}], genres, decades, energy, quiz_completed, loved[song_key], hidden[song_key]}`. It can't seed sung history or surveys. Today you have to PUT `/api/my/karaoke-log/app_…` with the user's token, or use the partner route with `X-Kjbox-Secret: local-stack-secret`.
- `GET /api/test/profile?email=`
- `GET /api/test/karaoke-log?email=` returns `{user_id, entries (all, including deleted and placeholders), sung: [{song_key,artist,title,times_sung,last_sung_at,source}], unresolved: [...]}`.
- Voice: `POST /api/test/voice/seed {email, profile}`, `GET /api/test/voice/sessions|recordings?email=`, `POST /api/test/voice/reset`.
- Also `POST /api/test/listenbrainz/poll`, `PUT /api/test/fake-externals`, and `POST /api/test/fake-{listenbrainz,lastfm}/users`.
- Fixture `catalog.db` comes from `python -m karaoke_decide.catalog.fixtures build`, and the fixture `voice.db` is built into `.local-stack/voice`. Crowd-stat E2E would need fixture data, or a test hook that runs the aggregation in-process, like `/api/test/listenbrainz/poll` does for the poller.

## C. kjbox, memories and backlog

I've read every memory file you listed, the kjbox code, decide's karaoke log and BACKLOG.md. Three things matter most for Me. "When was it sung" means different things in different places. The outbox is already filling decide's `karaoke_log`, which can be the Me history feed. And `user_songs.times_sung` is already counted.

### 1. Sung history: timing gotchas and data sources

**Timing (the main trap).** Three different timestamps get called "when it was sung":
- **Night Log `sung_at` is the song's END.** It equals `done_at`, the moment the KJ ticked Done. The real start is a separate `started_at` field, taken from `play_events`. See `/Users/andrew/Projects/nomadkaraoke/kjbox/kj-controller/night_log.py` around line 326–379.
- This bit us on 2026-10-16 (kjbox #284, v0.134.1). The night-clips tool matched phone clips on `sung_at` and tagged every clip with the PREVIOUS singer. It now matches on `started_at`, and songs ticked Done without ever playing are dropped. The memory's rule: any consumer of Night Log times should use `started_at` for "when it was on stage".
- **The outbox does it the other way round.** In `/Users/andrew/Projects/nomadkaraoke/kjbox/kj-controller/history_outbox.py`, `sung_at` is the first live play start (`stats_store.first_play`) and `ended_at` is `done_at`. If an entry was marked Done without playing, `state` is `"sung_unplayed"` and `sung_at` is null. This matches VISION's "at the time it started, not when the host ticked Done".
- **Clock quirks:**
  - `play_events.played_at` is UTC; `done_at` is box-local time.
  - In the DST fall-back hour, `ended_at` can come out earlier than `sung_at`. The outbox clamps it.
  - Nights roll at noon (`night_of`), but `_live_night` treats a reset before 06:00 as part of the previous night.

**How the Night Log rebuilt old nights** (memory `project_kjbox_night_log.md`; kjbox v0.129.0, #273):
- From 2026-10-14 onward, `rotation_archive` keeps `entry_id`, `done_at` and the download/gen fields, so those nights are exact.
- Earlier nights are best-effort, in this order:
  1. Link `file_path` → `media_id` → that singer's `play_event` that night (which carries the original entry id) → `sing_request.linked_entry_id`.
  2. If that fails, a request reviewed within 5 s of the entry being created, with the same singer, or with both title and artist matching.
- Known gaps in old nights:
  - Some songs have no time (Oct 8: 71 of 81 timed).
  - Unlinked entries show as KJ-added ("no singer request found").
  - "Fetched tonight" is guessed from when the file first appeared in the library.
- If you backfill Me from the box, suspect these heuristics before blaming the UI.
- Routes: `GET /history/nights?min_songs=` and `GET /history/night?night=YYYY-MM-DD`. `GET /history/night-media?night=` returns `started_at` plus per-song consent (`postable`).

**Other sung-history data on the box:**
- `play_events` (`stats_store.py`, v0.55.0) is append-only, deduped to one row per rotation entry, and keyed by `media_id`.
- Songs are grouped by `group_key`, singers by normalized name. There's a backfill script, and the box had 786 real plays as of July.
- Read routes: `/stats/singer_songs`, `singer_song_history`, `night_setlist`, `most_repeated`.
- Identity matching is by name only, which is fuzzy.

**Name gotchas** (memories `project_kjbox_self_rename_sung_history.md`, `project_kjbox_merge_singer_identity.md`):
- Shared phones and self-renames used to rewrite Done entries (Roy & Roy, v0.126.1). A rename now skips Done entries.
- `singer_aliases.origin` is either `kj` or `self`, and only a `kj` merge counts as a canonical identity.

### 2. What the outbox sends to decide, and how it dedupes

Flow: `PUT {decide}/api/partner/kjbox/karaoke-log/{history_id}` with header `X-Kjbox-Secret`. An un-done entry sends a `DELETE` with `?gen_email=`; a 404 or 410 on delete counts as success.

**Dedupe keys:**
- `history_id = "kj_" + sha256(f"{box_id}:{entry_id}:{email}")[:24]`, with the email lowercased. Defined in `/Users/andrew/Projects/nomadkaraoke/kjbox/kj-controller/history_ids.py`.
- `GET /sing/api/v1/me` hands out the same id in `sung_tonight[].history_id`, so the app and decide agree on it.
- `night_id = sha256(f"{box_id}:{night_started_at}")[:16]`; `box_id` defaults to `nomadpc`.

**Payload fields:**
- `history_id`, `gen_email`, `source:"kjbox"`, `box_id`, `night_id`, `night_date`, `entry_id` (sent as a string: an int gets a 400).
- `artist`/`title`: from the singer's request, else the media library's identity for the first play, else a split of the rotation text.
- `sung_at`, `ended_at`, `state` (`sung` | `sung_unplayed`).
- `singers[]` (at most 6), `venue {kind:"nomad", name: kj_name}`.
- `media {source_type, brand_code (NOMAD-####), gen_job_id}`.

**Who gets a record:**
- The account that owns the request, never for a "song for a friend" (that's the friend's performance).
- Any account whose name is on the entry (duet partner, host-typed entry), but only if nobody else claimed that name tonight. Otherwise `history_id` is null.

**Delivery behaviour:**
- Only tonight is compared, so a New Rotation never retracts last night's songs.
- A change in who's attributed never retracts a song that was already sent.
- Retries back off from 30 s up to 30 min. A 4xx (other than 429) retries daily, then gives up after 7 days.
- With no decide config it does nothing and the rows stay queued.

**Decide side** (`/Users/andrew/Projects/nomadkaraoke/karaoke-decide/backend/services/karaoke_log_service.py`, `backend/models/karaoke_log.py`):
- Documents live at `karaoke_log/{user_id}:{id}`.
- On `kj_` records, kjbox owns the facts; the user may set only `survey` and `deleted`.
- A survey written before kjbox delivers creates a placeholder with `state` None. `list_for_user` hides placeholders.
- `app_` ids (other bars) are fully owned by the user.
- **Survey model:** `feel` (great/ok/bad), `key` (too_low/right/too_high), `crowd_pleaser` (bool), `notes` (up to 2000 chars), `answered_at`.
- **Counters:** each counting record adds 1 to `user_songs.times_sung`, using the same row-choosing rule as "Love it". Songs that can't be matched to the catalog go to `user_karaoke_unresolved` instead. All of this runs in one Firestore transaction, so nothing double-counts.
- A state of `planned`, `requested` or `skipped` exists in the model already, which could serve setlists.

**Still open:**
- Before `/backlog-finish` 4.5, someone must confirm on a real night that a linked singer's Done reaches decide.
- INBOX: the KJ dashboard has no notice for permanently failed outbox rows.

**Singer-facing "my history" today:**
- sing.nomadkaraoke.com has a collapsed "Ideas" section, `renderInspiration` in `static-sing/sing.js` around line 2889. It calls `/sing/my-stats?name=`: the singer's past songs matched by normalized name (50 max, with `last_sung`) plus the venue's top 10.
- The app's v1 `/my-stats` deliberately returns only `top_songs`, with no name lookup.
- Web singers can tap "Save tonight's songs to your Nomad Karaoke account" to claim the night.

### 3. Crowd singability

- BACKLOG 4.4 note from 3c: BigQuery `karaoke_decide.song_vocal_range` has NULL INT64 columns `crowd_comfortable`, `crowd_too_low` and `crowd_too_high` reserved for the survey's `key` answers. Phase 4 should fill them.
- VISION's example: "72% of singers with your range found this comfortable".
- 3c gotcha: the decide API loads `catalog.db` only at startup, so a new catalog needs a new revision or a deploy.

### 4. The karaoke-candidates tool: could it power "get this made"?

Memory `project_karaoke_candidates_tool.md`; decide v0.5.0 #132, command `karaoke-decide candidates suggest|reject|review-rejects`.

**Pipeline**, cheapest step first:
1. Last.fm top tracks in playcount order.
2. Drop songs on the reject list (`candidates/rejects.jsonl`).
3. Drop "already ours": a fresh query of gen's Firestore `jobs`, excluding failed/cancelled.
4. Drop songs KaraokeNerds already covers (BigQuery dump).
5. Require a Spotify audio-features match. Pick one row per song by popularity; taking MAX per column mixes live and studio versions.
6. Require LRCLIB lyrics.
7. Suitability score (`--min-score` 45).
8. Gemini 2.5-flash judge via Vertex with ADC, keyed by lyrics hash and leaning towards keep.
9. flacfetch high-quality FLAC dry run as a hard gate.

**Fit for "get this made":** the elimination logic is reusable. The pieces are in `karaoke_decide/candidates/*`, `services/{spotify_features,llm_judge,lrclib,flacfetch,gen_jobs}.py`. But today it's a CLI aimed at one Last.fm user (`lastfm_username` has no default), and each run does a ~30 GB BigQuery scan.

For the app, a cheaper version could be: the user's songs (`user_songs`, loved, recs) minus songs with a karaoke version (the song index's `karaoke:true` / KaraokeNerds coverage, `catalog.db`), plus maybe the LLM judge and a flacfetch check.

Caveats:
- The judge uses Vertex Gemini in the nomadkaraoke project. VISION says notes tagging must use the AI Studio key only, never AI spend in that GCP project. That rule may need applying here too.
- The tool only proposes. Andrew asks before any job is created (`feedback_job_creation_candidates_only`).
- kjbox gotcha (v0.130.0): the song index marks most songs `karaoke:true`, so "no karaoke version" really only shows for obscure songs.

### 5. The requests voting board: reuse?

Memory `project_gen_requests_voting_board.md`; requests.nomadkaraoke.com, gen v0.219–0.226.

- **Data:** Firestore `song_requests` / `song_request_votes`, one vote per day (doc id `{email}__{YYYY-MM-DD}`). Requests are deduped through `match_judge` canonical plus `normalize_for_match`.
- **Routes:** `GET/POST /api/requests-board/requests`, `/requests/{id}/vote`, `/me`.
- **Community check:** `karaokenerds_service.check_community_versions` / `POST /api/catalog/community-check` already answers "does a community version exist?". Usable for the "no karaoke version" decision.
- **Daily free pick:** picks one track per day, creates the job as the requester, and emails up-voters when it publishes (`backend/services/community_publish.py`).
- **Reuse options:** a Me "get this made" item could offer "request it / vote on the board" as a free path next to one-tap Make.
- **Open follow-up:** a fallback that auto-submits trending candidates when the board is empty, deferred to the AUTOGEN TRENDING agent item (BACKLOG around line 282). It's meant to use `candidates` plus KaraokeNerds.
- **Gotchas:**
  - gen's `apiFetch` doesn't attach the bearer token automatically.
  - Re-voting must be idempotent.
  - gen is a public repo, so no real emails or IDs in docs.

### 6. Other existing decide APIs

In `/Users/andrew/Projects/nomadkaraoke/karaoke-decide/backend/api/routes/`:
- `playlists.py`: full CRUD plus add/remove songs. This is the "some exist" in BACKLOG.
- `my_songs.py`: loved and hidden.
- `known_songs.py`: includes `/enjoy-singing`.
- `my_data.py` and `karaoke_log.py`: list with a cursor, PUT, DELETE.

Apple Music gotcha: any new `UserSong.source` value (e.g. a new `karaoke_log` source) must be added everywhere at once: the source Literal (a missing one returned 500), recs v2 `_TOP_SOURCES` and `song_weight`, the web `SourceBadge`, and the disconnect allowlist.

### 7. Backlog items relevant to Me

- **4.4 Mobile Phase 4 "Me"** (WIP, started 2026-10-24, worktrees `nomad-mobile-phase4-me` and `karaoke-decide-phase4-me`): "Sung history + quick rating (collect crowd singability data from day one), multiple playlists/setlists + 'my songs' library, 'get this made' suggestions (songs you'd love with no karaoke version → one tap to make). Backend: decide history/playlist APIs (some exist)." It includes the crowd-column note from §3.
- **VISION roadmap** (`/Users/andrew/Projects/nomadkaraoke/nomad-mobile/docs/VISION.md` lines 99–103 and 121):
  - A collection "browsable by mood, how it went and how often you sing it".
  - The backend is "decide playlist APIs (some exist); aggregates over `karaoke_log`".
  - Notes tagging by LLM comes later (AI Studio key only).
- **nomad-mobile CLAUDE.md:** "Me's sung history will be recorded on the phone first and synced later (Phase 4), per VISION's offline principle."
- **Post-release items, out of scope for Phase 4:** auto-generated setlists, group setlists with synced turns, community playlists, friends/crew filter, send setlist to venue/YouTube, a "best version" picker, a subscription tier with pre-generated tracks, and commissioning or tipping creators.
- **INBOX from Phase 5:** KJ notice for permanently failed outbox rows; v1 `/me` tip_claims.
- **Optional chore:** "Review karaoke-candidate v3 picks".
- **Andrew's manual-test list** includes the first real Nomad night (linked singer's Done → decide karaoke log).

### 8. Andrew's own words

- Use case 4 (BACKLOG #4 and 4.4): "generally karaoke nerds who may want all of the above but also want to collect data about songs they've sung, build up their own library of songs they enjoy singing at karaoke, leverage that data to give them a better experience at future karaoke nights by giving them much better data-driven recommendations, recommending karaoke-gen submissions and perhaps even fully pre-generating tracks for them on demand (could be a monthly subscription tier feature or something eg 1 free generated karaoke video per week)".
- "Why an app" (VISION, 2026-10-21), as the doc paraphrases him: "A persistent profile of the songs you know, the songs you've sung at karaoke and how each one went, which powers much richer recommendations. This needs data stored server-side, so the app requires sign-in."
- On the web page: "i want sing.nomadkaraoke.com to continue to exist as a way for singers who come to my live events using my own kjbox tech to enter and manage their songs in the rotation easily without needing to log in (they only have to enter a free text name)."
- On reusing past work (`feedback_mobile_port_existing_learnings.md`): "thoroughly review work done on other parts of the nomad karaoke products, perhaps review a bunch of past session records etc. ... and apply the same learnings/improvements to this mobile app too."
- On post-release ideas: "agreed all are after release, but these are all great ideas i don't want us to lose".
- From the night-log memory, as a paraphrase rather than a quote: he wanted to review any past night (who sang, KJ vs singer added, media source).
