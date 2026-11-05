# Phase 7 research, area 2: Discover

Scope: search and its outcomes, song page, personal recommendations, quiz, filters and sheets, library filter, Connect your music hub, voice test, voice session. Assumes PR #46 lands (cached picks show first).

Research only: no plan and no code here. Screens are named as in the app. Committed screenshots may be stale, so each friction point was checked against the code. The "before" tours will replace them.

**Decisions left as they are:** picks need sign-in; the sticky "Not seeing your song? Make it" bar (Andrew: singers never found the bottom link); the library filter's three values; no Spotify Web API on mobile; the voice session stays admin-only until tuning sign-off; `src/media/youtube.ts` stays the single YouTube path. Real-mic behaviour is not yet verified on a device, so nothing below changes the pitch pipeline.

## 1. What our app does now

### Discover tab: `apps/mobile/src/app/(tabs)/discover.tsx`
Shot: `docs/screenshots/phase3c/ios/en/fit-discover-badges.png`.

- **Controls take 38% of the screen before the first song.** Stacked and fixed: field label, search field, Describe link, library chips, filter chips. They never collapse, so about three songs fit on a phone.
- **The search field says the same thing twice.** `TextField` forces a visible label, so "Search songs or artists" appears as label and placeholder. There is no search icon and no clear button (`packages/ui/src/TextField.tsx`).
- **Two unlabelled chip rows sit one above the other.** "Any / Community / KaraFun" has no visible heading ("Venue library" is accessibility-only, `find/library/LibraryFilterPicker.tsx`), so "Any" has no meaning on screen. Mood, Energy and More start off-screen.
- **Filters persist silently.** Chips show only "Genre (2)" or "Decade (1)", and a selected chip looks the same whatever its value. The only Clear all is inside the empty state.
- **"Improve your picks" is effectively hidden.** It is the list footer, so it sits after the last loaded page and moves further away as pages load (`discover.tsx`, `discover/components/ImproveCard.tsx`). Connect, the voice test, Find your voice and "Make any song" all live there, and they are what makes picks good.

### Picks rows: `discover/components/RecSongRow.tsx`, `RecSection.tsx`
- **Rows are tall and repeat themselves.** Title, artist and a wrapping pill row reach about 110 pt. Under "From artists you love", every row also says "You like Muse".
- **Colour means different things in different places.** Community is purple on rows (`find/library/LibraryBadge.tsx`) and green on the song page (`find/components/VersionList.tsx`), and green also means "Fits your voice". The most useful fact, fit, comes last in the pill order.
- **No artwork.** Decide has no cover art, and the app's generated `ArtTile` is used only on the song page.
- **Four row designs show the same song:** popular `SongRow` (inline in `discover.tsx`), `RecSongRow`, `SimilarList`, and Me's `CollectionRow`.

### Row menu: `discover/components/SongMenuSheet.tsx`
- "Not for me" comes first, above Save, Add to setlist and Mark as sung. The rows are plain text with no icons.
- **There is no tonight action**, though VISION says every song offers one. At the bar, a singer who spots a pick has to open the song page and scroll.
- There is no copy-link or share.

### Search and outcomes: `discover.tsx`, `find/components/*`, `find/outcome.ts`
Shots: `docs/screenshots/phase1b/ios/search-confident-card.png`, `search-missing-card.png`.

- **Tapping the field changes nothing.** There are no recent searches and no Cancel. The picks stay until 2 characters are typed.
- **No-results is one muted sentence plus the make bar:** `No songs found for “x”`. It ignores the library filter, so a KaraFun-filtered search that finds nothing looks like the song doesn't exist. Describe isn't offered there either; its link only sits under the field. No Maestro flow covers Describe.
- **The field says "songs or artists", but artists don't exist as a destination.** There is no artist row or page, and no artist name is tappable anywhere.
- **The identified-song card is wordy:** eyebrow, title, artist, a full "Corrected to Starlight · Muse — you typed…" line, then Undo and Not it?.
- **The Which-one chips hold whole "title · artist" strings** in wrapped pills, which are harder to scan than rows.

