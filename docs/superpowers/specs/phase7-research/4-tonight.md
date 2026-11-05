# Phase 7 research, area 4: Tonight

Research for the UX plan, 2026-11-05. It covers joining a night, requesting, your songs, the queue and your turn, managing songs, tips, the survey and the other-bar log. The context is one hand, a dark room and a loud bar.

The screenshots used are from `docs/screenshots/phase5/ios/`. They are from Phase 5 and I checked them against the code. Where they are stale, I say so. Every path below is relative to `apps/mobile/src/tonight/` unless it starts with `docs/`, `maestro/` or `packages/`.

## 1. What the app does now

### Where the app lags the web singer UI

kjbox's web singer UI changed after real nights and Andrew's own run-through (2026-10-22 to 10-31). The app was built on 10-22 and has not had these changes. The Phase 5 spec's "mandatory, hardened confirm" (A.19) is superseded by Andrew's 2026-10-29 decision, and that memory says to port the flow to the app.

| Web today (kjbox v0.141–v0.146) | App today | Where |
|---|---|---|
| No confirm step. Request sends from the search row. | Full-screen "Is this the right song?" with "Yes, send" and "Pick a different song" | `request/ConfirmScreen.tsx`, `request/ConfirmCard.tsx`, `docs/screenshots/phase5/ios/tonight-3-confirm.png` |
| 15 s one-line Sent note with Undo and + Add singer | No confirmation at all. The singer lands on Tonight and the song appears after the refetch. | `ConfirmScreen.tsx` `send()` |
| Compact rows (title; artist · N versions; pill · brand; Request and ▶ Preview). Best version folded into the facts line. | Large card with a full-width button, an "Auto-select best version" line and a nested version card. Only one result fits above the keyboard. | `request/ResultsList.tsx`, `request/VersionRow.tsx`, `tonight-3-results.png` |
| "Original" / "Cover band" | "Community" / "Commercial" | `VersionRow.tsx`, `en.json` `tonight.request.version` |
| Singers never see reliability copy (Andrew, 10-29; v0.146.0) | Every version shows it: "Almost always works. YouTube downloads occasionally fail." The other sources show "Very reliable…" and "Definitely available…". | `VersionRow.tsx` `availText`, `ConfirmCard.tsx` `sourceLine`, `tonight-3-results.png` |
| All/Original/Cover band pills, Sort, other artists grouped (lists of 6+) | None | `request/ResultsList.tsx` |
| Photo consent asked in My songs | Asked on the confirm step | `ConfirmScreen.tsx` `partnersBlock` |
| Duet partner added after sending (Sent note, Singers) | Duet partner only on the confirm step. There is no way to add one afterwards. | `manage/DuetPicker.tsx`, used only from `ConfirmScreen.tsx` |
| Make-it rows collapse to a short status with an ⓘ toggle | Long status sentences on the row | `nomad/SongRow.tsx`, `en.json` `makeReview`, `makeRendering` |
| 3+ actions in a grid under the text | Wrapping row of buttons | `nomad/SongRow.tsx` |
| Make-it: audio chosen automatically, because tipsy singers "couldn't judge audio files" | Picked by default, but the card shows filename, release, format and availability | `make/TonightMake.tsx` with `make/SourcePicker` `PickCard`, `tonight-7-make.png` |

The YouTube breaker itself already reaches the app, because v1 search proxies `sing.search` (`kj-controller/sing_api_v1.py`). Only the copy is out of date.

### Screen by screen

**Empty state** (`EmptyState.tsx`, `tonight-2-empty.png`). Clear and short: Scan, Enter the night code, Start logging. The code entry opens inline. No real problem.

**Scanner** (`ScanScreen.tsx`, `tonight-2-scan.png`).
- A square camera sits in a normal page, with a third of the screen empty below it.
- There is no aiming guide and no torch.
- Wrong QR codes are ignored silently, which is a recorded ruling (E3-R3).

**Name** (`JoinScreen.tsx`). Prefilled and one tap. Good. The push question follows, raised once Tonight has settled.

