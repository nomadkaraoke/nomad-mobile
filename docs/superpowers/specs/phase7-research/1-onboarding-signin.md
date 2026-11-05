# Phase 7 research, area 1: first launch, onboarding and sign-in

Research only (2026-11-05). Mobbin coverage: 10 screen searches and 4 flow searches, iOS. Flow results show evenly spaced samples, not every screen, so a claim about a flow covers only the screens I saw. Two searches naming Smule returned no Smule screens, and no karaoke app appeared in any result, so the closest references are music, audio and creation apps. Not every app on the brief was searched by name.

The current-state review comes from the code, plus committed screenshots. Those screenshots predate `SocialButton` (they show a pink Google button) and include the E2E-only "Test email" field. I did not run the app.

**Decisions treated as fixed:** Google and Apple are one-tap with email optional (Phase 1 spec §1); sign-in is a sheet over whatever asked for it, and the person never loses their place (§4.3); search and song pages work signed out (Phase 3a spec); personal data requires sign-in (VISION); push is asked in context, never at launch (Phase 6 spec); sing.nomadkaraoke.com stays name-only (VISION).

## 1. What our app does now

### First launch

`apps/mobile/src/app/index.tsx` redirects straight to `/discover`. There is no welcome, and nothing says what the app is for.

- The splash background is purple `#230a89` (`apps/mobile/app.json`), then the app cuts to the near-black `#0f0f0f` (`packages/ui/src/tokens.ts`).
- Nothing explains the app's four jobs. A new user sees a search box, library chips (Any / Community / KaraFun) with no explanation, a sign-in card and a text-only song list.
- Tonight and Make are bare tab labels. "First video free" appears only inside the sign-in sheet.

### Discover, signed out

Files: `apps/mobile/src/app/(tabs)/discover.tsx`, `apps/mobile/src/discover/components/SignInCard.tsx`. Screenshot: `docs/screenshots/phase3a/ios/discover-1-signed-out.png`.

- Search and Popular work signed out, which is the right foundation.
- The card leads with the ask: "Sign in to get your picks", then a "Sign in" button. It can't be dismissed and takes about a quarter of the visible screen, pushing Popular down.
- The search label duplicates its placeholder, and the rows have no art. Both belong to the Discover area's review; they are noted here only because they are the first impression.

### Other tabs and song page, signed out

| Screen | What it shows | Friction |
|---|---|---|
| Make (`(tabs)/make.tsx:27-38`) | Title, "Sign in to see the songs you've made", Sign in | Describes the empty state, not the value. No mention of making any song or the free first video, and no route to start a song. |
| Me (`(tabs)/me.tsx:125-131`) | Title, Sign in, offline list, language | Nothing says what Me holds. The offline song list becomes the main content. |
| Tonight (`tonight/EmptyState.tsx`) | Intro, Scan, Enter code, log another night | Clear, and the best signed-out tab. The sign-in ask comes only after a code is entered. |
| Song page (`song/[id].tsx:203,227`) | Versions and Make it | Save, Add to setlist and Mark as sung are hidden signed out, so these features can't be discovered. VISION says every song page offers these actions. |

### Sign-in sheet

File: `apps/mobile/src/app/sign-in/index.tsx`. Screenshots (stale for button styling): `docs/screenshots/phase1b/ios/signin-sheet.png`, `docs/screenshots/phase1b/android/signin-sheet.png`, `docs/screenshots/phase5/ios/tonight-1-sign-in.png`.

Already good: Apple first and white on iOS, Google to brand, email third; `returnTo` restores the person's place; the "Sign in to make {title}" title.

Friction:

- **One message for every reason.** Only the make path gets its own title. Everyone else sees "Sign in to Nomad Karaoke" and "Same account as nomadkaraoke.com. New here? Your first video is free." A patron who just scanned a QR code at a bar is told about a free video and a website account, not about joining the night.
- **A technical caveat in the main path.** On iOS, every user reads the Apple relay note ("won't link to an existing nomadkaraoke.com account"), though it matters only to someone who has a web account and also chooses to hide their email.
- **No visible close.** iOS has only a grabber; the Android screenshot shows no grabber at all, leaving back or tapping outside. There is no close button.
- **No memory of the last method.** A returning user can pick a different provider and create a second account. The BACKLOG already has an item about merging duplicates, which the Phase 6 spec mentions.
- **Legal line.** The sheet has a Privacy link only, with no "by continuing" line. `nomadkaraoke.com/terms`, `/en/terms` and `/en/terms-of-service` all returned 404 (see Q5).

