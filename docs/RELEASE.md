# Release runbook

Runbook for shipping the Nomad Karaoke mobile app (`com.nomadkaraoke.mobile`, Expo/React Native)
to the App Store and Google Play. Publisher: Nomad Karaoke LLC, https://nomadkaraoke.com, support
email support@nomadkaraoke.com.

Account details (owners and logins, company registration facts, store ids, tester lists, support
cases and the setup log): private workspace `docs/MOBILE-RELEASE-ACCOUNTS.md`. This repo is public, so
none of that belongs here.

## Accounts

Every account is owned by the company's admin mailbox (Google SSO where offered). Secrets live in GCP
Secret Manager (project `nomadkaraoke`); none is in this repo.

| Service | Plan | Identifiers (public) | Status (2026-10-25) |
|---|---|---|---|
| Expo / EAS | Free | account `nomadkaraoke`, project "Nomad Karaoke", slug `nomad-karaoke`, project id `c6092d15-ad6e-4e3d-bfc2-befc2e239af2` (in `app.config.ts`: `extra.eas.projectId`, `updates.url`) | Done |
| Sentry | Developer (free) | org `nomadkaraoke`, project `mobile` (React Native), DSN `https://fc42e40b65756724b9992bea21bbbe7d@o4507654072631296.ingest.us.sentry.io/4512318495457280` | Done. "Prevent Storing of IP Addresses" on; data scrubbers on |
| PostHog | Free, US cloud | project "Nomad Karaoke app", key `phc_nonjuPuxanDJJDiv5Mw9DojJAhGteb42DWiQxVmSjWPE`, host `https://us.i.posthog.com` | Done. Session replay, autocapture, web vitals and heatmaps off; "Discard client IP data" on |
| RevenueCat | Free | public SDK keys: iOS `appl_DWuzBOczZnmeAxFCBpuyEFByAGA`, Android `goog_iIeISSotmtDWCILZSHxRNKPwJlp` | App Store and Play Store apps created. Play credentials valid and Google real-time developer notifications connected. The 4 Play credit products exist as consumables. The app reads no offering or entitlement (`getProducts` + `purchaseStoreProduct`; gen grants from the webhook), so none is attached. App Store in-app purchase key and products still to add |
| Apple Developer Program | Paid | team `55B76HN73D` | Conversion from an Individual to an Organization (Nomad Karaoke LLC) requested; pending with Apple |
| App Store Connect | n/a | app id `6829908363`, bundle `com.nomadkaraoke.mobile`, SKU `nomad-karaoke-ios` | App record created 2026-11-02. TestFlight internal group "Nomad internal" has 1.0.0 (2). Not submitted for review. Waiting for the Organization conversion: seller name, bank and tax details, Small Business Program, in-app products, Sign in with Apple key |
| Google Play Console | One-off fee | organization account "Nomad Karaoke LLC"; app "Nomad Karaoke", package `com.nomadkaraoke.mobile` | App created, internal testing release 1.0.0 (4) rolled out (2026-10-31). Real-time developer notifications go to Pub/Sub `projects/nomadkaraoke/topics/Play-Store-Notifications` (all one-time products), which RevenueCat consumes; Play's publish grant is IaC in gen (`infrastructure/modules/play_rtdn.py`). One-time products `nomad_credits_1/3/5/10` active (2026-11-03): US $9.99 / $23.99 / $34.99 / $59.99, other countries by Play's conversion, license testing on for the internal testers. Their first real test purchase is still to do |

Store credential still to set up: the App Store in-app purchase key in RevenueCat.

## Build profiles (`apps/mobile/eas.json`)

- `preview` / `production` extend `release`: production URLs, `EXPO_PUBLIC_ASSOCIATED_DOMAINS=1`,
  `EXPO_PUBLIC_PUSH=1`, and the public RevenueCat, Sentry and PostHog keys.