**Night home** (`nomad/NightScreen.tsx`, `tonight-3-your-songs.png`). This is the main problem screen.
- The same song and status appear twice in the first screen: "Hello by Adele · #10 in line · about 41 min" in the tile and again in the row just below (`nomad/StatusTile.tsx`, `nomad/SongRow.tsx`).
- The answer to "when am I up?" is 16 pt regular text in a 3-line tile. It is no larger than the row below it.
- "Updated just now" and a Refresh button take a full row (`nomad/Freshness.tsx`), although the screen polls every 15 s and has pull to refresh.
- Request a song sits inside the scroll, below the songs. It moves further from the thumb with each song added, and it scrolls away (`nomad/YourSongs.tsx`).
- Name, Text me, Song for a friend and Tip the host are three full-width buttons, each as heavy as the main actions (`manage/MyNightPanel.tsx`).
- Who is singing now and the rotation are below all of that, off the first screen (`nomad/StatusTile.tsx` `StageTile`, `tonight-5-reorder.png` shows it starting at the fold).
- The order is status, freshness, notice, songs, settings, sung, stage, rotation, venue. A singer checking "is it me soon?" scrolls past settings to see the queue.
- The rotation caveat is permanent ("The order can change: new singers move up…"), and each row is three lines.

**Your turn** (`nomad/TurnBanner.tsx`, `nomad/useTurnAlerts.ts`, `tonight-4-on-stage.png`, `tonight-4-urgent.png`).
- "You're on!" is a banner with 16 pt text that hides after 10 s. A singer who glances away misses it. The tile still says it, at 16 pt.
- The banner sits above the list and pushes it down by about 100 pt as it appears, so a thumb on its way to a button can land on the wrong one, such as Cancel.
- There is one haptic. In a loud bar, a single buzz in a pocket is easy to miss.
- The screen can sleep while the singer waits. There is no keep-awake anywhere in the app.
- Backgrounded alerts rely on the box's push. It sets `priority: high` and the Android `tonight` channel is HIGH, but nothing marks it time-sensitive on iOS, so Focus modes can hold it (`kj-controller/push_dispatcher.py`).

**Manage** (`manage/`).
- Reorder is explicit ▲/▼ with row numbers and Save, as the spec ruled (A.57, `tonight-5-reorder.png`). It works, but the three-line hint is long.
- The cancel notice sits mid-list (`manage/SongActions.tsx` `NoticeLine`), so it can be off screen.
- Cancel is instant and sits next to Change song with the same weight.

**Tips** (`manage/TipsScreen.tsx`, `docs/screenshots/phase5/ios/en/tonight-31-tips.png`).
- A full screen with presets, a custom field, a method list and a second card for "Sent a tip?".
- The perk threshold (or $10) is preselected and visibly highlighted, which is good. The custom field stays open, though, and "I sent a tip" falls below the fold.
- After paying in Venmo the singer returns and has to pick the method again, though the app knows which one they tapped.

**Survey** (`log/SurveySheet.tsx`, `tonight-8-survey.png`; the shot predates the chips).
- All questions show at once: feel, key, crowd-pleaser, seven vibe chips, reasons when feel is OK or bad, and notes. It scrolls.
- Nothing saves until Save, so one quick tap followed by a swipe away counts as a skip. A singer just off stage, drink in hand, will often lose the one answer they gave.
- `tonight-8-survey.png` also shows "You're on! Time to sing" still up behind the survey.

**Other-bar log** (`other/OtherNightScreen.tsx`, `other/LogRow.tsx`, `other/AddSong.tsx`, `tonight-10-night.png`).
- The venue input is the first thing on screen and stays an open text field for the whole night.
- Each row has up to five text links on two lines (I sang it, Maybe later, Copy YouTube link, Share with the host, Remove). "Remove" sits beside the others with no separation.
- Add a song takes a search, then a second step choosing among three stacked buttons.