### Song page: `app/song/[id].tsx`
Shot: `docs/screenshots/phase3c/ios/en/fit-song.png` (its header gap was addressed in #44; re-check in the new tour).

- **The primary action is the paid one, and it comes last.** Order: 200 pt letter tile, title, status card, versions, history, tonight action, three stacked grey buttons, then pink "Make it · 1 credit". A singer who only wants to sing an existing version is steered towards paying, and the real answer is a small "▶ YouTube" link in a row.
- **The status card restates the list below it** ("Karaoke versions exist"). Its hint, "from the audio you pick", should be checked against the make flow's automatic source choice.
- **Fit and the crowd line, the facts unique to us, are inside that card** at secondary weight.
- **No copy-link or share on version rows**, though use case 2 is "hand the YouTube link to the KJ". The Ready screen already has copy (`phase1b/ios/ready-youtube-copied.png`).

### Filters: `discover/components/FilterBar.tsx`, `sheets/*`
Shot: `docs/screenshots/phase3a/ios/discover-3-decade-sheet.png`.

- Every sheet needs Apply, even single-choice ones such as Sort and Energy, so one change costs three taps.
- "Apply" says nothing about the outcome, and "More…" holds six unrelated filters.

### Quiz: `app/discover/quiz.tsx`, `discover/quiz/*`
Shot: `docs/screenshots/phase3a/ios/discover-2-quiz-3-artists.png`.

- **Progress is the text "Step 3 of 4"**, under a modal title of "Your picks".
- **The tap cycle is a hidden rule:** "Tap once to like, twice to love". This was recorded as Claude's call (3a spec §8.2, §11).
- **Artist tiles are text only,** and reasons repeat ("Based on rock" on Missy Elliott and Toto in the fixture shot; check on prod).
- **The button gives no sense of the goal.** It reads Next or Skip with no count. The card promises "30 seconds" for four steps.

### Connect your music hub: `discover/connect/ConnectHub.tsx`, `ConnectCard.tsx`
Shot: `docs/screenshots/phase3b/ios/connect-1-hub.png`.

- **Six identical cards in a fixed order,** with Apple Music last even on iOS. Only three have logos. There is no chevron or action label, so they don't read as tappable.
- **Nothing answers "I use Spotify, what do I do?"** The fast route (screenshot or playlist) and the slow one (a 5 to 30 day export) are separate cards with no link between them. YouTube Music has no row of its own.
- **"ListenBrainz" means nothing to most singers,** and it is shown at the same weight as everything else.

### Voice test: `voice/VoiceTestScreen.tsx`, `VoiceResult.tsx`
Shots: `docs/screenshots/phase3c/ios/en/voice-low.png`, `voice-result.png`.

- **Before a note is detected there is no sign the mic hears anything.** The note name stays blank and the status says "Hold a steady note". On a real phone in a noisy room, that looks broken.
- **The self-report escape disappears once the test starts.** It is offered on the intro and error screens but not on the low, high or sing steps.
- **The result is a dead end.** After Save, the only button is Done, though the payoff is songs that fit. Singable stays off until the singer finds that chip.
- The lower half of each step is empty, and progress is text only.

### Voice session: `voiceSession/VoiceSessionFlow.tsx`, `screens/*`
Shots: `docs/screenshots/phase3d/ios/en/vs-03-setup-filled.png`, `vs-06-quiz.png`, `vs-10-result.png`.

- **The promise may be out of date.** The intro and entry say "5–10 songs, about 30 minutes", but tuning batch 1 aims to converge in 3 to 5 songs. "Song 2" gives no sense of the end.
- **Pick has four equal-looking exits:** I know this, Skip, Something else, and a full-width Finish.
- **The after-song quiz is 10 question groups on one scroll, after every song.** Next stays disabled with the reason only at the top ("The first two are needed").
- **Stop early has no confirm** and sits alone in the footer during a song (`PlayScreen.tsx`, `useVoiceSession.ts`). Closing is safer than it looks, because a session resumes for 6 h.
- **The result's hierarchy works against it.** A low-confidence result still has Done as primary and Keep going as secondary, though more songs is the advice on screen. The session keyboard's pink and peach have no legend. Suited songs are tall cards that start low on the screen, above a two-button sticky footer.

## 2. What the best apps do

Mobbin surfaced no Smule, Yousician or Tidal screens: those queries returned [Apple Music's Sing mode][am-sing] and unrelated apps. Sing-along evidence is therefore limited, and mic patterns come from language and voice apps.

**Search**
- Focusing search is its own state: field plus Cancel, recents with per-item remove and Clear ([Spotify][sp-recent], [Apple Music][am-focus], [Deezer][dz-search]).
- Results while typing mix suggestions with an artist row and tracks ([Spotify][sp-typing]). Type chips narrow them, and each row has a quick add ([Spotify][sp-top]). [YouTube Music][ytm-results] groups results under Artists, Albums, Songs.
- Weak empty states are a sentence ([YouTube Music][ytm-empty]). Better ones give a next step ([Google, Try again plus recents][g-nomatch]). The best relax the filter for you, as in [Shazam's "View All Dates"][sz-empty].

**Song page**
- One dominant action sits next to the identity, with secondary actions as a compact icon row: [SoundCloud][sc-track], and [Shazam's "Play Full Song"][sz-flow], with extra detail further down the same page.
- Long pages stack cards rather than buttons ([Suno][suno-about], [Spotify][sp-lyrics]).

**Row menus**
- Song identity in the header, then the most common actions as icon tiles, then grouped rows, with negative actions last: [Suno][suno-menu], [Apple Music][am-menu], [SoundCloud][sc-menu].
- Taste controls use plain language: [Spotify's "Exclude from your taste profile"][sp-menu], [Deezer's "Don't recommend this track"][dz-menu].

**Personal feed**
- Compact rows with art and one or two lines ([Spotify "Start listening"][sp-home]). Shelves and list sections mix, with See All ([Suno][suno-home]).
- Sections explain themselves once, in a header or eyebrow, not per row ([YouTube Music][ytm-home], [SiriusXM][sxm-home]).
- The most valuable setup step sits at the **top** as a dismissible card ([Apple Music's Transfer music][am-home]).

**Filters**
- Chips show the current value and a caret. Each opens a focused sheet ([Apple Music Concerts][am-filter], [Shazam][sz-date], [Vestiaire][vc-flow]).
- The button states the result: "Show Concerts" ([Apple Music][am-filter]), "Show 169 results" ([Insight Timer][it-filter]), "View 350 results" ([CVS][cvs-filter]). Clear is always near it, with a count in [Mercury][mercury-filter].
- [Deezer][dz-pick] puts a round X chip first to clear all. [YouTube Music's tuner][ytm-tuner] offers Familiar / Blend / Discover, which is a good post-release idea for a "safe or stretch" control.

**Taste picker**
- Search above a visual grid, one tap to select with a clear mark ([Spotify][sp-pick], [YouTube Music][ytm-pick]).
- The button counts towards the goal: "Choose 14 more artists" ([Deezer][dz-pick]), "Pick 3 to start" ([Brink][brink-pick]), "Join 3 communities" ([Weverse][wv-pick]).
- Skip is a quiet corner link ([Weverse][wv-pick], [SiriusXM][sxm-pick]). [Spotify's onboarding][sp-onboard] lands straight in a home built from those picks.

**Connect hubs**
- A plain list: logo, name, and a trailing Connect that becomes a status ([Airbuds "synchronized"][airbuds], [Live Nation Connect → Connected][ln-flow], [StubHub][stubhub]).
- [Weverse][wv-connect] adds one honest line under each service about what it needs. [Sonos][sonos-flow] explains the wait while the other app authorises.

**Mic and voice**
- A live level or waveform proves the mic hears you, often with a timer ([Meta AI][meta-read], [Todoist][todoist], [Wispr Flow][wispr], [Babbel][babbel]).
- [Duolingo][duo-speak] always offers "Can't speak now". [Speak][speak-flow] and [Duolingo's lesson][duo-flow] keep one task on screen with a visible position ("Question 1/9", a progress bar).
- [Preply][preply-flow] asks for the mic only in context, with a reason.

**Guided sessions and results**
- [Oura][oura-flow]: setup on one calm screen, one focus during the session, an outlined "End early" with a confirm that says what is kept, then a summary that leads with one plain comparison ("Better than usual").
- [Mercury's accordion][mercury-filter] shows how to tuck optional groups away.
- Results lead with identity and next steps: [Rocket Money][rocket], [Noom][noom]. [Liven][liven] ends with recommendations.

## 3. Recommended changes

Ranked by user impact against effort. "Strings" means new keys, translated to all 33 locales with `pnpm i18n:translate`. "Flows" lists Maestro flows affected; keep existing testIDs wherever an element survives.

| # | Change | Why | References | Impact | Effort | Android note | `@nomad/ui` building block | Strings and Maestro |
|---|---|---|---|---|---|---|---|---|
| 1 | **Filter-aware no-results.** Replace the sentence with a state: title, then actions. With a library filter on, lead with "Search all libraries" (sets Any, keeps the query). Always offer "Describe it" and keep the sticky make bar. Apply the same layout to the picks empty states. | A KaraFun-only miss reads as "song doesn't exist", losing a singer or a sale. | [Shazam][sz-empty], [Google][g-nomatch] | H | S | Same layout. Use Material button styles through existing `Button`. | `EmptyState` (title, body, actions) | Strings: 3 or 4. Flows: unaffected unless they assert `find.noResults`' text. |
| 2 | **Move the next setup step to the top of picks.** One dismissible card above the first section showing the single most useful step, in order: stale ListenBrainz, connect music, voice test, Find your voice (if enabled). Dismiss per step and per account. Keep the full Improve list in Me → Your music profile. Footer keeps only "Make any song". | Better data is the product's whole promise, and today it sits after a paginated list. | [Apple Music][am-home] | H | S | Same. Dismiss X needs a 48 dp target. | `NudgeCard` | Strings: 1 or 2, plus dismiss label. Flows: `connect-open`, `voice-1`, `voice-2`, `voice-session-open` scroll to Improve and need the new path. Spec 3a §8.1 placed it at the end: see Q6. |
| 3 | **Full row menu.** Header with song and artist. Tiles: Save, Add to setlist, Share. Then rows with icons: Request tonight or Add to tonight (only during a night, first), Mark as sung, Open song. "Not for me" last, in muted style. Long-press on a row opens the same menu. | Lets a singer act from the list at the bar, as VISION asks. Stops the negative action being the first thing under the thumb. | [Suno][suno-menu], [Apple Music][am-menu], [SoundCloud][sc-menu], [Spotify][sp-menu] | H | S | Sheet with drag handle; back and scrim close it. Undo as a snackbar position above the tab bar. | `ActionTile`, `MenuRow` | Strings: reuse most; 1 or 2 new. Flows: 5 use `rec-menu` or `song-menu`; keep ids, re-check scroll. |
| 4 | **Song page hierarchy.** Compact header: 72 pt tile beside title and artist, tappable artist, then fit and crowd as first-class lines. Icon row: Save, Setlist, Sung, Share. Sticky primary at the bottom, by state: Request or Add tonight during a night; else "Play best version" when a YouTube version exists (top of `rank_version`); else "Make it · 1 credit". When versions exist, Make it is a clear secondary under the list. Drop the status card; the list or a one-line "No karaoke version yet" says it. Version rows gain Copy link and Share. | Answers "can I sing this tonight, and how?" in one screen, and gives the KJ handoff a real control. | [SoundCloud][sc-track], [Shazam][sz-flow], [Suno][suno-about] | H | M | Sticky bar pads by the gesture-nav inset (edge-to-edge). Share uses the Android sharesheet. Back stays system back, no iOS-style title. | `ActionBar` (sticky), `IconAction` | Strings: 4 or 5. Flows: 7 use `song-make`, 2 use the library buttons; keep ids, and flows that expect Make it first when versions exist need a scroll. Needs Q1. |
| 5 | **One Discover control row.** Search field without the visible label, with icon and clear. Single chip row, in order: Library (shows its value), Singable, Sort, Genre, Decade, Mood, Energy, More. Describe moves to the focused state and no-results. Keeps the library filter always visible as a value. | Saves about 120 pt, so a fourth or fifth song fits. The filter state is readable at a glance. | [Apple Music][am-filter], [Shazam][sz-date] | H | M | Filter chips use Material's trailing dropdown icon; selected state keeps a check rather than colour alone. | `SearchField`; `Chip` value and caret variant | Strings: 1 or 2. Flows: 7 use `library-filter-*`; 16 use `discover-search-input` (keep id). Spec 3a §8.1 says a chip row: see Q2. |
| 6 | **Compact shared song row.** 48 pt `ArtTile`, title, artist, one meta line with at most two items: fit first, then library. Show the reason only when the section header doesn't already say it. One colour rule: green is fit only; library pills neutral. Use it for picks, popular and similar results. | Nearly doubles the songs on screen and removes repeated noise. | [Spotify][sp-home], [Suno][suno-home], [YouTube Music][ytm-home] | H | M | Row height at least 56 dp; text follows font scale, so test at large sizes and in ar/he. | `SongRow` (coordinate with the Me area) | Strings: none. Flows: rows match accessibility text, so **keep the reason in the accessibility label** even when hidden. |
| 7 | **Filter chips say what is on.** Show the value ("1980s", "Pop +2"), add a leading clear-all X chip when any filter is on, and apply single-choice sheets (Sort, Energy) on tap. Multi-choice sheets rename Apply to "Show songs". No counts: that would need a new decide endpoint. | A KaraFun filter left on last week is visible and one tap from off. | [Apple Music][am-filter], [Deezer][dz-pick], [Mercury][mercury-filter] | M | S | Same as #5. Long values need truncation; test in long locales. | `Chip` variant (shared with #5) | Strings: 2 or 3. Flows: `discover-3`, `voice-3`, `discover-reset-filters`, tours tap `filter-apply-*`; keep id on multi sheets, adjust Sort and Energy. |
| 8 | **Focused search state.** On focus: hide picks and filters except the library value, show Cancel, recent songs (remove one, Clear) and "Describe it". Recents live on the phone, per account, wiped on sign-out and account change (`useClearDiscoverOnSignOut`, `ALL_STORAGES`). Add one tappable artist row when a query matches an artist name (runs that artist's search). | At a bar, people re-find songs. Also gives Describe a sensible home. | [Spotify][sp-recent], [Apple Music][am-focus], [Spotify typing][sp-typing] | H | M | Replace Cancel with a leading back arrow; system back leaves search first, then the tab. Keep the rule that the field never focuses by itself. | `SearchField` focus state | Strings: 3 or 4. Flows: 16 use the field; a post-search Cancel step may be needed. Describe has no flow, so add one. |
| 9 | **Connect hub as a grouped list.** Two sections: "Quick" (Apple Music first on iOS, screenshot, playlist) and "Your full history" (Spotify export, Last.fm, ListenBrainz). Rows: icon, name, one line, trailing Connect, Add or a Connected status. Name Spotify and YouTube Music in the playlist line and logos. The export row says "Start with a playlist today, add history later". ListenBrainz line explains itself. | Removes the "which one do I need?" stall and gives Spotify users an honest fast path. | [Airbuds][airbuds], [Weverse][wv-connect], [Live Nation][ln-flow] | M | S | Same list; Apple Music isn't first on Android (the MusicKit web route is slower there). | `ListRow` with trailing action | Strings: 4 or 5. Flows: 6 use `connect-card-*`; keep ids. |
| 10 | **Voice test proves it can hear you, and pays off.** Add a live level meter from the existing frames during low, high and sing. Add "Can't sing now" on each step (opens self-report). Segmented progress instead of text. After Save, primary becomes "See songs that fit you": turns Singable on and returns to Discover; Done stays secondary. | Silence looks broken in a loud place, and the result currently leads nowhere. | [Meta AI][meta-read], [Todoist][todoist], [Duolingo][duo-speak], [Rocket Money][rocket] | M | M | Keep the Android permission `AppState` handling as is. Meter draws only through the `@nomad/ui` Skia wrapper. | `LevelMeter`, `StepProgress` | Strings: 2 or 3. Flows: `voice-1`, `voice-2`, `voice-3` and the tour; `voice-close` stays. |
| 11 | **Quiz: goal and one-tap.** Segmented progress bar, generated round monograms on artist tiles, button counts ("Pick 2 more" where required, "Done, 5 artists" otherwise), Skip as a quiet header link. Drop repeated reason lines to a section subhead. One tap = love (see Q3). | Same data with less to learn, closer to what people have used elsewhere. | [Deezer][dz-pick], [Spotify][sp-pick], [Weverse][wv-pick] | M | S | Header link follows Material spacing. Back already steps through the quiz. | `StepProgress` (shared with #10) | Strings: 3 or 4. Flows: 5 use `quiz-*`; `quiz-skip` moves, `discover-2` loves by two taps today. |
| 12 | **Voice session hierarchy.** Pick: primary I know this; Skip and Something else as text buttons; Finish in the header. Progress against a real expectation, once Q5 is answered. Quiz: Feel and Position first, the rest in a collapsed "Add more detail". Stop early confirms, and says what is kept. Result: when confidence is low, Keep going is primary; add a keyboard legend (full range, comfortable). | The session asks a lot; less per song keeps people going. Applies only after G1 (see Q4). | [Oura][oura-flow], [Speak][speak-flow], [Mercury][mercury-filter] | M | M | Back on Play should raise the same confirm. | `Accordion`, `StepProgress` | Strings: 4 or 5. Flows: voice-session-1…5 and `voice-session-song`, `-finish`. |

## 4. Questions for Andrew

1. **What is the song page's main action when a karaoke version already exists?** VISION wants credit sales, but a singer usually wants to sing now. **Recommendation:** "Play best version" as primary and Make it as a clear secondary, with Make it primary when none exists. Trust now, and sales from the songs that truly have no version.
2. **Can the library filter become a value chip in the one filter row?** Spec 3a §8.1 has its own always-visible row. It stays always visible, but as "Library: Any" and two taps to change. **Recommendation:** yes; the screen gains the room. The downside is one more tap for people who change venue library often.
3. **Quiz artists: one tap to love instead of like then love?** Recorded as Claude's call for you to check. Decide's affinity scoring still has a like level for later edits. **Recommendation:** one tap in the quiz, with the finer levels kept in Your music profile.
4. **Collapse the session's optional questions, and when?** Your tuning may need those answers. **Recommendation:** keep them open for admins until G1, then collapse for everyone.
5. **What should the session promise?** Copy says "5–10 songs, about 30 minutes", while tuning batch 1 aims for 3 to 5. **Recommendation:** after your next tuning session, set copy and progress to what the numbers show.
6. **Can Improve move from the list's end to one top card?** Spec 3a §8.1 placed it at the end. **Recommendation:** yes, as in change 2.
7. **Real cover art or generated tiles?** The catalog has no art, and rows look bare beside the apps above. **Recommendation:** generated tiles in Phase 7, no backend; real art gets its own backlog item, using our own data and no live MusicBrainz calls or paid services.
8. **Do we want artist pages?** The search box promises artists. **Recommendation:** tappable artist names that run a search in Phase 7, with a real page after release.

## 5. The Mobbin collection

[Nomad Phase 7 - 2 Discover](https://mobbin.com/collections/2609de1d-7541-4977-b31b-1757fd51a784/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) holds 30 references (24 screens, 6 flows). It is private to Andrew and teammates.

---

**Your Mobbin AI usage is high this month**

Usage is unlimited during beta. If your usage stays at this level, you may need to purchase more credits once limits take effect. [View usage and plan options](https://mobbin.com/settings/billing-and-usage?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp)

[sp-recent]: https://mobbin.com/screens/d5f81cd1-8fd8-4693-bc07-3fa547b9eda2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[am-focus]: https://mobbin.com/screens/581d1446-a88d-4c84-9b68-fd7b6cdba167?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dz-search]: https://mobbin.com/screens/b6ca9d85-c0b8-4c4a-8878-f4e2d0ac8bc6?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-typing]: https://mobbin.com/screens/0036f80a-7fc1-424f-b517-c5fa92d48dbf?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-top]: https://mobbin.com/screens/a1b7b458-7051-4e25-b447-08d3dc90a9b7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-results]: https://mobbin.com/screens/724ac153-cc8e-4ff3-96e8-9e56bf8470a9?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-empty]: https://mobbin.com/screens/8e182923-018a-4665-bdc6-92dd38ce766a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[g-nomatch]: https://mobbin.com/screens/0ce32345-040a-4467-a403-21bf22172a75?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sz-empty]: https://mobbin.com/screens/097457b8-6b9d-41a6-abbc-4a0236e976ae?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sc-track]: https://mobbin.com/screens/4a1e3fd1-c837-499c-8a3a-b5f4ef17adbe?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sz-flow]: https://mobbin.com/flows/307a6ee0-9fad-4994-ab84-ef73a8a7db91?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-about]: https://mobbin.com/screens/77c90b8c-3569-4baa-b9e3-fc1934de49da?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-lyrics]: https://mobbin.com/screens/01967961-ee7c-4648-b748-d416ed45af1c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[am-sing]: https://mobbin.com/screens/d4a6d414-51a2-4b37-8a3a-aa279a037e0f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-menu]: https://mobbin.com/screens/dc7e2cec-5911-480e-ac99-a3a86e1396e1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[am-menu]: https://mobbin.com/screens/2fdb9db9-ee5c-4bf3-8673-853641f4c967?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sc-menu]: https://mobbin.com/screens/cc9f5595-5dbb-479d-bf4d-ab08db6e8300?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-menu]: https://mobbin.com/screens/facdc774-78cf-4c5f-a873-b70201c92bed?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dz-menu]: https://mobbin.com/screens/5a7c5e85-78e2-4a9d-b33b-a8b73f002cc2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-home]: https://mobbin.com/screens/c436956e-14b1-4d90-b58d-846eece57ba5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-home]: https://mobbin.com/screens/b134eddb-cc33-40f0-aa5f-5a52cd24e980?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-home]: https://mobbin.com/screens/6bfdf85e-4d6c-4a49-84f3-809c2d1928a7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sxm-home]: https://mobbin.com/screens/f7d5b995-f330-4b90-a7fd-cf0a795baa47?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[am-home]: https://mobbin.com/screens/9290ae13-674b-455e-beda-ac34ca81425f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[am-filter]: https://mobbin.com/screens/05210eb9-6971-4bfa-a5dc-94e7e2fc629b?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sz-date]: https://mobbin.com/screens/de0145cf-5c66-46c4-b9f4-9663bbad9180?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[vc-flow]: https://mobbin.com/flows/81c807db-1bce-4098-8969-242fdd4fb58d?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[it-filter]: https://mobbin.com/screens/f532c0e9-58ed-44c0-9d6e-572b20aeba58?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[cvs-filter]: https://mobbin.com/screens/4f25eb59-981d-4b2c-b34b-6f64716fb4dd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[mercury-filter]: https://mobbin.com/screens/f8e44e87-126f-43d2-9989-77e1fd089481?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dz-pick]: https://mobbin.com/screens/521b256c-0365-4b48-a6ec-e3a95105388a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-tuner]: https://mobbin.com/screens/67a24a3a-16d7-4144-809c-f6c59b70f5fa?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-pick]: https://mobbin.com/screens/9470cc8c-8f98-40ed-b3db-55bec0019a57?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-pick]: https://mobbin.com/screens/e89ef645-144c-43fc-a6ce-4772476c9372?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[brink-pick]: https://mobbin.com/screens/a0ef4aee-1a63-4eb1-8033-1995c90aafdd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[wv-pick]: https://mobbin.com/screens/04ea3ed1-14ef-4e63-97c3-ff98563a4f70?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sxm-pick]: https://mobbin.com/screens/a7ae0b22-cc7a-4857-8a48-ce085a0c2ee3?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sp-onboard]: https://mobbin.com/flows/2ca9968b-a50d-4910-89e7-e894023d7d21?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[airbuds]: https://mobbin.com/screens/1d6b039f-6a4a-4d3c-b9c8-930928966e99?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ln-flow]: https://mobbin.com/flows/0b5ab2f0-f8c3-4bad-b9fd-e2f0b35f05d7?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[stubhub]: https://mobbin.com/screens/d35e1476-c78e-4cdf-819c-8536fd774406?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[wv-connect]: https://mobbin.com/screens/5144509f-4131-40cf-bd7d-5e513c6c2930?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sonos-flow]: https://mobbin.com/flows/7e37ac1d-5ba8-415c-8032-feefd2b1eee7?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[meta-read]: https://mobbin.com/screens/0ea59284-19d0-42d8-b3a2-dec423ce975e?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[todoist]: https://mobbin.com/screens/61757b22-a4ea-4cc0-a656-1df18d726b4c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[wispr]: https://mobbin.com/screens/4f7aee71-c448-4d17-bd2d-c2abbd1e6101?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[babbel]: https://mobbin.com/screens/c25e73ca-1a5d-4c99-adeb-a7158531a969?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[duo-speak]: https://mobbin.com/screens/68634e56-78f8-484d-aedb-a2cb6117d216?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[speak-flow]: https://mobbin.com/flows/eed0e043-6c35-48a6-9a1d-b961328770b7?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[duo-flow]: https://mobbin.com/flows/eeed3ac8-ec59-44f8-9758-a08ada0a1063?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[preply-flow]: https://mobbin.com/flows/2f0a2068-c929-428a-b0f9-9a4d26b17482?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[oura-flow]: https://mobbin.com/flows/781d9e8d-d7c5-431f-abbf-aa4ae1238877?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[rocket]: https://mobbin.com/screens/a5d153d6-fb60-4e2c-a1ab-814d20b19d85?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[noom]: https://mobbin.com/screens/bf09eeb9-451b-4215-936e-7e353498b988?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[liven]: https://mobbin.com/screens/4bb9c0b4-94cb-4a63-9d45-5cffde3eb4bd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