- `development`: a dev client on Metro, none of the release keys.
- `e2e-test`: an unsigned simulator build / debug APK for the Maestro suite. `EXPO_PUBLIC_PUSH=0` is the
  part that matters at build time (no push entitlement, which an unsigned build can't carry; CI's
  `scripts/ci/build-dev-client.sh` sets the same). Its fakes (`EXPO_PUBLIC_FAKE_SOCIAL_SIGNIN`,
  `FAKE_IAP`, `FAKE_MIC`, `FAKE_YT`) **do nothing on their own**: `src/config.ts` honours each only when
  `EXPO_PUBLIC_GEN_API_URL` is a local host (localhost, 127.x, a private-range IP or `*.local`), and the
  profile sets no URL, so the app talks to production gen with every fake off. A debug build loads its JS
  from Metro anyway, so in practice the fakes come from the Metro environment `scripts/e2e-local.sh`
  starts (local stack URLs plus the same `EXPO_PUBLIC_FAKE_*`). To make a self-contained e2e build,
  add the local stack URLs to the profile.

## Android signing

EAS manages the Android upload keystore remotely (created by the first
`eas build -p android --profile production` on 2026-10-25). Fingerprints (public) of the upload key:

- SHA-1: `1D:11:D8:0D:AC:B7:AC:1C:11:43:B7:7D:28:54:3E:EC:2A:39:AF:BD`
- SHA-256: `76:F4:86:63:51:49:04:0D:78:CE:7A:55:18:C3:59:86:64:E2:93:79:6B:A2:94:9B:79:BC:ED:F7:DE:FE:7C:EC`
  (raw hex: `76f486635149040d78ce7a5518c3598664e293796ba2949b79bcedf7defe7cec`)

Play App Signing re-signs releases with Google's app signing key (public):

- SHA-1: `7A:92:5F:24:E3:72:EE:CC:0C:46:96:FC:F0:17:41:53:82:FD:CA:FA`
- SHA-256: `F2:57:4E:69:11:F1:A8:34:F9:F9:D7:DE:C8:77:86:F1:63:D7:9C:7A:23:27:A4:D9:47:70:DE:4B:6A:57:16:63`

