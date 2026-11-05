# Phase 7 research, area 5: Me

Research only. No plan, no code changes. Mobbin covers iOS and web only, so every Android note below is my own adaptation, not something seen in a reference.

**Decisions treated as fixed** (Phase 4 spec §2): profile summary card at the top with Manage; the shelf order go-tos, setlists, Get this made, All your songs; one heart for Save; library plus many ordered setlists; This year / All time stats; both mood and vibe; Get this made's Make it plus Request it free; songs shown before claiming a past night; artists as top chips plus an A to Z screen; setlist sharing not chosen. Where I think a recorded call should change, it is in §4 as a question.

**Evidence limits.**
- Screenshots are the committed `docs/screenshots/phase4` and `phase6` sets, checked against the code; refer to the fresh tours when they land.
- No committed screenshot exists of the "Were these you?" card, Past nights or Get this made (the me-28…33 tour shots were never run), so those are assessed from code only.
- Untappd did not appear in Mobbin's results for a check-in log. Letterboxd, Beli and Vivino came back, and I used Letterboxd and Beli instead.

## 1. What our app does now

### Me home: `apps/mobile/src/app/(tabs)/me.tsx`, `src/me/MeHome.tsx`
Screenshots: `docs/screenshots/phase4/ios/me-1-home.png`, `me-1-stats.png`, `android/me-1-home.png`.

Order: title, profile card, Were these you?, go-tos, setlists, Get this made, All your songs, stats, credits, Buy credits, signed-in email, Your music profile, offline song list, language, Account and notifications, Sign out.

- **No identity at the top.** The top says "Me"; the email appears only far down, as plain text in the middle of the page.
- **Settings are mixed into the page, about two screens down.** Everything after stats is a stack of full-width buttons and cards with no grouping.
- **Duplicate entry.** The bottom "Your music profile" button repeats the card's Manage (already noted in the Phase 4 spec's UX review, never fixed).
- **Dead language row.** `me-language` is plain text showing the language, with no way to change it. `setLocaleOverride` exists in `src/locale.ts`, but no file outside `locale.ts` references it.
- **Buy credits is the only solid pink button on the page**, and it sits under the stats. It reads as the screen's main action, though it isn't what most visits are for.
- **New user: the profile card takes about 29% of the screen** (`me-1-home.png`). Two dashed call-to-action boxes stacked, plus a count line.
- **Go-tos are bordered cards with no artwork**, each about 8% of the screen height. Two go-tos and a setlist card fill the rest of the first screen.
- **Go-tos See all does not show go-tos.** It opens All your songs with the default filters (`GoTosShelf.tsx`).
- **Stats are seven plain text lines** (`StatsCard.tsx`): "3 songs", "4 performances", "2 nights". No hierarchy and nothing is tappable, so "2 nights" can't take you to those nights.

### All your songs: `src/app/me/songs.tsx`, `src/me/SongsFilters.tsx`, `src/me/CollectionRow.tsx`
Screenshot: `docs/screenshots/phase4/ios/me-2-collection.png`.

- **The filters push the list down.** Search plus five chip rows (six once the singer has used vibes), no row labels. The first song starts about 55% down the screen, and they scroll away with the list, so there is no sign that a filter is on after scrolling.
- **Mixed chip semantics with no visual difference:** sort is pick-one, feel and mood are multi-select, how often is pick-one-or-none, and Saved sits in the feel row.
- **Label plus placeholder say the same thing** ("Search your songs" over "Song or artist").
- **"Add songs I've sung" takes the header's right side**, squeezing the title. The spec's UX review already flagged truncation in long locales.
- **Rows have no menu.** The spec (§6.6) says row menus offer Add to setlist and Mark as sung, but `SongMenuSheet` is only used by `(tabs)/discover.tsx`. From a collection or setlist row you must open the song page.

### Song history: `src/me/SongHistory.tsx` (on the song page), `src/app/me/history/[key].tsx`
Screenshot: `docs/screenshots/phase4/ios/me-3-history.png`.

- **Only per song.** There is no view of "what did I sing last Friday" across songs, although `useLogMirror` already holds every record on the phone. The closest is sorting the collection by Recent, which shows songs, not nights.
- Edit and Remove are equal-weight pink text links on every record. Remove is the destructive one.
- The song page's own layout belongs to area 2; I note only that Your history sits above Save / Add to setlist / Mark as sung.

### Setlists: `src/app/me/setlists/[id].tsx`, `src/me/SetlistItemRow.tsx`, `src/me/AddToSetlistSheet.tsx`
Screenshots: `docs/screenshots/phase4/ios/me-5-setlist.png`, `me-5-edit-order.png`.

