# Mobile Phase 4 "Me": design

**Status:** approved by Andrew 2026-10-25. **Delivers:** [VISION.md](../../VISION.md) phase 4, use case 4 ("karaoke nerds"); BACKLOG 4.4. **Repos:** nomad-mobile, karaoke-decide, kjbox (slice 4c only). gen gets no changes; the app calls gen's existing requests-board endpoints.

**Companion:** [2026-10-25-mobile-phase4-me-survey.md](2026-10-25-mobile-phase4-me-survey.md) is the raw survey of earlier learnings; §3 condenses it.

## 1. Intent

In Andrew's words (BACKLOG 4.4):

> collect data about songs they've sung, build up their own library of songs they enjoy singing at karaoke, leverage that data to give them a better experience at future karaoke nights by giving them much better data-driven recommendations, recommending karaoke-gen submissions

and (VISION, Tonight at any other bar):

> opt-in data collection to let the user see what songs they usually sing at karaoke, record what they do/don't enjoy so they can browse their own personal karaoke song collection easily if they do just want to sing something they've sung before for a given mood/event/headspace etc. 2) leverage that data to give the user truly useful karaoke song recommendations

Phase 5 already records the data: every song sung at a Nomad night (kjbox outbox) or logged at another bar lands in decide's `karaoke_log` with the post-song survey. Phase 4 turns that data into something a singer opens on the way to a bar, feeds it back into recommendations, and turns "songs I'd love with no karaoke version" into gen jobs or free requests.

**Success:** a regular opens Me and immediately sees their go-to songs, their setlists, and songs worth getting made. They can browse everything they've sung by how it went, how often and the mood they're in, with no signal at the bar. Discover's picks visibly change once they've sung and rated a few songs.

## 2. Decisions Andrew made (brainstorm, 2026-10-25)