Read the upload key's any time through the EAS GraphQL API (`androidAppCredentials.androidAppBuildCredentialsList.androidKeystore
{ sha1CertificateFingerprint sha256CertificateFingerprint }`); the app signing key's are in Play Console >
App integrity. Google sign-in needs one OAuth Android client per certificate (an Android client holds a single
package + SHA-1 pair): one for the upload key (sideloaded and EAS builds), one for the app signing key (Play installs). Both clients exist since 2026-10-30 (ids in CLAUDE.md
§ App identity). Push on Play installs: the Firebase Android API key's Android restriction already
allows both SHA-1s (upload and app signing, checked 2026-10-31 through `apikeys.googleapis.com`), which is
what FCM registration needs. The Firebase app's own fingerprint list (upload key only) matters only for
Firebase Auth / Dynamic Links, which the app doesn't use. Add the app signing SHA there only if one of
those is ever adopted (then re-download `google-services.json`).

EAS environment variable `SENTRY_AUTH_TOKEN` (visibility: secret) in the `production` and `preview`
environments uploads source maps.

The first production Android build failed in "Configure expo-updates" on a runtime version (fingerprint)
mismatch, fixed below. The second (versionCode 3) was the first internal testing release; 1.0.0 (4) (EAS build `2ea75a8f`) superseded it on 2026-10-31.

## iOS signing and TestFlight

EAS manages the Apple Distribution certificate and App Store provisioning profile remotely. An App Store Connect
team API key (App Manager role) is on EAS as the project's submission key, with a backup in Secret Manager. It also
authenticates credential repairs when passed through `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`,
`EXPO_APPLE_TEAM_ID` and `EXPO_APPLE_TEAM_TYPE`.

To ship a build to internal testers, from `apps/mobile` on main:

```bash
npx eas-cli build -p ios --profile production --non-interactive --no-wait   # autoIncrement bumps the remote buildNumber
npx eas-cli submit -p ios --profile production --id <build id> --non-interactive --no-wait
```

The "Nomad internal" group has automatic distribution on, so a build reaches its testers once Apple finishes
processing (`processingState` VALID, internal state `IN_BETA_TESTING`). `eas submit` only uploads: it never submits
for App Store review.

- **Export compliance:** `ios.config.usesNonExemptEncryption: false` in `app.json` sets
  `ITSAppUsesNonExemptEncryption`, so TestFlight asks nothing. The app uses standard HTTPS only (`expo-crypto` is
  `randomUUID`). Revisit this if the app ever adds its own encryption.
- **Capabilities:** the App ID needs Sign in with Apple, Push Notifications, Associated Domains, In-App Purchase and
  MusicKit, all enabled. eas-cli 27.2.0's capability sync failed with "not a valid request document object", so a
  run that has to sync capabilities needs `EXPO_NO_CAPABILITY_SYNC=1` and the change made in the Apple developer
  console or through `POST /v1/bundleIdCapabilities`.
- **First-time credentials need an interactive `eas build`:** in `--non-interactive` mode, a missing distribution
  certificate is an error. Existing credentials work non-interactively.
- **Push:** the APNs key (Sandbox & Production, team scoped) is on EAS, with a backup in Secret Manager. Builds already
  carry the `aps-environment` entitlement, so adding it needed no rebuild.

## Runtime version (fingerprint)

`runtimeVersion: { policy: 'fingerprint' }`: EAS Build computes the native fingerprint on the Mac at
submit time and again on the build server, and fails the build if they differ.

Root cause of the 2026-10-25 mismatch: a local Android build (`expo run:android`, the Maestro runs)
rewrites library manifests inside `node_modules`. React Native's Gradle plugin strips the legacy
`package="…"` attribute from a library's `AndroidManifest.xml` once it sets the AGP namespace
(`@react-native-masked-view/masked-view`). EAS installs clean, so its hash of that package differed.
The other diff entry, the prebuild-generated `android` dir (`bareNativeDir`), has a null hash
(gitignored, CNG) and does not count towards the fingerprint.

Fix: `apps/mobile/fingerprint.config.js` has a `fileHookTransform` that hashes `node_modules/**/AndroidManifest.xml`
without the `package` attribute and whitespace, so the hash is the same before and after a local build
(`src/__tests__/fingerprintConfig.test.ts`). Any other manifest change still changes the fingerprint.

Check before a build (from `apps/mobile`): `npx expo-updates fingerprint:generate --platform android --debug`;
to compare with a build's fingerprint, `npx @expo/fingerprint fingerprint:diff <a.json> <b.json>`. If a build
fails on a mismatch again, the build log's "Difference between local and EAS fingerprints" names the
source; most often it is a locally modified `node_modules` file (a fresh `pnpm install` also clears it).

## Push (FCM for Android)

- Firebase is on GCP project `nomadkaraoke` (display name "Nomad Karaoke"), with an Android app for
  `com.nomadkaraoke.mobile` carrying the upload key's SHA-1 and SHA-256 (§ Android signing).
- `apps/mobile/google-services.json` is committed and set as `android.googleServicesFile`. It holds only
  public client identifiers; its Firebase Android API key is restricted to this package and its signing
  certificates and to the APIs push needs (allowlisted in `.gitleaks.toml`). It is not an EAS file
  variable on purpose: the fingerprint hashes its contents, and a secret file variable is unreadable on
  the Mac, so the two fingerprints would differ. Re-download it after app or SHA changes:
  `GET https://firebase.googleapis.com/v1beta1/projects/nomadkaraoke/androidApps/<app id>/config`.
- FCM v1 credentials for Expo push: a dedicated service account with `roles/firebasecloudmessaging.admin`
  only; its JSON key is in Secret Manager and uploaded to EAS as the FCM V1 key of the Android app
  credentials. `eas credentials` > Android > production > Google Service Account shows it.

## Store screenshots

Listing screenshots come from one re-runnable pipeline, not hand-made files: `scripts/store-screenshots.sh`
(Maestro `maestro/screens/store-tour.yaml` on iPhone 6.9", iPad 13" and a Pixel AVD, sizes checked against the
stores' requirements). Run it on the build host (the self-hosted E2E Mac, `docs/TESTING.md`), after the Phase 7
UX polish and before submitting the listing; files committed before that are placeholders. Details and required
sizes: `docs/store/screenshots/README.md`.