- **A setlist row can't be opened.** `setlist-item-N` is a `View`, not a `Pressable`, and nothing in it links to the song page. At the bar, a singer looking at their setlist can't reach the versions or the YouTube link to hand the host. This is the biggest functional gap in the area.
- **Every row carries its own buttons** (Request tonight or Add to tonight, Mark as sung, maybe Make it, Remove). Each row is about 17% of the screen, so roughly four songs fit on the first screen.
- **Remove is immediate, with no confirm and no undo**, and sits next to Mark as sung.
- **The header takes about 35% of the screen:** generic pink "Setlist" title, the real name again below, count, and four buttons wrapping to two lines. Delete has the same weight as Rename.
- **No position numbers unless editing,** although order is the point of a setlist.
- **Reorder is one swap per tap** with up and down arrows (`ArrowButton`). Moving song 9 to position 2 is seven taps, and you must then Save. Rename, Remove and reorder are three separate modes.
- **Add to setlist sheet:** an always-visible name field and "Add new" button under the list, and a separate Done. Rows have no song count, so a singer can't tell a full list from an empty one.

### Get this made: `src/me/GetMadeShelf.tsx`, `src/me/GetMadeRow.tsx`, `src/app/me/get-made.tsx` (code only)
Compact shelf rows and the one limit line (R28) are sound. On the full screen each of up to 30 rows has its own solid primary Make it button; check the fresh tour for a wall of pink.

### Were these you? and Past nights: `src/me/ClaimNightsSection.tsx`, `ClaimNightCard.tsx`, `src/app/me/past-nights.tsx` (code only)
Up to two full cards with every song listed sit above the go-tos. A regular with long nights could have this push the ready-to-sing shelves off the first screen until they answer. See Q2.

### Music profile: `src/app/me/music-profile.tsx`
Screenshots: `docs/screenshots/phase4/ios/me-9-profile.png`, `me-9-connected.png`.

- **Two solid pink buttons in a row** with no explained difference: "Take the voice test" and "Find your voice (30 min)".
- **Recordings dominates with zero recordings:** "0 recordings kept privately" still shows Delete all and the Record me by default switch.
- **The same idea in two cards:** Connected (Last.fm) and Your music services (Apple Music only). Apple Music is not in the Connect-style list; it has its own card with a large pink button.
- **"Remove" is a full-width button** under each source.
- **One very long page** holding voice, session, recordings, sources, Apple Music, artists, songs, quiz, hidden songs.

