# App Review notes (draft)

Phase 6 spec §9. The first part is the text to paste into App Store Connect (App Review Information →
Notes) and Play Console (App content → App access → "All or some functionality is restricted", with the
instructions). The second part is Andrew's checklist for submission day. Nothing is submitted yet.

## Before pasting: placeholders to fill

| Placeholder | What it is | Set where |
|---|---|---|
| `APP_REVIEW_DEMO_EMAIL` | The one review email gen accepts with a fixed code, e.g. `appreview@nomadkaraoke.com` (Andrew picks it; it doesn't need a real inbox) | gen Cloud Run env `APP_REVIEW_DEMO_EMAIL` |
| `<DEMO CODE>` | 6 digits, from Secret Manager `app-review-demo-code` (mounted as `APP_REVIEW_DEMO_CODE`) | Andrew creates the secret version (agent ADC is read-only) |
| `<NIGHT VIDEO LINK>` | A screen recording of a real Nomad night in the app: scan the QR code, request, "you're up next" push, "your turn", the post-song survey | Andrew records it at a night; upload it as an unlisted YouTube video or to App Store Connect's attachment field |

The demo login is **inert until both values are set** (gen `login_code.py` `verify_login_code`: only that
email, only that code, normal attempt limits, an INFO log line `app review demo login` on every use).
Set them on submission day, and give the demo account enough credits for a few test makes (an admin
grant, for example 5 credits).

Also before submitting:
- `ACCOUNT_DELETION_ENABLED` **on** in prod (the delete row is hidden and the web page shows a 404
  without it).
- In-app purchase products `nomad_credits_1/3/5/10` attached to this version (Apple reviews a first IAP
  together with the binary).
- Guideline 5.1.2(i) (third-party AI): screenshot import discloses Gemini and asks once, and gen's
  welcome-credit check no longer sends the raw email and IP to Gemini (see `privacy-inventory.md`).
- The microphone permission text no longer says "Audio stays on your phone" if voice-session
  recordings are open to reviewers (see `privacy-inventory.md`).

## Text to paste (App Store Connect notes; Play app access instructions)

```
Thank you for reviewing Nomad Karaoke.

SIGN IN
The app requires an account (the same account works on nomadkaraoke.com). To sign in as our review account:
1. Open the app, go to the Me tab and tap Sign in (or tap any sign-in prompt).
2. Tap "Continue with email".
3. Enter APP_REVIEW_DEMO_EMAIL and tap "Send code".
4. Enter the code <DEMO CODE> and tap "Sign in".
This review address can't receive email, so it accepts this fixed code. Sign in with Apple and Google sign-in also work with your own accounts.

WHAT TO TRY
- Discover: answer the short quiz (or connect a music service) to see personal karaoke picks. Me > Your music profile > Your voice runs a vocal range test with the microphone.
- Make: search for a song, tap Make it, and confirm. The review account has credits. Making a video takes a few minutes or more, and you'll get a notification when it's ready or if the lyrics need a quick check.
- Tonight: "Start logging tonight" keeps a log of songs at any karaoke night, with an optional survey after each sung song.

BUYING CREDITS (sandbox)
Me > Buy credits. The packs (1, 3, 5 or 10 credits) are consumable in-app purchases (nomad_credits_1, _3, _5, _10). Buy one with your sandbox account; the new balance appears within a few seconds, once our server has the purchase. On the US storefront the same screen also shows "Buy on the web", which opens our own web checkout, as Guideline 3.1.1(a) allows for US storefront apps.

NOMAD KARAOKE NIGHTS
Part of the Tonight tab only works at a live Nomad Karaoke event run by our own host system: you join by scanning the host's QR code, request songs into the rotation, and get "you're up next" and "it's your turn" notifications. This can't be tried without a live event, so here is a screen recording of it at a real night: <NIGHT VIDEO LINK>
At these events the app also has "Tip the host". It opens Cash App, Venmo, PayPal or a card page to tip the person running the live show in the venue. It pays for a real-world service at a physical event, not digital content (Guideline 3.1.3(e)).

PERMISSIONS
- Microphone: only when you start the vocal range test (pitch is measured on the phone) or a voice session where you choose to record. Never in the background.
- Camera: only to scan the host's QR code at a Nomad night. Nothing is recorded or uploaded.
- Notifications: we ask after you start making a video or join a night, not at launch. Each type can be turned off in Me > Account and notifications > Notifications.
- Photos: the system photo picker, only when you choose screenshots of your music app to import. Saving a finished video adds it to Photos (write-only).
- Apple Music: only if you choose to connect it, to read your library and recent plays for recommendations.

ACCOUNT DELETION
Me > Account and notifications > Delete account. The screen lists what is deleted and kept (job and payment records are kept for accounting; videos already published on YouTube stay), shows how many unused credits will be lost, and deletes the account after you confirm. Accounts made with Sign in with Apple re-confirm with Apple first, and we revoke the Apple token. Deletion is also available on the web at https://gen.nomadkaraoke.com/en/account/delete/

Questions: support@nomadkaraoke.com
```

The pasted block above is about 3,250 characters. App Store Connect's notes field takes 4,000.

## Notes for Andrew (not for the reviewer)

- **Sign in with Apple revocation** only happens from the iOS app, where the delete flow gets a fresh
  `authorizationCode` and gen calls Apple's `/auth/revoke` (spec §6.4). A deletion from the web page or
  Android deletes the account **without** revoking, and gen logs a WARNING. Apple's requirement is about
  in-app deletion, so this is acceptable, but the user would still see Nomad Karaoke under "Apps using
  Apple ID" until they remove it.
- **Sandbox purchases** reach gen's real webhook (RevenueCat sends `environment: SANDBOX`). gen grants the
  credits but doesn't count them in `total_spent` (`iap_service.py`), and `store_payments` marks them
  `is_test`. So the review account's purchases won't skew revenue figures.
- **Tips.** "Tip {amount} or more and the host moves your next song up a little" is the riskiest
  sentence in the app for App Review. The argument is 3.1.3(e): a physical service (place in a live
  queue at a venue), paid person to person. If a reviewer objects, the fallback is to hide the perk line
  in the iOS app, or tips altogether.
- **US web link on iOS:** allowed by 3.1.1(a) and 3.1.3 for the US storefront since the May 2025
  injunction (details and sources in `fees.md`). The app only shows it when the RevenueCat storefront is
  USA, and gen's `web_link.show_for.ios` controls it from the server.
- **Play "App access":** add the same credentials under App content → App access, and say a live event
  is needed for the Nomad night features. Play's pre-launch report robots can't sign in. That's
  expected and isn't a rejection reason.
- **Demo account after approval:** keep the values set while each version is in review, then clear
  `APP_REVIEW_DEMO_EMAIL` (or leave it). The code only works for that one address.