| Topic | Decision |
|---|---|
| Me home | **Ready-to-sing shelves:** Your go-tos, Setlists, Get this made, then All your songs. Andrew added: put a **compact, visually appealing summary of the music profile at the top of Me** (vocal range graphic, connected sources, a Manage button), so profile tasks (vocal range, connecting sources) are easy to find. |
| Profile page fixes | **Summary card plus targeted fixes:** colour brand icons for the music services, the vocal range graphic moved up (Andrew: it "looks great and is super intuitive/appealing" but sits at the bottom), and an "Artists you love" rethink (Andrew: "currently a super long list to scroll through for me"). |
| Mood | **Both:** the catalog's mood and energy tags, plus optional "vibe" chips in the survey. |
| Collections | **Library plus many ordered setlists.** "My songs" fills itself; named setlists keep their order and can be reordered. Every song page offers Add to setlist, Save and Mark as sung. |
| Crowd singability | **Show at 5 or more distinct singers, split by voice type** only when that voice type also has 5 or more. Below that, show the overall figure or nothing. Always counts, never names. |
| Get this made | **Your songs first, plus a free vote path:** loved, sung and imported songs with no karaoke version, topped up with the recommendations' "Make it" picks. Each row offers **Make it** (one tap into Make) and **Request it free** (a vote on requests.nomadkaraoke.com). Rows can be dismissed. |
| Recs v2 | **Strong, with a go-tos shelf.** Rated great or sung twice or more counts like a loved song. "Not for me" pushes a song down hard (reversible) and stops it seeding similar picks. Key answers feed the fit badge, crowd-pleaser feeds the crowd score. Discover gets a "Your go-tos" section. |
| Backfill | **All three:** "Mark as sung" on any song; a bulk "songs I've sung" picker; **claiming past Nomad nights from the Night Log**: loose name matching ("people often use variations of their name, sometimes with or without a last initial"), with the songs shown so people recognise their nights and tick the ones that were theirs. Nights rebuilt before 14 Oct contribute only the songs that were linked to an entry. |
| Offline | **Read everything, edit offline, sync later** (outbox, like Tonight's log). |
| Web | **App only now.** Build decide APIs the web can reuse; fix the web playlists page so it shows titles instead of raw ids; backlog item for full web Me. |
| Extras in scope | Survey "why" chips, a per-song history view, a year / all-time stats card. (Sharing a setlist was offered and not chosen.) |
| Save vs Love | **One heart = Save to My songs**, using decide's love. |
| Shipping | **One spec, three merge slices** (4a, 4b, 4c, §5), each with its own decide/kjbox and mobile PRs, merged when green. A release APK from main at the end. |
| Mockups | None before the spec; a screenshot UX review of the real app during the build. |

## 3. What earlier work taught us (condensed survey)

Full detail with paths: the survey companion. These are the points the build must respect.

**Data that already exists**
- decide `karaoke_log/{user_id}:{entry_id}`: `source` kjbox|app, `state` planned|requested|sung|sung_unplayed|skipped, artist, title, `song_key` + `song_key_status`, `night{id,kind,venue_name,date}`, `sung_at` (performance START), `ended_at`, `survey{feel great|ok|bad, key too_low|right|too_high, crowd_pleaser, notes≤2000, answered_at}`, `media`, `deleted`. `kj_` ids: kjbox owns the facts; the app may write only `survey` and `deleted`. `app_` ids: fully app-owned. A survey written before kjbox delivers creates a placeholder (`state` None) that list hides. A 403 `not_owner` is dropped as permanent by the phone outbox.
- On each counted sung record, decide's transaction bumps `user_songs.times_sung` and `last_sung_at` on the row chosen by `choose_user_song_row` (`{uid}:{kn_id}` if present, else `loved_doc_id`; love, log and imports merge into the same row). Unresolved songs count in `user_karaoke_unresolved`, retried daily. **The survey is never copied off the log doc.**
- `GET /api/my/karaoke-log?since=&limit=&cursor=` already supports a sync pull (newest `updated_at` first; with `since` it includes deleted). It has no index: one equality query on `user_id`, then sort and page in Python.
- Playlists exist (`/api/playlists` CRUD + add/remove song) but hold only opaque `song_ids` with no titles and no order; the web page prints raw ids. The `user_id + updated_at` index they need is not declared in Pulumi.
- `GET /api/my/songs` likely returns 500 for anyone with a song first created by the karaoke log: `UserSong.source` has no `"karaoke_log"` (code reading, unverified). Adding a source value means changing every place at once: the Literal, recs `_TOP_SOURCES` + `song_weight`, the web `SourceBadge`, the disconnect allowlist (Apple Music lesson).
- Recs v2 (`backend/services/recs_v2/`): context, then candidates, scoring, sections. `_map_songs` gives `known_songs[key] = max(best-of-sources base weight, session_song_weight)`; a `karaoke_log` row falls to `SONG_DEFAULT` 0.6; `times_sung` is ignored; survey unused. Phase 3d (merged, decide v0.28.x) added best-of-`sources`, `voice_session` (0 base weight), `session_no` + `SESSION_NO_PENALTY` 0.15, and session-only rows not counting toward artist affinity; `test_context.py` pins this. 3d agreed (2026-10-24) that sung history goes in as a term next to `session_song_weight` and "not for me" as a penalty set like `session_no`, without overloading `source`.
- "No karaoke version" = not (`catalog.db songs.in_kn` or in `availability.db`). Recs already have a `make_it` section and `has_karaoke=make`; known songs without karaoke go to `make_it`. Most songs in the index are `karaoke:true`, so "no version" is mostly obscure songs (kjbox v0.130 lesson).
- Catalog facets: `mood` ∈ happy|chill|sad|intense (valence × energy quadrants), energy band low|mid|high (`karaoke_decide/catalog/moods.py`). Songs outside the catalog have none.
- BigQuery `karaoke_decide.song_vocal_range` reserves NULL `crowd_comfortable`, `crowd_too_low`, `crowd_too_high` (3c; "fill them here"). They aren't in `catalog.db`. The weekly `mb-refresh` job's service account has no Firestore role. **There's no privacy threshold anywhere yet**; this phase sets the first.
- gen requests board (`/api/requests-board`): `GET /requests` (public, with the caller's vote), `POST /requests` (signed in; auto-corrects artist/title and dedupes, returns `already_exists`), `POST /requests/{id}/vote` (one vote a day), `GET /me` (today's vote). The daily free pick makes the top request.
- kjbox Night Log: `sung_at` in the Night Log is the END (Done) time; use `started_at` (kjbox #284). Nights before 2026-10-14 are reconstructed by heuristics (some songs untimed, unlinked entries look KJ-added). The outbox `history_id = "kj_" + sha256(box_id:entry_id:email)[:24]`, so re-sending is idempotent. Identity on the box is by name (fuzzy); a self-rename no longer rewrites Done entries; only a KJ merge is canonical.

**Phone patterns to reuse**
- Per-account MMKV keys via `userKeyFor(email)`; stores rehydrate on account change. Discover's data is wiped by `useClearDiscoverOnSignOut`; the import queue purges a previous owner's data when a different account signs in ("another person's listening history must not stay on the phone"). Me must do both.
- Outbox: `tonight/log/outbox.ts` (FIFO, coalesce per id with `mergePatch`, permanent drop on 400/403/404/422, wait on 401, backoff 5 s → 5 min, flush on mount / reconnect / foreground, `synced` counter driving query invalidation). Offline = `ApiError` status 0. A decide 401 never signs out; it marks things stale.
- Snapshot: `discover/recsSnapshot.ts` (one key, owner prefix, shape check, `isFresh`).
- Make entry: `useMakeIntent.getState().set(identifiedIntent({artist,title,song_key}))` then `router.push('/make/new')` (or `openSignIn('/make/new')`); Discover's `make_it` rows already do this.
- Reusable UI: `RecSongRow`, `RecSection`, `LogRow`, `SongMenuSheet` (Love / Not for me only today), `SurveySheet`, `ProfileSection`, `PianoStrip`, `LibraryBadge`, `FitBadge`, `useYouTubeLink` → now `media/youtube.ts` (3d), `mostSung()` in `IdeasPanel.tsx`.
- Store `song_key` (search/song page key), not KN `song_id`. The stored artist may be the sentinel `"Unknown Artist"`, displayed translated (Phase 5 E9-R8). Uncatalogued songs are first-class (Andrew, Phase 5): they show, count and take the survey.
- Maestro: iOS keeps MMKV across `launch.yaml` (flows clean up explicitly); iOS 26 sheets sometimes lose their accessibility tree (`common/tonight-open-sheet.yaml`); match text with a leading `.*` (isolate marks); container testIDs don't carry child text on iOS; Android `eraseText` and the dev Tools button; never run both platforms against one stack; Tonight flows need decide on :8030. Tests never under `src/app`.
- `offline.db` stays at schema 1 (additive only). decide loads `catalog.db` only at startup.
- Process: decide `pulumi up` only from main, previewing zero deletions of other sessions' resources; GCP ADC is read-only (Pulumi or secret writes need Andrew's `/gcp-admin`). CodeRabbit CLI may be unavailable, in which case use a reviewer subagent. No mouse or click automation on Andrew's Mac.

## 4. Scope

### Goals
1. Me home redesign with the profile summary card and the three shelves.
2. The karaoke collection ("All your songs"), browsable by how it went, how often, mood and vibe, recency, library; a per-song history; a stats card.
3. Setlists: many, named, ordered, reorderable, usable at the bar.
4. Library actions everywhere: Save, Add to setlist, Mark as sung (song page, row menus).
5. Backfill: Mark as sung with a rough date and count, a bulk picker, Night Log claim.
6. Survey additions: vibe chips (all answers) and why chips (on OK / Not for me).
7. Recs v2 driven by sung history and survey answers, plus a Discover "Your go-tos" section.
8. Get this made with Make it and Request it free.
9. Crowd singability: collection, thresholds, display on the song page and in recs; the BigQuery `crowd_*` fill.
10. Music profile fixes: brand icons, vocal range moved up, the artists-you-love rethink.
11. Offline reading and editing for all of the above except Make, requests and live crowd figures.
12. decide fixes found on the way: the `karaoke_log` source bug, the playlists index, web playlists page titles.

### Non-goals (this phase)
- Web Me pages beyond the playlists title fix (backlog item).
- Sharing setlists, auto-generated setlists, group or crew setlists, community playlists, sending a setlist to a venue (post-release list in VISION).
- LLM tagging of survey notes (later, AI Studio key only).
- Push notifications, account deletion, store work (Phase 6). Phase 4 does register its new collections for Phase 6's deletion registry (§6.9).
- Changes to the kjbox name-only web page.

### Anti-goals (a failure even if it works)
- Someone else's history landing in a user's profile (a wrong-name Night Log claim auto-imported, or one account's cached data shown to the next account on a shared phone).
- A crowd figure that lets anyone infer an individual's answer (threshold breached, or names shown).
- Me breaking or emptying offline at the bar.
- Rewriting what 3d's recs semantics pin (best-of-sources, voice_session rules), or editing shared files without telling the session that owns them.
- Any AI spend in the nomadkaraoke GCP project, or any new account or paid service.

## 5. Slices

| Slice | Contents | PRs |
|---|---|---|
| **4a: Collection and library** | Me home (profile card, shelves for go-tos (from local data until 4b's server section lands), setlists, a Get this made placeholder hidden until 4b), All your songs, per-song history, stats card, setlists, Save / Add to setlist / Mark as sung, bulk picker, survey vibe + why chips, music profile fixes, offline cache + outbox, decide data + API changes in §6.1–6.4, the source bug, playlists index, web playlists titles | decide 4a, mobile 4a |
| **4b: Smarter picks** | Recs v2 from history and surveys + Discover go-tos section, Get this made (decide endpoint + Me shelf + Make it + Request it free), crowd singability (counters, thresholds, display, BigQuery fill + Pulumi grant) | decide 4b, mobile 4b (Pulumi apply from decide main after merge) |
| **4c: Claim past Nomad nights** | kjbox v1 suggestion + claim endpoints, the Me "Were these you?" card, local stack ops and flows | kjbox 4c, mobile 4c (decide only if a gap appears) |

Each slice: plan part(s) → subagent-driven development → tests → `/coderabbit` (or reviewer subagent) → PR → merge when CI is green, then the next. Shared-file claims and merge order are agreed with the other sessions first (§9).

## 6. Design

### 6.1 Library model (decide)

"My songs" = every song the user has **sung** (karaoke log, including backfill), **saved**, or put in a **setlist**. Listening imports (Spotify saved tracks, Last.fm plays) are not the library; they stay "songs you know" in the music profile.

- **Save is Love (Andrew, after the builder check).** The song page and menus show one heart toggle, labelled "Save to My songs" / "Saved", which calls the existing love endpoints. Discover's "Love it" gets the same label. Everything loved shows in My songs: Discover and quiz loves, legacy `source=="manual"` rows, and a voice session's "loved it" answers (which already call love).
- **Library endpoint:** a new `GET /api/my/library` returns one item per song: `song_key` or (for uncatalogued songs) a `norm_key` = the karaoke log's normalised artist + title; artist, title; `times_sung`, `first_sung_at`, `last_sung_at`; `feel` counts `{great, ok, bad}` and the latest feel; latest `key`; `crowd_pleaser` count; the union of `vibes`; `loved`; `setlist_ids`; and catalog facets (`mood`, `energy_band`, `has_karaoke`, `community`, `karafun`, vocal range tier when known). It's built from `karaoke_log` (one equality query, already how list works), loved songs, playlists and a catalog lookup. Users have hundreds of songs at most, so it returns the whole library, with an `etag` for cheap revalidation (`If-None-Match` → 304). *(My call: server aggregation so the web can reuse it later; the phone overlays its pending outbox edits on the cached response so offline edits show at once.)*
- **Fix:** add `"karaoke_log"` to `UserSong.source` and every place §3 lists, with a regression test for `GET /api/my/songs` on a log-created row.

### 6.2 Karaoke log additions (decide)

- **Survey:** `vibes: list[...]` (any answer) from `party, ballad, warm_up, duet, emotional, rock_out, singalong`; `reasons: list[...]` (shown when feel is OK or Not for me) from `out_of_range, too_hard, crowd_quiet, awkward_music, too_long, didnt_know_it`. Both optional, validated enums, stored on the log doc like the rest of the survey. *(The lists are my call, from decide's USER-DATA-VISION "why" list plus mood words; Andrew can edit them at review.)*
- **Backfill records:** an `app_` record with `state: sung`, `origin: "backfill"`, an optional `sung_at` or a rough `night.date` (month or year precision allowed: `date_precision: day|month|year|unknown`), and `times` (1–50, default 1) meaning "sung about this many times". The counter transaction adds `times` instead of 1. Stats show backfill under "before the app" rather than on a date. *(My call.)*
- **Per-song denormalisation for recs and crowd:** inside the existing counter transaction, keep on the chosen `user_songs` row: `sung_feel_counts {great,ok,bad}`, `sung_feel_latest`, `sung_key_latest`, `sung_crowd_pleaser_count`, plus `crowd_bucket` (§6.7). A survey edit or delete adjusts them by delta (the transaction already reads the old doc). Unresolved songs don't get these (they aren't in recs or crowd).
- `GET /api/my/karaoke-log` gains a `song_key` / `norm_key` filter for the per-song history (in Python after the equality query, like the rest).

### 6.3 Setlists (decide)

Reuse the `playlists` collection and routes, so the web page keeps working.
- Add `items: [{item_id, song_key|null, artist, title, added_at}]` in order (uncatalogued songs allowed, as in Tonight), and `rev` (an int bumped on every write). `song_ids` stays in step for old clients.
- `PUT /api/playlists/{id}/items {items, base_rev}` replaces the whole order (add, remove and reorder all go through it from the phone); on a `base_rev` mismatch the server still applies it (last writer wins) and returns the new doc. *(My call: one user, mostly one phone; full replace keeps the offline outbox trivial.)*
- Create accepts a client-supplied `id` (`pl_<uuid>`) so a setlist made offline keeps its id when it syncs. The response carries items with titles; old docs (ids only) are upgraded lazily by catalog lookup.
- Declare the `user_id + updated_at` composite index in Pulumi (check whether a hand-made one already exists first; never delete one).
- decide web `playlists` page: show item titles. That's the only web change.

### 6.4 Catalog facets

The phone needs mood, energy, karaoke availability and fit tier for library songs and setlist items offline. `GET /api/my/library` includes them. Setlist items not in the library get them through the same lookup in the playlist response.

### 6.5 Mobile: Me home

Top to bottom (signed in):
1. **Profile summary card:** the `PianoStrip` vocal range strip with voice type (or a "Find your voice range" prompt), connected-source brand icons (or "Connect your music"), and counts (songs known, songs sung, saved). It has a **Manage** button that opens Your music profile; tapping the strip opens the voice section, and tapping the icons opens Connect.
2. **"Were these you?"** (4c), only when there are suggestions.
3. **Your go-tos:** up to 5 songs, with See all opening the collection sorted that way. **One go-to rule everywhere** *(my call, from the builder check)*: the latest survey feel isn't "not for me", the song isn't hidden, and either the latest feel is great or it's been sung 2 or more times. It's one helper in `@nomad/core`, mirrored in decide's `sung_song_weight` with shared fixtures. Hidden or "not for me" songs stay in the library but aren't go-tos. In 4a the shelf is computed on the phone from the library. In 4b it shows the recs `go_tos` section (catalog songs with a karaoke version, with fit) **merged with** the phone's uncatalogued go-tos, so songs outside the catalog never drop off.
4. **Setlists:** horizontal cards (name, count), plus **+ New**.
5. **Get this made** (4b): up to 3 rows with Make it / Request it free, and See all.
6. **All your songs ›** with a count.
7. **Your karaoke so far:** a stats card with a This year / All time toggle: songs sung, nights, venues, top artist, most-sung song, best-rated share. Backfill counts toward totals only.
8. Then today's items: credits + Buy credits, offline song list, language, account, sign out.

Signed out: the existing sign-in card. Empty states make the first action obvious, for example "Log a song tonight or mark songs you've sung before" leading to the bulk picker.

### 6.6 Mobile: collection, song history, setlists, actions

- **All your songs** (`me/songs`): a search field, sort (most sung, recently sung, best rated, A–Z), and filter chips: How it went (Great / OK / Not for me / Not rated), How often (2+ times / Once / Not sung yet = saved only), Mood (Happy / Chill / Sad / Intense, plus the user's own vibes), Library (the existing any / community / KaraFun filter), Saved. A row shows the title, artist, a times-sung pill, a feel icon, a crowd-pleaser star, the library badge and the fit badge. It uses `@nomad/ui` `List`. Tapping a row opens the song page; for an uncatalogued song it opens `me/history/[normKey]`.
- **Song page** (`song/[id]`) gains:
  - a **heart** (Save), **Add to setlist** and **Mark as sung** next to Request / Add to tonight and Make it, as VISION says every song page should have;
  - **Your karaoke history**: each time the user sang it (date or "before the app", venue, survey summary, notes), with Edit survey (`SurveySheet`) and Remove;
  - the **crowd line** (4b).
  The uncatalogued history page shows the same history plus Add to setlist / Mark as sung / Make it.
- **Mark as sung sheet:** When (Tonight / Pick a date / A while ago), How many times (stepper, for "a while ago"), then the optional survey. It writes an `app_` backfill record (or a normal other-bar record for "Tonight", joining tonight's other-bar night if one is open) through the existing karaoke-log outbox.
- **Bulk picker** (`me/sung-before`): multi-select from saved songs, top imported songs and recs "songs you know", with search to add any song. Done writes one backfill record per song (`times` 1, date unknown). Reached from the empty state and from All your songs' menu.
- **Setlists:** a list (`me/setlists`) and a detail screen (`me/setlists/[id]`) with rename, delete, add songs (search sheet), remove, and Edit order (move up/down, the same pattern as Tonight's reorder; no new drag library). Each row offers Request tonight / Add to tonight (when a night is active), Mark as sung and Make it (no karaoke version). **Add to setlist sheet:** tick existing setlists, or + New setlist inline.
- **Survey sheet:** after feel / key / crowd-pleaser / notes, a row of vibe chips, and why chips when feel is OK or Not for me. It stays optional and never blocks. Tonight uses the same sheet, so both get them.
- **Row menus** (`SongMenuSheet`): add Add to setlist and Mark as sung alongside Save and Not for me.

### 6.7 Crowd singability (4b)

- **Who counts:** signed-in singers' latest `key` answer per song (one vote per singer per song, not per performance), from both kjbox and app records. Backfill records count only when they carry a survey.
- **Counters:** `song_crowd_stats/{song_key}`: `total {right, too_low, too_high}`, `by_bucket.{bucket} {right, too_low, too_high}`, `crowd_pleaser_yes`, `updated_at`. Updated by delta inside the karaoke-log transaction when a singer's latest key (or bucket) for that song changes. The singer's bucket at answer time is kept on their `user_songs` row (`crowd_bucket`), so a later decrement is exact.
- **Bucket** = the singer's voice type from their voice profile (bass, baritone, tenor, alto, mezzo, soprano), or no bucket when unknown. Self-report "lower / middle / higher" maps to no bucket. *(My call, so buckets mean one thing.)*
- **Thresholds (Andrew):** a figure is shown only when at least 5 distinct singers count; the "singers with your range" figure only when the viewer's bucket has 5 or more; otherwise the overall figure ("8 of 11 singers found the key comfortable"), otherwise nothing. Both thresholds are one constant each in decide, and the API applies them server-side: raw counts below threshold never leave the server.
- **Where shown:** the song page ("72% of baritones found the key comfortable" / "Most singers found it a bit high"), through a decide `GET /api/songs/{song_key}/crowd` (the user's bucket comes from their token), and on recommended songs as `RecSong.crowd`.
- **Effect on picks** *(my call, from the builder check; there is no crowd score term today, and `ctx.crowd_pref` is the quiz's hits / deep-cuts answer)*:
  - after scoring, recs batch-read `song_crowd_stats` for the songs it is about to return (one Firestore `get_all` of at most ~100 docs, not per candidate);
  - it attaches `RecSong.crowd` where the threshold is met;
  - it reorders only within the crowd-pleasers section: songs with crowd-pleaser votes above the threshold move up, and the user's own crowd-pleaser answers count there too;
  - a song whose crowd figure shows the user's bucket mostly found it too high or too low gets the same transpose hint as §6.8's per-song key answers;
  - there's no new global score term, so 3d's scoring stays as it is apart from §6.8. If the extra read costs more than ~50 ms warm, attach crowd data on the song page only and file a follow-up.
- **BigQuery** (lowest priority in 4b, can slip to a follow-up): a weekly step copies `song_crowd_stats` totals into `song_vocal_range.crowd_comfortable / crowd_too_low / crowd_too_high` (thresholded the same way), as the 3c backlog note asked, for analysis and a future catalog column. Nothing in the app reads it this phase. It needs Firestore read for the job's service account (Pulumi `roles/datastore.viewer` on the job SA, the same pattern as `vocal-range-gen`). Apply from decide main after merge, with a preview showing no deletions; it needs Andrew's `/gcp-admin`.
- **Account deletion:** aggregate counts above the threshold aren't personal data; deletion clears the user's rows, and the counters may keep their votes. *(My call; Phase 6 can decrement instead using `crowd_bucket` + `sung_key_latest` if Andrew prefers.)*

### 6.8 Recs v2 from history and surveys (4b)

All in `backend/services/recs_v2/`, after telling nomadkaraoke-72 (agreed shape, §3):
- **`weights.sung_song_weight(d)`** from the row's `times_sung` and `sung_feel_*`:
  - latest feel great, or sung 2+ times with no latest "bad": **1.0**;
  - sung once with no survey: **0.8**;
  - latest feel OK: **0.7**;
  - latest feel bad: **None**, and the song goes to `ctx.survey_no`.
- `_map_songs`: `weight = max(base, session, sung)`; survey-no songs are dropped from `known_songs`.
- **`ctx.survey_no`:** `scoring` subtracts `SURVEY_NO_PENALTY` (0.4, larger than 3d's 0.15). Survey-no songs never seed `because_*` sections and don't count toward their artist's affinity. A later great or OK answer lifts the song out, so it's reversible.
- **Key answers:** the latest `too_high` / `too_low` for a song becomes that song's transpose hint for the user's fit badge ("Try it 2 keys down"), the same way 3d's `session_key_hint` does. It doesn't move the user's measured range. *(My call.)*
- **Crowd-pleaser:** the user's own `crowd_pleaser` answers add a small bonus to that song in the crowd-pleasers section; the global counts feed `crowd_pref` (§6.7).
- **Go-tos section:** a new first `_Slot` `go_tos` ("Your go-tos", `reason_type: sung_before`) with known songs at weight 1.0 from sung history that have a karaoke version, limit 10. `REASON_TEXT` + i18n.
- **Pins:** extend `test_context.py` / `test_scoring.py`; 3d's existing tests must pass unchanged.

### 6.9 Get this made (4b)

- **decide `GET /api/my/get-made`:**
  1. Candidates: the user's own songs with no karaoke version (saved, sung (including uncatalogued), imported, voice-session-labelled), ranked by their recs weight.
  2. Topped up with `make_it` recs, up to 30 in total.
  3. Excludes dismissed songs: `user_make_dismissed/{uid}:{song_key or norm_key}` (a new collection). Dismissing doesn't hide the song from recs.
- **Phone:**
  - drops songs the user already made (their gen jobs, normalised artist + title);
  - marks songs already on the requests board (public `GET /requests`, normalised match) with their vote count.
- **Row actions:**
  - **Make it:** the existing identified make intent.
  - **Request it free** (gen, signed in):
    1. `POST /api/requests-board/requests {artist,title}`;
    2. if the response says `already_exists` and the user hasn't voted today (`GET /me`), `POST /requests/{id}/vote` (up);
    3. if today's vote is already used, show "You've used today's free vote; we've added the request" (Andrew's board rules: one vote a day).
    The row then shows "Requested · N votes".
  - **Dismiss** (×), with undo.
- Offline: the last list is shown with the actions disabled.

### 6.10 Claim past Nomad nights (4c)

- **Matching is loose (Andrew):** "people often use variations of their name, sometimes with or without a last initial". A box name matches the account when, after normalising (case, accents, punctuation, spaces), its first word equals the first word of any of the account's names: its profile name, names this account used through the app on the box, and KJ-merged aliases. Anything after the first word (last name, last initial, "B.") is ignored. Duet entries match on any listed singer. *(Nickname tables ("Sam" vs "Samantha") are out of scope; that's my call.)*
- **kjbox `GET /sing/api/v1/history/suggestions`** (app auth = gen token, as the rest of v1):
  - returns past nights with Done entries sung under a matching name, **showing the songs** so people recognise their nights (Andrew: "show songs before matching so people can recognise their nights and tick to select them easily");
  - excludes entries already claimed by any account, and entries this account rejected.
  - Each night: `night_id`, date, venue, songs `{entry_id, singer_name, artist, title, started_at, state}`.
  - It uses `started_at` (never the Night Log's `sung_at` = Done).
  - Pre-2026-10-14 reconstructed nights are included, but **only entries the rebuild linked to a rotation entry** (exact or inferred `entry_id`). Unlinked songs are left out, and the night says how many couldn't be matched (Andrew).
- **kjbox `POST /sing/api/v1/history/claim {night_id, mine: [entry_id], not_mine: [entry_id]}`:**
  - claims are **per entry**, so two Sams on one night can each tick their own songs; the first claimer of an entry wins;
  - `mine` entries are attributed to the account and enqueued through the existing history outbox with the same `history_id` formula, so the claim is idempotent and decide sees ordinary `kj_` records;
  - `not_mine` entries are remembered for this account and never suggested to it again;
  - the host can undo a wrong claim from the KJ dashboard (if no UI exists for that, it's a follow-up; the data model supports it).
- **Me card "Were these you?":** one card per night ("Sat 12 Oct · 3 songs as 'Sam B'"), songs listed with tick boxes (all ticked by default), then **Save ticked songs** / **None of these are me**. Hidden when the box is unreachable. Claimed songs appear after the next karaoke-log sync.
- **Andrew's KJ dashboard:** no new UI. The KJ Night Log should show claimed entries as linked; if that comes for free, good; otherwise it's a follow-up.

### 6.11 Music profile fixes (4a)

- **Brand icons:** colour vector marks for Spotify, Apple Music, YouTube Music, Last.fm and ListenBrainz in `@nomad/ui` (SVG, the same approach as `GoogleLogo`), used on the profile card, the profile page's connected sources and the Connect hub cards. They follow each brand's published guidelines for "connect" usage.
- **Order:** Your voice (with the range graphic) moves to the top of Your music profile, then connected sources, then artists, songs, quiz answers and hidden songs.
- **Artists you love:** the top 12 by affinity as chips with a remove ×, a search field that filters, and **See all (N)** opening an A–Z list with section headers and a letter jump bar (`List` sections). Remove works the same everywhere.

### 6.12 Offline and privacy (phone)

- **Per-account MMKV keys:**
  - the library response with its etag (`me.library.v1.<userKey>`);
  - setlists (`me.setlists.v1.<userKey>`);
  - the get-made list;
  - the karaoke-log mirror for per-song history, synced with `since`, which also replaces `IdeasPanel`'s 500-record direct query (the mirror is the single read path).
- **Me outbox** (setlist create / items PUT / delete, love / unlove, dismiss): the same mechanics as `tonight/log/outbox.ts`, factored to share code rather than copied. Log writes (Mark as sung, backfill, survey edits) keep using the karaoke-log outbox.
- Pending edits overlay the cached data immediately.
- **Sign-out** clears Me's queries and caches through `useClearDiscoverOnSignOut` or a sibling hook. **A different account signing in** purges the previous owner's Me data, including unsent outbox items (the import-queue rule).
- **What doesn't work offline:** Make, Request it free, Night Log claims, crowd figures (last-known values are shown, never recomputed), and first-time catalog facets for a song never fetched.

## 7. Testing and verification

- **decide:** TDD unit tests for every endpoint and transaction delta, including:
  - survey edit and delete;
  - the bucket change;
  - the threshold edges (4 vs 5 singers);
  - backfill `times`;
  - the source-bug regression.
  Recs tests extend the pinned suites. Test API:
  - `reset` also clears `playlists`, `user_make_dismissed` and the per-row survey fields;
  - new `POST /api/test/karaoke-log/seed` (records with surveys for a user);
  - `POST /api/test/crowd/seed` (counts for a song);
  - fixture songs with no karaoke version for get-made.
- **kjbox (4c):** pytest for suggestions, claims and rejections, the started_at rule and idempotent outbox ids; local-stack test API ops to seed past nights under a name.
- **gen:** none changed. The requests-board flow runs against gen's local stack (check during planning that the board routes work there; if they need a local-stack knob, that's a small gen PR).
- **Mobile:**
  - jest for stores, outbox overlay, aggregation helpers in `@nomad/core` (go-tos, stats, filters) and screens;
  - 70%+ on packages;
  - Maestro flows `me-1…N` on iOS and Android against the gen + decide (+ kjbox for 4c) local stacks, covering:
    - home shelves;
    - collection filters;
    - mark as sung and the bulk picker;
    - setlist create / reorder / offline edit then sync;
    - survey chips;
    - get-made Make it + Request it free;
    - crowd line at threshold;
    - go-tos in Discover;
    - Night Log claim yes / no;
    - sign-out and account-switch purge.
  - A `me-tour` screen tour (en + ar for RTL) for the screenshot UX review.
- **iPad:** a device check on Andrew's iPad over USB (lock `mkdir /tmp/nomad-ipad.lock` with an owner file; remove when done).
- **End of phase:** a release APK from main. Anything only a human can check goes on the final manual-pass list (memory project_nomad_mobile_app): for example, a real Nomad night claim, real crowd figures once there's data, and Request it free on prod.

## 8. Left to the builder

- Exact component structure, file layout under `apps/mobile/src/me/`, query keys, and copy wording (all i18n'd, 33 locales, "host" not "KJ").
- The normalisation for `norm_key` (reuse decide's karaoke-log `norm_key` so the phone and server agree).
- Stats card details beyond §6.5's list.
- How the setlist search sheet reuses `find/` search.
- Whether the library etag is a hash or a max-`updated_at`.

## 9. Coordination and process

- **Orchestrator nomadkaraoke-12:** message at spec approved, each PR opened and each merge.
- **Phase 3d (nomadkaraoke-72):** owns recent recs v2 code. Tell it before editing `weights.py`, `context.py` or `scoring.py`. Its mobile PR (music-profile, `_layout`, discover, i18n, `api-decide`, `useClearDiscoverOnSignOut`, song page) merges first; Phase 4 rebases onto it.
- **Phase 6 (nomadkaraoke-14):** owns app.config, push and account deletion. It registers decide user collections in one deletion registry. Send it Phase 4's: `playlists`, `user_make_dismissed`, and the new `user_songs` fields (`sung_*`, `crowd_bucket`).
- **Before merging shared files, message the other active sessions:** `(tabs)/_layout`, `(tabs)/me.tsx`, `packages/i18n` messages, `packages/ui` / `core`, `package.json` / lock, CI, decide `models` / `recs_v2` / `ci.yml` / Pulumi.
- **Process as earlier phases:**
  - worktrees `nomad-mobile-phase4-me`, `karaoke-decide-phase4-me` (plus a kjbox worktree for 4c);
  - a plan, then an execution ledger in the plan;
  - one decide PR per plan part;
  - `/coderabbit` before each PR;
  - a final whole-branch review on the most capable model;
  - Maestro on iOS + Android;
  - the screenshot UX review;
  - a release APK from main at the end;
  - version bumps per repo convention.