### Bulk picker: `src/app/me/sung-before.tsx`
Screenshot: `docs/screenshots/phase4/ios/me-4-picker.png`. Rows read as one "title by artist" line in heavy bordered cards, about seven to a screen. Already-sung rows look like selected rows (known from the spec's review).

### Mark as sung: `src/me/MarkSungSheet.tsx`
Screenshot: `docs/screenshots/phase4/ios/me-3-mark-sung.png`. Clean, but rating is a second step: Save, then an offer of the survey in another sheet.

### Account and notifications: `src/app/me/account.tsx`, `notifications.tsx`
Screenshot: `docs/screenshots/phase6/ios/notify-1-defaults.png`.

- **A whole screen for at most two buttons** (Notifications, and Delete account where gen allows it). Styled as big buttons, not a list.
- **Four separate cards,** no grouping, though three are about videos and one about nights.
- **System green switches,** not the brand colour.
- **No Help, Privacy, Terms or version** anywhere in Me. A privacy link exists only on the sign-in screen and in voice and export screens. Please check this against App Store guideline 5.1.1(i) (privacy policy "within the app"), from my memory of the guideline, not verified here.

### Delete account: `src/app/me/delete-account.tsx`
Screenshot: `docs/screenshots/phase6/ios/account-1-preview.png`. The content is better than most references (credits lost, what we delete, what we keep). But Delete my account is the same brand-pink primary as every other happy-path button and is one tap. `@nomad/ui` `Button` has only primary and secondary variants, though a `danger` colour token exists.

### Cross-cutting
- **~200 pt empty band under the native header on iOS.** Visible in `me-9-profile`, `notify-1-defaults`, `account-1-preview`, `me-3-history`. Not visible in `me-5-setlist`, `me-2-collection` or `me-4-picker`. In the code, the first three use `<Screen underHeader scroll>` and the last three are `View` + `List`. So it looks tied to the `ScrollView` path in `packages/ui/src/Screen.tsx`, which is a lead and not a confirmed cause. Already on the manual-pass list.
- **No confirmation toast in most of Me.** Adding to a setlist, saving and removing mostly give no feedback. `GetMadeUndoToast` is the only undo pattern, and it is specific to Get this made.

## 2. What the best apps do

**Profile as an index with counts.**
- [Letterboxd][lb-index]: recent activity, a ratings histogram, then plain rows with counts ("Films 7 / 4 this year", "Diary 4 / 4 this year"). Settings is one gear at the top left.
- [Strava][strava-rows]: "This week" chart, then icon rows with a useful subtitle ("Statistics: This year: 396.8 km"). Settings is a gear at the top right on the [own-profile view][strava-sam].
- [Beli][beli-index]: Been 1243 and Want to Try 980 rows, then Rank and Streak tiles.
- [SoundCloud][sc-library] and [Apple Music][am-downloaded] use the same pattern for a library: a short list of rows, then one shelf.

**Unfinished setup as one compact prompt.** [Strava][strava-complete] shows "Your profile is 80% complete" with one Continue button, not one box per missing item.

**Stats as numbers with hierarchy.**
- [Letterboxd "A Life in Film"][lb-life]: a headline, then a 2 by 3 grid of big numbers with small labels (Films, Hours, Directors, Longest streak).
- [Letterboxd stats by year][lb-year] adds a bar chart and tabs.
- [Strava Statistics][strava-stats] is a plain table split into Year-to-date and All time, which shows a table is fine when it's aligned.
- [Goodreads Year in Books][gr-year] and the [Strava monthly recap flow][strava-recap-flow] and [Beli recap flow][beli-recap-flow] make a recap its own event, with [Strava's share card][strava-share] and [Beli's share row][beli-share] for Instagram and Messages.

**A diary across everything.** [Letterboxd Diary][lb-diary]: month section headers, a day-number tile, poster, title, stars, and a small icon if there's a review. Filter icon at top right. The [log flow][lb-log-flow] ends in a green "added to your diary" banner.

**Log and rate on one sheet.** [Letterboxd "I Watched…"][lb-watched]: date row defaulting to today, stars, like, review, tags, all on one sheet with Save at the top.

**Setlist-like detail: compact header, list first.**
- [Spotify][sp-playlist]: art, name, an icon row, then a chip row Add / Mix / Edit / Sort. About seven rows show below it, each with a single ⋯.
- [Apple Music][am-playlist]: ⋯ and tick in the header, Play and Shuffle side by side.
- [\[untitled\]][untitled-playlist]: position numbers on every row and one "Add tracks" button.
- [Waking Up][wu-playlist]: a primary Resume plus three icon buttons, and a "Changes Saved" toast.

**Song menus, not row buttons.** [Spotify][sp-menu], [Suno][suno-menu] (three big tiles, then grouped rows), [Deezer][deezer-menu] (including a one-tap "Add to Driving", the last-used playlist), [YouTube Music][ytm-menu].

**Edit is one mode for reorder, remove and rename.** A red or outlined minus on the left, a drag handle on the right, Cancel and Save at the top.
- [Spotify][sp-edit] and its [reorder flow][sp-reorder-flow], where Save stays dim until something changes; [Spotify's editing flow][sp-edit-flow] also has name and description on the same screen.
- [Letterboxd][lb-edit]: position badges on the posters, plus an "Add a film" field at the top.
- [Waking Up][wu-edit]: the lifted row has a shadow.
- [YouTube Music][ytm-edit]: "Add a song" as the first row, Done at the top.
- [SiriusXM][sxm-edit]: a one-line hint, "Press and drag an item to move it."

**Add to playlist: create first, tick, confirm.**
- [Spotify][sp-add]: New playlist on top, a "Saved in" group, Recently updated, circles with counts. [With many lists][sp-add-many] it adds "Find playlist" and Sort. The [flow][sp-add-flow] ends in a toast.
- [Suno's flow][suno-add-flow]: ticking saves immediately and shows "Added to 'Road Trip 24'", no Done needed.

**Library filtering stays out of the way.**
- [Epidemic Sound Sort & Filter][es-filter]: a sheet of labelled sections with current values, "Clear (2)", and a live "View 1.923 tracks" button.
- [Spotify][sp-sort], [YouTube Music][ytm-sort], and [Shazam][shazam-sort]: sort is one small control above the list opening a short menu.
- [YouTube Music's library][ytm-library]: a few chips, one sort control, a floating "New playlist".

**Settings: grouped rows, destructive last.**
- [Deezer][deezer-settings]: identity at the top, Account management, then a Preferences group with icons.
- [SoundCloud][sc-settings]: toggles first, then rows with a value on the right, including App Language.
- [Epidemic Sound][es-account]: profile with the email as its subtitle, Log out centred at the bottom, version and build under it.
- [Letterboxd][lb-settings], and [Starbucks][sbux-settings]: "Help & policies" with Help, Terms, Privacy, Delete account, then Sign out and version.

**Notifications: section headers, one card per group.** [Google Photos][gp-notif], [New York Times][nyt-notif], [Gentler Streak][gs-notif], [Venmo][venmo-notif]. [Runbuds][runbuds-notif] and [Jomo][jomo-notif] add a single "pause all" switch.

**Connected services: one list, status on the right.**
- [Live Nation][ln-linked]: a one-line reason, then Spotify and Apple Music with Connect.
- [Linktree][lt-social]: connected rows show a green tick and chevron, others "Connect" and chevron.
- [Yubo][yubo-links]: "Connected · @alexsmith" under the name, red Disconnect beside it.
- [Uber Eats][ue-connected]: Connect or Disconnect plus a toast.

**Account deletion: red, and a deliberate second step.**
- [Vestiaire Collective's flow][vc-delete-flow]: a low-key entry row, then a sheet with an "I confirm" checkbox and a red outlined button.
- [Natural AI][nai-delete]: states the points you'd lose; "No, go back" is the prominent button and "Yes, continue" the quiet one.
- [DoorDash][dd-delete] and [Zomato][zomato-delete]: red on a plain confirm.
- [Starbucks][sbux-flow] and [Forest][forest-flow]: deletion is at the end of settings.
- Some add friction we don't need: a [reason field in Wanderlog][wl-delete], an [email code in Manus][manus-delete].

## 3. Recommended changes

Ranked by impact against effort. "New strings" means new `en.json` keys and a run of `pnpm i18n:translate` for 33 locales. Row 5 is listed as a building block for rows 1, 2 and 8, so build it first despite its rank.

| # | Change | Why | References | Impact | Effort | Android note | `@nomad/ui` block |
|---|---|---|---|---|---|---|---|
| 1 | **Setlist rows open the song and have one ⋯.** Tap a row → song page (or `me/history/[key]` if uncatalogued). ⋯ holds Mark as sung, Make it, Save, Remove. Keep only `SongTonightAction` inline, when a night is active. Show position numbers always. Header: the setlist's name as the screen title, a count line, a chip row (Add songs, Edit), ⋯ for Rename and Delete. | Singers can't reach versions or YouTube links from a setlist at the bar. About twice as many songs fit on screen. **Breaks me-5, me-6 and me-tour** (per-row buttons move into ⋯). New strings: few, mostly reuse. | [Spotify][sp-playlist], [\[untitled\]][untitled-playlist], [Apple Music][am-playlist], [Spotify menu][sp-menu] | H | M | ⋯ as a Material bottom sheet with a drag handle and ripple rows. A Material top app bar has a left-aligned title. | `SongRow`, `MenuSheet` |
| 2 | **Replace the chip wall in All your songs.** Search field (no separate label; keep an accessibility label). One row: Sort control showing its value ("Most sung ▾"), Filters button with a count, then two quick chips, Saved and Great. A filter sheet with labelled sections How it went, How often, Mood, Vibe, Library, with Clear (n) and "View N songs". Keep the header sticky. Header's "Add songs I've sung" becomes a + icon with that accessibility label. | The list starts halfway down the screen today. Reuses the labels `sortLabel` / `feelLabel`. Same model as Discover's `FilterBar` and sheets, so learn once. New strings: Clear, View N songs. **Breaks me-2 and me-tour** (filters behind a sheet; testIDs can stay). | [Epidemic Sound][es-filter], [Spotify sort][sp-sort], [YouTube Music][ytm-sort], [Shazam][shazam-sort] | H | M | Sheet follows system back to close. Sticky "View N songs" footer must clear the gesture bar (edge-to-edge). | `FilterSheet` (from Discover's sheets), `SortControl` |
| 3 | **Move utilities to one Settings screen.** Gear in Me's header, shown signed in and signed out. Me ends at stats, plus one compact credits row ("2 credits · Buy", see Q5). Settings groups: Account (email, Notifications), App (Language, Offline song list), Help and legal (Help, Privacy, Terms), then Sign out, Delete account where gen allows, and version. Remove "Account and notifications" and the duplicate music profile button. | Removes about a screen and a half of unrelated buttons, gives the email a home, adds legal links. New strings for section titles, Help, Terms, version. **Breaks flows and commons that use** `me-account` (3 files), `me-signout` (4), `me-buy` (2), `me-credits` (3), `me-music-profile` (1). | [Deezer][deezer-settings], [SoundCloud][sc-settings], [Epidemic Sound][es-account], [Starbucks][sbux-settings], [Letterboxd gear][lb-index] | H | M | Gear stays at the end of the app bar (mirrored in RTL). Rows use ripple, not iOS grey highlight. No chevrons needed on Material, though keeping them is harmless. | `ListRow`, `ListSection` |
| 4 | **Fix the iOS band under native headers** and show real titles (the setlist's name, not "Setlist"). Start from `Screen underHeader scroll` vs the `List` screens. | Every affected screen looks broken before anyone reads it. Likely shared with areas 2 and 3. | Every reference above has content directly under the header | H | S | Check it doesn't change Android, whose header is opaque. | `Screen` |
| 5 | **One shared song row plus ⋯ menu everywhere in Me.** 44 to 48 pt thumbnail (`ArtTile`-style gradient with initials when there is no art), title, artist, trailing status (times pill, feel, fit), ⋯. Extend `SongMenuSheet` with Add to setlist and Mark as sung as spec §6.6 asks, and use it for go-tos, collection and setlist rows. Go-tos become flat rows instead of bordered cards. | The spec's row menus were never built for Me. Every music reference has art plus one ⋯; our rows are text with big borders. | [Spotify][sp-playlist], [SoundCloud][sc-playlist], [Spotify menu][sp-menu], [Deezer "Add to Driving"][deezer-menu] | H | M | Same row; 48 dp minimum touch target. Long-press may open the menu on both platforms. | `SongRow` (promote, likely shared with areas 2 and 4), `ArtTile` size prop |
| 6 | **Karaoke diary** (`/me/diary`): every sung record, newest first, grouped by month with a date tile, venue or "Nomad night" as a night header, song, feel icon, note icon. Tap opens that song. Reached from a "Diary" row on Me and the stats card's nights tile. Backfill goes in a final "Before the app" group. | VISION's use case 4 wants "a history of what they've sung". Data is already on the phone (`useLogMirror`), works offline, no backend. New strings: title, empty state, few others. | [Letterboxd Diary][lb-diary], [Diary flow][lb-diary-flow], [Letterboxd index][lb-index] | H | M | Sticky month headers via `List`. Standard back. | `SongRow`, `DateTile` |
| 7 | **Single Edit setlist screen with drag.** Pushed screen, Cancel and Save on top, minus left, handle right, name editable at the top, Save dim until changed, one-line hint. Moves the separate Rename and arrow modes into it. Needs Q1. Build as a pushed screen, never a `Sheet`: gesture-handler gestures get no touches inside an RN `Modal` on iOS 26 (CLAUDE.md gotcha). Keep up and down as row actions in edit mode: they give VoiceOver and TalkBack a path, and Maestro a stable target. **Breaks me-5, me-6 and me-tour.** | Reorder is one swap per tap today. Every reference uses a handle. | [Spotify][sp-edit], [Spotify flow][sp-reorder-flow], [Letterboxd][lb-edit], [Waking Up][wu-edit], [YouTube Music][ytm-edit] | M | M | Hardware or predictive back with unsaved changes must ask to discard. Lift with Material elevation; add a haptic on both. | `ReorderableList` wrapper |
| 8 | **Confirm and undo with one toast.** "Added to Friday" / "Saved" / "Removed. Undo" across Me, generalising `GetMadeUndoToast`. Removing from a setlist and removing a history record use Undo where the write can be reversed. Setlist delete keeps its alert. New strings for a few messages. | No feedback today, and setlist Remove has no safety net. | [Suno][suno-add-flow], [Waking Up][wu-playlist], [Uber Eats][ue-connected], [Letterboxd banner][lb-log-flow] | M | S | Position above the tab bar and gesture area. Announce via `accessibilityLiveRegion`. Same look as a Material snackbar. | `Toast` |
| 9 | **Add to setlist sheet.** "New setlist" row first (field appears only on tap). Rows: art tile, name, count, circle. Most recently updated first, "Find setlist" once there are more than about 8. Tick applies immediately with a toast; keep Done as a close. Needs the `Toast` from row 8. Check me-tour's `add-setlist-*` steps. | Removes a permanent form from a picker. Shows which list is which. | [Spotify][sp-add], [Spotify many][sp-add-many], [Suno flow][suno-add-flow] | M | S | Same sheet. Keyboard on Android: pad the footer with `useKeyboardHeight`. | `Sheet`, `ListRow` |
| 10 | **Music profile as an index.** Keep voice first (Andrew's call). One primary and one secondary voice action, with plain labels for quick test vs guided session. Sources: one list, Apple Music merged in, status on the right, removal one tap further in (row → confirm). Recordings becomes a row with a count, hidden when none and the session flag is off (deleting stays reachable whenever any exist). Artists keep their chips; Quiz answers, Songs and Hidden become rows with counts. **Touches me-9, discover-5, voice-me-both-results, voice-session-3…5, `common/connect-profile-row.yaml`, `common/voice-clear-local.yaml`.** New strings for new labels. | The page is one long scroll with two competing primaries and two source cards. | [Live Nation][ln-linked], [Linktree][lt-social], [Yubo][yubo-links], [Strava rows][strava-rows] | M | M | Same list. Apple Music connect stays as it is on Android (full browser, per CLAUDE.md). | `ListRow`, `ListSection` |
| 11 | **Compact profile card and stat grid.** Unset state: one prompt ("Finish your profile: voice, music") with the two steps as small tiles side by side and Manage kept. Stats: keep the toggle, show Songs, Performances, Nights, Venues as a 2 by 2 number grid, Top artist and Most sung as two rows below; nights opens the diary. Reuses existing `me.home` keys where a number and label can be split, otherwise new strings (the count plural strings combine both today, so expect new keys). me-1 and me-tour assert these testIDs, so keep them. | Gets the shelves onto the first screen for new users; makes stats readable at a glance. | [Strava complete][strava-complete], [Letterboxd grid][lb-life], [Strava stats][strava-stats], [Beli tiles][beli-index] | M | S | Same layout. Check the 2-column fit in de and fi on both platforms. | `StatTile` |
| 12 | **Notifications grouped.** Two labelled groups in one card each: Your videos (ready, review, problems), Nomad nights. Brand colour on iOS via `trackColor`. Make "Problems" clearer: "Video problems". New strings: 2 headers, 1 label. | Reads as a settings page, not four unrelated things. | [Google Photos][gp-notif], [New York Times][nyt-notif], [Gentler Streak][gs-notif] | L | S | Material 3 switch look (thumb and track). RN's default Android `Switch` isn't M3, so style the track or accept. | `ListSection`, `ListRow` with switch |
| 13 | **Delete account: red and two-step.** Add `Button variant="danger"`. Keep the preview. Confirm opens one alert restating credits lost when there are any, with Keep as the prominent choice. **Breaks account-1** (one more tap). New strings: alert title and body. | The destructive step looks like every happy path today. | [Vestiaire flow][vc-delete-flow], [Natural AI][nai-delete], [DoorDash][dd-delete] | M | S | RN `Alert`'s `style: 'destructive'` only works on iOS, so Android's dialog button won't be red; the screen's button carries the colour. | `Button` danger variant |
| 14 | **Rate while marking sung.** Add the three feel faces to the Mark as sung sheet as an optional row, and offer the longer survey only if they tap one. Never blocking, same data. Toast on save. Touches me-3, me-7. | One sheet, same as the best log flows, so more songs get rated, and ratings power recommendations. | [Letterboxd I Watched][lb-watched], [Letterboxd flow][lb-log-flow] | M | S | Same. Sheet closes on back without saving. | none |
| 15 | **Small fixes.** Go-tos See all opens the collection with a Go-tos filter. Picker: already-sung rows in an "Already in your history" group using `SongRow`. Get this made screen: Make it as a smaller row button if the fresh tour shows a wall of pink. New strings: 2 or 3. me-10, me-4 touched. | Each is a promise the UI currently breaks. | [Bevel sections][bevel-pins], [Weverse rows][weverse-rows] | L | S | none | `SongRow` |

Not recommended: icons on every settings row (nice, not needed), or any new shelf on Me.

## 4. Questions for Andrew

1. **Allow a drag library for setlists?** Spec §6.6 says "no new drag library" (arrows, as in Tonight). I recommend changing that. `react-native-reorderable-list` runs on Reanimated and Gesture Handler, both already in the app, and is free. It is built on `FlatList`, so it doesn't touch the FlashList wrapper rule, and setlists are capped at 500. Its compatibility with our Reanimated 4.5.1 and New Arch still needs checking. If you'd rather not, I'd keep the arrows and add "Move to top" to the row. Tonight's reorder would be worth aligning either way.
2. **Can "Were these you?" collapse to a banner?** Ruling R40 puts up to 2 full night cards on Me. I recommend one banner ("We found 3 nights that might be yours. Review") that opens Past nights, where songs are still shown with ticks. That keeps your "show songs before matching" decision and keeps go-tos on the first screen ([Beli's feed banner][beli-recap-flow] is the shape). Worth seeing the fresh tour's me-32 shot first.
3. **Should a setlist have a "Play" equivalent at the bar?** When a night is active, a primary "Request next: Hello" above the list, and songs ticked as sung tonight ([Waking Up's Resume][wu-playlist], [Apple Music's Play][am-playlist]). I recommend yes, after row 1, since "usable at the bar" was the point of setlists. Effort M.
4. **Year in karaoke recap with a share card?** It's a strong acquisition idea (the [Strava][strava-recap-flow] and [Beli][beli-recap-flow] flows), distinct from the setlist sharing you passed on. I recommend leaving it for after release: there's little real data yet, and it would suit a first December. The stat grid in row 11 is the groundwork.
5. **Keep credits on the Me home?** I recommend a compact row there, not only in Settings, because use case 2 "should drive credit sales" and VISION lists credits under Me. It would no longer be the page's one solid pink button.
6. **Language: picker or remove the row?** I recommend a Language row in Settings opening a list of the 33 `LOCALE_NAMES` ([SoundCloud][sc-settings] has App Language), since people may want a language other than their phone's. The alternative is removing the row and relying on the device language. Picker effort: S to M, including persistence and the existing RTL reload.

## 5. Mobbin collection

[Nomad Phase 7 - 5 Me][collection] (25 references: 20 screens, 5 flows). It is private: only Andrew and his Mobbin teammates can open the link.

---

**Your Mobbin AI usage is high this month**

Usage is unlimited during beta. If your usage stays at this level, you may need to purchase more credits once limits take effect. [View usage and plan options](https://mobbin.com/settings/billing-and-usage?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp)

[collection]: https://mobbin.com/collections/9bc09e77-867e-43a2-8a46-c08682865b54/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-index]: https://mobbin.com/screens/0cbd7a3c-9a2d-4889-813a-9d826730a778?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-life]: https://mobbin.com/screens/af7b4f2a-9a01-4950-bbb9-bc5857593598?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-year]: https://mobbin.com/screens/81cf14b8-0ba2-4f7f-97e9-c2c954dfa49e?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-diary]: https://mobbin.com/screens/483648e0-d2c3-47ed-9c05-384c4d078d49?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-watched]: https://mobbin.com/screens/b4f69cfa-0ff1-4938-9324-7c0af178ea65?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-log-flow]: https://mobbin.com/flows/8e45b2f5-0680-40de-8d2c-ff1015c03dae?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-diary-flow]: https://mobbin.com/flows/7ec2459d-e20a-42a0-9f9d-792485dd60a0?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-edit]: https://mobbin.com/screens/e68db082-0bc9-4fd3-b7fb-74d7fda14330?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-settings]: https://mobbin.com/screens/d646ec53-e698-430e-982e-58dde702445d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[strava-rows]: https://mobbin.com/screens/f8673140-fc82-48ce-b231-aea18cc854db?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[strava-sam]: https://mobbin.com/screens/533801a5-e9c5-4887-8480-f3b2e94d81cf?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[strava-complete]: https://mobbin.com/screens/e2c4d8a5-1b1a-4087-b666-4d65e9d2cc19?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[strava-stats]: https://mobbin.com/screens/1786be1e-54c1-471b-9b1d-2cb2401ee016?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[strava-share]: https://mobbin.com/screens/02cd5c88-9922-4d47-8da3-bba089b6eecf?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[strava-recap-flow]: https://mobbin.com/flows/12b59a5c-335c-4ec6-a4ba-975ec34928d4?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[beli-index]: https://mobbin.com/screens/e1aff3df-761d-4952-aa8c-04a02b6d69eb?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[beli-recap-flow]: https://mobbin.com/flows/6520099e-59a7-44a2-8336-a80d9feb47ce?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[beli-share]: https://mobbin.com/flows/6520099e-59a7-44a2-8336-a80d9feb47ce?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gr-year]: https://mobbin.com/screens/2aa78a42-966e-43c2-bd75-171b90280565?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sc-library]: https://mobbin.com/screens/02aee325-8a52-44c1-846c-27d82f3cf85b?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sc-playlist]: https://mobbin.com/screens/48ab5685-3b18-478c-a4fa-8f5cdacc8df3?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sc-settings]: https://mobbin.com/screens/b8f5e125-aed4-45a7-b70c-c85a6092a072?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[am-downloaded]: https://mobbin.com/screens/2087d083-31ec-4f92-998e-c600bd9469d4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[am-playlist]: https://mobbin.com/screens/8ef5f209-0e4a-4ed9-b742-cef6a47acc6f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-playlist]: https://mobbin.com/screens/61af77a4-a534-4b48-b0ea-d440f7da6943?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-menu]: https://mobbin.com/screens/facdc774-78cf-4c5f-a873-b70201c92bed?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-edit]: https://mobbin.com/screens/e0486c16-d841-442f-8172-e020cf712e19?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-reorder-flow]: https://mobbin.com/flows/fe3e3166-0ef7-472f-8e05-72ee3c075f17?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-edit-flow]: https://mobbin.com/flows/4bdb6180-97d7-456b-a571-28675eece318?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-add]: https://mobbin.com/screens/12351da3-4a6c-4f23-bea0-7674d19c8eea?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-add-many]: https://mobbin.com/flows/325ffefb-2469-418d-8d79-9779506f9a28?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-add-flow]: https://mobbin.com/flows/325ffefb-2469-418d-8d79-9779506f9a28?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-sort]: https://mobbin.com/screens/e407265a-af25-4f72-86c3-24908d5cfecd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[untitled-playlist]: https://mobbin.com/screens/3874b37f-33fb-4e69-af62-697b1ef25f82?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[wu-playlist]: https://mobbin.com/screens/37080fad-3ea0-472e-8351-c69568ef3904?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[wu-edit]: https://mobbin.com/screens/736258ca-de85-4089-93cc-f3191a5ca8b6?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-menu]: https://mobbin.com/screens/dc7e2cec-5911-480e-ac99-a3a86e1396e1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-add-flow]: https://mobbin.com/flows/ccc5aa15-052a-4c5c-99da-e4e33be41dd8?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[deezer-menu]: https://mobbin.com/screens/b47c2abf-e795-4874-b457-919045bf5c3d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[deezer-settings]: https://mobbin.com/screens/7d427604-cff0-4771-bc4d-6d166dd2b0c9?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-menu]: https://mobbin.com/screens/a84d6487-ae87-465c-aa03-5b2328886823?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-edit]: https://mobbin.com/screens/b0723c69-759e-4fa9-8f81-a559e67b7466?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-sort]: https://mobbin.com/screens/1e8522d2-fb5b-49b3-b0ed-5a01c02b64e6?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-library]: https://mobbin.com/screens/e0560ca4-e5d0-4632-96df-2110c3ece955?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sxm-edit]: https://mobbin.com/screens/cfb1e560-c6ae-4883-b6b9-47eff0ade897?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[es-filter]: https://mobbin.com/screens/105ad91c-ab98-499a-b146-f3a2d70dc816?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[es-account]: https://mobbin.com/screens/445b227c-15da-4c62-9ff8-d841bc93ec8b?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[shazam-sort]: https://mobbin.com/screens/11a378f2-e0e6-493e-abe8-8f9635832b64?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sbux-settings]: https://mobbin.com/flows/69699f6c-c1c2-4749-85df-ac428ff2e2a5?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sbux-flow]: https://mobbin.com/flows/69699f6c-c1c2-4749-85df-ac428ff2e2a5?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[forest-flow]: https://mobbin.com/flows/d487e001-8070-44ab-b913-b433e05a2d29?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gp-notif]: https://mobbin.com/screens/22a248fd-e7e2-4396-bae3-51e8c952b2b6?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[nyt-notif]: https://mobbin.com/screens/2eb2f3b8-3992-4c41-bbca-e469d3bb6c61?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gs-notif]: https://mobbin.com/screens/33a9da03-3400-445d-9e4e-943e33d1f2de?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[venmo-notif]: https://mobbin.com/screens/c9e32778-c869-4879-8982-878356e69632?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[runbuds-notif]: https://mobbin.com/screens/75f4ed2d-a2fa-47a3-89a1-041c4b254c69?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[jomo-notif]: https://mobbin.com/screens/e75c7211-703e-42ed-8529-1472bc0670de?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ln-linked]: https://mobbin.com/screens/5eda9498-453e-438c-94d6-b4e65b2b38e4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lt-social]: https://mobbin.com/screens/a6404f2c-6c05-4030-868a-a0b5ffd6accd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[yubo-links]: https://mobbin.com/screens/f31d5f8b-fb56-46ad-976d-ac89cb0a6f76?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ue-connected]: https://mobbin.com/screens/035eeb71-dd57-4203-9615-5f1bda565dbf?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[vc-delete-flow]: https://mobbin.com/flows/1d82d598-a76f-4b01-af48-ae0af8101148?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[nai-delete]: https://mobbin.com/screens/12979086-22f4-4dfb-88ee-7120173b5b32?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dd-delete]: https://mobbin.com/screens/ab4eecb4-24ec-40c9-aca6-799efcd5c9fc?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[zomato-delete]: https://mobbin.com/screens/ec3a0723-ba00-4908-9a09-bebd180dfd96?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[wl-delete]: https://mobbin.com/screens/99b39f4e-dc4f-4fe1-b2f9-b1d819a400da?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[manus-delete]: https://mobbin.com/screens/f06ce2f1-dea4-495e-9717-90ffb223cbd0?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[bevel-pins]: https://mobbin.com/screens/6ecf82f8-b6db-422c-bd93-c0fdf74d5b58?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[weverse-rows]: https://mobbin.com/screens/3b6da3da-216e-4c7c-88ca-7493956d28cb?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
