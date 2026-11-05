# Phase 7 research: 6. Cross-cutting design system

Scope: navigation, headers, empty, loading, error and offline states, toasts, sheets, type, spacing, colour, icons, dark mode, accessibility, RTL and motion. Changes land in `@nomad/ui` first, so every screen benefits.

Method: a static audit of `apps/mobile/src` and `packages/ui/src` (228 non-test `.tsx` files) using the TypeScript AST and grep, plus 15 Mobbin screen searches. The counts come from the code, not from running the app. Touch sizes are estimates from class names. Screens are named as they appear in the app; the committed screenshots predate #44, and fresh tours will replace them.

**In short:** token discipline is already very good. What's missing is the layer above the tokens: semantic type styles, shared state components, pressed feedback and a toast. Most screens solve these problems locally, so the app feels assembled rather than designed, even though the raw values are consistent.

---

## 1. What the app does now

### Component adoption

Files importing each `@nomad/ui` export (of 228):

| Component | Files | JSX uses | Component | Files | JSX uses |
|---|---|---|---|---|---|
| Text | 154 | part of 848 `Text` | Sheet | 13 | 13 (plus 11 `TonightSheet`) |
| Button | 103 | 287 | Chip / ChipRow | 11 / 4 | 32 / 8 |
| Screen | 38 | 62 | List | 10 | 11 |
| TextField | 30 | 36 | NomadLoader | 8 | 9 |
| StartText | 26 | 76 | PianoStrip | 7 | 7 |

Gaps in the kit:

- **No shared row, card, badge, link button, toast, banner or state component.** There are 50 distinct local `*Row`, `*Card`, `*Banner`, `*Tile`, `*Badge`, `*Section` and `*Shelf` functions, 5 files defining a badge, and 8 local button components (`RowButton`, `LinkButton`, `StepButton`, `IconButton`…). Cards alone are about 72 hand-written class strings.
- **158 raw `Pressable`s.** All of them restate their own style and accessibility props.
- **`Screen` is bypassed in 5 files** with a direct `SafeAreaView` (`OtherNightScreen`, `AddSong`, `SearchScreen`, `TipsScreen`, `ReviewScreen`), and 3 more compute insets by hand (`quiz`, `discover`, `StepLayout`).

### Type