**Legibility across Tonight.**
- Measured from `packages/ui/src/tokens.ts`: muted text is 5.41:1 on the background and 4.91:1 on cards, which passes AA but leaves little margin in a dim room.
- `border` is 1.34:1, far below the 3:1 WCAG asks for control edges, so secondary buttons are close to borderless. The screenshots look fine in a bright room, and this is the weakest visual point in a dark one.

## 2. What the best apps do

**Queue status: one line, large, with the wait, in plain words.**
- [Uber][uber-1min] titles the sheet "Pickup in 1 min" and [the earlier state][uber-3min] "Pickup in 3 min". That is the whole status, with no separate "updated" line.
- [Chick-fil-A][cfa-wait] is the nearest analogue to karaoke. A vertical rail, "4-9 MIN ESTIMATED WAIT" in red caps, then a large instruction: "Please go to the Pickup area." It adds "A Team Member will call out your name". The status tells you what to do, not only where you stand.
- [Starbucks][sbux-hero] uses a hero band, "See you soon… Ready around 10:23 AM (in 4 – 7 minutes)", with "Don't follow this order" as a quiet outlined button further down.
- [Waymo][waymo] says "You are number 1 in the line" with a small "Leave the queue" button, and [Equinox+][equinox] shows "Your place in line" over a large "#1". Leaving is possible but quiet.
- [DoorDash][dd-prep] and [Panera][panera] use a stepped rail, with chips for secondary actions under it. A rail shows stages, not exact positions, so it survives a position that moves backwards.

