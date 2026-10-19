# Nomad Karaoke mobile app: search parity design (Phase 1b)

*2026-10-18. Backlog Frog 4.1b. It comes after [Phase 1 "Make it"](2026-10-17-mobile-phase1-make-it-design.md) and before Phase 2 "Native review" (4.2). It applies Andrew's phone-test feedback on Phase 1 (BACKLOG INBOX 2026-10-17; memory `feedback_mobile_port_existing_learnings`). Read [docs/VISION.md](../../VISION.md) first.*

## 1. Intent

**Why now.** Andrew sideloaded Phase 1 on his Pixel and found that search and make were rebuilt naively:

> the song search (eg matching with songs which exist from our musicbrainz DB, showing community vs. commercial karaoke versions etc.) and flow to then Make a track (passing through the artist/title from the musicbrainz match etc.) is lacking a lot of the improvements we already worked hard on for the singer ui … thoroughly review work done on other parts of the nomad karaoke products … and apply the same learnings/improvements to this mobile app too.

The kjbox singer UI (sing.nomadkaraoke.com), gen web's make flow and decide already encode months of hard-won search and make fixes. Appendix A lists every one of those learnings. This phase brings them to the app, so Phase 2 onwards builds on a search that already works the way singers type.

**The person.** A singer at any karaoke night types a song the way people actually type: title only, title plus part of the artist in any order ("starlite muse"), or with typos. The app works out which real song they mean. It shows that song's karaoke versions (community YouTube uploads and commercial libraries) or, when there isn't one, offers to make it, pre-filled with the canonical artist and title. With no connection, they can still look up which songs have karaoke versions.

**Agreed direction (Andrew, 2026-10-17/18):**
- **decide becomes the app's single cloud song-search backend.** It hosts the kjbox song-id index (the same kn-data-sync export, ListenBrainz ranking and spelling variants). It handles combined "title artist" queries and groups community vs commercial versions per song like kjbox. Gen's catalog auto-correct is the fallback.
- Mobile Discover search and the make flow use it, passing the canonical MusicBrainz artist/title into gen make.
- **No new monthly cost.** "I'd prefer to thoroughly brainstorm options which enable a good user experience without increasing our monthly costs." The GCP run-rate was cut from ~$970 to ~$170–200/mo in Sept–Oct 2026 (`docs/sessions/2026-Q4/2026-10-04-gcp-cost-under-300-rounds-1-2-storage-retention.md`), and this must not undo that.
- **Cloud plus a partial offline index on the phone (option "A plus C").** Andrew: "ideally i want the nomad mobile app to make as much of its functionality available to work offline too (accepting compromises/tradeoffs when in offline mode)". Offline search serves two uses:
  - singers at bars that use known commercial libraries (e.g. KaraFun) looking up available songs;
  - later, the personal library (sung history and ratings, Phase 4).
- **Library filter groundwork for Phase 3.** Support only "a limited selection of easy to implement (eg easy to find a public authoritative source for what songs their library provides) commercial libraries (eg KaraFun, Karaoke Cloud, maybe Singa?)". Research into which libraries have authoritative catalogues belongs to Phase 3.
- **The four search outcomes** in §4.1 were reviewed as mockups and approved ("all lgtm").

**What success looks like:**
- Typing "starlite muse", "machu picchu strokes", "buy me presents sabrina" or "baby" in Discover gives the same song identification kjbox gives for that query, in well under a second when warm.
- The karaoke versions shown belong to that one song and are split into Community and Commercial.
- A song with no karaoke version shows "No karaoke version yet · Make it" at the top. The make flow then submits the canonical artist/title to gen.
- In airplane mode, searching still finds songs that have karaoke versions, with the same matching rules, and shows how fresh the saved list is.
- GCP net cost does not measurably rise. The target is ≤ $2/mo added, checked in billing a week after launch.

## 2. Goals, non-goals, anti-goals

**Goals**
1. **decide search service.** A new Cloud Run service in the karaoke-decide repo that answers song identification plus karaoke availability, using ported kjbox code (§5).
2. **Index build job.** A daily decide Cloud Run job builds the server index and the phone's offline index from the existing exports and publishes them (§5.3).
3. **Gemini fallback.** Decide calls gen's existing free-text resolve on the app's behalf (§6).
4. **Mobile search.** Discover uses the cloud search and the on-device offline index together (§4, §7).
5. **Mobile make flow.** Brought to parity with gen web and kjbox: canonical artist/title in, judge plus gate, a richer pick screen, the YouTube fallback rules and error mapping (§4.3).
6. **Library groundwork.** The index records per-song brands and a brand→library mapping table, so Phase 3's library filter can be built on it (§5.4).
7. **Search logging.** Choice events go to structured Cloud Logging, so wording and placement can be tuned from real use (§5.6).
8. **VISION updates.** An offline-first principle, and the library-source note (§9).
9. **Tests.** decide unit tests plus a decide local stack. Mobile component tests. Maestro on iOS **and** Android against the gen and decide local stacks (§8).

**Non-goals**
- The library filter UI. The data comes now; the UI is Phase 3, which also researches and ingests KaraFun, Karaoke Cloud and Singa catalogues.
- Sung history, ratings and the personal library. That is Phase 4; this phase only writes the principle into VISION.
- The "quick version" draft video. It is gen-gated to kjbox jobs and uses GPU time.
- Moving decide web's own search onto the new service. It could adopt it cheaply later, but it isn't in this round.
- Making kjbox consume decide's ported code. The code is vendored with a parity check; unifying it is a follow-up.
- Branding (app icon, Nomad logo). Andrew: "minor polish which can come later".

**Anti-goals: these would make the phase a failure even if it technically works**
- Any new always-on cost: min-instances ≥ 1, a bigger always-billed service, or a paid plan. Anything that costs money needs Andrew's explicit OK.
- Mixing candidate songs with karaoke rows (kjbox D1). Rows under a song card must belong to that song.
- The make flow submitting typed or KaraokeNerds spellings when an identification exists, or overwriting a field the user edited.
- Offline naming the wrong song. The TS matcher must match the Python one (§7.2). Because the phone holds fewer songs, offline is allowed to ask "Which one?" more often than online, but it must very rarely be confident about a different song than the cloud (§7.1 rivals table, §8 dual eval).
- Search getting worse than Phase 1 in any case. For example, popular songs on an empty query must still show.
- Querying karaokenerds.com or the live MusicBrainz API. Only our own exports and mirrors may be used (workspace CLAUDE.md; memory `feedback_no_live_musicbrainz_api`).
- Sending any secret from the app. The decide→gen partner secret lives server-side only.

## 3. Constraints

