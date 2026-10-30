# Age rating answers (draft for Andrew)

Phase 6 spec §9. These are the answers to give in App Store Connect (App Information → Age Rating) and in
Play Console (Policy → App content → Content rating, which is the IARC questionnaire), with the reasons.
Check the wording against the live forms when filling them in: Apple reworked its questionnaire in 2025
(ratings 4+, 9+, 13+, 16+, 18+, plus new capability questions), and the question text can shift.

## What drives the rating

- **Song content.** People make and sing karaoke of real songs, so lyrics on screen (in the review
  screen, in videos made in the app, in community YouTube videos opened from the app) can include
  swearing, sexual references, and drink and drug references, just like the radio. We don't write that
  content, and the app doesn't feature or promote explicit songs, but it can appear. The honest answer is
  "infrequent / mild" for those themes, not "none".
- **Bars.** Nomad nights are often in bars, and the app mentions "karaoke night" and "the bar you're at",
  but it doesn't show, sell or encourage drinking.
- **No public content feed.** Nothing a user writes is published to other app users, except the name a
  singer goes by at a Nomad night (row below).

## Apple App Store

| Question | Answer | Why |
|---|---|---|
| Parental controls (in-app) | No | |
| Age assurance (in-app) | No | |
| Unrestricted web access | **No** | The app opens specific pages in the in-app browser: web checkout (Stripe), Spotify / Apple / ListenBrainz help pages, the MusicKit connect page, YouTube links. There's no address bar or open browsing. The only WebView is our own YouTube player page for the voice session. |
| User-generated content | **No** (Andrew to confirm, see below) | Survey notes and the karaoke log are private to the user. At a Nomad night, the name you sing under (and a friend's or duet partner's name) shows on the host's queue, the venue screen and other singers' duet picker. That's a display name on a queue the host moderates (the host can rename or remove anyone), not content shared between users. |
| Messaging and chat | No | No user-to-user messages. "Text me when I'm up" is a one-way SMS from the host's system. |
| Advertising | No | |
| Profanity or crude humor | **Infrequent / Mild** | Lyrics of real songs |
| Horror / fear themes | None | |
| Alcohol, tobacco or drug use or references | **Infrequent / Mild** | Lyrics; the bar setting |
| Mature or suggestive themes | **Infrequent / Mild** | Lyrics |
| Sexual content or nudity | None (Infrequent / Mild sexual content only if Apple's form has a lyrics-style "suggestive" item and not the item above) | No images; song lyrics are covered by "mature or suggestive themes" |
| Graphic sexual content and nudity | None | |
| Cartoon or fantasy violence | None | |
| Realistic violence | None | |
| Prolonged graphic or sadistic realistic violence | None | |
| Guns or other weapons | None | |
| Medical or treatment information | None | The voice type is entertainment, not a medical assessment |
| Health or wellness topics | None | Warm-up and posture tips in the voice session are singing tips; answer None |
| Simulated gambling | None | |
| Contests | None | Tips can move a singer's next song up a little at a Nomad night. That's a host's perk, not a contest or prize. |
| Gambling (real money) | No | |
| Loot boxes | No | |

**Expected result: 13+** (mild, infrequent mature themes). If Apple's calculator gives 9+, accept it;
don't answer down to get it.

**On user-generated content:** if the answer is "Yes", Guideline 1.2 then expects a way to filter
content, report it and block people. The host already moderates the queue (rename, remove), but the app
has no report or block button. Answering "No" is defensible because names only show at a physical event
the host runs. If App Review pushes back, the fallback is a "Report this name to the host" action on the
duet picker. Andrew decides.

## Google Play (IARC questionnaire)

Category: **"All other app types"** (it isn't a game, a store front, or a news or social app; IARC's
"Entertainment" and "Music" both sit in that path).

| Question | Answer | Why |
|---|---|---|
| Violence, blood, gore | No | |
| Fear / horror | No | |
| Sexuality, nudity | No | Lyrics are covered under language and themes |
| Language: does the app contain swearing or crude humor? | **Yes, mild / infrequent** (song lyrics) | As above |
| Controlled substances: references to drugs, alcohol, tobacco | **Yes, references only** (song lyrics, bar setting); no use shown or encouraged | |
| Gambling or simulated gambling | No | |
| Does the app let users interact or exchange content? | **Yes, limited**: a display name on a host-moderated queue at live events. No chat, no media sharing between users. | IARC asks this broadly, and "Yes" here only adds the "Users Interact" descriptor; it doesn't raise the rating. Answering Yes is the safer reading. |
| Does it share the user's location with other users? | No | No location is collected |
| Does it let users buy digital goods? | **Yes** (credits) | Adds the "In-App Purchases" descriptor |
| Does it share user-provided personal info with third parties? | No | Only service providers (see `privacy-inventory.md`) |
| Is it a web browser or search engine? | No | |
| Is it mainly news or educational? | No | |

**Expected result:** ESRB Teen, PEGI 12, USK 12 (mild language, references to alcohol and drugs), with
the descriptors "Users Interact" and "In-App Purchases".

## Google Play: target audience (Policy → App content → Target audience and content)

Recommend **18 and over** only. Nomad nights are mostly in bars, and the privacy policy already says the
service isn't for children under 13. If the app picks any band under 18, Play's teen expectations come
in, and an under-13 band brings the Families policy (no Sentry or PostHog without certified SDKs). Answer
**No** to "Could your store listing unintentionally appeal to children?" (no cartoon art or kids'
wording). Andrew can widen it to 16+ later if he wants teen singers.