### Email and code

Files: `sign-in/email.tsx`, `sign-in/code.tsx`, `packages/ui/src/CodeField.tsx`. Screenshots: `docs/screenshots/phase1/ios/signin-email.png`, `signin-code.png`.

Already good: one-time-code autofill, paste handling, auto-submit when six digits arrive, and boxes cleared after a wrong code.

Friction:

- **The email screen doesn't say what happens next.** Its title is "Sign in"; only the button ("Send code") hints that no password is involved.
- **Dead end on a typo.** Email and code use `router.replace` with `headerShown: false`, so there is no back. The code screen has no way to change the address. Recovery means dismissing the sheet, reopening it, tapping email and retyping, because `email` is local state.
- **No help finding the code.** There is no way to open the mail app and no spam hint.
- **Resend has no cooldown.** "Send a new code" is a full-size button enabled immediately, which invites the "Too many codes" error.
- **"Sign in" button competes with auto-submit.** It is the screen's primary button, but it is rarely needed. It is also the only place the verifying spinner shows.

### After sign-in

- From the Discover card, the person lands back on Discover and sees another card ("Get your picks in 30 seconds"), which needs another tap. The first card already promised "Tell us what you like".
- From Join, the flow correctly continues to the name confirm (`tonight/JoinScreen.tsx`). Its fallback copy, "Sign in to join tonight's night.", reads awkwardly.

### Notifications

File: `apps/mobile/src/notifications/push.ts`. Screenshots: `docs/screenshots/phase6/ios/notify-1-*`.

The principle is right: in context, after a make or a join, with a question of our own before the OS prompt, so "Not now" doesn't burn it. The copy is specific too.

Friction:

- **One answer is final for that context.** After "Not now" or an OS denial, a grep of `jobs/JobCard.tsx`, `tonight/nomad/NightScreen.tsx` and `tonight/manage/MyNightPanel.tsx` finds no permission prompt or link. The only route back is Me → Account and notifications → Notifications. A singer in the queue has no nearby way to turn on the alerts that VISION names as one of the app's three reasons to exist.
- **Plain system alert.** It is clear but gives no preview of what the notification looks like.

## 2. What the best apps do

