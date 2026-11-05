# Phase 7 research, area 3: Make

Pick (make/new, audio pick), job list and progress, ready screen, credits and paywall, native review (Lyrics and Finish).

**Basis.** Code read at commit `9bb5318`. I did not run the app; screenshots are the committed ones and some are stale (noted where it matters). Mobbin images are low-res previews. For flows, Mobbin only returned sampled screens, so those are cited as the whole flow.

**The job this area has to do:** a singer at a bar wants a YouTube link to hand the KJ the same night, one-handed, in a hurry, possibly for the first time. The two moments that decide whether they trust it are spending money and waiting.

## 1. What our app does now

### Make tab: `apps/mobile/src/app/(tabs)/make.tsx`, `apps/mobile/src/jobs/JobCard.tsx`

Screenshot: `docs/screenshots/phase1b/ios/make-tab-working.png` (its step labels are stale; `en.json` now says "Getting the audio").

- **First load shows the bar alone** (`make-loading`). This is Andrew's note: a 40 pt tall strip of N icons across the full width reads as decoration. With reduce motion on, the strip stands still and there are no words, so nothing on screen says anything is happening.
- **No way to start a new song once you have one.** "Find a song" is only in the empty state. With a list there is no action at all; you have to know to go to Discover.
- **Working card says what, not how long or what to do.**
  - No time hint. The Phase 1 spec §4.6 allowed "a rough time remaining if one can be derived"; the gen OpenAPI snapshot has no ETA field, so it was omitted.
  - Nothing says you can leave the app, though the job runs on the server and push exists.
  - Two indicators compete: a 6 pt bar and a five-step list.
  - Done and current steps are plain dots, told apart only by colour (green and pink), and none has a check mark.
  - Every step has one progressive label, so a finished step still reads "Separating the vocals".
  - `pending` is step 0, so no step is lit.
  - Five steps per card makes several jobs a long scroll.
  - The list doesn't warn that the singer may be needed for lyrics. "Needs you" arrives as a surprise.
- **Working cards aren't tappable.** Only `done` cards are.
- **No Make tab badge.** `(tabs)/_layout.tsx` sets no `tabBarBadge`, so a job waiting on the singer is invisible from other tabs unless they allowed push.
- **No balance on this tab.** Credits show on Me and on the pick screen only.
- **A ready card has no quick action.** At a bar, re-copying a link takes tap card, then Copy.

### Job screen: `apps/mobile/src/app/job/[id].tsx`

- Bare `NomadLoader` (`ready-loading`) in two states.
- For an unfinished job it shows only the title and "This video isn't ready yet. You'll find it on the Make tab when it's done." It knows the job but shows no progress.

### Pick: `apps/mobile/src/app/make/new.tsx`, `apps/mobile/src/make/SourcePicker.tsx`

Screenshot: `docs/screenshots/phase1b/ios/make-pick-perfect.png`.

- **The search wait is good:** bar, "Finding the best audio…", "This can take up to a minute."
- **The pick card is seven lines of release data:** badge, song, reason line, `Filename: 01 - Hello.flac`, `Release: Adele - Hello`, `FLAC 16bit CD` with an availability badge, `[Album / 2001 / Fake Records / CD]`. The album and year appear twice. A singer can't act on any of it. This came from the Phase 1b spec (§ "Pick screen catches up with gen's Choose Audio"), so see Q2.
- **The primary button scrolls with content.** Opening "See other sources" pushes cost and Make it off screen.
- **The disabled state explains itself elsewhere.** While the match judge checks (up to 12 s), the reason is a small spinner line at the top of the results and the button is just disabled at the bottom.
- **Inconsistent waits:** a small `ActivityIndicator` here, `ActivityIndicator` on credits, `NomadLoader` elsewhere.

### Credits: `apps/mobile/src/app/credits.tsx`

Screenshot: `docs/screenshots/phase6/ios/purchase-1-packs.png`.

- **Value is uneven across packs.** 3 credits has "Popular", 10 has "$6.00 each", 1 and 5 have nothing. The real savings against the single pack ($8, $7, $6 each: 20%, 30%, 40%) are not shown.
- **No reason on arrival.** A singer sent here from a make flow (`returnTo=/make/new`) isn't told why or which song they're buying for.
- **Good already:** the button names the price ("Buy for $23.99"), and landing back in the flow after "Credits added" works.