- **Mobile:** everything in nomad-mobile `CLAUDE.md`:
  - Expo SDK 57 and typed router;
  - TanStack Query, Zustand;
  - generated clients (refresh `openapi/decide.json`);
  - 33 locales: no hardcoded strings, `pnpm i18n:translate`;
  - a `testID` on every interactive element;
  - FlashList only through `@nomad/ui`;
  - API clients never touch storage.
- **Decide:** decide `CLAUDE.md` rules:
  - SOLID services and DI;
  - unit coverage 70%+ and backend coverage 60%+;
  - ruff and mypy;
  - Pulumi for infra;
  - version bump in `pyproject.toml`.
- **Shared infra rules:**
  - Cloud Run settings are set in BOTH Pulumi and the CI deploy flags. CI flags override Pulumi; that is the Sept 2026 OOM lesson, memory `project_decide_oom_ci_memory_drift`.
  - Claude's GCP access is read-only. Creating secrets and `pulumi up` need Andrew's `gcloud auth login` (or admin@). Plan those as explicit Andrew steps.
  - Gemini runs only through gen, on the Developer API key billed to Aquarius credits, never in the nomadkaraoke project (memory `project_no_ai_spend_in_gcp_project`). Decide never calls Gemini for this.
  - Never pull bulk data through Andrew's Mac. Build indexes in GCP (memory `feedback_no_bulk_data_through_mac`).
- **Repo workflow:** worktrees, `/coderabbit` before `/pr`, CI green before merge. The worktrees are `nomad-mobile-search-parity` and `karaoke-decide-search-parity`; create a gen worktree when gen work starts.

## 4. User experience

### 4.1 Discover search: four outcomes (approved mockups)

The mockup is at `.superpowers/brainstorm/*/content/search-states.html` (gitignored). The tokens come from `@nomad/ui`.

1. **Confident match, has karaoke versions.**
   - A "🎵 The song you mean" card shows title, artist, and "Corrected from "…" · Undo · Not it?" when the query was changed. kind `cosmetic` shows "Tidied to … · keep what I typed" instead. kind `same` and `completed` show no announcement.
   - Below it is "Karaoke versions (N)": that song's versions, each with a **Community** or **Commercial** pill and the full brand name. Community rows carry a YouTube link; commercial rows say they are in a library or on disc.
   - Then "Other songs with similar names", capped at 3 with "Show N more".
2. **Confident match, no karaoke version yet.**
   - A top card: "🎵 No karaoke version yet · Title — Artist · Make it →". It passes exactly that artist/title into Make.
   - Near-misses go under "Other songs with similar names" (≤3 + "Show N more").
   - The index's own `karaoke` flag vetoes this card (kjbox learning B108).
3. **Not sure.**
   - A "Which song do you mean?" card with candidate chips (≤4, plus "More…").
   - The karaoke results below.
   - A slim sticky "Not seeing your song? Make it" bar. It is never shown with a confident identification.
4. **Offline.**
   - A banner: "Offline · searching songs saved on this phone (updated N days ago)".
   - The same card and version layout from the offline index. Community rows show the saved link.
   - Make shows "Making a song needs a connection".