**Tell people what the app is, in one screen.**
- Gated welcomes state the value in a line: [Spotify][spotify-welcome] ("Millions of songs. Free on Spotify."), [Suno][suno] ("Make your own music" over a collage of real content, with the provider buttons on the same screen), [YouTube Music][ytm-welcome] ("Over 100 million songs and counting"), [Deezer][deezer].
- Not every music app gates. [Shazam's onboarding][shazam-flow] is one screen ("Find any song in seconds", a data note, Continue), then straight into the core action with no account shown.
- [Brink][brink] offers "Sign in with Apple" and "Continue as Guest" equally, and says what signing in keeps: "your shows, playback, and listening history in sync".
- [Duolingo][duolingo-flow] asks with "Create a profile to save your progress!" and a plain "Later". The reason is what would be lost, not what the company wants.

**Say why this sign-in is being asked for.** [ChatGPT][chatgpt] ("You'll get smarter responses and can upload files, images and more") and [Photoroom][photoroom] ("Create your Space: Sign in to invite friends and colleagues") put the purpose above the buttons.

**Keep the sheet short and closable.**
- [Cal AI][calai], [Airbnb][airbnb], [TextNow][textnow-sheet] and [Photoroom][photoroom] show a visible close control. [Tubi][tubi] uses a grabber.
- [Cal AI][calai] is a good model: three buttons, one small line of privacy text, nothing else.
- [Matter][matter] marks the previous method with a "Last used" badge.

**Explain passwordless email before it happens.** [Reddit][reddit] ("No password needed"), [Dot][dot] ("We'll send a code to this email to verify your sign in"), [Anything][anything], [Canva][canva-email] ("We'll check if you have an account, and help create one if you don't").

**Make the code screen a recovery screen.**
- [Cleo][cleo] is the fullest example: "Sent to…", "Send to a different email", a spam hint, "Resend code (16s)" with a lock icon, and "Open my email" as the big button.
- [TextNow][textnow-code] has an inline "Open mail app" link and a spinner on auto-submit, with no verify button. [Check][check] has "Open e-mail" and sets the expectation "within the next minute".
- [Deel][deel] shows a resend countdown. [Canva][canva-code] and [WhatsApp][whatsapp] keep resend as a quiet text link. [Finch][finch] and [Canva][canva-code] have a clear back button.

**Hand straight over to taste after sign-up.** The [Spotify flow][spotify-flow] includes picking from visual grids before home ("To get you started"). The [YouTube Music flow][ytm-flow] goes from "Pick 5 artists you like" to a home of "Music to get you started". [DICE][dice] ties the ask to the outcome: "Sync your music library and we'll serve up events that match your taste". Our quiz is the same kind of step, but it sits behind an extra card.

**Signed-out tabs sell what's inside.**
- [Tripadvisor][tripadvisor]: "Make plans. See the world. Earn rewards." in a card with a Sign in button.
- [Calm][calm]: feature icons with "Create an account to save your progress and see your stats".
- [GetYourGuide][gyg]: the benefit, then the button, with settings still usable below. This is the right shape for Me, which keeps language and the offline list. [TheFork][thefork] and [Skyscanner][skyscanner] show the sections you would get.
- [Shazam's Library][shazam-library] fills its empty state with "Popular on Shazam".

**Notifications: show the moment, then leave a way back.**
- Pre-asks that preview or name the event: [Atoms][atoms] (a realistic notification card), the [Spotify flow][spotify-flow] (a stack of notification cards, "Not now" as the alternative), [Chick-fil-A][cfa] (when you would hear from them), [Amie][amie] ("We won't send anything else"), [Twitch][twitch] ("You can change this anytime").
- Once off, they say so where it matters: [Realtor.com][realtor] (a banner on the relevant tab), and [Spotify][spotify-notif], [Telegram][telegram] and [Etsy][etsy] (a "turned off" card with a Settings button).
- Dismissible cards on home: [Apple Music][apple-card] has a Transfer music card with an X.

## 3. Recommended changes

Ranked by impact against effort. Change 10 depends on Q1. "Strings" means new keys in `en.json`, translated to all 33 locales with `pnpm i18n:translate`.

| # | Change | Why | References | Impact | Effort | Android note | `@nomad/ui` block | Strings / Maestro |
|---|---|---|---|---|---|---|---|---|
| 1 | **Sheet copy follows the reason.** Pure `signInReason(returnTo)` picks title and body (table below). No caller changes. | The bar patron and the singer wanting picks get told about a free video | [ChatGPT][chatgpt], [Photoroom][photoroom], [Brink][brink] | H | S | Same. Apple hidden, so the sheet is shorter. | None | ~10 strings. Flows use testIDs and are unaffected. `signInSheet.test.tsx` may need updates. |
| 2 | **Discover card sign-in goes straight into the quiz** when decide says `hasProfile` is false, once per account. Only from this card; never after Make or Tonight sign-in. Closing the quiz leaves today's quiz card. | The card promised "tell us what you like"; today that takes another tap | [YouTube Music][ytm-flow], [Spotify][spotify-flow], [DICE][dice] | H | S | Back closes the quiz modal and returns to Discover. | None | No strings. **Breaks** `discover-1-signin-card` and `discover-2-quiz`, which assert the quiz card after sign-in. |
| 3 | **Make and Me signed-out states sell the tab.** Make: "Turn any song into a karaoke video", "Your first one's free", Sign in, plus a secondary "Find a song" to Discover. Me: "Keep every song you sing", three short benefit lines, Sign in, with offline list and language below. | Empty tabs waste the most curious moment; Make has no way forward | [Tripadvisor][tripadvisor], [Calm][calm], [GetYourGuide][gyg] | H | S | Same layout. Use Material-style icon sizing via the shared block. | New `SignedOutPrompt` (icon, title, body, primary and optional secondary button). Reusable for credits and music profile. | ~8 strings. Keep `make-tab-signin` and `me-signin`. `tabs.test.tsx` and `makeTab.test.tsx` text checks change. |
| 4 | **Inline notifications row where it matters.** While permission isn't granted, a one-line row on Tonight's night screen ("Get told when you're up · Turn on") and on an unfinished job card ("Get told when it's ready · Turn on"). Undetermined opens the OS prompt; denied opens Settings. Reuse `usePushPrefs`. Passive and dismissible, never a repeat prompt. | "Not now" is permanent today, and turn alerts are a main reason to install | [Realtor.com][realtor], [Spotify][spotify-notif], [Telegram][telegram] | H | S | Android 13+ needs the channel first (`ensureChannels`). When `canAskAgain` is false, open app notification settings. | New small `InlineNotice` row (text, action, dismiss) | ~3 strings. Add one flow. `notify-1/2` should still pass; check their scroll positions. |
| 5 | **Tidy the sheet.** Close button at top end. Remove the Apple relay note from the sheet, and show it once after sign-in only if the address ends `@privaterelay.appleid.com` (Phase 1 §6.2 left placement to the builder). Privacy as one small centred line. | Shorter sheet with a clear exit; the caveat reaches only people it applies to | [Cal AI][calai], [Airbnb][airbnb] | M | S | Android has no grabber, so the close button matters more; back still works. Provide `accessibilityLabel`. | Add a `SheetHeader` (back and close) shared with change 7 | 1 string (close, if not in `common`). `signin-close` testID. `signInSheet.test.tsx` may assert the note. |
| 6 | **"Last used" badge** on the provider used last on this phone. Store the method in MMKV at sign-in (the session already records it); no email stored. Wiped with `ALL_STORAGES` on account deletion. | Cheapest guard against duplicate accounts | [Matter][matter] | M | S | Same; only Google and email appear. | `SocialButton` gets an optional `badge` prop | 1 string. No flow breaks. iOS MMKV survives `launch.yaml`, so the badge may appear in shots. |
| 7 | **Email and code screens recover.** Email: title "Continue with email", helper "We'll email you a 6-digit code. No password needed." Back goes to the provider sheet. Code: "Sent to {email} · Change", which returns with the address filled in. "Open mail app" in the primary position. Resend becomes a text link with a 30 s countdown, except when locked out. Spam hint after the countdown. Verify button goes; the code field shows the spinner. | A typo is a dead end today; email is optional but is the only path for some | [Cleo][cleo], [TextNow][textnow-code], [Check][check], [Deel][deel], [Reddit][reddit], [Dot][dot] | M | M | Back goes to the previous step. iOS opens `message://`. Android has no plain URL for the mail app: use `expo-intent-launcher` with `CATEGORY_APP_EMAIL` (new native dep, needs a rebuild) or hide the action. | `SheetHeader`; `CodeField` gets an optional busy state | ~6 strings. `make-7-code-lockout` taps `signin-resend` straight after lockout (exempted, so passes); `make-1` uses email. Check no test presses `signin-verify`. Keep auto-submit. |
| 8 | **Show Save, Add to setlist and Mark as sung signed out.** Tapping opens the sheet ("Sign in to save this song") with `returnTo` set to the song page. Carrying out the action after return is a stretch goal. | Shows the collection features at the moment of interest; matches VISION | [Duolingo][duolingo-flow], [Airbnb][airbnb] (Mobbin shows the login sheet, not the tap that triggered it) | M | M | Same. | None | ~3 strings. Add one flow. `SongLibraryActions` assumes an account, so it needs a signed-out variant. |
| 9 | **Discover card leads with value (if Q1 is no, this carries more weight).** Title "Find songs you'll love singing", same body, button "Get my picks", small X that hides it until next launch. | "Sign in" is the ask, not the benefit | [Tripadvisor][tripadvisor], [Apple Music][apple-card] | M | S | Same. | Could use `SignedOutPrompt` | ~2 strings, Maestro uses testIDs. `discover-1` asserts the card, unaffected. |
| 10 | **One-screen welcome on first launch, never blocking (needs Q1).** `index.tsx` shows it once when signed out and unseen. Three lines, one per use case, "Get started" (sign-in sheet, returning to the quiz) and "Look around first" (Discover). Deep links skip it, because they don't pass through `index`. Marks seen on display. | Explains the app before asking for anything; today nothing does | [Shazam][shazam-flow], [Brink][brink], [Suno][suno] | H | M | Back leaves it for Discover. Draw under the system bars (edge-to-edge). | None (uses `Screen`, `Button`) | ~6 strings. **Touches every flow**: add an optional tap to `common/launch.yaml` and `tour-launch-signed-out.yaml` (49 files reference the launch files). Android's `clearState` shows it every time; adds a few seconds per flow. Add `welcome-1`. |
| 11 | **Richer push pre-ask.** Replace the `Alert` with a short `Sheet` showing a preview ("Your video is ready: {title}") and "Turn on" / "Not now". Keep the once-per-context rule and settled-screen timing. | A preview persuades better; lower priority because the current ask is already in context | [Atoms][atoms], [Spotify][spotify-flow], [Amie][amie] | L | M | Bottom sheet is a natural Material fit; back counts as "Not now". | Uses `Sheet`; new `NotificationPreview` | Few strings (reuse the `push.ask` body). `common/dismiss-push-ask.yaml` needs its tap checked; `make-submit` and `tonight-name` depend on it. |

Also worth one line: match the splash background to `colors.bg` so launch doesn't flash from purple to black. It's an S-effort native rebuild, and a brand call for Andrew.

### Change 1 copy (drafts)

| `returnTo` | Title | Body |
|---|---|---|
| `/make/new` | "Sign in to make {title}" (existing) | Existing text (Phase 1 §4.3) |
| `/(tabs)/make` | "Sign in to make karaoke videos" | Existing text |
| `/tonight/join…` | "Sign in to join tonight" | "Request songs and get told when you're up. Every song you sing is saved for you." |
| `/discover`, `/discover/quiz` | "Sign in to get your picks" | "We'll remember what you like and what you've sung." |
| `/me` | "Sign in to keep your songs" | "Your history, setlists and voice, on any device." |
| `/credits` | "Sign in to buy credits" (existing string) | "Same account and credits as nomadkaraoke.com." |
| Anything else | "Sign in to Nomad Karaoke" (existing) | "Same account as nomadkaraoke.com." |

Also fix `tonight` `signIn` to "Sign in to join tonight."

## 4. Questions for Andrew

1. **Should a first launch show a welcome screen?** Options: no screen (only changes 3 and 9), a one-time skippable screen (change 10), or a blocking sign-in wall like [Spotify][spotify-welcome]. **Recommendation: one-time and skippable.** App-store visitors are a stated acquisition goal and currently get no explanation. A wall would contradict "search works signed out", and at a bar it would slow people down. If flow cost matters more, ship 3 and 9 first and add it later.
2. **Should the Tonight sign-in step offer the name-only web page?** VISION keeps the web page for people who won't sign in, but a patron with the app installed never hears of it. A small "Or join on the web with just your name" link would appear only on Join. **Recommendation: yes.** Getting someone singing tonight is worth more than one sign-up. The risk is that the link opens back into the app through universal or App Links, so it must be tested on both platforms.
3. **Keep "New here? Your first video is free" only on make paths?** Change 1 removes it from picks, Tonight and Me. **Recommendation: yes on the sheet**, and carry the offer on Make's signed-out state and the welcome. Say if you would rather show it everywhere as a sign-up incentive.
4. **Should the quiz open automatically once after sign-in from Discover (change 2)?** **Recommendation: yes**; it's one tap saved and can be closed. The alternative is a clearer quiz card with no auto-open.
5. **Do we need a terms page and a "by continuing, you agree" line?** Three likely URLs on nomadkaraoke.com returned 404, and most references show this line. **Recommendation: decide with whoever handles legal; add the line once a page exists.** I'm not recommending the copy before then. The privacy link stays either way.

## 5. Mobbin collection

[Nomad Phase 7 - 1 Onboarding & sign-in](https://mobbin.com/collections/00b1a169-fac3-4998-99ee-b1301d2db8b4/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) (25 saved: 4 flows and 21 screens; private to Andrew and teammates).

---

**Your Mobbin AI usage is high this month**

Usage is unlimited during beta. If your usage stays at this level, you may need to purchase more credits once limits take effect. [View usage and plan options](https://mobbin.com/settings/billing-and-usage?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp)

[spotify-welcome]: https://mobbin.com/screens/f4f60cac-2462-4fc9-a931-aa44e727d693?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[spotify-flow]: https://mobbin.com/flows/2ca9968b-a50d-4910-89e7-e894023d7d21?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[spotify-notif]: https://mobbin.com/screens/f3affd56-448d-495d-9bbf-73a4b7ee6e6c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno]: https://mobbin.com/screens/e343465a-7315-441a-9271-40f93d88ad2f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-welcome]: https://mobbin.com/screens/f3a68a6f-bf20-4178-a514-061ee31d5dd4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-flow]: https://mobbin.com/flows/dfe30247-8a80-486a-9c65-545c30a8f4b6?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[deezer]: https://mobbin.com/screens/1913f3ad-c35f-4df7-bdc2-0f7916567cb1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[shazam-flow]: https://mobbin.com/flows/68502b87-ffbd-470d-a65c-07c068760a76?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[shazam-library]: https://mobbin.com/flows/9dcfd6b6-c7d7-493f-97c8-97493f9e6298?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[brink]: https://mobbin.com/screens/8dbbaa4b-6f0a-4631-9e58-5dd5aeec61b7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[duolingo-flow]: https://mobbin.com/flows/9f5126ab-a403-4ac6-bc9f-1f44b1d373ec?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[chatgpt]: https://mobbin.com/screens/ec8d1f25-41b5-4ebd-99a8-982ca807d3b5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[photoroom]: https://mobbin.com/screens/a24501bb-f77a-4077-900d-f7817f12bf62?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[calai]: https://mobbin.com/screens/8c9a9d91-341f-4c2d-875d-ee50364437d2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[airbnb]: https://mobbin.com/screens/80b459e6-da95-4a46-a7c3-fd67f311ac2a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[textnow-sheet]: https://mobbin.com/screens/fe68100c-ffea-4727-8333-c4aa52b9e954?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[tubi]: https://mobbin.com/screens/323840ce-e385-4eed-88a8-caa318763d5d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[matter]: https://mobbin.com/screens/534eb403-f6a8-4634-9a8a-845ef635d2a8?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[reddit]: https://mobbin.com/screens/fbe24986-2bb1-4fb5-ad36-7d516b908f91?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dot]: https://mobbin.com/screens/a9d9ab84-a5cd-456a-8cd8-fd150657a9b5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[anything]: https://mobbin.com/screens/e2a8a218-9fa6-412a-84cc-82e2809f8096?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[canva-email]: https://mobbin.com/screens/aabfe332-4f8a-4a9e-b073-ded8ef1dbbaf?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[cleo]: https://mobbin.com/screens/ba9c24b8-1e12-4df2-aae9-50bc7faebbce?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[textnow-code]: https://mobbin.com/screens/3ee41732-c241-4254-ad00-ba31c7e3d23c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[check]: https://mobbin.com/screens/a3d11b3b-d219-4be4-8a40-d3df917ebe8f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[deel]: https://mobbin.com/screens/be3538c5-a7ed-419e-b7c0-5068e896f5b7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[canva-code]: https://mobbin.com/screens/34a8680d-150d-44f8-84e2-6640f7e12b07?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[whatsapp]: https://mobbin.com/screens/90f9e541-0bf7-4beb-9347-684326ba622d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[finch]: https://mobbin.com/screens/925d48e0-f7ce-481b-87d1-578a25bdff7c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[dice]: https://mobbin.com/screens/cf32dec3-7dcd-48b6-8b0b-0b04206ecbfb?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[tripadvisor]: https://mobbin.com/screens/b3143d75-3772-4263-a013-f8d868c2e8c2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[calm]: https://mobbin.com/screens/cf8d199b-8c24-489c-85e4-0c17b95fa482?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gyg]: https://mobbin.com/screens/84560f01-51d3-4725-a8fb-f29f67343c0f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[thefork]: https://mobbin.com/screens/9aa54a3e-1625-41e2-9850-53c3abd3fdb6?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[skyscanner]: https://mobbin.com/screens/c6d0733c-b73f-4191-9519-a4ca7849558a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[atoms]: https://mobbin.com/screens/10e80f9a-ea1d-4c26-9f5a-54e5e48fac34?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[cfa]: https://mobbin.com/screens/6bff2339-b553-4737-aa73-bf717675a956?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[amie]: https://mobbin.com/screens/acd12bae-61fe-45ce-a339-2b50f218bbc1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[twitch]: https://mobbin.com/screens/a7ade93a-6b8c-4c5b-95d3-e6404d52cd74?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[realtor]: https://mobbin.com/screens/60b64bdf-fb40-41b8-91c8-28e3cd6e5391?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[telegram]: https://mobbin.com/screens/24793c63-044a-4396-85aa-dc25d7812bea?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[etsy]: https://mobbin.com/screens/e139cb91-9e0e-462f-b5b7-95b45400457e?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[apple-card]: https://mobbin.com/screens/9290ae13-674b-455e-beda-ac34ca81425f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