### Ready: `apps/mobile/src/app/job/[id].tsx`

Screenshot: `docs/screenshots/phase1b/ios/ready-youtube-copied.png`.

- **No heading and no instruction.** The screen opens on a thumbnail. It never says "it's ready" or "give this to your KJ", which is the point of use case 2.
- **The thumbnail looks like a picture.** It opens YouTube, but there's no play mark and no visible "Open in YouTube", though the string exists as an accessibility label.
- **"Copied" pill shifts the layout:** it is inserted between the buttons and Download MP4.

### Review: `apps/mobile/src/review/**`, `docs/REVIEW-UX.md`

Screenshots: `docs/screenshots/phase2/ios/review-1-lyrics.png`, `review-1-finish.png`.

The structure is sound (issues bar, sticky player, sticky CTA, drafts, Back to Lyrics). Friction is at the edges:

- **No first-time guidance on Lyrics.** Nothing says to listen, tap a word to fix it, then continue. Plain text doesn't look editable. This is a mandatory step between paying and getting the video.
- **Low density.** The screenshot fits 5 lines on a large phone. Short lines wrap because of the time gutter, wide word gaps and pill padding (`WordPill` `px-1.5 py-1 text-lg`, `LineRow` `my-1 px-2 py-2 w-10` gutter), so each takes two rows of about 40 pt.
- **"Song" chip is ambiguous** (`PlayerBar.tsx`): is it the current source or what tapping switches to? Vocals versus Song is unexplained.
- **Finish reads out of order.** The advice ("If you can hear the lead singer's voice coming through, choose Clean") comes after the choices and after an idle scrubber that looks like an empty, disabled bar.

### Everywhere: `NomadLoader` usage

| Where | Words shown? |
|---|---|
| Make search, Tonight make search | Yes, plus a time hint |
| Review opening, stems separating, preview | Yes |
| **Make tab, job screen (twice), Discover picks** | **No: label is accessibility only** |

### Cross-cutting

Pushed screens (pick, credits, ready) have a large empty gap under the back button, visible in all three screenshots and already recorded in `CLAUDE.md` as a manual-pass item. Other areas will see this too.

## 2. What the best apps do

### Long-running generation

- **Say you can leave, and promise the notification.** This is the most consistent pattern for jobs of minutes.
  - [Lensa AI][lensa-wait]: "Creating avatars…", "Remaining time 18 min", "Feel free to close the app", "You'll be notified when it's done", and a "Hide this screen" button.
  - [Character AI][cai]: a sheet titled "You can close this while it's generating", with "Got it".
  - [Meta AI][meta-wait]: "You'll be notified when your vibe is ready" under a 51% ring.
  - [Brainly][brainly]: "This may take up to 2 minutes" and "We'll let you know".
  - The counter-example is apps that say to stay: [CapCut][capcut-export] ("Please don't close CapCut or lock your screen") and [WHOOP][whoop]. These are on-device renders. Ours runs on a server, so we can make the better promise.
- **Give a time or a range.**
  - [TikTok][tiktok-flow]: 66%, "Around 6m left" and a "Generate in drafts" button that moves the wait out of the way.
  - [YouTube Studio][yt-flow]: on the list row itself, "Checking 0% … 10 min left".
  - [IKEA][ikea]: "Estimated processing time 8 Minutes" on a card with two named stages.
  - [Google Photos][gphotos]: "Polishing pixels…", "This may take about a minute", 16%.
- **Named steps, with the current one obvious.** [Brainly][brainly] has one highlighted step with a sub-line and spinner, and the rest dimmed. [GitHub][github] uses check, running and pending icons, each with a word. [Calm Sleep][calm] uses ticks and an empty circle. All use shape as well as colour. These are full-screen. On list rows, apps compress to one line ([YouTube Studio][yt-flow], [GoPro Quik][gopro]: "00:27 remaining", "Waiting").
- **The result takes its place in your library at once.** [Suno][suno-flow] shows a floating banner, "Your groove is on its way" with a ring, over skeleton rows in My Songs, then "Songs ready, tap to play!", with pink dots marking new rows. It's the closest analogue to our Make tab.
- **Slow-job escape hatch.** [Manus][manus]: "Taking too long? You can move on…".

