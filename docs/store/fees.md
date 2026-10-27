# Store fees and US external purchase links (research, 2026-10-25)

Phase 6 spec §2 ("Android US web link: research first, then decide") and §9 ("Store fees"). Prices are
the same on every channel (spec §2): 1 / 3 / 5 / 10 credits at $9.99 / $23.99 / $34.99 / $59.99 in the
apps, and $10 / $24 / $35 / $60 on the web. Copy the summary table into `docs/RELEASE.md` once Andrew has
read it.

**Not legal advice.** The Epic cases are still moving. Recheck the sources marked "check" on
submission day.

## Summary: what we keep from a $23.99 pack (3 credits)

| Channel | Fee | We keep (approx.) | Status |
|---|---|---|---|
| iOS in-app purchase (Small Business Program) | 15% | $20.39 | In force. Needs SBP enrolment. |
| iOS US "Buy on the web" link (Stripe) | 0% to Apple today + Stripe about 2.9% + 30c | $23.00 (web price $24) | In force since May 2025. Apple has proposed **5% for small developers**, not yet approved. |
| Android Play Billing (first $1M) | 10% service + 5% billing = **15%** | $20.39 | In force (new fee structure from 2026-06-30) |
| Android US web link (Play external content links program, first $1M) | **10%** of purchases within 24 h of the link tap, plus Stripe | about $20.60 (web price $24) | In force; needs enrolment and API integration; reporting from 2026-10-01 |
| Web (nomadkaraoke.com, Stripe) | Stripe only | $23.00 | as today |

## Apple

### Small Business Program (15%)
- 15% commission on paid apps and in-app purchases (consumables included; nothing excludes them) for
  developers with up to **$1M in proceeds in the previous calendar year**, counted across associated
  accounts. New developers qualify.
- **Enrolment is not automatic.** Apply through the enrol form after accepting the latest Paid
  Applications Agreement. The rate applies from 15 days after the end of the fiscal month in which
  you're approved. So **enrol before the first sale**, after the LLC conversion (spec §2; RELEASE.md
  records that the form asks about the latest agreement).
- If proceeds go over $1M in a year, the standard 30% applies for the rest of that year.
- Source: https://developer.apple.com/app-store/small-business-program/ (live page, read 2026-10-25).

### US external purchase links
- **2025-04-30:** in Epic v. Apple, the district court (Judge Gonzalez Rogers) held Apple in contempt
  and barred any commission on US link-out purchases and any "scare screens". Apple changed the
  guidelines for the US storefront at once.
- **2025-12-11:** the Ninth Circuit upheld the contempt finding and the limits on scare screens, but
  said Apple may charge a commission that isn't "prohibitive", tied to costs that are "genuinely and
  reasonably necessary". It sent the rate back to the district court.
  https://law.justia.com/cases/federal/appellate-courts/ca9/25-2935/25-2935-2025-12-11.html ;
  summary: https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple
- **2026-06-30:** the Supreme Court agreed to hear Apple's challenge to the contempt question only.
  https://ipwatchdog.com/2026/06/30/high-court-grants-cert-in-apples-challenge-to-ninth-circuit-contempt-ruling-in-app-store-dispute/
- **About 2026-08-13:** Apple proposed commissions on US linked purchases of 15% generally, 10% for
  renewals and partner programs, and **5% for Small Business Program members**. This is only a proposal,
  pending the district court.
  https://9to5mac.com/2026/08/13/apple-proposes-commissions-of-up-to-15-for-off-app-store-purchases-in-the-us/
- **Today:** RevenueCat's guide (updated 2026-10-01) gives the current US link-out commission as 0%,
  "subject to the court process".
  https://www.revenuecat.com/blog/engineering/app-to-web-purchase-guidelines
- **Guidelines** (https://developer.apple.com/app-store/review/guidelines/, read 2026-10-25):
  3.1.1(a) says entitlements "are not required for developers to include buttons, external links, or
  other calls to action in their United States storefront apps", and 3.1.3 allows encouraging other
  purchase methods for "apps on the United States storefront".
- **For us:** the iOS web link (`web_link.show_for.ios = ["USA"]`) is allowed and costs nothing to Apple
  today. If the court sets the 5% small-developer rate, the web link still beats IAP (about 8% with
  Stripe against 15%). The link needs no entitlement, no special sheet and no reporting today. **Check
  on submission day** whether a court-approved commission and a reporting duty have started.

## Google Play

### Service fees (Play Billing)
- Since **2026-06-30** in the US, EEA and UK, Play's fee has two parts: a **service fee** of 10% on a
  developer's first $1M of earnings a year (and 10% on auto-renewing subscriptions), with 20% (installs
  from 2026-06-30) or 25% (earlier installs) on other purchases above $1M; plus a **5% billing fee**,
  charged only when Play Billing is used. For our consumables under $1M, Play Billing costs **15%**, the
  same as the old 15% tier. https://support.google.com/googleplay/android-developer/answer/112622
  (read 2026-10-25)
- The old 15% tier had to be joined (payments profile, account group, accept the terms:
  https://support.google.com/googleplay/android-developer/answer/10632485). **Check in Play Console**
  whether the 10% first-$1M rate also needs enrolment. If it does, enrol when the organisation account
  exists.

### US external payment links (the decision for `web_link.show_for.android`)
Timeline, from Google's US programs page
https://support.google.com/googleplay/android-developer/answer/15582165 (updated through 2026-10-21)
and its program page https://support.google.com/googleplay/android-developer/answer/16470497
(read 2026-10-25):

- **2025-10-29:** to comply with the Epic v. Google injunction (Ninth Circuit affirmed; the Supreme
  Court refused a stay), Google stopped requiring Play Billing for US users. US apps may link to outside
  purchases and tell users about other prices.
- **2025-12-09:** Google launched the US **external content links** program (link out to a web
  purchase) and the US **alternative billing** program (your own billing inside the app).
- **2026-03-04:** Google and Epic signed a settlement and asked the court to change the injunction.
  **2026-07-17:** the Daily Journal reports they dropped that request.
  https://dailyjournal.com/article/393046-epic-google-abandon-bid-to-rewrite-google-play-injunction
  (Not confirmed against the docket.)
- **2026-07-22:** Google said enrolled developers report link-out transactions and pay fees **from
  2026-10-01**. **2026-10-21:** the deadline for reporting download links (not our case) moved to
  2027-02-01.

How the external content links program works (answer/16470497):
- **Optional enrolment.** Fill in the declaration form (plus any onboarding with Google's team),
  integrate the **External Content Links API** (it shows Google's information screen before the user
  leaves, handles parental controls and reports transactions), then enrol the app in Play Console →
  Monetization setup → External content links.
- **Disclosure:** before leaving the app, the user must see where the link goes and what it's for, and
  the destination must not mislead.
- **Fee:** charged on purchases completed **within 24 hours** of the user following the link: **10%
  within the first $1M** of annual earnings; above that, 10% on subscriptions and 20% on other purchases
  (15% for Google's partner programs). There's no 5% billing fee because Play Billing isn't used. The
  per-install fees ($2.85 for apps, $3.65 for games) only apply to links that download an app outside
  Play, which we don't do. (The rate table didn't parse cleanly for the above-$1M "existing installs"
  column; the first-$1M 10% is clear.)
- **Reporting:** we'd report each linked purchase (in practice, Stripe sessions started from the app
  within 24 h of a link tap) and pay Google monthly.
- **Play Billing alongside:** not required in the US. If both are offered, Play Billing must work
  "consistently and reliably" for every user.

Unsettled points: whether a changed injunction will lower or raise these terms, and whether the
settlement's proposed caps come back. Check answer/15582165 again on submission day.

### What it means for us (Android, US)
- Web link: 10% to Google plus about 3% Stripe = **about 13%**, against **15%** for Play Billing. That's
  about **$0.21 more per 3-credit pack** ($20.60 against $20.39).
- What it costs to get: the declaration and onboarding, a native module for the External Content Links
  API (no Expo module exists today, so it's custom native code in an Expo module), Google's information
  screen on every tap (more friction than the iOS link), and **monthly transaction reporting** that
  matches Stripe sessions to link taps by time. Mistakes in that reporting are a compliance risk.
- As we read Google's pages, linking to an outside purchase from a US app goes through this program (it's
  how Google applies the fee), so an app that links out without enrolling risks a policy strike.
  **Check** this reading in Play Console before relying on it either way. Telling customers about web prices **outside**
  the app (emails, the website, VISION use case 2) needs no program at all.

## Recommendation and the decision Andrew needs to make

**Recommendation: keep `web_link.show_for.android = []` (Play Billing only) at launch.** The saving is
about 2 points (13% against 15%), about $0.21 per 3-credit pack or roughly $20 a month at 100 Android packs, and it costs a
native integration, monthly reporting to Google, and a slower purchase flow. Keep iOS at `["USA"]`,
where the link is free today and stays cheaper than IAP even if Apple's 5% is approved. Revisit Android
if Android revenue becomes large, or if Google's terms change after the injunction proceedings (the
server-driven `web_link` block means switching it on later needs no app release, only the API
integration).

**Decision for Andrew:** `web_link.show_for.android` stays `[]` at launch (recommended), or `["USA"]`
after enrolling in Google's external content links program and building the API integration and
reporting (a new task, not in Phase 6).