There are **9 font sizes** in use and no deliberate line heights (0 `leading-*` classes; the only ones are whatever Tailwind bundles with each `text-*` class, which I didn't confirm Uniwind applies):

| Class | px | Class uses | Via variants |
|---|---|---|---|
| text-xs | 12 | 51 | |
| text-sm | 14 | 67 | `muted` 309, `error` 82 |
| text-base | 16 | 34 | default `body` |
| text-lg | 18 | 48 | |
| text-xl | 20 | 9 | |
| text-2xl | 24 | 14 | `title` 27 |
| text-3xl / 4xl / 5xl | 30 / 36 / 48 | 4 / 2 / 3 | |

`Text` has only 4 variants (`title`, `body`, `muted`, `error`), so hierarchy is hand-assembled from classes. Section headings have at least 5 recipes: `font-semibold` (74), `text-lg font-semibold` (20), `text-lg font-bold` (16), `text-xl font-bold` (6) and `text-xs font-bold uppercase` (8). The song page shows the cost: "KARAOKE VERSIONS (2)" (uppercase caption) and "Your history" (bold body) are sibling headings in two styles (`docs/screenshots/phase4/ios/en/me-18-song-history.png`).

### Spacing and shape

All values are on Tailwind's 4 pt grid, and only one arbitrary pixel value exists in the spacing audit (`min-h-[46px]`, `tonight/manage/DuetPicker.tsx`). Uses by step:

`0.5:30 1:113 1.5:18 2:307 2.5:6 3:231 4:110 5:3 6:9 8:4 10:1 12:2 24:3`

This is healthy. The weakness is hierarchy: gaps of 32 pt or more barely appear (`8` and up: 10 uses), so sections on Me and the song page sit almost as close as the items inside them.

Radii are less consistent. `bg-card` surfaces use `rounded-xl` (57), `rounded-lg` (16) and `rounded-2xl` (4). Button and TextField are `rounded-lg`, while cards are mostly `rounded-xl`.

### Colour

- **Off-token colours are almost all legitimate:** brand marks (`BrandIcon`, `SocialButton`, Google's own required colours), black behind video, 2 piano greys. Default Tailwind colours appear 7 times, mostly `transparent` and `bg-black/60`.
- **Pink does everything:** `text-primary` 106, `border-primary` 33, `bg-primary` 24. It is links, secondary actions, selection, CTAs, the active tab, dashed prompts and even native header titles (`headerTintColor` in `app/_layout.tsx:65` and `discover/connect/_layout.tsx:25` tints the title too; see `docs/screenshots/phase5/ios/ar/tonight-13-versions.png`).
- **The same concept has two colours:** Community is purple on Discover rows (`find/library/LibraryBadge.tsx`) but green on the song page and in Tonight (`tonight/request/VersionRow.tsx:106`), where Commercial takes the purple.

**WCAG AA contrast of the current tokens, computed** (AA: 4.5:1 for text, 3:1 for large text and control boundaries):

| Foreground | on bg `#0f0f0f` | on card `#1a1a1a` | Result |
|---|---|---|---|
| text `#e5e5e5` | 15.22 | 13.82 | pass |
| muted `#888888` | 5.41 | 4.91 | pass; **fails on tints**: 3.81 on primary/15, 3.33 on gold/15, 3.80 on success/15 (over card) |
| primary `#ff7acc` | 8.13 | 7.38 | pass |
| gold `#ffdf6b` | 14.62 | 13.28 | pass |
| orange `#fb923c` | 8.47 | 7.69 | pass |
| success `#22c55e` | 8.41 | 7.64 | pass |
| danger `#ef4444` | 5.09 | 4.62 | pass; **fails on its own tint**: 3.96 on danger/15 over card |
| purple `#8b5cf6` | 4.53 | **4.11** | **fails on card**; 3.07 to 3.68 on its own tint, which is how every Community or Commercial badge is drawn |
| border `#2a2a2a` | **1.34** | **1.21** | **fails 3:1** as a text field boundary; a card field on bg is only 1.10 |
| primary-fg on primary | 8.13 | | pass |

### State patterns

No shared component exists for any state:

| State | What exists | Problems |
|---|---|---|
| **Loading** | `NomadLoader` 9 uses in 8 files; `ActivityIndicator` 38 uses in 29 files (2 inside Button or SocialButton); **0 skeletons** | No rule for which to use. `NomadLoader` is used for full lists (`make.tsx:45`, `PicksState.tsx:26`), for a 240 pt strip beside text (`make/new.tsx:311`, `review/[id].tsx:41`, `TonightMake.tsx:606`) and at 28 pt in a card (`InstrumentalChooser.tsx:73`). The layout jumps when content arrives. |
| **Empty** | 21 distinct `*-empty`/`*-none` testIDs, one component per screen | Nearly all are start-aligned muted text, some with a Button. `PicksState.tsx` alone has 6 layouts. None has an icon. `tonight/EmptyState.tsx` is the action-led exception. |
| **Error** | 93 distinct error, failed, retry or unreachable testIDs; `variant="error"` 82 times in 48 files; 12 `Alert.alert` | Red 14 pt text plus a secondary Button is the default. Only the voice session has a full error screen with an icon (`VoiceSessionFlow.tsx:71`). Retry copy is split: 11 keys say "Try again", 2 say "Retry". 72 strings say some form of "Couldn't…". |
| **Offline** | `useOffline` used in about 20 files; about 20 distinct offline testIDs; 27 offline strings | Rendered as muted text in some places (`PicksState`) and red `variant="error"` text in others (`connect-offline`), though being offline isn't an error and these screens are used in bars with poor signal. |
| **Toast** | 3 hand-built: `discover-hidden-toast` (absolute, bottom), `GetMadeUndoToast` (inline, in flow), Copied on the ready screen (`job/[id].tsx`) | Different placement, timers and markup. The Discover one is `bg-card` on a near-identical bg, separated only by a 1.21:1 border (`discover-4-hidden-toast.png`). |
| **Sheet** | `@nomad/ui` Sheet (RN `Modal`) 13 files; native `formSheet` for sign-in and duration; 12 Alerts | Two looks. The Modal sheet has **no grabber and no drag to dismiss**, and `animationType="slide"` slides the dim layer up with the panel rather than fading it. Rows have no icons (`tour-10-song-menu.png`). |

### Navigation and headers

- **Tab bar:** default JS `Tabs` with 4 filled Ionicons (`search`, `moon`, `sparkles`, `person`). Selected and unselected differ only by colour. **No badges** (0 `tabBarBadge`), so a job needing review or "you're up" is invisible from other tabs. **No scroll to top on reselect** (0 `useScrollToTop`). Discover's icon is a magnifier under a "Discover" label.
- **Tab screens:** Make, Me and Tonight start with a 24 pt in-body title. Discover has none, so the search field is the header. The field repeats itself: the label and placeholder both read "Search songs or artists" (`tour-02-picks.png`).
- **Pushed screens:** the native header's title is empty by default (`title: ''`), and each screen either sets one or draws its own in the body. Song, job, credits, make/new, account, delete-account and notifications have blank native titles with a 24 pt in-body title, so the header row is an empty band with a back button.
- **Back:** `ui/HeaderBack.tsx` mirrors correctly for RTL, but it draws a chevron on Android too, where the native header draws an arrow.
- **Android:** `predictiveBackGestureEnabled: false` in `app.json`, which is Expo's SDK 57 default.

### The iOS header gap

**Probably fixed; not yet confirmed on a device.** #44 (`f60f176`) added `underHeader` to pushed screens, and today every pushed `<Screen>` passes it (checked per file). The screens without it are the tabs (correct) and the sign-in sheets. The PR says "Not yet checked on a device: the layout changes".

Evidence from the pre-#44 shots fits the diagnosis: in `me-18-song-history.png` the scrolled content clips well below the header, which is what padding outside the ScrollView would produce. Those shots are scrolled, so I can't measure the original "~200 pt" from them.

To close this out: check Song page and Get this made in the fresh tours, plus the full-height sign-in sheets, whose `Screen` still takes the top edge. Once confirmed, delete the stale gotcha at `CLAUDE.md:203`.

### Accessibility

| Check | Result |
|---|---|
| Roles | 157 of 158 Pressables have one. Missing: `review/lyrics/LineRow.tsx:60` |
| Labels | About 60 explicit or spread; about 100 inherit child text, which is fine. Only `jobs/JobCard.tsx:55` has neither directly (its text comes through a variable, so it's probably fine). TextInputs: all labelled |
| **Pressed feedback** | **0 of 158.** No `active:` class, no pressed style, no `android_ripple` anywhere. Nothing responds to a touch until navigation or data changes |
| Headings | **6** `accessibilityRole="header"` in the whole app; **0 of the 27** `variant="title"` uses have it, so VoiceOver's heading rotor finds almost nothing |
| **Announcements** | 48 `accessibilityLiveRegion`s, which is an Android-only prop. iOS `announceForAccessibility`: **1** (`FalsettoChip`). VoiceOver hears no toast, error or progress change |
| Dynamic Type | Scaling is on by default and works: 0 `allowFontScaling={false}`, 2 `adjustsFontSizeToFit`. But **0 `maxFontSizeMultiplier`**, so nothing caps layout breakage at AX sizes. Risks: 33 `numberOfLines`, 118 fixed heights (many on icons), and `h-14 text-5xl` on the live note readouts (`VoiceTestScreen.tsx:349`, `WarmUp.tsx:50`) clips above about 115% |
| Touch targets (estimate, of 158) | 17 at 48 or more; **100 at exactly 44**, which passes Apple but is under Material's 48 dp; **about 25 below 44 even with hitSlop**: 15 text links (about 20 pt text + 16 slop = 36: `describe-link`, `SongCard`, `VersionList`, `VersionRow`, `ResultsList`…), pills at 32 (`WhichOne`, `JudgeNotices:57`, `CorrectionBanner:56`), 40 (`MakeBar`, `SimilarList:29`, `WordPill`), 36 (`LineRow:60`), 24 tall (`artists.tsx:85` A to Z). The other 13 are full-width cards and rows, or sizes the audit can't read |
| Reduce motion | Honoured only in `NomadLoader`; its hook isn't exported |

### RTL (this is in good shape)

Only 3 physical classes exist, and RN swaps `left`/`right` under RTL anyway. Start-aligned text is centralised in `Text`. The ar and he strings use `←` where English uses `→` (8 keys, seen correct in `tonight-13-versions.png`). No audit-level RTL problem found. One gap: arrows inside labels (`Make it →`) are read aloud by some screen readers.

### Icons, dark mode, motion

- **Icons:** one set (Ionicons, 24 uses) plus **15 text glyphs** used as icons (`✕ ✓ ⋯ ♥ × ▲ ▼ ▶`); sheet close and row menus are glyphs. 10 distinct sizes (18 to 64).
- **Dark mode:** dark only (`userInterfaceStyle: "dark"`).
- **Motion:** nothing animates in app code except `NomadLoader` and the Modal slide (0 reanimated or `Animated` uses outside it). Rows appear and disappear abruptly, and the 5 s Discover toast pops in. Haptics: 4 uses, all sensible (turn alert, scan, submit, Tap To Sync).

---

## 2. What the best apps do

Mobbin has no karaoke apps (a "karaoke app" search returned only song pickers from other apps), so references are music, video and utility apps. Stills can't show pressed states or motion, so those recommendations rest on platform conventions instead.

**Four-tab dark bars: quiet selection, filled when active.** [Spotify][spotify-home] shows Home, Search, Your Library, Create with a white filled selected icon and grey outlines, and content fades under the bar. [YouTube Music][ytm-home] and [SiriusXM][sirius-home] do the same in white. [Deezer][deezer-home] puts a purple pill behind the filled icon, which is close to Material's active indicator. None of these uses its accent as the only signal. [BFF][bff-badge] and [Ladder][ladder-badge] show count badges on tabs, and [Locals][locals-toast] uses dots.

**Headers: a big in-body title on root screens, with actions beside it.** [Spotify Library][spotify-library] has avatar, title, search and plus, then filter chips. [SiriusXM Library][sirius-library] has a large title with an Edit pill; [Suno][suno-library] has title, search and bell. Pushed lists keep a large title under a bare back control ([Apple TV][appletv], [Me+][meplus], [Calm Sleep][calm-fav]). The title is always white, never the accent.

**Empty: icon, one title, one sentence, one action, while the page's chrome stays.** [YouTube Music][ytm-empty] keeps its chips and tabs, with a line icon, one grey sentence and a white "Find music" pill. [Edits][edits-empty] shows a large outline icon, "Nothing saved yet" and a line. [MD Vinyl][mdvinyl-empty] and [\[untitled\]][untitled-empty] are the fuller version with a CTA. [ElevenReader][eleven-empty] gives two actions, primary over secondary. [Insight Timer][insight-empty] shows the weak form: text telling you to press + elsewhere.

**Loading: skeletons matching the final layout, with real chrome.** [Resy][resy-skel] keeps its real city pill and tab bar, with real heart icons on placeholder rows. [Calm Sleep][calm-skel] keeps the title and search field and shimmers art plus text lines. [Spotify Kids][spotifykids-skel] and [Hatch Sleep][hatch-skel] do the same for song rows. Spinners survive only where shape is unknown or inside a control ([Sora][sora-form]'s button).

**Error: the failure replaces only the part that failed.** [Glow][glow-error] and [Prime Video][prime-error] keep their header (Prime Video its tabs too) so you aren't trapped, with a title, a sentence and a retry. [eBay][ebay-error] keeps the sheet title. [Facebook][facebook-card] fails one card and leaves the feed. [Netflix][netflix-error] and [HBO Max][hbo-error] put download failures in a sheet with the fix as a row. Page-level errors are in neutral white text; red or orange is reserved for the short failure line in those sheets.

**Offline: calm, not red, and states what still works.** [Spotify][spotify-offline]: "We'll be here when you're back online", neutral and centred. [Fanatics Live][fanatics-offline] is similar. When content is cached, a small notice sits above it: [Alta][alta-banner] ("Network offline. Reconnecting…") and [Sunlitt][sunlitt-offline] ("OFFLINE MODE" tag). [GoPay][gopay-offline] adds "View settings" beside Retry.

**Toasts: one bottom bar, one line, one action, above the tabs.** [Google Photos][gphotos-toast] and [Google Drive][gdrive-toast] are the template: full-width, a raised surface that clearly separates from the page, tinted Undo at the end. [My BMW][bmw-toast] and [eBay][ebay-toast] sit just above the tab bar. Top placement exists ([LinkedIn][linkedin-toast], [Medium][medium-toast]) but covers the header, and [Locals][locals-toast] uses a contrasting white pill.

**Sheets: grabber, context header, icon rows, groups.** [Spotify][spotify-sheet] has a grabber, song art and title, then icon-plus-label rows. [SoundCloud][soundcloud-sheet] and [Suno][suno-sheet] add quick actions on top and group the rest. [YouTube Music][ytm-sheet] uses a close X instead of a grabber. [Locket][locket-sheet] shows the short form sized to its content. All of them use a surface visibly lifted from the page.

**Settings: grouped rows with chevrons and values.** [Character AI][charai-settings] and [Google TV][googletv-settings] show icon, label, value or toggle, chevron, grouped under section titles. [alias][alias-settings] and [MoonPay][moonpay-settings] are plainer versions.

**Fields: visible boundaries and errors at the field.** [SiriusXM][sirius-form] has a filled field, coloured outline, icon and message beneath. [WHOOP][whoop-form] has a visible resting border with an inline icon. [HBO Max][hbo-form] uses a banner for account-level errors.

**RTL:** Mobbin has no useful Arabic or Hebrew references. Two searches returned nothing relevant (only language pickers: [talabat][talabat-lang]). Our existing approach stands on its own.

---

## 3. Recommended changes

Ranked by user impact against effort. "Strings" means new keys needing all 33 locales through `pnpm i18n:translate`. Maestro counts are files currently referencing the affected ID. Keeping testIDs avoids breaking them.

| # | Change | Why | References | Impact | Effort | Android note | Lands in | Strings / Maestro |
|---|---|---|---|---|---|---|---|---|
| 1 | **Pressed feedback everywhere:** a `Tappable` primitive replaces raw Pressables; Button, Chip, rows get it built in | 0 of 158 respond to touch, so the app feels slow and unsure | Platform convention (stills can't show it) | H | S–M | `android_ripple`; iOS `active:` opacity or fill (Uniwind supports `active:` on Pressable). Don't use Uniwind's `transition-*` (a Pro feature; no paid services) | `Tappable` (new), `Button`, `Chip` | None / none |
| 2 | **State set:** `EmptyState`, `ErrorState`, `OfflineState`, `LoadingState`, `Banner`, per the spec below, adopted on all 4 tabs and main pushed screens first | 21 + 93 + about 20 one-offs; this is the most visible inconsistency | [YT Music][ytm-empty], [Edits][edits-empty], [Prime Video][prime-error], [Spotify][spotify-offline], [Alta][alta-banner] | H | M | Same components. Material's error container is not needed; stays neutral | New in `@nomad/ui` | Few new keys (default offline title and body); merge the "Retry" keys into `common.retry` / 5 flows use state testIDs: keep them; 1 asserts error text |
| 3 | **Skeletons for known-shape lists** (Discover picks, Make, Me shelves, song page, search results) | No layout jump; the page reads as loading at once and reduces reliance on the loader | [Resy][resy-skel], [Calm Sleep][calm-skel], [Spotify Kids][spotifykids-skel] | H | M | Same; honour animator-off with reduce motion | `Skeleton`, `SkeletonRows` (new; Reanimated, inside `@nomad/ui`) | None / flows wait on testIDs: keep `make-loading`, `discover-picks-loading` on the skeleton |
| 4 | **Type scale** as `Text` variants with line heights, automatic header role and font-scale caps (below) | 5 heading recipes, 9 sizes, 6 heading roles | [Spotify][spotify-library], [SiriusXM][sirius-library] | H | M | Same sizes in system Roboto; matches M3 (below). Check th, hi, ar for clipped marks, which is why line heights are generous | `Text` | None / none |
| 5 | **Colour fixes:** muted `#a3a3a3`, purple `#a78bfa`, danger `#f87171`; add `border-strong` `#6b6b6b` and `surface-raised` `#2e2e2e` | Fixes every failing pair above. Muted is 309 uses, so this is the largest single legibility gain, in dim bars | [HBO Max][hbo-form] (visible field border) | H | S | Same | `tokens.ts`, `global.css` (keep both in sync) | None / none |
| 6 | **Toast host:** `useToast().show({message, action, duration})`, one bottom bar above the tabs, on `surface-raised`, one at a time; replaces all 3 | 3 implementations; on-page contrast is 1.21:1; VoiceOver hears nothing | [Google Photos][gphotos-toast], [My BMW][bmw-toast], [eBay][ebay-toast] | H | S–M | This is a Material snackbar already; add insets for the gesture bar | `Toast`, `ToastHost` (new) | None / `discover-4-hide`, `me-11`: pass through their `*-toast`, `*-undo` testIDs |
| 7 | **Sheet upgrade:** grabber, drag to dismiss, backdrop that fades instead of slides, `surface-raised`, `SheetRow` with icon, label and optional destructive tone | Sheets feel like web modals; the most-used surface beyond lists | [Spotify][spotify-sheet], [SoundCloud][soundcloud-sheet], [Locket][locket-sheet] | H | M | M3 drag handle matches. System back already closes it (`onRequestClose`). **RNGH gets no touches inside RN Modal on iOS 26**, so use the responder system on the grabber (as Tap To Sync does) and keep the ✕ for accessibility. Compare against moving these sheets to native `formSheet` routes before building it | `Sheet`, `SheetRow` (new) | None / 12 flows use `-close`, `-backdrop`: keep both |
| 8 | **Tab bar:** filled when selected, outline otherwise; badge on Make when a job needs the singer, and on Tonight when up next or on stage; scroll to top on reselect | Your turn or a job needing review is invisible from other tabs; this directly affects the two most time-sensitive moments | [Spotify][spotify-home], [YT Music][ytm-home], [BFF][bff-badge], [Ladder][ladder-badge] | H | S–M | Bottom nav convention. M3's pill indicator can be drawn in `tabBarIcon` on Android, or comes free with NativeTabs later (Q4) | `(tabs)/_layout.tsx`; `TabIcon` in `@nomad/ui` | 2 keys for badge a11y labels / 49 flows use `tab-*`: unchanged on JS Tabs |
| 9 | **Announcements:** `useAnnounce()` and `<LiveText>`: Android live region plus iOS `announceForAccessibility` | 48 live regions are silent on iOS | n/a | H (for VoiceOver users) | S | Android already works through live region; don't double-announce | `LiveText`, `useAnnounce` (new) | None / none |
| 10 | **`ScreenHeader` and one header rule:** tab roots get a 32 pt title with an actions slot. Pushed screens set the native title and drop blank bands and in-body duplicates. Native titles in `text`, tint only on back | Blank header bands, pink titles, and 3 patterns | [Spotify][spotify-library], [Apple TV][appletv], [SiriusXM][sirius-library] | M–H | S–M | Native stack already gives left-aligned Material top bar. `HeaderBack` should draw `arrow-back` on Android | `ScreenHeader` (new), `app/_layout.tsx` | Some title keys already exist / 20 flows use back IDs: `BackButton` unaffected; flows asserting in-body titles need checking |
| 11 | **`Badge` with tones and one meaning per colour.** Community, Commercial, KaraFun, status | Community is purple or green depending on the screen; 5 local badges | [Spotify][spotify-library] (quiet metadata) | M | S | Same | `Badge` (new) | None / keep `library-badge-*` |
| 12 | **Accent discipline:** pink only for one primary action per view, selection, and inline text links. Secondary actions neutral; retire most dashed pink prompts (6) | When everything is pink nothing stands out; Me home has 3 pink outlined elements competing in one card | [Spotify][spotify-home], [SiriusXM][sirius-home], [YT Music][ytm-empty] | M | M | Same | `Button` variants, per-screen | None / none (Q1) |
| 13 | **`TextLink` and hit targets:** 44 pt minimum, 48 dp on Android; A to Z and review word pills exempt with reasons | About 25 below 44, 100 below 48 dp | n/a (HIG, Material) | M | S | A 2 dp `hitSlop` on the 100 at 44 gets them to 48 without visual change | `TextLink` (new), `Tappable` default slop | None / none |
| 14 | **`ListRow` and `GroupedList`:** leading icon or art, title, subtitle, value, chevron or switch | Settings and music profile are bespoke; 50 local rows | [Character AI][charai-settings], [Google TV][googletv-settings], [SiriusXM][sirius-library] | M | M | Rows are flush with ripple; no chevrons is common on Android, keep them for consistency (mirrored in RTL) | `ListRow`, `GroupedList` (new) | None / keep row testIDs |
| 15 | **TextField:** resting `border-strong`, focus in primary, error with icon plus message linked to the field, `variant="search"` with magnifier, hidden label and clear button | 1.34:1 boundary fails; Discover says its label twice | [SiriusXM][sirius-form], [WHOOP][whoop-form], [Calm Sleep][calm-skel] | M | S | Material filled style is close enough; use a focus indicator of at least 2 dp | `TextField` | 1 clear label / flows target testIDs; check any asserting label text |
| 16 | **Spacing and shape tokens** (below); section gap 32 | Sections blend into each other; 3 card radii | [Spotify][spotify-home], [Suno][suno-sheet] | M | S–M | Same | `tokens.ts`, `Screen`, `Card` (new) | None / off-screen items may need extra scrolling in flows |
| 17 | **Dynamic Type pass at 200%** on the 4 tabs, song page and sheets; replace fixed heights with `min-h` | Caps from #4 only limit the worst case | n/a | M | M | Test Android font scale 200% (non-linear, large text scales less) | Per screen | None / none |
| 18 | **Icons:** replace 15 text glyphs with Ionicons; size tokens 16, 20, 24, 32, 48 | Glyphs render differently by font and platform | [Spotify][spotify-sheet] | L–M | S | Same | `Icon` (new) | None / `chip-leading-*` unaffected |
| 19 | **Motion tokens and `useReduceMotion` export:** fast 120 ms, base 200, sheet 280; toast and row enter and exit fade plus slide; none with reduce motion | Abrupt changes; only one component honours the setting | n/a | L–M | S | Respect animator scale | `motion.ts` (new) | None / Maestro waits on animations: keep them short |
| 20 | **Test predictive back on** after the sheet and `beforeRemove` work | Expected on Android 14+; Finish's `beforeRemove` and review need checking | n/a | L | S | Android only: `android.predictiveBackGestureEnabled`, off by default in SDK 57 | `app.json` | None / run affected flows on Android |

### Proposed type scale

Sizes in pt/dp. The font stays the system face. Replaces 9 sizes with 7, every style with a line height.

| Variant | Size / line | Weight | Max scale | Replaces | iOS near | M3 near |
|---|---|---|---|---|---|---|
| `display` | 48 / 56 | bold | 1.3 | `text-5xl` note readouts (use `min-h`) | n/a | Display small |
| `screenTitle` | 32 / 40 | bold | 1.5 | `title` on tab roots; sets header role | Large Title | Headline large |
| `title` | 22 / 28 | bold | 1.8 | `text-2xl` in pages, `text-xl` | Title 2 | Title large |
| `subtitle` | 18 / 24 | semibold | 2 | `text-lg font-*`; sets header role when used as a section head | Title 3 | Title medium |
| `body` | 16 / 24 | regular | 2 | `text-base` | Body | Body large |
| `bodyStrong` | 16 / 24 | semibold | 2 | `font-semibold` (74 uses; song titles) | Headline | Title medium |
| `muted` | 14 / 20 | regular | 2 | `text-sm text-muted` | Subheadline | Body medium |
| `label` | 14 / 20 | semibold | 2 | `text-sm font-semibold` (links, chips) | Subheadline | Label large |
| `caption` | 12 / 16 | semibold | 1.6 | `text-xs` (badges, metadata) | Caption | Label medium |
| `error` | 14 / 20 | regular | 2 | stays; new danger colour | | |

- Retire `text-xs font-bold uppercase`: Arabic, Hebrew, Thai and others have no case, and it creates a second heading style.
- Body at 16 rather than Apple's 17 keeps 33 locales fitting and matches Material.
- Move "max scale" onto `Text` as `maxFontSizeMultiplier`, so individual screens need nothing.

### Proposed spacing and shape

Keep Tailwind's 4 pt steps. Export these from `tokens.ts` with the rule beside them. Retire `2.5`, `5` and `10`; keep half steps in dense components only.

| Token | pt | Class | Use |
|---|---|---|---|
| `xxs` | 2 | `0.5` | title to subtitle |
| `xs` | 4 | `1` | inside compact rows |
| `sm` | 8 | `2` | chips in a row, icon to label |
| `md` | 12 | `3` | list item padding, card inner gap |
| `lg` | 16 | `4` | screen gutter, card padding, stack of related items |
| `xl` | 24 | `6` | group within a section |
| `xxl` | 32 | `8` | **between sections** (new as a habit) |
| `xxxl` | 48 | `12` | state view vertical padding |

Radii: `control` 12 (inputs, and buttons per Q2), `card` 16, `sheet` 24, `pill` full.

Colour additions, computed: `muted #a3a3a3` is 7.60 on bg, 6.90 on card, 5.36 on primary/15, 4.68 on gold/15. `purple #a78bfa` is 6.40 on card, 4.59 on its /20 tint. `danger #f87171` is 6.29 on card, 5.03 on its /15 tint. `border-strong #6b6b6b` is 3.60 on bg, 3.27 on card. `surface-raised #2e2e2e` carries text at 10.78, muted at 5.38, primary at 5.76, and is 1.28 over card. These diverge from gen web's tokens (Q6), as `primaryFg` already does.

### State component set

All in `@nomad/ui`; caller supplies translated strings, as `Sheet` does. All take `testID`. Placement: `layout="screen"` centred in the free area, with header and tabs kept; `layout="inline"` start-aligned inside a section or shelf (replacing most of today's); `layout="sheet"` centred within a sheet.

**`EmptyState`:** `icon` (Ionicons outline, 48, muted; 32 inline), `title` (`subtitle`), `body?` (one sentence, `muted`), `action?`, `secondaryAction?`. Says what will appear here and how to get it. Filter-empty uses the same with "Clear filters". Never use it for failures.

**`ErrorState`:** `kind: 'load' | 'server' | 'notFound'`, `title?`, `body?`, `onRetry?` (label defaults to `common.retry`), `secondaryAction?`. Icon `alert-circle-outline`, in neutral colour, **not** red text. Keep cached content when it exists and use `Banner` instead, as Make already does with `refreshFailed`.

**`OfflineState`:** `cloud-offline-outline`, default title "You're offline" (`common.offline`-style key), `body` naming what still works, `onRetry?`. Neutral, never danger. Auto-retries when `useOffline` flips, with no need to tap.

**`LoadingState`:** one rule, one component:

| Situation | Show | Reference |
|---|---|---|
| Under about 300 ms | Nothing (delay the indicator) | |
| Inside a control | `Button loading` spinner, existing | [Sora][sora-form] |
| Known shape: lists, shelves, pages | `variant="rows" \| "cards" \| "page"` skeleton, with real header, chips and tabs in place | [Resy][resy-skel], [Calm Sleep][calm-skel] |
| Unknown shape, blocking wait over 1 s with no content to preview: opening review, picking audio | `variant="brand"`: the `NomadLoader` (whatever form the loader research picks) **plus a line of text saying what's happening** | |
| Long jobs with stages | Existing determinate job steps; never an indeterminate loader | |

Under this rule, `NomadLoader` stops being the list loader and stops needing to say "progress bar" by itself: it becomes the brand moment for short blocking waits, always with text. Replace most bare `ActivityIndicator`s.

**`Banner`:** `tone: 'neutral' | 'warning' | 'danger' | 'success'`, `icon`, `message`, `action?`, via a `Screen` `banner` prop, so all screens place it the same way, directly under the header. Used for offline with cached content, refresh failed, the box unreachable. Live-region announced. Reference: [Alta][alta-banner].

Copy rule across all of them: what happened, then what to do, in one sentence each. Use one wording for retry.

### What doesn't need changing

Don't spend time on: RTL plumbing, token adoption, label coverage, `testID` coverage (0 interactive elements missing one) or the `Button` 48 pt height.

---

## 4. Questions for Andrew

1. **What should pink mean?** Options: (a) everything interactive, as now; (b) one primary action per view, selection and inline links, with other actions neutral. **Recommendation: b.** Spotify and SiriusXM use their accent sparingly, and pink stays special.
2. **Button shape.** Standalone CTAs could stay 8 to 12 pt rounded, or become capsules like the chips. Music apps lean capsule ([YouTube Music][ytm-empty], [MD Vinyl][mdvinyl-empty]), and iOS 26's own controls do too. **Recommendation: capsule**, one line in `Button`, trying it on real screens before deciding, given your earlier preference for iterating on the real frontend.
3. **Dark only, or add light?** **Recommendation: dark only for release.** Karaoke happens in dark rooms, and every strong reference here is dark. Semantic tokens leave light possible later.
4. **Native tabs and Liquid Glass.** In SDK 57 `NativeTabs` is still at `expo-router/unstable-native-tabs`; docs for SDK 58 use a stable path. It gives iOS's glass bar and Material's indicator free, but changing it could affect 49 flows' `tab-*` targeting. **Recommendation: keep JS Tabs now with the improvements in #8, and move with SDK 58.**
5. **Empty-state artwork.** Line icons, or custom illustrations (with the Nomad N)? **Recommendation: line icons for release**, because illustrations need art for each state. One illustrated moment on Tonight's empty state would be enough if you want some personality.
6. **Do app tokens lead gen web?** `tokens.ts` says it mirrors gen web, yet the contrast fixes diverge from it. **Recommendation: the app leads**, and gen web can adopt the same fixes in its own small PR later. Text legibility shouldn't wait for it.
7. **Brand typeface or system fonts?** **Recommendation: system fonts.** A custom font must cover Arabic, Hebrew, Thai, Hindi, Japanese, Korean and Chinese across 33 locales, and adds weight, for little gain in this phase.

---

## 5. Mobbin collection

[Nomad Phase 7 - 6 Cross-cutting](https://mobbin.com/collections/b44b54c0-056a-4f2f-8b9d-bb7750c7b82e/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp): 30 references. Private to Andrew and teammates unless made public on mobbin.com.

---

**Your Mobbin AI usage is high this month**

Usage is unlimited during beta. If your usage stays at this level, you may need to purchase more credits once limits take effect. [View usage and plan options](https://mobbin.com/settings/billing-and-usage?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp)

[spotify-home]: https://mobbin.com/screens/1925c9b8-b85a-4aed-80b5-06a0c284e259?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-home]: https://mobbin.com/screens/a9626e3b-e898-4072-9eec-de86ca202dce?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sirius-home]: https://mobbin.com/screens/c59cd9ab-e786-492f-be48-e70e08cc2e5b?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[deezer-home]: https://mobbin.com/screens/4e38f154-7a6e-45c7-9ab7-cadb7ec9301f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[bff-badge]: https://mobbin.com/screens/16d9dd48-a699-4ae8-99e7-5564def9d557?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ladder-badge]: https://mobbin.com/screens/81249caf-390e-4980-82ce-bc588dec78d2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[locals-toast]: https://mobbin.com/screens/57b81b64-26c3-46b9-b1f1-cc4143f90908?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[spotify-library]: https://mobbin.com/screens/768254d2-404f-4ef7-b44e-445c297dda7c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sirius-library]: https://mobbin.com/screens/ab801c06-245e-44d5-9c86-edff90d681b7?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-library]: https://mobbin.com/screens/3ab0b1ed-c25c-458a-bf83-d71c6dd712a2?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[appletv]: https://mobbin.com/screens/25823b65-6d21-4e06-97f1-2f0fcb8a63f1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[meplus]: https://mobbin.com/screens/354b85b1-3118-4e8e-a01f-ece047c58050?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[calm-fav]: https://mobbin.com/screens/dd473c45-123b-4e50-8538-3d17aa12e692?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-empty]: https://mobbin.com/screens/82238b64-804a-4a31-83e4-8d9a5427b1e4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[edits-empty]: https://mobbin.com/screens/f599590f-d201-416d-9f01-e64c0dd1b5b8?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[mdvinyl-empty]: https://mobbin.com/screens/e6073726-4e2a-4ef1-8280-87876e7d55f0?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[untitled-empty]: https://mobbin.com/screens/a871be3f-acf8-4265-9462-b4ddf5fea9dd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[eleven-empty]: https://mobbin.com/screens/b82ee6d1-960d-4a40-b68f-a246a4892fbe?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[insight-empty]: https://mobbin.com/screens/d5a8b3a5-d8c3-4b29-8553-f9b8529cbe3f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[resy-skel]: https://mobbin.com/screens/ec347638-be48-4fe6-93c2-4dd925c12573?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[calm-skel]: https://mobbin.com/screens/af14280a-7aca-4d5b-a806-003216e10222?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[spotifykids-skel]: https://mobbin.com/screens/071f97bd-3d7f-4812-8a3d-97f7e6fc86e9?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[hatch-skel]: https://mobbin.com/screens/37667ddd-fca9-435d-a2f6-0ce64ba52515?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sora-form]: https://mobbin.com/screens/dcaa6ff8-78cf-41b6-9f85-6ab1d8255941?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[glow-error]: https://mobbin.com/screens/40002101-c026-4d71-9f55-82cef3db9415?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[prime-error]: https://mobbin.com/screens/7f93f562-2680-4876-9cc2-c11898ae4092?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ebay-error]: https://mobbin.com/screens/f4c64fdd-701e-4ddc-9f28-54d9cd5deda9?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[facebook-card]: https://mobbin.com/screens/4ecaa84d-2715-42a5-acb7-47b550651e00?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[netflix-error]: https://mobbin.com/screens/03edfe67-e0c0-4036-a9dc-2c580a7b1eb6?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[hbo-error]: https://mobbin.com/screens/2c6b51a6-80b2-40f0-8513-83e693c55da3?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[spotify-offline]: https://mobbin.com/screens/430d2c09-a884-471d-afed-fbcc0f7ad2d4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[fanatics-offline]: https://mobbin.com/screens/211a7715-c3dc-46cc-af99-467d6575c34d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[alta-banner]: https://mobbin.com/screens/2b00c4b9-d2a6-4a6a-9d95-2aba49348be1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sunlitt-offline]: https://mobbin.com/screens/ac78de4c-c721-4233-ac1b-14bc15e0a31f?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gopay-offline]: https://mobbin.com/screens/95483b32-a4d7-4025-b6e7-64220245eff5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gphotos-toast]: https://mobbin.com/screens/f74e2b73-3c0c-40a3-acaa-d43511b58abd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[gdrive-toast]: https://mobbin.com/screens/db60a3e2-1e3a-414c-926e-2776b2f5dfcd?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[bmw-toast]: https://mobbin.com/screens/7ab2720a-b373-420b-a6a5-354e76153343?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ebay-toast]: https://mobbin.com/screens/a06ebfd3-a3db-4ebf-a1e4-0e07d8cac91c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[linkedin-toast]: https://mobbin.com/screens/9e932899-9f6a-48d4-8743-ed093f0c8489?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[medium-toast]: https://mobbin.com/screens/ed637f28-2d0d-40a6-bb79-b7fe7d8505e8?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[spotify-sheet]: https://mobbin.com/screens/facdc774-78cf-4c5f-a873-b70201c92bed?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[soundcloud-sheet]: https://mobbin.com/screens/cc9f5595-5dbb-479d-bf4d-ab08db6e8300?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[suno-sheet]: https://mobbin.com/screens/dc7e2cec-5911-480e-ac99-a3a86e1396e1?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[ytm-sheet]: https://mobbin.com/screens/e1aa8d03-1fe7-43d8-8882-fe6a4bf705d3?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[locket-sheet]: https://mobbin.com/screens/6a9ea959-6cb0-4b92-8fd8-f65bf38011ac?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[charai-settings]: https://mobbin.com/screens/0a65f4fd-71b8-4fdd-9572-b088b0568e5e?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[googletv-settings]: https://mobbin.com/screens/13577f13-8ff2-4789-ab1b-5a95a0df46d8?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[alias-settings]: https://mobbin.com/screens/9c23d9e1-7e54-4282-b9c9-9c9374a3c00d?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[moonpay-settings]: https://mobbin.com/screens/d0e0e9ad-9100-4eff-ac0a-ba66f630c627?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[sirius-form]: https://mobbin.com/screens/fbefd228-753f-4eaa-be45-fd3a3b2a986e?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[whoop-form]: https://mobbin.com/screens/6974adad-0ea8-4baf-8d82-8e06b58444c6?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[hbo-form]: https://mobbin.com/screens/d3c797f9-f37d-420b-a2d4-47018c614183?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
[talabat-lang]: https://mobbin.com/screens/4e35a445-bc69-465a-a54f-96fe36631f25?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp
