# Privacy policy: gaps and drafted additions (for Andrew and the public-website repo)

Phase 6 spec §9. The current policy is https://nomadkaraoke.com/en/privacy/ (public-website
`app/[locale]/privacy/page.tsx`, text in `messages/en.json` → `privacy`, "Last updated: January 2026").
Compared below with `privacy-inventory.md`. Only the gaps are drafted. Once Andrew approves, the new keys
go into `messages/en.json` and through `scripts/translate.py --target all` (33 locales, CI-enforced),
plus a few new `<section>` blocks in `page.tsx`.

## What the policy already covers

- Who we are (Nomad Karaoke LLC), email and name, payments through Stripe, song requests and
  preferences, communications, usage and device data.
- Sharing with Stripe, Google Cloud, Google Analytics and the law; no selling.
- Rights (access, correct, delete, opt out, export), cookies, security, children under 13, changes,
  contact (andrew@nomadkaraoke.com and the Columbia, SC address).

## Gaps

| # | Gap | Why it matters |
|---|---|---|
| G1 | The **mobile app** isn't mentioned at all | Both stores link this policy as the app's policy |
| G2 | **Music listening data** from connected services (Apple Music, Last.fm, ListenBrainz, playlist links, export files, screenshots) | Apple 5.1.1 / Play User Data policy: say what's collected and why |
| G3 | **Voice**: vocal range results and optional **voice recordings** (kept privately until deleted; our team can listen to them) | Audio is sensitive. Says who can access it. |
| G4 | **Karaoke log**, survey answers and free-text notes, venue names | User content stored server-side |
| G5 | **Nomad night data**: phone number for texts (Telnyx), singer names on the queue and venue screen, photo and clip consent and optional Instagram handle, tip claims; this is kept on the host computer we run (NomadPC), not only in the cloud | Phone numbers and consent records |
| G6 | **AI processing (Google Gemini)**: screenshots, search text, the abuse check at sign-up (until gen stops sending the email and IP), lyrics translation | Apple 5.1.2(i) requires disclosing third-party AI |
| G7 | **Service providers** missing from "Data Sharing": Sentry, PostHog (the policy names Google Analytics), RevenueCat, Apple and Google (stores and push), Expo push, Telnyx, Postmark, Dropbox, YouTube | Play data safety and Apple labels must match the policy |
| G8 | **Push notifications** and device identifiers (push tokens, a random install id) | |
| G9 | **Crash reports** | Spec §9 lists "crash data" |
| G10 | **Location**: the policy says "IP address and approximate location". The app collects no location. | Keep the web line; say the app doesn't use device location |
| G11 | **Account deletion**: how (in the app and the web URL), what's deleted, what's kept (job and payment records, published YouTube videos), and that unused credits are lost | Play requires the deletion URL and what's kept; Apple 5.1.1(v) |
| G12 | **Retention** is one generic sentence | Play asks for retention by data type, and "some data kept for legal reasons" needs to be stated |
| G13 | "Last updated" date | Bump on publish |

Note for G10 and G7: the website still uses Google Analytics, so keep it in the list and add PostHog
beside it.

## Drafted additions (English; in Andrew's voice, ready to become en.json keys)

Suggested key names in brackets. These slot in after "How We Use Your Information".

### Our mobile app [`privacy.app.*`]

**Title:** The Nomad Karaoke app

**Text:** The Nomad Karaoke app for iPhone, iPad and Android uses the same account as our website. This
section covers what the app adds. Everything else in this policy applies to the app too.

**Items:**
- **Your music.** If you connect Apple Music, Last.fm or ListenBrainz, add a playlist link, import an
  export file from Spotify or Apple, or add screenshots of a music app, we save the artists and songs
  you listen to (with play counts where the service gives them), so we can recommend songs for you. For
  export files, the app reads the file on your phone and only sends us a list of songs and how often you
  played them. You can disconnect a service or remove its songs at any time.
- **Screenshots.** Screenshots you add are sent to Google's Gemini AI to read the artist and song names.
  We don't keep the images: only the songs you confirm are saved.
- **Your voice.** The vocal range test listens through your microphone and works out the notes on your
  phone. We save the result (your range and voice type), not the audio. In a guided voice session you
  can choose to record yourself singing. Recordings are kept privately in our storage, only you and our
  team can access them, and you can delete all of them at any time from Me in the app.