### Short loading, and brand loaders

- **Brand mark plus words.** [Remote][remote]: logo and "Loading…". [Stake][stake]: animated mark, "Creating account", "This can take up to 1 minute". [Alma][alma]: "Crunching the numbers…". [Whatnot][whatnot]: "Loading your trimmed clip…".
- **A mark alone only appears at app launch** ([Clue][clue], [Origin][origin], [Life Reset][lifereset-splash]) where nobody wonders what it is.
- **A multicoloured bar with a sentence is the closest match to our strip.** [VSCO][vsco]: a thin rainbow bar, determinate, directly under "Keep VSCO open while your Montage is prepared…", with Cancel. [Polarsteps][polarsteps]: words above a short bar. The bar reads as a bar because it's thin, has a track and is attached to a sentence.
- **Skeletons for lists.** Dark examples: [Resy][resy], [Hatch Sleep][hatch]. [Snapchat][snap] and [Spotify Kids][spotifykids] show music rows. No words needed, because the shape says what's coming.

### Paying with credits or packs

- **Sell the outcome.** [Replika][replika] sells "5 videos" and "15 videos" with "Best deal". [Tolan][tolan] puts "200+ messages" under each pack, with a "Save 16%" and a "Best deal save 19%" ribbon.
- **Per-unit price on every pack.** [Open][open]: "$25.00 per credit", "$30.00 per credit".
- **Say why you're here and what you have.** [Riveo][riveo]: "You need 1.0 to run it", "Your Balance 499". [CapCut][capcut-flow]: "Estimated credits needed 20", "Credits left 0" directly above Generate, then a confirm. [Bevel][bevel-flow]: remaining balance on top, the selected pack named in a pinned button ("Buy 350 credits"), a cost table below, and "never expire".
- **Reassurance lines.** "Never expire": [Tolan][tolan], [Ahead][ahead], [Bevel][bevel-flow].
- **Duolingo's** [paywall flow][duo-flow] is about subscriptions: a single illustrated benefit, then a sheet of plans with "Most popular". The useful part for us is limited: one tag per row, all rows the same shape.

### Ready and share

- **A heading that names the moment.** [Edits][edits]: "Ready to share", the video, one strong button, one secondary, "saved to your camera roll". [Twitch][twitch]: "'great discovery' Created!" with three round actions (copy, share, download), confirmation as a bar over the sheet. [Meta AI][meta-share]: "Your post is ready to share", plus a row of apps.
- **Confirm in place.** [YouTube][youtube-save]: "Save completed", OK or Share offered straight after.

### Lyrics, captions and A/B

- **Text with a highlighted current word and a player below, at reading density.** [Life Reset][lifereset]: synced transcript, one word lit, the rest dim, a full screen of text. [ElevenReader][eleven]: "Back to current" pill, like our Follow pill. [Suno][suno-song]: current lyric line bold.
- **Phone editors spend the screen on a timeline.** [CapCut][capcut-captions] and [TikTok][tiktok-captions] select a caption block, then show a bottom action row. That suits free editing. Ours is approval with occasional fixes, so our line list is the better shape. Keep it.
- **One-time coach marks on first use.** [Riveo][riveo-coach]: "Move the handles to change in and out times", with a hand illustration.
- **A/B choice with a one-line instruction first.** [Grok][grok-flow]: "Which video do you prefer to keep? Tap on a video to play its audio." Instruction above, two choices, Skip.

### Empty state and starting

[[untitled]][untitled-empty]: art, "Start your first project", one sentence, one button. [YouTube Studio][yt-flow] keeps a + in the header on the screens I saw, and [Suno][suno-flow] has a permanent Create tab. Nobody relies on an empty state as the only way to start.

**Coverage limits.** Mobbin's results did not give me usable references for some requested apps: the ChatGPT query returned only a finished image, the Lensa/Runway query returned only Lensa, and the Descript-style query returned no Descript. I didn't find a Revolut or Spotify screen relevant to this area. None of the examples is a karaoke product, and none of the time figures above is a benchmark for our jobs.