**The moment it's your turn: louder than the waiting state.**
- [Lapse][lapse] fills the screen with one colour and "YOU'RE IN!". [Grill'd][grilld] uses a full-bleed illustration over a large time. Neither was a queue state (Mobbin has few true "your turn" screens; I searched for them specifically), but both show what a single-message screen looks like.
- [Starbucks' lock screen][sbux-ready] changes to "Ready to go! See you at the pickup counter", and [Chick-fil-A's Live Activity flow][cfa-flow] moves "We'll start your order…" → "Please go to the Pickup area." → "…in a moment". The instruction changes with the state.

**Live Activities: glanceable, no app open.** [Transit][transit] ("70 in 1 minute"), [Blinkit][blinkit] ("Arriving in 9 mins"), [Lyft][lyft-la] and [Wonder][wonder] all put one number or instruction and one rail on the lock screen.

**QR join: camera first, fallback one tap away.**
- [Uber][uber-qr] is black and full-bleed, with corner brackets, a torch icon and "Enter ID instead" at the thumb. [Forest][forest] puts "Type Vehicle ID" and a torch side by side.
- [Bevel][bevel] raises a numeric keypad sheet over the live camera.
- [Tonal's scanner][tonal-flow] says exactly where to find the code. [Lime's flow][lime-flow] explains the camera before the system prompt, with keyboard and torch buttons.
- [Mesh][mesh] shows a small "Invalid scan" pill when a code is wrong.

**One action, then a light confirmation with Undo.**
- [CHOPT][chopt] adds to the cart with no confirm step and shows a banner "…added to cart" with Undo, above the bottom bar.
- [Quicken][quicken] and [Google Photos][gphotos] use a bottom snackbar with Undo. [Todoist][todoist] puts an Undo chip in the thumb zone above the tabs.
- [Spotify's Jam flow][jam-flow] adds a song from the list with "+", shows "Added to Jam." at the bottom and stays on the list, so adding another is one more tap.

**Queue management.**
- [Spotify][sp-queue] uses art, title and artist in two lines, a trailing handle, and the current song in green. [Dragging][sp-drag] lifts the row, and [a swipe][sp-swipe] reveals a red trash. [The Jam queue][sp-jam] shows whose song each row is with an avatar.
- These are gestures, and Andrew's nights found drag confusing (A.57, A.105), so I take the row density from Spotify and not the gesture.

**Quiet secondary actions.** [Posh][posh] lists View Event, Transfer Ticket, Add to Calendar and more as flat rows with trailing icons, not stacked buttons. [Uber][uber-3min] tucks the rest behind a card.

**Tipping.**
- [Uber][uber-tip] uses a sheet: three amounts, "Enter Custom Amount", Skip. [DoorDash][dd-tip] uses a segmented $1 / $2 / $3 / Other.
- [Lyft's flow][lyft-tip] uses a sheet with three presets (one preselected and visibly so), "Add custom tip", "Add tip", then a "Thanks for tipping!" toast.
- [Grab][grab], [Zomato][zomato] and [Tesla Robotaxi's flow][tesla-flow] place the tip with the rating, at the moment of goodwill.

**Rating: one tap first, the rest on demand.**
- [Lyft's flow][lyft-flow] opens with stars alone. [After a rating][lyft-rate] it reveals "Great", "What went well?" and chips.
- [Uber Eats][ue-rate] does the same with thumbs. [Skip][skip] uses two very large thumbs. [Grubhub][grubhub] offers "Not now" as a full-width bottom button.

**Logging.**
- [Beli][beli] asks "How was it?" with three large colour circles (I liked it! / It was fine / I didn't like it), and everything else is an optional row below. It maps directly to great / OK / not for me.
- [Letterboxd's quick sheet][lb-sheet] has Watched, Like, Watchlist and stars, then "Review or log" for more. [Its full form][lb-form] is separate.
- [Pangea][pangea] uses two segmented choices (Want To Go / Been; Not a fan / Liked / Loved).

**Coverage gaps.** Searches for Untappd, Resy and Ticketmaster returned no screens from those apps, so there is nothing to cite from them. I did not search Strava by name. Beli and Letterboxd covered logging.

## 3. Recommended changes

Ranked by user impact against effort. Costs (strings, Maestro, backend) are listed under the table by number. The table states what to build; the plan decides order and PR shape.

| # | Change | Why | References | Impact | Effort | Android note | `@nomad/ui` block |
|---|---|---|---|---|---|---|---|
| 1 | **Remove the reliability copy, rename the pills.** Delete `availText` and `sourceLine` from rows and confirm. Show "Original" / "Cover band". | Andrew's decision for singers, and the app still shows the opposite. Quickest correct fix. | Web v0.143, v0.146 | H | S | Same | None |
| 2 | **One-tap Request with a Sent note.** Remove the confirm screen. Request sends from the row (new, friend and change modes), keeping the `client_request_id` retry logic and `arm.guard`. Back on Tonight, a bottom note: "Sent: Hello" with Undo and + Add singer, 15 s or ×. Move consent to Your songs. | Andrew's decision. Also fixes "did it go through?", since today nothing confirms a send. | Web v0.145; [CHOPT][chopt], [Quicken][quicken], [Jam flow][jam-flow] | H | M | M3 snackbar above the tab bar and gesture area, using the bottom inset. TalkBack announces via a polite live region. | New `Toast` (message, up to 2 actions, close, timer). Other areas will want it. |
| 3 | **Compact search rows.** Title; artist · N versions; pill · brand; Request and ▶ on the row. "Choose from N versions →" stays. | Three or more results above the keyboard rather than one. Matches web's tested layout. | Web v0.143; [Spotify][sp-queue] row density | H | M | Same; check row height at Android font scale 1.3 | Shared song row if area 2 builds one. Reuse `Chip` for the pills. |
| 4 | **Rebuild the night home's first screen.** Order: status hero, now on stage line, Your songs, rotation, then Your night options, sung, venue. Hero: large "#10" and "about 41 min", or the instruction ("You're next. Get ready!"). When the first song row would repeat the hero, drop its title and status duplicate (hero carries them, row shows its actions). | Answers "when am I up?" in one glance. Removes the duplicate, puts the queue before settings. | [Uber][uber-1min], [Chick-fil-A][cfa-wait], [Equinox+][equinox], [DoorDash][dd-prep] | H | M | Roboto with tabular figures for the number; keep it scaling with font size | None; display size added to `Text` variants |
| 5 | **Sticky "Request a song"** above the tab bar, always in thumb reach; hidden while reordering or read-only. | The main action of the night should not move or scroll away. With no songs it is the obvious next step after joining. | [CHOPT][chopt] bottom bar | H | S | Sit above the tab bar; respect edge-to-edge insets | None; a `StickyFooter` if area 1 or 3 also needs one |
| 6 | **"You're on" takeover.** Full-screen overlay (absolute View, not a Modal) in success green: "You're on!", song, name, a large OK. Stays until OK or the state ends, and never shows behind the survey. Repeating haptic pattern, about 3 buzzes. Up next stays small but overlays rather than pushes content. | The most important moment of the night is 16 pt and gone in 10 s. Fixes the layout jump. See question 1. | [Lapse][lapse], [Grill'd][grilld], [Starbucks][sbux-ready] | H | S–M | Back dismisses it. Use `performAndroidHapticsAsync` or a pattern; test on a real Pixel. Colour the system bars. | `Takeover` if anyone else needs one; else local |
| 7 | **Survey: one tap first, saved at once.** Three large feel buttons. The tap saves immediately (decide merges sub-fields, per `logStore.saveSurvey`), then reveals key, crowd, vibes, reasons and notes with Done. Closing after a tap keeps the answer. All questions stay. | More answers feed recommendations and the crowd data. Today a tap then swipe loses the answer. | [Lyft flow][lyft-flow], [Lyft][lyft-rate], [Uber Eats][ue-rate], [Beli][beli], [Grubhub][grubhub] | H | M | Back closes the sheet and keeps any answer; sheet handles the keyboard with edge-to-edge | Reuse `Chip`; `Sheet` unchanged |
| 8 | **iOS time-sensitive turn pushes.** Mark the box's up next and your turn pushes time-sensitive, plus the entitlement. | Focus modes at a bar shouldn't hide a turn. Cheap, and covers the backgrounded case that a takeover can't. | [Starbucks][sbux-ready] (the instruction wording) | H | S | Already handled: channel `tonight` is HIGH | None |
| 9 | **Keep awake near the turn.** Hold the screen on while the Tonight tab is focused and the singer is 3 or fewer from the mic (the tile's existing `urgent`) or on stage. | A phone left face up should not be asleep when the turn comes. Never all night, so it doesn't drain the battery. | None; platform feature | M | S | Same API | None |
| 10 | **Collapse "Your night" options to flat rows**: Singing as Tess (Edit), Text me, Song for a friend, Tip the host, in one card. Labelled, no gesture and no hidden menu. | Three heavy buttons compete with Request. Stays explicit, as A.105 asks. | [Posh][posh] | M | S | Use ripple feedback on rows; 48 dp height | `ListRow` if area 5 or 6 has one |
| 11 | **Hide Freshness unless stale.** Show nothing until data is over 60 s old, then "Updated 2 min ago". Keep Refresh as a small icon in the title row, with its `tonight-refresh` testID. | The status should read as live, and it takes a row. A.48's rule (never claim fresh when stale) still holds. | [Uber][uber-1min] | M | S | Dev Tools button overlaps the top right in debug; flows use `common/tonight-refresh.yaml` | None |
| 12 | **Make-it: simple card and short status.** Auto-picked audio shows one line ("Perfect match · ready to make") with Details for the rest. Long make statuses collapse to one line with an ⓘ. | Andrew's finding: singers can't judge audio files. Web did this in PR C. | Web v0.142 | M | S–M | Same | None. `PickCard` is shared with Make, so coordinate with area 3 (a `compact` prop). |
| 13 | **Scanner: full-bleed camera.** Black, corner brackets, hint at the bottom, torch button and "Enter the night code instead" in thumb reach. Code entry as a keypad sheet over the camera instead of replacing it. Keep ignoring wrong QR codes silently (E3-R3). | Looks and works like every scanner people know. Torch helps with printed QR codes (table tents); the host's screen won't need it. | [Uber][uber-qr], [Forest][forest], [Bevel][bevel], [Tonal flow][tonal-flow] | M | S | Edge-to-edge camera, transparent system bars; back closes it. Verify `enableTorch` in expo-camera's SDK 57 docs. | None |
| 14 | **Other-bar log rows.** One clear next-step button per row (I've requested it, then I sang it, then How did it go?), and the YouTube pair as "Hand to the host" opening Copy and Share. Remove is separated and quiet. Venue becomes a line with Edit. Add a song keeps three outcomes but as one row of three large choices. | With five links on a row, the one needed next is hard to find, and the venue field shouldn't lead the screen. | [Letterboxd sheet][lb-sheet], [Beli][beli], [Pangea][pangea] | M | M | Share sheet is system; back closes the sheet | Segmented choice via `Chip` |
| 15 | **Tips as a sheet, with a remembered method.** Keep the preselected preset and the perk line; custom amount behind a link. On return from the payment app, one prompt: "Sent $5 with Venmo? Yes, I sent it". Keep "Cash" and "Other" as a link. Toast to confirm. | Three decisions become one. The app already knows the amount and method. | [Uber][uber-tip], [Lyft flow][lyft-tip], [DoorDash][dd-tip] | M | M | Return detected with `AppState` on both; Venmo and Cash App links may open a browser if not installed | `Toast` from 2 |
| 16 | **Control edges a dim room can see.** A `borderStrong` token at 3:1 or better (e.g. `#666666`, 3.3:1 on `bg`) for secondary buttons and inputs. Raise `text-xs` muted lines to `text-sm`. | Secondary buttons are close to invisible in the dark (1.34:1). This is the room the tab is used in. | None; WCAG 1.4.11 | M | S | Same | Token and `Button` change. Applies app-wide, so coordinate. |

**Costs by number.**

- **New strings (33 locales):** 2, 3, 4, 7, 12, 13 (few), 14, 15. Removed strings: 1, 2. Items 5, 6, 8, 9, 10, 11 and 16 reuse existing copy or need at most one or two keys. Item 6 reuses `alert.onStage`.
- **Maestro:**
  - Item 2 removes `tonight-confirm-send`. It is in `common/tonight-request.yaml` (used by every Tonight flow that requests), tonight-3, -5, -6, -9 and the `tonight-tour`; the flows must assert the Sent note instead. This is the biggest test change in this list.
  - Item 3 changes `tonight-version-*` and `tonight-result-*` testIDs used by `common/tonight-request.yaml`, tonight-3, -5, -6 and -9.
  - Item 6 keeps `tonight-turn-banner` for up next, and tonight-4 needs the takeover's testID.
  - Item 7 changes order in tonight-8, tonight-10, me-3 and me-7 (feel must be tapped first).
  - Item 14 changes tonight-10.
  - Items 4 and 5 change scrolling in `tonight-request.yaml`, though the sticky button removes a known near-the-tab-bar tap problem.
  - No flow covers tips (only the tour). Item 15 should add one.
- **kjbox backend:**
  - Item 2's + Add singer needs a v1 route. The web has `POST /requests/<id>/singers` in `sing.py`, and v1 has only submit, cancel, change, reorder and consent (`sing_api_v1.py`), plus a new OpenAPI snapshot. Everything else in item 2 needs no backend: Undo uses `cancelRequest`.
  - Item 8 adds a field in `push_dispatcher.py`.
- **New native capability:** item 8 adds the iOS Time Sensitive entitlement and `interruptionLevel` (check the current Expo push and Apple docs when planning, as I did not verify the field name). Item 9 uses `expo-keep-awake`, which is already in the lockfile through `expo` but must be added to the app's own dependencies with `npx expo install`.

### Deliberately left alone

These are recorded decisions, or fine as they are.

- ▲/▼ reorder (A.57; see question 2).
- Silent handling of wrong QR codes (E3-R3).
- No swipe-only actions (A.105).
- Cancel without a confirm (E6-R2).
- A survey that never blocks (E8-R3).
- The name sheet and the empty state.
- Polling only while visible.

## 4. Questions for Andrew

1. **Full-screen "You're on"?** You rejected a big "You're on the list!" banner on the web (10-29) in favour of one line. That was a confirmation; this is the one moment a singer must not miss. **Recommendation:** takeover only for "You're on", with "up next" staying one line. Review a screenshot first.
2. **Reorder: stay ▲/▼ only?** The web has a drag handle too, and Spotify has trained people on handles, but press-and-drag confused your singers (A.57), and rows can't move under a thumb while polling. **Recommendation:** keep ▲/▼, shorten the hint. No drag in Phase 7.
3. **"Original" / "Cover band" across the whole app, or only Tonight?** Discover and search filters still say Community, and one word per concept is clearer. The catch is KaraFun, where "Cover band" is less obviously right as a filter name. **Recommendation:** change Tonight now (item 1), and let the area 2 plan decide on Discover's filter so the app ends up with one vocabulary.
4. **Live Activity for your place in line?** It is the industry pattern and would suit a singer with the phone locked. It needs a native widget target (`expo-widgets`) and direct APNs from the box, since Live Activities use the `liveactivity` push type and not Expo's push service, so kjbox would have to hold an APNs key. Android's equivalent is an ongoing notification or Live Update. **Recommendation:** not in Phase 7. Ship items 6, 8 and 9 first, then decide after a real night. It needs no new paid service, only the existing Apple account.
5. **"Text me when I'm up" in the app?** VISION lists it for parity, but the app has push. **Recommendation:** keep it as an option row, and lead with it only when push is off.
6. **Tip prompt after a song?** Ride apps tip at the rating, when goodwill is highest. A prompt could feel pushy from the host's own app. **Recommendation:** no prompt in the survey. At most, one quiet "Tip the host" link on the survey's reveal step after "Great", only when tips are on.
7. **Undo after Cancel?** It would be consistent with the Sent note, but restoring the queue place needs kjbox work, and re-requesting loses the place. The web has none. **Recommendation:** leave as is, notice only. If singers cancel by mistake in real nights, revisit.

## 5. Mobbin collection

[Nomad Phase 7 - 4 Tonight](https://mobbin.com/collections/24a33c89-6fdd-4fef-a43f-c166b6e2ee79/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) holds 24 references (20 screens, 4 flows). It is private: only you and your teammates can open the link, unless you make it public on mobbin.com.

---

**Your Mobbin AI usage is high this month**

Usage is unlimited during beta. If your usage stays at this level, you may need to purchase more credits once limits take effect. [View usage and plan options](https://mobbin.com/settings/billing-and-usage?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp)

[uber-1min]: https://mobbin.com/screens/02e52b85-dd21-40b0-b75c-548b35ae2125?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[uber-3min]: https://mobbin.com/screens/76380627-b6b3-4a58-8e6d-858d0cc2dc27?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[cfa-wait]: https://mobbin.com/screens/d831b7c5-6e70-4516-aa00-bc363c290467?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[cfa-flow]: https://mobbin.com/flows/28621aaa-d9b9-46bf-96a4-9ceeafcd93bf?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sbux-hero]: https://mobbin.com/screens/9be082af-e4a1-4982-90a6-9fbe952624ce?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sbux-ready]: https://mobbin.com/screens/5faba993-a972-4de2-befd-c761d89ecc56?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[waymo]: https://mobbin.com/screens/dd06088e-6808-4598-a93a-1e8ca4e51ea1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[equinox]: https://mobbin.com/screens/175f19d0-617d-4275-8409-c0917628b1a4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dd-prep]: https://mobbin.com/screens/fdd0b708-af32-4297-9cb9-e92ce3b0c18a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[panera]: https://mobbin.com/screens/68fbc9be-b216-4d7f-a7d9-2b0cd7cf7c76?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lapse]: https://mobbin.com/screens/cbf0454a-d377-4972-a347-0ab2f7625a12?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[grilld]: https://mobbin.com/screens/7df760c7-3382-4abc-9632-6b4e9d14db7b?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[transit]: https://mobbin.com/screens/b84f786b-1c21-4110-9977-f0544d9adcf5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[blinkit]: https://mobbin.com/screens/86b15e18-696c-4032-b988-cfaf457a696a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lyft-la]: https://mobbin.com/screens/1e3a6d14-c1be-4da9-957c-898a4902c682?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[wonder]: https://mobbin.com/screens/6c9a62da-c6d4-404a-b3ec-ed18dff3bd8c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[uber-qr]: https://mobbin.com/screens/c9df75d3-ad98-407a-b196-516df6283491?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[forest]: https://mobbin.com/screens/9a2b32e8-f8ee-4525-bc0d-37896c00e4a5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[bevel]: https://mobbin.com/screens/c2676d15-5cfb-4c40-a438-943631bda281?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[mesh]: https://mobbin.com/screens/3d8f210a-e4ec-45b7-8a83-3d3f3167319b?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[tonal-flow]: https://mobbin.com/flows/943aafd2-ee41-4442-a208-aa605dad7341?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lime-flow]: https://mobbin.com/flows/16971d3b-a451-4293-a0d1-c12df9d915f4?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[chopt]: https://mobbin.com/screens/fa70101b-9b13-4e56-8f78-f8566b246f46?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[quicken]: https://mobbin.com/screens/3b0b5c12-410f-4afe-9eec-552cc5532376?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gphotos]: https://mobbin.com/screens/271108af-b336-489e-bac3-7b4639152cb4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[todoist]: https://mobbin.com/screens/09f39b7b-c17a-4f87-97e5-4a1af75c3938?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[jam-flow]: https://mobbin.com/flows/4eab6760-3773-4a13-b0c6-21ec82581fd7?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-queue]: https://mobbin.com/screens/05495a0a-5a18-4253-aaea-f88ba572826c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-drag]: https://mobbin.com/screens/c0df9404-f3cf-490a-a9ea-40abdf6f02cc?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-swipe]: https://mobbin.com/screens/9767132b-e28e-49e9-9ff6-91e6267f2c67?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-jam]: https://mobbin.com/screens/438ac8ae-b4cc-4c9e-bfe1-d01c2dd67089?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[posh]: https://mobbin.com/screens/70c99608-be00-4a4a-8d05-48bc9e9697bb?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[uber-tip]: https://mobbin.com/screens/af273512-5746-402e-b78a-4c89235aaedf?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dd-tip]: https://mobbin.com/screens/d500450a-873c-4ef2-a2a5-49ad7d076d63?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lyft-tip]: https://mobbin.com/flows/9b3f742a-6c68-4716-af15-36aaa8f45184?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[grab]: https://mobbin.com/screens/100791f5-1677-4258-9398-e0ddb3cebe0d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[zomato]: https://mobbin.com/screens/29794b28-a22b-48db-bbad-75956cd94336?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[tesla-flow]: https://mobbin.com/flows/5b72cc6a-d7d4-4030-94cf-88b5a0495c85?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lyft-flow]: https://mobbin.com/flows/e0c06f1a-f852-4985-9cde-084a4e37b9dd?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lyft-rate]: https://mobbin.com/screens/77be3246-695c-4dd5-b318-920fc81d08b5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ue-rate]: https://mobbin.com/screens/8734b6a7-fc59-49e4-b02b-5f5caa67c462?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[skip]: https://mobbin.com/screens/71122d65-c3ca-4951-8942-08b31bd44da2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[grubhub]: https://mobbin.com/screens/b6af2df1-ce13-43a5-bee1-0d531bcf35b9?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[beli]: https://mobbin.com/screens/f5668e5b-d11f-4e83-a972-0a50b1dccaff?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-sheet]: https://mobbin.com/screens/9f1d6bfa-c04d-497f-8432-0e007e7f9cd7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lb-form]: https://mobbin.com/screens/073e0cff-5af9-4069-9c68-a2998a753853?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[pangea]: https://mobbin.com/screens/f7ee01c5-5ed3-4f8e-aaac-9ae03f0a589d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