- **Your karaoke log.** Songs you add to tonight's log, your answers to the post-song survey and any
  notes you write are saved to your account to build your karaoke history and improve your
  recommendations.
- **Nomad Karaoke nights.** When you join one of our live events, the host's system (a computer
  we run ourselves, not a cloud service) stores the name you sing under, your song requests, any duet partners or friends' names
  you add, your answer about whether photos and clips may be posted (and an Instagram handle if you give
  one), and any tips you tell the host about. Your name appears on the queue and the screen at the venue.
  If you ask us to text you when you're up, we store your phone number and send the text through our SMS
  provider. Every song you sing is added to your karaoke log.
- **Notifications.** If you allow notifications, we store a push token for your device so we can tell
  you when your video is ready or needs you, and when you're up at a Nomad night. You can turn each type
  off in the app.
- **Camera.** The app uses your camera only to scan the host's QR code at a Nomad night. Nothing is
  recorded or sent to us.
- **Location.** The app doesn't use your device's location.
- **Crash reports and app usage.** If the app crashes, it sends us a crash report (what went wrong,
  your device model and system version, and a random account id, not your email or name). We also
  count anonymous events, such as "a video was started", to see which features people use. These aren't
  linked to you.
- **Purchases in the app.** Credits bought in the app are sold by Apple or Google, who handle the
  payment. We get a record of the purchase, not your card details.

### Additional service providers [append to `privacy.sharing.*`]

Add these items to "Data Sharing" (they process data for us and may not use it for anything else):

- Google Gemini (AI), to read music-app screenshots, help with song searches, translate lyrics when you
  ask for a translation, and help us spot accounts made to claim free credits more than once
- Sentry, for crash reports from the app
- PostHog, for anonymous app usage statistics
- RevenueCat, Apple and Google, to process in-app purchases (identified by a random id, not your email)
- Expo, Apple and Google, to deliver push notifications
- Telnyx, to send "you're up next" texts at Nomad nights
- Postmark, to send sign-in codes and emails about your videos
- Dropbox and YouTube, to deliver and publish the karaoke videos you make

### Deleting your account [`privacy.deletion.*`]

**Title:** Deleting your account

**Text:** You can delete your account in the app (Me → Account and notifications → Delete account) or on
the web at https://gen.nomadkaraoke.com/en/account/delete/. If you can't sign in, email us and we'll do
it for you.

**When you delete your account, we delete:**
- your name, email address and sign-in details
- your music data, vocal range, voice recordings and karaoke log
- your Nomad night details (name links, phone number, consent answers)
- the files you uploaded to make videos, and your push tokens

**We keep:**
- records of your jobs and payments, with your name and email removed, because we need them for
  accounting and tax
- karaoke videos that were already published on YouTube
- a one-way scrambled (hashed) copy of your email address, so a new account with the same email doesn't
  get a second free credit

**Unused credits are lost** when you delete your account. The app and the web page tell you how many
before you confirm. Deletion is permanent and can't be undone.

### Retention [replace `privacy.retention.text`]

We keep your account data while your account is open. Voice recordings, music data and your karaoke log
stay until you delete them or your account. Search logs and server logs are kept for about 30 days.
Crash reports and anonymous usage data are kept by Sentry and PostHog for their standard periods. Job
and payment records are kept after account deletion, without your name or email, for as long as the law
requires for accounting. Photos and clips posted from a Nomad night stay posted unless you ask us to take
them down.

### Location [replace `privacy.collect.item7`]

IP address, and an approximate location worked out from it, on our website. The mobile app doesn't
collect your location.

### Last updated [`privacy.lastUpdated`]

`Last updated: <month> 2026`, on the day the additions go live (before the app is submitted).

## Open questions for Andrew

1. Should the policy name **support@nomadkaraoke.com** (the app's address) as the contact, or keep
   andrew@? The two should match the store listing.
2. The policy says users can **export** their data. Today there's no export button, so requests would be
   handled by email. That's fine, but keep the wording ("email us to request a copy").
3. Night photos and clips: the policy should say how someone asks for a post to come down. The draft
   above says "ask us"; is that the process?