[lensa-wait]: https://mobbin.com/screens/b3f703cb-d85e-4000-a56f-1e25ab3e63e4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[cai]: https://mobbin.com/screens/8fd8ac57-8ba7-4a18-b659-81f4d8dc0bc1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[meta-wait]: https://mobbin.com/screens/ec848afc-743d-4488-8937-7a8b74a51144?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[brainly]: https://mobbin.com/screens/7680e340-23ff-4307-8f94-1e06dc92b599?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[capcut-export]: https://mobbin.com/screens/0817efa5-475d-47db-b95e-ddf474865ef7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[whoop]: https://mobbin.com/screens/e7c9bc50-3282-43b5-b047-46a1f083eea5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[tiktok-flow]: https://mobbin.com/flows/085b073c-ae1f-4d80-8e59-50be142f2e8a?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[yt-flow]: https://mobbin.com/flows/96473f1d-634b-4697-b102-453c80fc8a8a?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ikea]: https://mobbin.com/screens/6106d815-e660-402a-8503-73c907b3bf02?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gphotos]: https://mobbin.com/screens/c99ceb78-91cc-43d3-a055-352407f25919?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[github]: https://mobbin.com/screens/a3086985-2b47-4048-af7e-81f6941cfab2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[calm]: https://mobbin.com/screens/52e0bf63-158b-49be-a8d6-fd6bab9c17af?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gopro]: https://mobbin.com/screens/d9d1710a-5585-42da-ae77-c4811a8ed7b0?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-flow]: https://mobbin.com/flows/984eb0dd-aa92-4aa4-847c-41a1ba5f945c?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[manus]: https://mobbin.com/screens/08137b86-5f12-4e1e-a4dd-e11ca8683190?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[remote]: https://mobbin.com/screens/64b8b1f5-2680-4b78-8888-ab3c60fbe6cd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[stake]: https://mobbin.com/screens/d4fdba6f-b5fd-48e4-aa76-c9b24ef8d266?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[alma]: https://mobbin.com/screens/56bb6fe7-d63f-45d1-83b9-727ade9f7297?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[whatnot]: https://mobbin.com/screens/e870407e-de1f-4df0-a810-98a03c792ca4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[clue]: https://mobbin.com/screens/eaeddaec-da98-47c9-a065-bd78b735188c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[origin]: https://mobbin.com/screens/c364764e-3f2d-4ccb-9956-051afc53d3b4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lifereset-splash]: https://mobbin.com/screens/b9f8e756-55b8-47af-8429-56ad4faa8b4e?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[vsco]: https://mobbin.com/screens/c4eee5f0-164b-4aa0-a84a-69e9f7e49a56?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[polarsteps]: https://mobbin.com/screens/82fc6f83-a013-45e5-8a61-5dbb8f966e62?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[resy]: https://mobbin.com/screens/ec347638-be48-4fe6-93c2-4dd925c12573?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[hatch]: https://mobbin.com/screens/37667ddd-fca9-435d-a2f6-0ce64ba52515?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[snap]: https://mobbin.com/screens/7cfd07e9-78cf-4bd6-b80e-b3f4d7edb0a0?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[spotifykids]: https://mobbin.com/screens/071f97bd-3d7f-4812-8a3d-97f7e6fc86e9?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[replika]: https://mobbin.com/screens/7f976de3-1ae2-49b4-83b9-aa546553fe07?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[tolan]: https://mobbin.com/screens/fbf834a7-f3a3-4dec-8728-8a5a1ca13021?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[open]: https://mobbin.com/screens/82c07843-67f4-4e94-9946-cc9649251344?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[riveo]: https://mobbin.com/screens/cb027d86-017a-4aec-9edd-786396673bc0?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[capcut-flow]: https://mobbin.com/flows/0ea5e1f5-22d2-4fe2-baa3-f37e05e77420?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[bevel-flow]: https://mobbin.com/flows/00d151fb-8257-4ab0-8695-67205b858d7f?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ahead]: https://mobbin.com/screens/dbee17fb-d099-432f-b798-8b920cc8a92c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[duo-flow]: https://mobbin.com/flows/be703cd0-0438-402e-93c2-e8b9c0084338?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[edits]: https://mobbin.com/screens/955222e6-fb32-4c0c-97cb-af35bc1b85c7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[twitch]: https://mobbin.com/screens/ef5eb22e-56bc-47c9-97de-7699750bb0c1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[meta-share]: https://mobbin.com/screens/f7e69007-c8f5-43ba-9eb2-10ec8766523a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[youtube-save]: https://mobbin.com/screens/38f3d5f2-5217-41c1-bdfa-069e0b7d6847?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[lifereset]: https://mobbin.com/screens/e1056ee3-8f44-4702-9808-6311917aee8d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[eleven]: https://mobbin.com/screens/5c627524-cd63-4845-885a-77c7dace046c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-song]: https://mobbin.com/screens/e1056783-c822-42e2-90a4-d6a37e190247?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[capcut-captions]: https://mobbin.com/screens/d87ac26c-0f62-4765-a86b-c1a9d4161294?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[tiktok-captions]: https://mobbin.com/screens/b6042778-6369-482c-af62-5da2956280c1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[riveo-coach]: https://mobbin.com/screens/667da150-042b-4e3d-a02b-6c0a1badd756?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[grok-flow]: https://mobbin.com/flows/549ac1f8-474d-49b1-b536-68726fee94eb?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[untitled-empty]: https://mobbin.com/screens/a871be3f-acf8-4265-9462-b4ddf5fea9dd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp

---

**Your Mobbin AI usage is high this month**

Usage is unlimited during beta. If your usage stays at this level, you may need to purchase more credits once limits take effect. [View usage and plan options](https://mobbin.com/settings/billing-and-usage?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp)

---

## 3. Recommended changes

Ranked by user impact against effort. "Strings" means new keys in `en.json`, translated to all 33 locales. Maestro notes are from a search of `maestro/` and the unit tests.

| # | Change | Why | References | Impact | Effort | Android note | `@nomad/ui` building block |
|---|---|---|---|---|---|---|---|
| 1 | **Every loader has visible words.** Replace `NomadLoader`'s `accessibilityLabel` with a required `label`, rendered under the strip, and make it the a11y label too, so a bare loader can't exist. Default to about 28 pt tall and 240 pt wide, centred. Make tab: "Loading your songs…"; job screen: `common.loading`; Discover: the existing `picksLoading`. See Q1 for the wider choice. | Andrew's note. Also fixes the reduce-motion case, where a still strip says nothing. | [Remote][remote], [Stake][stake], [VSCO][vsco] | H | S | Same. | `NomadLoader` `label` prop. **Strings:** one (`makeTab.loading`). **Tests:** testIDs stay; `NomadLoader.test` and 8 callers change, callers with their own text drop it. |
| 2 | **Always offer a way to start.** Header action on the Make tab in every signed-in state, label `makeTab.findSong`, going where the empty state's button goes. | Today the tab's core action disappears after the first song. | [YouTube Studio][yt-flow], [Suno][suno-flow], [[untitled]][untitled-empty] | H | S | Same header button on both for now. An extended FAB is the Material idiom but a new pattern for one screen. | None. **Strings:** none. |
| 3 | **Compact working card with time and "you can leave".** One line: "Step 2 of 5 · Separating the vocals". A thicker bar. "Usually about N minutes" (Q3). Then: "You can close the app. We'll notify you when it's ready", or, with push off, "…Check back here". Add "We may ask you to check the lyrics." Make the whole card tappable, to the job screen (#4). | Waiting is the main anxiety, and the app can promise more than on-device editors can. Five rows per job don't scale. | [Lensa AI][lensa-wait], [Character AI][cai], [YouTube Studio][yt-flow], [IKEA][ikea], [Suno][suno-flow] | H | M | Copy depends on notification permission, including Android 13+ where it can be denied by default. Use ripple on the pressable card. | Optional strip bar (#13). **Strings:** about 4. **Tests:** `jobCard.test` asserts `job-step-*` and needs moving to the job screen. No flow asserts steps; `make-1` screenshots the card. |
| 4 | **Job screen shows live progress for unfinished jobs.** Move the step list here: check, spinner or N mark, empty circle, in shape as well as colour. Current step bold with one sub-line; finished steps in the past tense. Handles `pending` ("Starting…") and `slow`. | Replaces a dead end, and gives the five steps somewhere to live. | [Brainly][brainly], [GitHub][github], [Calm Sleep][calm] | H | M | Back returns to the Make tab; nothing special. | New `StepList`. **Strings:** 6 (past-tense labels, starting). `readyScreen.test` `ready-not-ready` changes. |
| 5 | **Pinned footer on the pick screen.** Cost line and Make it pinned at the bottom, as on Finish. While the judge checks, the footer shows "Checking song details…" where the reason is needed. Keep the public note in the footer. | Puts the paid action and its price always in reach, including with sources open. | [CapCut][capcut-flow], [Bevel][bevel-flow] | H | S | Sits above the gesture nav inset. Keep `useKeyboardHeight` with the link box open. | None. **Strings:** none. **Tests:** keep `make-submit`, `make-cost`, and the text `You have 3` (`make-1`). |
| 6 | **Ready: name the moment, say the next step.** Heading "Your karaoke video is ready" and "Give this link to your KJ". Add a play mark on the thumbnail and a visible "Open in YouTube" line. The Copy link button turns into "Copied" in place, with no layout shift. Keeps all of Andrew's decided contents; no QR. | This screen is the product's payoff, and the next step is currently implicit. | [Edits][edits], [Twitch][twitch], [Meta AI][meta-share] | H | S | The system share sheet stays as built. The in-place label replaces what would otherwise be a Snackbar, and works on both platforms. | None. **Strings:** 2 (`openInYouTube` and `copied` exist). **Tests:** keep the `ready-copied` testID on the label; `make-1` and `readyScreen.test` assert it. |
| 7 | **Make tab badge for needs-you jobs.** A count on the tab while any job needs the singer. | A waiting job otherwise blocks silently for anyone without push. | [Suno][suno-flow] | H | S | Material navigation bar badge; same data. | None. **Strings:** 1 (a11y label). |
| 8 | **First-time hint on Lyrics.** One inline dismissible card at the top of the list: "Play the song. Tap any word to fix it. Looks right? Tap Lyrics look good." Remembered on the phone, once ever. | Unassisted first review is the riskiest step after paying, and text doesn't look tappable. | [Riveo][riveo-coach], [Grok][grok-flow] | H | S | Same. | None. **Strings:** 2. **Tests:** inline and non-modal, so flows keep tapping; line positions shift, so check `review-10` and `review-7`. |
| 9 | **Credits: same facts on every pack.** Second line per row: "$8.00 each · Save 20%", computed from that store's own prices against the 1-credit pack (hide saving if that pack is missing). Keep one tag: "Popular". Drop the gold chip, which becomes redundant. | The savings are real and unseen. This drives revenue. | [Open][open], [Tolan][tolan], [Replika][replika] | H | S | Play prices come through the same adapter; same currency handling. | None. **Strings:** 1. **Tests:** `credits.test` asserts both badges. `purchase-1` is unaffected (ids and `Buy for`). |
| 10 | **Credits: say why you're here.** From a make flow: "You need 1 credit to make Hello". Pinned Buy button. | Keeps the song in mind at the moment of paying. | [Riveo][riveo], [CapCut][capcut-flow], [Bevel][bevel-flow] | M | S | Back returns to the flow, as built. | None. **Strings:** 1. |
| 11 | **Denser lyric rows.** Reduce word gaps and line height so short lines fit on one row and 8 or more lines are visible. The selected line can keep larger targets, since words are only tappable-to-edit after selecting. Update `REVIEW-UX.md`. | More context while checking, and less scrolling one-handed. | [Life Reset][lifereset], [ElevenReader][eleven] | M | M | Check Roboto metrics and `line-250` scrolling on the emulator. | None. **Tests:** run all review flows. RTL needs a re-check. |
| 12 | **Finish order and player chip.** Put the help line above the choices; hide the scrubber until something plays. On Lyrics, replace the "Song" chip with a two-part Vocals / Song control. | Instruction before choice; removes a control that looks broken and one that's ambiguous. | [Grok][grok-flow] | M | S | Segmented control matches Material segmented buttons. | Shared `Segmented` if another area wants it. **Tests:** no flow taps `review-player-source`; `PlayerBar.test` does. |
| 13 | **Quick copy and balance on the Make tab.** A copy icon on ready cards; a balance chip in the header that opens credits. | Handing over links at a bar is repeated; balance matters before tapping. | [Twitch][twitch], [Tolan][tolan], [CapCut][capcut-flow] | M | S | Ripple; 48 dp target. | None. **Strings:** none (`copyLink`, `packageCredits`, `balance`, `copied` exist). |
| 14 | **Remove the gap under the header on pushed screens.** Cross-cutting; de-duplicate with the other area docs. | First screen of paying, picking and sharing starts about a quarter of the way down. | Compare any reference above | M | M (cause not investigated) | Check whether the same gap appears on Android; these screenshots are iOS. | Possibly `Screen`. **Tests:** screenshots only, expected. |

Depending on Q1, also: **skeleton job cards and picks rows** (M/M, new `Skeleton` in `@nomad/ui`, no strings; references [Resy][resy], [Suno][suno-flow]) and a **determinate N-strip** on job cards (M/M, `NomadLoader` `progress` prop, Skia stays in `@nomad/ui`; reference [VSCO][vsco]).

**Decisions I'm not recommending changing:** ready-screen contents and no QR; the multicolour N strip; a line list instead of a timeline for review; two review steps; "Make my video" not waiting on the preview.

## 4. Questions for Andrew

**Q1. The loader. How should a wait look?** All three keep your strip.

- **Option A: words everywhere.** The strip gets smaller, is centred, and always has a sentence under it: "Loading your songs…". Simplest, and one prop ends the problem. It answers your suggestion directly, and matches Remote and Stake.
- **Option B: match the wait.** Skeleton rows for lists that load in a second or two (Make tab, Discover picks), and strip plus words only for real waits (searching, opening a review, separating). The strip then means "this will take a moment", and fast screens feel faster. It adds a `Skeleton` component.
- **Option C: make the strip a real progress bar.** Thin, in a visible track, with the N icons revealed left to right as a job's percent rises, used with a "35%" and a sentence on job cards. This is like VSCO's rainbow bar with a sentence. It gives real jobs a branded look, but only suits work with a real percent, so it can't replace A or B for short waits.

**Recommendation:** A now on every loader (it's change 1, and it makes a bare loader impossible), B for the Make tab and Discover picks, and C on job cards only if you like the idea when you see it. If you only want one thing, choose A.

**Q2. Pick card details.** Phase 1b brought in gen's Filename, Release and format details so people could check it's their song. Should the recommended card collapse them?

**Recommendation:** yes for tiers 1 and 2. Show the badge, song, and one plain line ("Studio album · lossless · reliable download"), plus warnings when any exist, with the rest behind "Details". Keep everything visible in "See other sources" and at tier 3, where the person actually is choosing. Warnings must never collapse. **Strings:** 1. No flow asserts the filename; `make-*` flows wait on `make-pick`, and `SourcePicker.test` will need updating.

**Q3. Time estimates.** gen has no ETA field. Options are a static "Usually about N minutes" per stage, from real job timings; or a new gen field with a real estimate.

**Recommendation:** static first, no countdown, no new backend. Someone needs to pull real durations from gen; I haven't and won't guess a number. Should the wait for review be excluded from the figure? I'd say yes, since it depends on the singer.

**Q4. Two facts only you can confirm.** Can credits truly be described as never expiring? Is a credit refunded on every failed job (the app shows "Your credit was refunded" only when gen says so)?

**Recommendation:** if both are true, add one line to the credits screen: "Credits never expire. If a video fails, you get the credit back." **Strings:** 1.

**Q5. Credits or videos?** Replika and Tolan sell the outcome ("5 videos"). But long tracks cost extra credits, so "videos" wouldn't always be true.

**Recommendation:** keep "credits" as the unit, since they're shared with the web, and keep the existing "1 credit = 1 karaoke video" explainer.

## 5. Mobbin collection

[Nomad Phase 7 - 3 Make](https://mobbin.com/collections/accaa99b-3755-4acd-bb31-61dff2fee019/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp): 30 references (24 screens, 6 flows). Private: only Andrew and his teammates can open it. Some references cited above are not in the collection, which holds the most useful ones.