**Other rules carried over from kjbox:**
- **Query handling.** Minimum 2 characters, a ~300 ms debounce (Phase 1's 300 ms stays; kjbox uses 700 ms on venue wifi), and a generation counter so only the latest query renders.
- **Tap safety.** Results ignore taps for 300 ms after re-rendering.
- **Empty query.** It still shows popular songs (Phase 1 behaviour), now from the new service.
- **Tapping a result** opens the song page (§4.2).
- **Describe the song.** "Can't remember the name? Describe it" sends the text straight to the Gemini resolve. This is my call to include, as a small link under the search box (kjbox D4).

### 4.2 Song page

Phase 1's layout stays and gains:
- the grouped Community / Commercial version list, with community rows opening YouTube;
- "Make it" that passes the canonical artist/title (and song id/MBID when known) into the make intent.

The "same song" check on the client follows kjbox `sameSong`: same title key and a shared credited artist.

### 4.3 Make flow parity

The make intent (`apps/mobile/src/make/intentStore.ts`) gains `canonicalArtist`, `canonicalTitle`, `songKey`, `mbid?` and `source: 'identified'|'typed'`. Make-any-song (the free-text form) pre-fills from the current identification and never overwrites a field the user edited (kjbox D10, `prefillMake`).

Make screen (`app/make/new.tsx`), ported from gen `AudioSourceStep.tsx` and kjbox `make.js`:
1. **Judge and audio search together.** On mount, fire gen `POST /api/catalog/match-judge` with `stage:"fast"` in parallel with `search-standalone`. A confident cosmetic fix applies immediately.
2. **When to run the full judge.** When results arrive, compute the tier. Run `stage:"full"` only if fast returned null, `needs_ai`, or a confident catalogue match on weak audio (tier ≥ 3).
3. **Applying the verdict.**
   - Confident cosmetic: apply, and don't search again.
   - Confident content: apply, and search again only if tier ≥ 3.
   - Ambiguous: show "Did you mean…"; accepting always searches again.
   - Undo and redo swap metadata only.
4. **Gate.** Source-selection buttons stay disabled until the judge settles, or until a timeout (gen's `JUDGE_GATE_TIMEOUT_MS`).
5. **Submit the tidied values.** `create-from-search` gets the tidied `artist`/`title`.
6. **Pick screen** catches up with gen's Choose Audio step:
   - the raw **Filename** (`target_file`, monospace);
   - "Title match" / "Wrong track?" badges, with matching files sorted first;
   - `confidence.warnings`;
   - a High/Medium/Low availability badge (≥50 / ≥10 seeders);
   - release details;
   - category "+N more".
   - **Bug fix:** Spotify rows must show `target_file` as the track name. `title` is the album, and `view_count` is popularity × 10000.
7. **YouTube fallback.**
   - Collapsed behind "Can't find your song?" at tiers 1–2. Shown first and expanded at tier 3 or with 0 results.
   - URLs are checked with `POST /api/jobs/validate-url` before creating. The YouTube-only regex goes, since gen supports more hosts.
8. **Error mapping.**
   - A gen 400/403/422 whose detail mentions YouTube and "bot" → a dedicated `youtube_blocked` message.
   - 404 "Search expired" and 403 (search session owned by another account) → search again.
   - 402 → credits (as now).
9. **Parallel community check.** `POST /api/catalog/community-check`, non-blocking. If a community version already exists, say so before the user pays ("A community karaoke version already exists: watch it"), with make still available. This is my call, borrowed from gen web.

Rate limits: gen's `/api/catalog/*` routes share a 20/min per-user bucket. Two judge calls plus one community check per make fit. Never call gen catalogue routes per keystroke; typeahead uses decide.

## 5. decide search backend

### 5.1 Shape: a separate, scale-to-zero service kept warm by pings

- **The service.** A new Cloud Run service, `karaoke-decide-search`.
  - It is built from the decide repo, as the same image with a different entrypoint/role env, or a slim second image (builder's call).
  - It runs **min-instances 0**, request-based billing (`cpu_idle: true`), 1 vCPU and **4 GiB**. The in-memory filesystem holds the ~930 MB index; 4 GiB is the 1-vCPU maximum.
  - decide's main service is untouched: 1 GiB, min 0.
- **Why it costs ~nothing.** Under request-based billing, idle time between requests on an instance above min-instances is free. A **60 s uptime check** keeps an instance alive, the trick gen's backend already relies on (2026-10-04 session record, "Keep the 60s uptime check"). The paid time is search requests plus startup.
- **Verify before relying on it.** Before building, the builder confirms in the billing export (read-only account) that gen's pinged backend shows ~$0 idle cost. If it doesn't, stop and tell Andrew.
- **Cold start.** Cloud Run can still recycle the instance. Then the first request waits for the index download, about 15–30 s; measure it and keep it fast. The app pings `GET /api/search/health` on launch and foreground. While a cold start is in progress, Discover answers from the offline index if the singer has downloaded it (§7) and shows a quiet "Warming up…" note, like gen's "Starting up our karaoke servers…".
- **Daily index refresh.** The build job deploys a **new revision** with the new index run id, e.g. `gcloud run services update … --update-env-vars SONG_INDEX_RUN=<run>`. Cloud Run only shifts traffic once the new instance's startup probe passes, so users never see the cold start and the instance never holds two indexes in memory. This is my call; a hot swap inside one instance would need ~2× memory and CPU outside requests, which `cpu_idle` throttles.
- **Routing.** `decide.nomadkaraoke.com/api/search/*` is routed to the new service. Update the existing Cloudflare Worker in decide Pulumi. It could instead be called directly by its run.app URL; the builder picks, keeping one public base URL for the app if possible.
- **Settings in both places.** Every Cloud Run setting goes in **both** Pulumi and the CI deploy step.

### 5.2 Ported code (vendored from kjbox, parity-tested)

Copy these from `kjbox/kj-controller/` into a decide package (e.g. `karaoke_decide/song_search/`). Each file gets a header naming the kjbox source path and commit:
- `text_normalize.py` (`normalize`, `identity_normalize`, `index_text`, `joined_forms`, `fts_match_query`, `group_key`, `result_group_key`; `NORMALIZER_VERSION`, `SEARCH_INDEX_VERSION`);
- `song_identify.py` (`SongIdentifier.identify`, thresholds, `_same_song`);
- `scripts/build_song_id_db.py` (`build`, `_fold_title`, `SCHEMA_VERSION`);
- `fuzzy_match.py`;
- `version_priority.py` (brand registries, `rank_version`, `canonical_brand_for_match`);
- the grouping and folding logic from `routes.py`: `_group_search_results`, `_group_relevance`, `_kn_track_is_playable`, and the KN full/community merge from `karaoke_nerds.py` `_merge_full_catalog`;
- the `/sing/search/identify` `kind` logic (`sing.py` `_identify_kind`).

kjbox-only concerns stay behind: local SSD files, the Divebar mirror, NOMAD master suppression and rotation.

Also port kjbox's eval set (`tests/fixtures/song_id_eval.jsonl`, `song_id_synthetic.jsonl`, `scripts/song_id_eval.py`). It is the parity and regression gate (§8).

### 5.3 Index build job

A new decide Cloud Run **job**, `song-index-build`, triggered daily by Cloud Scheduler after kn-data-sync. It runs only when the song-id run id or the schema/normalizer versions change.

**Resources.** Roughly 2 vCPU / 8 GiB for ~10 min/day. Estimate ~$1/mo, which fits the free tier alongside the rest; confirm. Pin it to the service's SHA in CI like `mb-refresh`/`lb-refresh`.

**Inputs** (all existing exports, nothing scraped):
- `gs://nomadkaraoke-kn-data/song-id/latest.json` plus its shards: 4-col TSV `artist, title, popularity, karaoke`.
- `gs://nomadkaraoke-kn-data/full/full-data-latest.json.gz`: KN commercial, `{Artist, Title, Brands}`, a bare list.
- `gs://nomadkaraoke-kn-data/community/community-data-latest.json.gz`: `{"Items":[{Artist, Title, Brand, Watch}]}`.

**Outputs**, each under `gs://<bucket>/song-index/<run>/` plus a `latest.json` manifest with run, schema, normalizer, sizes and sha256:
1. **`song_id.db`**: the kjbox schema, as built by the ported `build_song_id_db.py`.
2. **`availability.db`**: KN full plus community.
   - Merged per song via `identity_normalize` keys.
   - Versions carry `{brand_code, brand_name, kind: community|commercial, youtube_url?}`. Disc-only commercial brands merge in as `is_community=False, youtube_url=None`, deduped by brand code.
   - Indexed for FTS plus a trigram fuzzy fallback (kjbox `catalog_mirror.py` design).
   - Brand display names come from gen's `kn_brand_names.py` map; vendor it.
3. **`offline.db`**: the phone's index (§7.1). It is the subset of songs with any karaoke version plus their versions and library tags, in a schema the TS matcher reads. Gzipped.

**Eval gate.** After building, the job runs the eval. If wrong-auto-applies or the local hit rate regress against the last published run beyond a small tolerance, it **does not publish** and logs an error (error monitor). This is my call.

**Publishing.** Publishing the server index means the revision update in §5.1. Keep the last 3 runs.

**Optional MBID.** Adding a recording MBID column to `SONG_ID_SQL` (gen `kn_data_sync/main.py`) would let Phase 4 history link to MusicBrainz. Do it **only if** kjbox's `build_song_id_db.py` tolerates an extra column (check its TSV parsing), or update both. Otherwise defer, and key songs by `identity_normalize(artist)|identity_normalize(title)`.

### 5.4 Library groundwork

`availability.db` and `offline.db` contain:
- a `libraries(code, name, kind, source)` table;
- `song_libraries(song_key, library_code)`.

For now the source is KN brand codes, mapped to libraries where a brand *is* a library's catalogue. Unknown brands stay just brands. Phase 3 adds authoritative catalogues (KaraFun, Karaoke Cloud, maybe Singa: whichever publishes a usable song list) as further `source` values, and builds the filter UI.

### 5.5 API (`/api/search/*` on the search service)

All endpoints are public (no token, like decide today) and rate-limited per device id header plus per IP. The kjbox numbers are 120/device and 1500/IP per window. Responses are typed with Pydantic `response_model`, so the OpenAPI snapshot generates the mobile client.

| Endpoint | Purpose |
|---|---|
| `GET /api/search?q=&limit=` | Returns `{identification: {status: confident\|candidates\|none, kind: same\|cosmetic\|completed\|content, best, candidates[≤5]}, groups: [{song_key, artist, title, karaoke: bool, versions: [...], version_count}], index: {run, built_at}}`. Identification and availability run against the same query. When identification is confident, availability is also run for `"<artist> <title>"` and merged (kjbox `fetchKaraokeForCorrection`). Groups are ranked by kjbox `_group_relevance`; versions are sorted best-first by `rank_version`. |
| `GET /api/search/popular` | Replaces decide `/api/catalog/songs/popular` for the empty query. |
| `GET /api/search/song?key=` (or artist+title) | Song page: identification detail plus all versions. |
| `GET /api/search/resolve?q=` | Gemini fallback via gen (§6). Same response shape as kjbox `/sing/search/resolve`: `{corrected, kind, typed, groups, split}` / `{alternatives}` / `{split}` / `{}`. |
| `POST /api/search/event` | Choice events (§5.6). |
| `GET /api/search/offline-index` | The offline index manifest: `{run, schema, normalizer, url, bytes, sha256}`. |
| `GET /api/search/health` | Warm-up ping and uptime check. Cheap; it does not touch the index. |

Decide's existing `/api/catalog/*` routes stay as they are for decide web.

### 5.6 Search logging

`POST /api/search/event` and the search endpoints write one structured Cloud Logging line per event. Events and fields follow kjbox `search_log.py` (`search`, `identify`, `resolve`, `accept_tidy`, `keep_typed`, `pick_candidate`, `not_it`, `make_offer_shown`/`make_offer_tap` with `where`, `make_submit`, `youtube_submit`, `describe_*`), plus a client search-session id. No PII beyond an anonymous device id; signed-in gen user ids are not sent.

Cloud Logging's free allotment covers this; no BigQuery sink in this phase. Logging never breaks search.

## 6. Gemini fallback (gen)

Decide's `/api/search/resolve` calls gen's existing `POST /api/kjbox/catalog/resolve` (`free_text.resolve_and_tidy`: one Gemini call to split and fix typos, then the gen catalogue tidy). It is called only when the cloud identification is `none` **and** there are no availability groups (kjbox rule E50), or for an explicit "Describe it".

**Gen change (small PR):**
- The route accepts a second partner secret for decide (e.g. Secret Manager `decide-gen-partner-secret`, header `X-Partner-Secret`, or a generalised check). Keep the kjbox header working.
- Share or split the 120/min partner-wide budget; the builder's call, but kjbox nights must not be starved.
- Add a local-stack fake for the resolve, so tests don't call Gemini.

**Andrew creates the secret.** Claude's GCP is read-only. The builder hands Andrew the exact `gcloud secrets create` commands, plus the IAM bindings for both services.

**Decide side.** Cache per case-folded query (500 entries). Rate-limit per device (20/5 min) and per IP (200/5 min). Fail silently to `{}`. Never cache `reason: "unavailable"`.

## 7. Mobile app

### 7.1 Offline index on the phone

- **Contents.** Every song that has a karaoke version (~300k KN full plus ~63k community, merged), each with:
  - canonical artist/title;
  - popularity;
  - versions (brand code/name, kind, YouTube URL);
  - library tags;
  - plus the matcher's tables: FTS over normalised fields, artists, vocab.

  The 5M+ songs without karaoke are left out; they only matter for making, which needs a connection anyway.
- **Rivals table (Andrew, 2026-10-18: "i'd rather give the users a better offline experience through a larger download").** The phone holds fewer songs than the cloud, and some matcher rules depend on which other songs exist: the 0.06 margin, the same-title popularity lead, and an exact obscure match losing to a popular near-match. So `offline.db` also carries a compact `rivals` table: the non-karaoke songs that would compete with a karaoke song for a query. That covers same or near-same titles (same `identity_normalize` title, or within the matcher's dedupe similarity), with artist, title and popularity. The builder picks the exact selection rule and measures its size.
  - Offline, rivals take part in scoring and margins exactly as in the cloud. A rival can win the identification ("this song has no karaoke version; making it needs a connection"), but it never produces karaoke rows.
  - On top of that, the offline matcher uses a slightly stricter confident bar (e.g. +0.03 margin; tune with the eval). Offline then asks "Which one?" a little more often rather than naming the wrong song.
- **Size.** Measure it. A larger download is fine (Andrew), but report the number. If it becomes very large, trim the vocab-variant tables first and say what that costs in matching.
- **Storage.** `expo-sqlite`. The builder confirms its bundled SQLite has FTS5 (and trigram, if used). If not, the matcher falls back to vocab-table expansion without FTS, and the spec owner is told.
- **Opt-in download (Andrew).** Nothing downloads automatically. A "Download song list for offline use (N MB)" button sits in Me, and in the offline banner when there's no list yet. Once downloaded, refreshes run in the background on unmetered connections, at most weekly or when `schema`/`normalizer` changes. Verify the sha256, then swap atomically. Show "Song list updated N days ago" and a "Remove offline song list" option.
- **Serving the file (Andrew: "whatever is easiest to implement, as long as it doesn't expose us to costs which are very likely (eg automated scrapers finding it easily and costing egress)").** The KN data is already publicly searchable on karaokenerds.com, so a public file is acceptable. My call:
  - Put the file at an unguessable, versioned GCS path (run id plus a random token), discoverable only through `GET /api/search/offline-index`.
  - Serve it through decide's existing Cloudflare Worker with edge caching, so repeat downloads don't cost GCS egress.
  - Don't list the bucket publicly.

  If the builder finds a simpler route with the same exposure (e.g. a signed URL from the manifest endpoint), that's fine.
- **Online use.** The offline index answers instantly while the cloud request is in flight (and during a cold start). Cloud results replace local ones when they arrive; the cloud wins.

### 7.2 TS matcher (`packages/core`)

Port `text_normalize`, the parts of `song_identify` and `fuzzy_match` the offline index needs, `_identify_kind`, the grouping/ranking (`_group_relevance`, `rank_version`) and `sameSong` to TypeScript.

**Parity is tested.**
- The decide repo emits a fixture file: query → expected identification and grouping from the Python code, over a small fixture index.
- The mobile repo's jest suite runs the TS matcher over the same fixture index and compares.
- Fixtures are refreshed by a script, and CI fails on drift.

kjbox already keeps a JS twin of its normaliser with node parity tests (`static/text_normalize.js`); reuse it as the starting point.

### 7.3 Screens and client

- **`packages/api-decide`.** Regenerate from the new OpenAPI snapshot. New facades: `searchSongs` (new shape), `resolveQuery`, `getSongVersions`, `getOfflineIndexManifest`, `logSearchEvent`, `pingSearch`.
- **`apps/mobile/src/find/`:**
  - search orchestration (local plus cloud, generation counter, fallback to resolve);
  - the four outcomes in §4.1;
  - the offline banner;
  - the warm-up ping.
- **Song page and make flow:** §4.2–4.3.
- **New strings.** All go in `en.json` and are translated for 33 locales. Reuse gen's wording for "Tidied to / Corrected to" (port gen's existing translations where the keys match).

## 8. Testing

**decide (unit and backend, CI-gated):**
- the ported normaliser/matcher/builder tests from kjbox;
- endpoint tests with a fixture index;
- resolve proxy tests (cache, rate limits, silent failure);
- the build job's eval gate;
- Pulumi/CI flag parity: a test or script asserting the memory/min-instances in both match.
- Coverage gates as today.

**decide local stack (new).** `scripts/local-stack.sh` in decide starts the search service on a fixed port (e.g. :8020) with a **fixture index**, a small built index from a checked-in TSV and KN fixtures that covers the Maestro songs. The gen resolve URL points at gen's local stack, which uses its fake. Document it in decide `docs/TESTING.md`.

**Eval.** Run the ported kjbox eval against a full index built in GCP, never on the Mac. The cloud matcher must reproduce kjbox's published results (80% auto-applied, 0 wrong on the labelled set) before the app depends on it.

**Dual eval (offline vs cloud).** The build job also runs the eval with the Python matcher over `offline.db`, which has the same rules as the TS matcher, and compares it with the cloud answer per query.
- Gate on the rate at which offline is confident about a different song than the cloud. Target ≈ 0; the builder sets the tolerance from the first measurement and reports it.
- Report how often offline falls back to "Which one?" where the cloud was confident.

**Mobile:**
- component tests for each search outcome, the offline banner, the song page versions, and each make-flow state (judge pending/applied/undone, Did you mean, gate, pick-screen badges, YouTube collapsed/expanded, validate-url failure, `youtube_blocked`, 403 re-search);
- TS parity tests (§7.2);
- coverage ≥ 70% on packages.

**Maestro (iOS and Android, one platform at a time).** `scripts/e2e-local.sh` starts both local stacks. New flows:
- confident with versions (Community/Commercial shown);
- confident with no karaoke, then Make submits the canonical artist/title (assert via the gen stack's job record);
- not sure, then pick a candidate;
- an offline search (airplane mode, or point the app at an unreachable search URL, with the offline index preloaded from the fixture);
- a make-flow correction with Undo.

Existing flows 1–9 must still pass. Screenshots go in `docs/screenshots/phase1b/<platform>/`, then a screenshot UX review of every changed screen on both platforms.

**Prod check before Andrew's phone test.**
- The release APK against prod decide/gen, searching for the §1 example queries.
- A **non-popular** test song from `scripts/karaoke-candidates/output/candidates.csv` for any real make. Ask Andrew first (memory `feedback_job_creation_candidates_only`).

## 9. VISION.md changes (in this phase's PR)

- **New principle, "Offline where possible":** every feature states what it does offline and what it gives up.
  - Search: the saved karaoke-song list and library tags.
  - Me: sung history and ratings are recorded on the phone first and synced later (Phase 4).
  - Things that need a connection: making a track, the Gemini fallback, songs without karaoke versions, and live new uploads.
- **Library filter:** Phase 3 researches which commercial libraries publish an authoritative song list, starting with KaraFun, Karaoke Cloud and Singa, and supports only those that are easy to source. This phase lays the data model.
- **Roadmap:** add the row "1b. Search parity", and note decide's search service as the single song-search backend.

## 10. Order of work (the builder refines it in the plan)

1. **Cost check.** Billing shows the gen ping trick costs ~$0. Stop if not.
2. **decide: port and eval.** Vendor the code; get unit tests green; build a full index in GCP (a one-off job run) and reproduce kjbox's eval.
3. **decide: service, build job, local stack.** Then Pulumi and CI. The **Andrew steps** are the secret creation and `pulumi up`. Deploy and measure cold start and latency.
4. **gen: the second partner secret plus the local-stack fake.** Merge and deploy.
5. **mobile:** TS matcher and parity; offline index; search screens; song page; make flow; i18n; tests; Maestro on both platforms; screenshot review.
6. **Prod check.** Then hand the APK to Andrew for the phone test.
7. **One week later:** confirm the billing impact (target ≤ $2/mo) and record it in the session record.

## 11. Calls made by Claude (not explicitly decided by Andrew)

- The search service is separate from decide's main service, so the 1 GiB main service and its OOM history are untouched.
- Daily index refresh by deploying a new revision, not an in-place hot swap.
- Decide proxies gen's resolve with a new server-side partner secret, not a new user-Bearer gen endpoint.
- Search events go to Cloud Logging, not BigQuery or Firestore.
- The offline index refreshes at most weekly. The download itself is opt-in (Andrew).
- The offline index holds songs with karaoke versions plus a rivals table. The rivals table is Andrew's choice of a bigger download for better offline answers; the selection rule and the stricter offline confident bar are my calls.
- How the offline file is served: an unguessable versioned path behind decide's Cloudflare Worker cache.
- An eval gate blocks publishing a regressed index.
- The parallel community-check line in the make flow, and the "Describe it" link.
- The Phase 1 300 ms debounce is kept (kjbox uses 700 ms).
- Vendoring the kjbox code into decide with parity tests, not making it a shared package now.
- An MBID column only if it doesn't disturb kjbox.

## Appendix A: learnings surveyed (2026-10-17/18)

Sources:
- **Session records:** `docs/sessions/2026-Q3`/`Q4`: kjbox-kn-commercial-brands-and-fuzzy-precision, kjbox-search-quick-wins, kjbox-search-unification-recs-5-6, kjbox-local-catalog-mirror, kjbox-kn-panel-grouped-search, kjbox-singer-ui-overhaul / polish / batch-autocorrect-folding, kjbox-singer-make-it-gen-flow, kjbox-make-it-feedback-polish, make-it-quick-version, make-it-youtube-blocked-spotify-ranking, kjbox-singer-song-for-friend-rename-guard, song-id-listenbrainz-ranking, kjbox-search-featured-artist-normalizer, kjbox-joined-word-search-mp4-tiebreak, decide musicbrainz/listenbrainz refreshes, the MB full mirror, bulk-album MB mirror, decide OOM, gcp-cost-under-300, mobile-phase1-make-it.
- **kjbox docs:** `docs/SONG-IDENTIFICATION.md` (SID).
- **Memory:** the kjbox, audio-search, decide and mobile entries.

### A1. Architecture
1. Singer search answers two separate questions: which real song is meant (identification over every song that exists), and whether there is a karaoke version (availability). Keep them separate in code and UI. [SID §1]
2. Never mix candidate songs with karaoke rows. The identification has its own card; rows below it belong to that song; picking a different identification never adds a request. [SID D1]
3. Once identified, ask availability for that one song: `unified_search("<artist> <title>")`. [SID §6.4]
4. Matcher first, Gemini only when not confident. Most queries are easy, and answering them locally is free and fast. [SID D2]
5. Gemini only through gen: one place for model, caching and rate limits. Clients hold a partner secret, never a Gemini key. [SID D3]
6. Freshness is required: "not acceptable for … search / auto-correction to be slowly degrading over time due to stale data". [SID D5]
7. One server-side search function for every surface, so each fix lands everywhere. [kjbox recs 5-6]

### A2. How people type
8. Mostly title only, or title plus an artist fragment in any order ("Buy me presents Sabrina", "Main Street bob seg"). [SID D6]
9. Typos are common ("Black eyes pee", "cheery pie"). The artist is often a first name or surname. [SID D6]
10. Descriptions ("that song from titanic") leave words unexplained, so they return none and go to Gemini. [SID §8]
11. Combined "title artist" ("Starlight Muse") is handled by artist-first retrieval. Any 1–4 word run that matches an artist name (FTS AND, sim ≥ 0.80) pulls in that artist's songs: ≤3 artists, ≤1500 songs each. [song_identify `_artist_candidates`]

### A3. Matcher internals (song_identify.py)
12. Retrieval pools three routes: FTS AND of each word's variants plus ≤6 leave-one-out queries (skipped at 40+ hits), title-phrase runs, and artist-first. Then dedupe and WRatio, keeping the top 200.
13. **Word variants.** From a vocab table bucketed by (first letter, length). Edit budget 1 (≤3 letters), 2 (4–8), 3 (9+). ≤8 variants per word. Words under 3 letters match exactly only.
14. **Word similarity** (`_word_sim`):

    | Case | Score |
    |---|---|
    | exact | 1.0 |
    | dropped g (5+ letters) | 0.95 |
    | prefix (3+ letters) | 0.9 |
    | mistyped start (4+ letters) | 0.75 |
    | otherwise | scaled Levenshtein × 0.95 |
    | 2-edit bad start | floor 0.6 |

15. Prefix `*` only on 4+ letter non-stop words. With 2+ distinctive words, stop words are dropped from the FTS intersection (performance).
16. **Query cleanup.** Strip karaoke/lyrics/instrumental/official and "song by"/"karaoke version". "feat" words are optional (weight 0.1). A stray single letter is glued to the previous word.
17. `song_norm` = `identity_normalize` plus joined single-letter runs ("U.S.A." = "usa"), used on both sides.
18. **Score** = 0.45·q_cov + 0.20·title_cov + 0.08·artist_cov + 0.12·sim + 0.15·title_sim + 0.10·pop/100 + 0.05 (karaoke exists). The exact typed title adds +0.06.
19. **q_cov** is a one-to-one word match. Stop words weigh 0.4; other words min(1, 0.4 + 0.15·len). Leftover-after-artist text is fuzzy-compared to the title ("max picu" ≈ "machu picchu"). No title evidence means score 0.
20. **Decision thresholds.**
    - Confident: score ≥ 0.80, margin ≥ 0.06, q_cov ≥ 0.80, plus title evidence.
    - Candidates: score ≥ 0.62 and q_cov ≥ 0.70.
    - Otherwise none, which goes to Gemini.
21. **Same title by several artists.** The most popular wins only with a ≥12 popularity lead (+10 if only it has karaoke), or ≥25 for a bare generic title. "baby" stays a question; "Die Young" goes to Kesha.
22. An exact obscure match must lose to a popular near-match ("the stokes" gives The Strokes). Popularity alone misranks, hence the karaoke boost. [SID D5/D7]
23. **Dedupe** per (artist, base title), stripping version suffixes. MB credit variants collapse when they share a credited artist and title, or are ≥92% similar with equal digits ("Hayloft" ≠ "Hayloft II").
24. **Identify kinds:**
    - `same`: nothing to announce;
    - `cosmetic`: "Tidied to";
    - `completed`: a card only if the rows don't show it;
    - `content`: "Corrected to". [sing.py `_identify_kind`]
25. **Measured (5.77M songs, 929 MB index):**
    - labelled set: 98/123 auto-applied (80%), 0 wrong;
    - freshness set: 26/26;
    - held-out set: 753/900 auto, 109 "Which one?", 7 wrong;
    - p95 ~200–290 ms on the N97.
26. Identification has no joined-word forms; run-together queries are untested there. [10-16]
27. **Open glitch.** "rihanna breaking" shows "Breakin' Dishes (Without Backing Vocals)". Dedupe should prefer the member without a suffix for display. [09-29]

### A4. Song-id index data
28. **Sources:**
    - MusicBrainz (weekly mb-refresh);
    - the July-2025 Spotify snapshot (pop ≥ 30, ~2.08M);
    - all KN (`karaoke=1`);
    - ListenBrainz popularity.

    Exported daily by gen `kn-data-sync` `SONG_ID_SQL`.
29. **MB inclusion** if any one holds: Spotify pop ≥ 30 (via ISRC); ≥3 recordings; Spotify artist pop ≥ 50; LB ≥5 listeners this/last year; LB ≥3 last/this month. That is ~4.5M of 30.7M.
30. **Popularity** = max(Spotify, LB). With neither, min(0.8 × artist pop, 50), so an estimate never outranks a measurement.
31. **LB calibration:** offset + 19·log10(listeners). Offsets: all_time 8, this_year 11, year/half 12, month 14, this_month 20. Artists: 2/6 + 17·log10. Ignore ranges under 3 listeners. Re-fit if LB's user base shifts.
32. LB artist popularity must not gate inclusion (+440K unlistened songs).
33. **Junk filters:**
    - MB disambiguations live/demo/rehearsal/instrumental/karaoke;
    - cover/tribute/"in the style of" credits;
    - self-titled rows without karaoke and with pop < 40.
34. **Export.** 4-col TSV gz shards at `gs://nomadkaraoke-kn-data/song-id/<run>/songs-*.tsv.gz`, plus a `latest.json` manifest so runs never mix. Last 3 runs kept. ~8–9 GB scanned (~$0.05) per run.
35. **Merge.** 5.9–6.3M rows → 5.77M songs. Merged on space-less normalised artist+title; the most popular display spelling is kept; karaoke flags are ORed.
36. **Spelling folds** (merge key only): dropped g on 6+ letter -ing words, "ur"→your, "u"→you. Display spelling = the karaoke one, else the more popular.
37. Preferring KN spelling everywhere added 10 wrong answers. KN only breaks ties.
38. **Rebuild triggers.** Rebuild on run id / `NORMALIZER_VERSION` / `SCHEMA_VERSION` change. ~9 min and 4.4 GB RAM. Atomic swap.
39. **Eval sets** (`song_id_eval.jsonl` with 123 cases; synthetic held-out). Metrics: local hit rate, wrong-auto-apply (≈0), Gemini fallback rate (= cost). The eval compares display strings, so check spelling changes before calling them regressions.
40. Evaluate in GCP, not via the Mac. Readonly ADC can't `EXPORT DATA`.
41. BigQuery gotcha: `NOT (a OR b)` with NULLs drops rows. Wrap in `IFNULL(…, FALSE)`.
42. kn-data-sync source changes need `gcloud functions deploy`; Pulumi doesn't pick up new source.

### A5. Why the existing catalogue search fails
43. decide `/api/catalog/songs` is `LIKE '%q%'` on artist OR title of `karaokenerds_raw`, ranked by brand count. Combined queries and typos return 0 ("bohemian rhapsody queen", "Starlight Muse"). It covers only songs that already have karaoke, and all brands (community and commercial codes) are mixed in one list. [decide survey; INBOX 10-17]
44. decide `/api/catalog/tracks|artists` are prefix-only. [SID §2]
45. Gen's job-form fast judge is an exact match after normalising (no typo tolerance). Most submissions need the Gemini full pass (~10 s). [SID §2]
46. decide's first request took 35.6 s: min 0, plus a ~34 s startup BigQuery load of the in-memory catalogue. [decide survey]

### A6. Gemini fallback
47. Call it only when identification is none AND availability found nothing; at most one Flash call per failed search. [sing.js `doSearch`]
48. **Caching and limits:**
    - kjbox: cache 500 entries; 20/5 min per device and 200/5 min per IP.
    - gen: cache 2000 entries; 120/min partner-wide.
    - Never cache `unavailable`.
49. **gen `resolve_free_text`:** one schema'd call, temperature 0, low thinking, 12 s timeout. It splits and fixes, and understands descriptions and lyric lines. Malformed output becomes none; it never 5xxes.
50. `resolve_and_tidy` runs the pick through `judge_match(stage="fast")` for canonical formatting. kind is cosmetic if the typed text named that song, else content.
51. A verdict with no karaoke songs must still pre-fill make. [SID §2]
52. Why a dedicated gen endpoint rather than match-judge: match-judge needs a split and can't fix typos, and an admin token would put an admin credential behind a singer action. [09-26]

### A7. Normalisation
53. **One normaliser** for indexes and queries, with a JS twin and parity tests. Order matters:
    1. NFD + strip accents + Latin specials
    2. lowercase
    3. feat
    4. &/+ → and
    5. apostrophes dropped, punctuation → space
    6. pt/vs
    7. number words and roman numerals → digits
54. `normalize` (search) keeps featured names. `identity_normalize` strips the feat clause and is used for grouping and keys.
55. Never apply an end-anchored deletion to concatenated "artist title" text: it turned "Zedd feat. … Stay the Night" into "zedd". Normalise fields separately.
56. Search must keep featured names ("hayley stay the night").
57. Word boundaries matter ("Soft Cell" ≠ "so"; "Taylor Swift" ≠ "taylor swi").
58. Brackets stay in grouping keys ("(Live)"). `result_group_key` strips only quality tags (MPX, [HM], multiplex, homemade).
59. `group_key` is also a persisted stats key; change grouping only via `result_group_key`.
60. "and" vs "&": FTS5 drops "&", so canonicalise both sides.
61. **Joined-word index.** The indexed side also stores adjacent pairs joined, per field ("overthinking" finds "(Over)Thinking", "acdc" finds "AC-DC"). Queries are never joined. Pairs only.
62. **Version stamps:** `NORMALIZER_VERSION` 3 gates song_id; `SEARCH_INDEX_VERSION` "3.1" gates FTS (bump only the suffix for index-only changes).
63. FTS query: quoted tokens, last token prefix-matched.

### A8. Availability matching
64. **Precision gate.** Every significant token (≥4 letters) must be covered: substring, or Levenshtein ≤1 (4–6) / ≤2 (7+). Typo tolerance never excuses a missing word.
65. A WRatio ≥ 80 gate made "queen bohemian" match all of Queen. WRatio is for ranking only.
66. No significant tokens means WRatio ≥ 95. Rank by (verbatim token fraction, WRatio).
67. The fuzzy fallback runs only when FTS returns nothing. Candidates come from trigram FTS by bm25 (`ORDER BY rank` is required), capped at 200–250.
68. "Found something" is a misleading metric: 190/254 fuzzy-only matches were garbage before the gate.
69. Whole-string LIKE fails on swapped order and typos; token-AND fixes it. Accent-fold both sides.
70. **Latency.** Serial BigQuery took 3.2 s; a local SQLite mirror takes 0.19–0.26 s warm.
71. **TTL caches.** Deep-copy on put and get; cache only successes; include the API URL in the key; cap the size.
72. **KN community is community-only.** "Any version" needs the full table too. Disc-only commercial brands merge in as `is_community=False, youtube_url=None`, deduped by code.
73. A version with no URL and no file is unplayable at kjbox. In the app it is still useful as "in this library", so label it rather than drop it.
74. Frontends must be null-safe for URL-less tracks. Verify payload changes in a real UI.
75. **FTS performance:** source filters go inside `MATCH`, not a JOIN-side WHERE (32 s). Use a freshness gate. KN full is a bare list; community is `{"Items":[…]}`.
76. The new path must never make search worse; any trouble falls back.
77. Clamp `limit` (SQLite LIMIT -1 is unlimited). Snapshot dicts before iterating in per-keystroke endpoints.

### A9. Grouping and ranking
78. One group per song: exact normalised (artist, title) via `result_group_key`. Group shape `{key, artist, title, version_count, versions[]}`.
79. **Group relevance:** title equals the query (2) > title prefix (1) > other (0); then playable; then version count capped at 12. Version count is the "well-known recording" signal (Luis Fonsi over a Boyce Avenue cover).
80. Versions are sorted best-first; `versions[0]` is the auto-pick.
81. **`rank_version` tiers:**

    | Tier | Base |
    |---|---|
    | community, listed brand | 0 + 10·brand index |
    | community, unknown brand | 1000 |
    | commercial, listed brand | 2000 + 10·brand index |
    | commercial, unknown brand | 3000 |
    | unknown | 4000 |

    Tiebreak by source and format (MP4 beats CD+G).
82. **Brand registries.**
    - Community: CC, LC, FBK, BELLY, NOMAD, FAKEY, PMK, OBSK, SDK, DBK.
    - Commercial: KV, SC, SBI, SF, CB, ZM, VS, SK, MR, PT, EK.

    Aliases ME→MR, PY→PT. Display names come from a code→name map.
83. Cross-source brand matching: registry name → name-only → alpha prefix (FBK204 → FBK) → uppercase name.
84. **Community fold** (kjbox only, needs local files): drop a KN community YouTube row when exactly one local file has the same song key and brand. Not applicable in the app.
85. **Open issue:** trailing ", The" isn't folded ("Adults Are Talking, The").
86. Popular songs exceed 50 versions; cap what you snapshot or display.

### A10. Singer UI flow
87. Debounce (kjbox 700 ms), minimum 3 characters, a generation counter; each keystroke invalidates in-flight results and the correction.
88. Identification (~100 ms) runs alongside karaoke search. Show the card early, start the identified song's availability early, then reconcile.
89. A search-session id ties search, identify, resolve and choice together; it is renewed after a pick.
90. **Cards:**
    - "🎵 The song you mean" with you-typed, keep-mine/undo and "not it?";
    - cosmetic: "Tidied to … · keep what I typed";
    - candidates: "Which song do you mean?" (local) / "Did you mean…?" (Gemini), max 4.
91. Client `sameSong`: same title key (accent-folded, alphanumeric, suffix-stripped) and a shared credited artist.
92. **Missing card (D13):** confident identification, no row for it and no karaoke → top card "No karaoke version yet · Generate it on demand". Others go under "Other songs with similar names" (≤3).
93. Not confident → a sticky "Not seeing your song? Generate it". Andrew: most singers never found the bottom make link.
94. The index's karaoke flag vetoes "no karaoke version yet" ("Killers" vs "The Killers").
95. Make pre-fill from the identification; never overwrite a user-edited field. [D10]
96. **Wording:** reuse gen's "Tidied to X · keep what I typed" and "Corrected to X — you typed … · Undo"; "Figuring out which song you mean…" while resolving. [D9]
97. "Can't remember the name? Describe it" is an explicit Gemini entry point. [D4]
98. A fresh results list ignores taps for 300 ms.
99. **Version row tiers** (kjbox): local "Definitely available", cloud "Very reliable", YouTube "Almost always works".
100. Version rows show Community/Commercial pills with an explainer, full brand names, hand-written brand blurbs (never scraped), and Preview.
101. A collapsed multi-version card shows `versions[0]` as a Best row. Single-version groups also need the enriched row.
102. **Search log:** search/identify/resolve rows plus client choice events (`accept_tidy`, `keep_typed`, `pick_candidate`, `not_it`, `make_offer_shown`/`tap` with `where`, …), reviewed with a report script. Logging never breaks search. [D11]

### A11. Make flow
103. **Two-phase judge, alongside the audio search.** Fast on mount; full only if fast is null, `needs_ai`, or confident on weak audio (tier ≥ 3).
    - Cosmetic: apply without re-search.
    - Content: apply, and re-search only at tier ≥ 3.
    - Ambiguous: "Did you mean" (accepting always re-searches).
    - Revert and reapply are metadata-only.

    [gen AudioSourceStep L180–330; kjbox make.js]
104. Source buttons stay disabled until the judge settles or the gate times out.
105. `create-from-search` uses the body `artist`/`title` (the tidied values) as the job name, ahead of the session query; `display_*` overrides both. The session keeps the original as `audio_search_*`.
106. **Audio ranking.** A confirmed title match first, then artist. Always pass the artist (George Strait vs Braxton Keith). Ties go to seeders, then popularity. [#1122/#1123]
107. A Spotify title+artist match is tier 2, not "limited". Torrents > Spotify > YouTube.
108. **Spotify fields:** `title` = album, `target_file` = track, `view_count` = pop × 10000.
109. `checkFilenameMismatch` strips only real audio extensions ("Mr. Brightside").
110. YouTube box collapsed at tiers 1–2; fallback first at tier 3.
111. **Pick screen like gen's Choose Audio:**
    - a confidence summary;
    - the Filename (monospace);
    - the release;
    - quality;
    - an availability badge (≥50 / ≥10 seeders);
    - release details;
    - warnings;
    - categories "+N more";
    - matching filenames first, with "Wrong track?"/"Title match" badges.
112. Validate YouTube URLs with `POST /api/jobs/validate-url` before creating.
113. A YouTube bot-check rejection → `youtube_blocked`; other rejections → `gen_rejected`.
114. 404 "Search expired" → search again. 403 (session owned by another account) → treat as expired.
115. Gen web fires `community-check` in parallel with the audio search, non-blocking.
116. kjbox job defaults: `is_private:false, requires_audio_edit:false, review_mode:"auto", backing_preference:"auto"`.
117. Gen copies every `X-*` request header into `job.request_metadata`, which the owner can read. Never send secrets as headers on job-creating calls.
118. Gen's per-IP signup cap is 2/24 h; a venue shares one IP.
119. **Quick version** is kjbox-only (`X-Client-Id: kjbox*` plus env), and fastgen-style. Its 4-minute goal is blocked by audio-download cold start. Out of scope here.
120. Never create test jobs for popular songs. Use `karaoke-candidates` and ask Andrew.
121. Gen's `/api/catalog/*` share a 20/min per-user bucket; don't autocomplete through gen.

### A12. Phase 1 gaps (what this phase fixes)
- **G1:** Discover only finds songs that already have karaoke.
- **G2:** no identification, combined queries or typos.
- **G3:** identification and availability aren't separated in the UI.
- **G4:** no community/commercial split.
- **G5:** no canonical artist/title into make; no judge or gate.
- **G6:** the pick screen is thin, and Spotify rows show the album.
- **G7:** YouTube fallback placement; no validate-url; the regex blocks other hosts.
- **G8:** no `youtube_blocked`; 403 isn't treated as expired.
- **G9:** no quick version (out of scope).
- **G10:** fine once G5 is fixed.
- **G11:** no search log.
- **G12:** rate-limit awareness.

### A13. Cost and infra
122. Under request-based billing, idle time above min-instances is free; a 60 s uptime check keeps gen warm for ~$0. [10-04]
123. decide went to min 0 to save ~$10/mo (#139). Memory flags live in both Pulumi and the CI deploy step, and CI wins. [decide OOM]
124. decide main-service memory headroom at 1 GiB is ~500 MB, shared with the dict catalogue and quiz spikes. Don't load more there. [decide survey]
125. No home servers for product-critical work (hf2 is full and its internet unreliable). [10-04]
126. Build images in Cloud Build; avoid cross-region egress. [10-04]
