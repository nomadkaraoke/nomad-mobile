# Phase 3d device spike results (2026-10-22)

Task D1: can the voice session embed a community YouTube karaoke video in a React Native WebView on Expo SDK 57, and does mic capture keep working while it plays?

**Verdict (updated after the real iPad pass)**

- `PLAYER_MODE` default: **`embed-hosted`**, meaning our own IFrame Player API page (player C below) controlled with `injectJavaScript`. It needs **no web deploy**: ship it as an HTML string in the app with `source={{ html, baseUrl: 'https://nomadkaraoke.com' }}`; a real hosted `embed/yt.html` is optional. `embed-iframe-lib` (player B) also plays on every target and is an acceptable first cut for playback only, but it is no longer the default because the session needs deterministic pause/resume: on the iPad the OS pauses the video when the mic stream starts and the app must resume it (see "iPad (real device)"), and the lib's `play` prop failed to pause on Android. `linkout` stays as the fallback for any error event.
- `RECORDING_SINK` default: **`aac-recorder`** (`useAudioRecorder`, AAC mono 44.1 kHz). Confirmed on the iPad. A bare `useAudioStream` (`wav-stream`) is **not** viable on iOS on its own while a WebView video plays: frames starve once the video resumes. See the required start order below.

**Required iOS start order for singing with the video (verified 4 of 4 runs on the iPad):** `setAudioModeAsync({ allowsRecording: true, ... })`, then `stream.start()` (the video pauses about 1 s later, WebKit state 2), then start the AAC recorder while the video is still paused, then tell the player to play again. After that, stream frames (about 10 per second) and the recorder run for 15 to 20 s while the video plays. The other orders failed (see the iPad section).

The spike was a standalone throwaway app (`/Users/andrew/Projects/nomadkaraoke/nomad-yt-spike`, bundle id `com.nomadkaraoke.ytspike`, dev-client debug build, Metro on :8091). Nothing in nomad-mobile was touched. Raw event log: `nomad-yt-spike/shots/spike-run.log`; screenshots in `nomad-yt-spike/shots/`.

## Versions that worked

| Package | Version |
|---|---|
| expo | ~57.0.31 |
| react-native | 0.86.3 |
| react | 19.2.3 |
| expo-audio | ~57.0.5 |
| expo-dev-client | ~57.0.20 |
| react-native-webview | 13.16.1 (what `npx expo install` chose for SDK 57) |
| react-native-youtube-iframe | ^2.4.1 (2.4.1) |

Config: `expo-audio` config plugin with a `microphonePermission` string; no other plugins. Android emulator `Pixel_8_API_35_Root` (API 35), iOS simulator iPhone 17 Pro (iOS 26.5).

## Test videos

Community ids from `karaoke_decide.karaokenerds_community.Watch` (BigQuery via ADC), embeddability pre-checked with YouTube oEmbed (200 = embeddable, 401/403 = embedding disabled, 404 = removed). In a random sample of 400 community rows, 397 were embeddable, 1 was embedding-disabled (403) and 2 were removed (404).

| # | Id | Brand | oEmbed |
|---|---|---|---|
| 0 | `_2kUE3zhlzM` | NOMAD | 200 |
| 1 | `I4RwbQ9zUEU` | CC | 200 |
| 2 | `yUCqHHsqfd4` | SDK | 200 |
| 3 | `abU28ePbD0Q` | FBK | 403 (embedding disabled) |
| 4 | `SgTTutlu0pg` | CC | 404 (removed) |
| 5 | `6X2eVajeqz8` | REEKIES | 200 |

## Players

- **A**: `react-native-youtube-iframe` defaults. The lib loads a page hosted at `lonelycpp.github.io` (third-party).
- **A0**: `useLocalHTML` with no base URL (the 2025 failure mode, included as a control).
- **B**: `useLocalHTML` + `baseUrlOverride='https://nomadkaraoke.com'`. The lib only applies `baseUrlOverride` as the WebView `baseUrl` when `useLocalHTML` is true; without that flag it prefixes the hosted URL instead.
- **C (emulated)**: our own HTML string with the IFrame Player API (`origin: https://nomadkaraoke.com`), loaded with `source={{ html, baseUrl: 'https://nomadkaraoke.com' }}`, posting `ready` / `state` / `error` / `time` messages. Nothing was published. Note the real thing does not need a public-website PR: the local HTML string with a `baseUrl` already works, so a hosted `embed/yt.html` is only worth doing if we want to change player behaviour without an app release.

## Results: Android emulator (API 35, WebView, emulator software rendering)

| Player | Video loads (not Error 153) | Plays (currentTime advances) | onReady / onChangeState / onError | Programmatic play/pause | Fullscreen | Error for ids 3 and 4 |
|---|---|---|---|---|---|---|
| A | yes | yes, after a user tap on the iframe; the `play` prop did NOT start it | yes / yes / yes | no (see note 1) | not tested | `embed_not_allowed` (code 150) for both |
| A0 | **no, "Error 153 Video player configuration error"** | no | ready then error (value `undefined`, see note 2) | n/a | n/a | n/a |
| B | yes | yes (`state` unstarted, buffering, playing; currentTime advanced through 16 s) | yes / yes / yes | play yes; pause via the `play` prop did NOT take effect in two attempts (video kept advancing) | not tested | `embed_not_allowed` for both |
| C | yes, ids 0, 1, 2, 5 | yes; started by injected JS with no user tap; pause and resume by injected JS both work (state 2 then 1) | yes / yes / yes (numeric codes) | yes, deterministic | yes: tapped the player's fullscreen icon, system immersive "Viewing full screen" appeared and lyrics kept playing; the screen stayed portrait (device rotation not exercised) | `150` for both |

Notes:
1. Player A's hosted page (`iframe_v2.html`) only handles plain-string `postMessage` (`"playVideo"`), but lib 2.4.1 sends JSON (`{eventName, meta}`), so the `play` prop cannot control it at all. A is also a third-party dependency. Do not use A.
2. The lib's error map only knows 2, 5, 100, 101 and 150. YouTube's **153** (missing referrer) is passed to `onError` as `undefined`. Detecting it means treating an `undefined` error as failure and falling back to link-out.
3. Both an embedding-disabled video and a removed video returned **150** from the player, so the two cannot be told apart (oEmbed distinguishes them: 403 vs 404). Either way the app should offer link-out.
4. Playback on the emulator is choppy and buffers often (software rendering, nested virtualisation); do not read timings into it.
5. Audio could not be heard (no ears on this run). "Plays" means `currentTime` advanced and state was `playing`. Android's `dumpsys audio` showed the WebView's `AudioFocusDelegate` holding focus (GAIN, no loss) while mic capture ran.

## Results: iOS simulator (iPhone 17 Pro, iOS 26.5)

| Player | Video loads | Plays | Events | Programmatic play/pause | Fullscreen | Error for ids 3 and 4 |
|---|---|---|---|---|---|---|
| A | yes | not controllable (see Android note 1) | ready only; no state events as nothing could start it | no | not tested | `embed_not_allowed` |
| A0 | **no, Error 153** (ready then `undefined` error) | no | ready, error | n/a | n/a | n/a |
| B | yes (screenshot shows lyrics rendering inline) | yes, started by the `play` prop with no tap; pause worked too | yes / yes / yes | **yes** (play and pause both worked) | not verified | `embed_not_allowed` for both |
| C | yes, ids 0, 1, 2, 5 | yes, started by injected JS with no tap; pause worked | yes / yes / yes | yes | not verified | `150` for both |

The simulator has no tap control available to this run, so iOS fullscreen and landscape are **unverified**. Playback is inline (`allowsInlineMediaPlayback`), which is what the lib sets.

## Link-out fallback

- iOS: `Linking.openURL('https://www.youtube.com/watch?v=<id>')` opens Safari on the watch page (with an "Open App" button; on a device with the YouTube app installed the universal link normally opens the app directly). `canOpenURL('vnd.youtube://')` throws unless `vnd.youtube` is added to `LSApplicationQueriesSchemes`, so just call `openURL` with the https URL rather than probing.
- Android: the https URL resolved to the YouTube app (emulator image's YouTube was out of date and showed "Update your app"). `canOpenURL('vnd.youtube://')` returned false without a manifest `<queries>` entry, so again use the https URL and do not probe.

## Results: recording while the video plays

Setup: player C playing video 5, then `requestRecordingPermissionsAsync()`, `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false, shouldRouteThroughEarpiece: false })`, then `useAudioStream({ sampleRate: 44100, channels: 1, encoding: 'int16' })` started, then `useAudioRecorder` (`.m4a`, 44100 Hz, 1 channel, 48000 bps, Android `mpeg4` + `aac`, iOS `MPEG4AAC` + `AudioQuality.MEDIUM`) started while the stream kept running.

| Check | Android emulator | iOS simulator |
|---|---|---|
| Video keeps playing (currentTime advancing) while stream starts | yes | yes |
| Stream frames arrive | yes: 80 frames / 705,600 B in about 8 s (exactly 44.1 kHz x 2 B x 8 s) | yes: 69 frames / 608,088 B in about 7 s |
| Frames carry signal | no: emulator virtual mic is silent (RMS 0.0001); **unverified with a real mic** | yes: RMS avg 0.013, max 0.21 (Mac mic and/or speaker bleed) |
| Recorder starts while the stream is running | yes | yes |
| Frames keep arriving while the recorder runs | yes (233 then 324 frames) | yes (191 then 272 frames) |
| Video keeps playing while both run | yes (kept advancing to 61 s) | yes (kept advancing to 48 s) |
| Recorded file | `.m4a`, 15.1 s, 97 KB (about 51 kbps) | `.m4a`, 15.2 s, 146 KB (about 77 kbps: iOS `AudioQuality.MEDIUM` appears not to honour the 48 kbps request exactly; check on a device) |
| Recorder with `allowsRecording: false` | works (Android ignores the flag) | **`recorder.record()` throws** (`FunctionCallException`): `allowsRecording: true` is mandatory on iOS |

Audio-mode notes (iOS), from the expo-audio SDK 57 types and docs; **audible routing is unverified** because the simulator run cannot be heard:

- `allowsRecording: true` switches the session to `.playAndRecord`.
- `shouldRouteThroughEarpiece` only has an effect with `allowsRecording: true`, and defaults to `false`, which routes to the speaker. Keep it `false` for the session so the karaoke video is not played quietly through the earpiece. This is the trap to check on a device.
- `playsInSilentMode: true` so the video is audible with the ring/silent switch on silent.
- `interruptionMode: 'mixWithOthers'` was used (the default) so the WebView's own audio is not interrupted; `doNotMix` was not tested.

## Defaults and reasons (original simulator/emulator reasoning; superseded by the verdict above where they differ)

**`PLAYER_MODE = embed-iframe-lib`** (player B config)
- Works on both platforms with the `nomadkaraoke.com` base URL, including the two error paths; the same setup without the base URL reproduces Error 153 on both platforms, confirming the 2025 referrer cause and the fix.
- Least code: `onReady`, `onChangeState`, `onError` and `getCurrentTime()` come ready-made, and no web deploy is needed.
- Known weaknesses to design around: (a) on Android the `play` prop did not pause the player in two trials (it worked on iOS), so do not rely on pause from the app on Android, or switch to the custom local-HTML player C (`injectJavaScript`) which worked on both platforms; (b) Error 153 surfaces as an `undefined` error, so treat any `onError` as "fall back to link-out"; (c) Android did not autoplay from the `play` prop before any tap in player A, so show a visible start affordance. All three are reasons the session should keep player C as the planned upgrade if B proves flaky on devices. Plain player A (lib defaults) must not be used.
- `linkout` remains the fallback when `onError` fires (ids 3 and 4 both gave 150).

**`RECORDING_SINK = aac-recorder`**
- Stream and recorder ran together on both platforms with the video playing and no stall, so a pitch stream plus a recorded take is feasible without keeping PCM in JS memory.
- The AAC file is small (about 6 to 10 KB/s) versus roughly 88 KB/s for 44.1 kHz int16 mono WAV (about 5.3 MB per minute).
- `wav-stream` (buffering `useAudioStream` frames) works too (byte counts matched exactly), so it is the fallback if the recorder misbehaves on a device.

## To check on a real phone / iPad (not done here)

1. Audio is actually audible and at normal volume from the embedded video: on Android speaker and headphones, on iOS speaker and headphones, with `allowsRecording: true` and `shouldRouteThroughEarpiece: false`, mic stream running. On iPhone confirm it does not drop to the earpiece.
2. Ringer switch on silent (iOS): video audible with `playsInSilentMode: true`.
3. Mic frames carry real signal on Android (the emulator mic is silent) and the stream RMS responds to singing.
4. Does the speaker audio of the video bleed into the mic stream and recording (expected; decide whether pitch tracking needs headphones or echo handling)?
5. Fullscreen and landscape on iOS (the simulator run could not tap), and device rotation on Android.
6. Programmatic pause on Android with player B on real WebView versions (reproduce the "play prop did not pause" case) versus player C.
7. First-play start: does the app have to show a native "Start" button that also calls `play`, or does the embedded Play affordance suffice on real iOS (simulator and emulator both allowed injected-JS autoplay; real iOS Safari engines can be stricter without a user gesture).
8. iOS recorder bitrate (about 77 kbps seen against the 48 kbps requested) and the actual file size per minute on device.
9. Incoming call, Bluetooth headset route change and app background behaviour (not tested).
10. Link-out opens the YouTube app on a phone that has it installed (universal link).

## Caveats

- The Android run used an emulator with software video decoding; the iOS run used the simulator. Neither is a substitute for a release build on a real phone (Andrew's phone was deliberately not touched).
- Metro on :8091, the collector, the Android emulator and the iOS simulator booted for this spike were all shut down afterwards.

## iPad (real device): iPad (A16), iPad15,7, iOS release build

Setup: team-signed Release build (embedded JS bundle, no Metro), `com.nomadkaraoke.ytspike`, installed over USB/devicectl, launched with `devicectl`. The app ran its own test sequence on launch and wrote events to a file in its Documents folder, which was read back with `devicectl device copy from`. No taps and no Mac mouse use. Logs: `nomad-yt-spike/shots/ipad-spike*.log`, screenshots `shots/ipad-*.png` (the iPad renders the karaoke video inline, lyrics visible, and the video advances). The microphone permission prompt appeared during the first recording run and was granted (it took about 11 s to be answered, apparently by a person; the spike cannot tap).

### Key questions

1. **Autoplay without a user gesture works on real iOS WebKit.** Player B (lib `play` prop true, after load) went unstarted, buffering, playing within about 1.5 s; player C (injected `playVideo()`) the same, for ids 0 and 1. Pause and resume worked for both (state 2 then 1). Player A (lib default hosted page) still cannot be controlled: ready fires, `play` does nothing.
2. **Error 153 reproduces without a base URL, and B and C fix it.** A0 (`useLocalHTML`, no `baseUrl`): ready, then an `undefined` error (the lib's map has no entry for 153). B and C with `baseUrl: https://nomadkaraoke.com` load and play. Non-embeddable id 3 and removed id 4: B gives `embed_not_allowed` and C gives raw `150`, both on the iPad, the same as the simulator and emulator.
3. **Mic frames carry signal while the video plays from the speaker.** Yes. Running RMS rose from about 0.004 (video paused, quiet room) to a cumulative average of about 0.023 and a max of 0.09 once the video played, which is consistent with the speaker audio bleeding into the mic. This also shows the video is audible on the speaker, but **audible volume and the earpiece/speaker route were not heard by a person: unverified**. Pitch tracking will see the backing track in the mic signal unless the singer uses headphones.
4. **Recorder bitrate: about 77 to 83 kbps**, not the 48 kbps requested (e.g. 145,659 B in 15.03 s = 77.5 kbps; 148,173 B in 15.02 s = 78.9 kbps; 135,003 B in 13.05 s = 82.7 kbps). iOS ignores `bitRate` with `AudioQuality.MEDIUM` for this AAC config; at 77 kbps a 3.5 minute take is about 2.0 MB. Frame bytes matched 44.1 kHz int16 mono exactly (183 frames = 1,613,796 B in about 19 s).

### Finding that the simulator hid: starting the mic stream pauses the video

- `setAudioModeAsync({ allowsRecording: true, ... })` alone does **not** pause the video.
- Starting `useAudioStream` pauses the embedded video about 1 s later (WebKit `state 2`, `currentTime` frozen). It happens with `interruptionMode` `mixWithOthers` and with `doNotMix`. The video stays paused until the app tells it to play again; it never recovers on its own while the stream runs (19 s observed).
- Starting only the recorder (no stream) does **not** pause the video, in any mode tried (`mixWithOthers`, `duckOthers`).
- Calling play again (injected `playVideo()`) resumes the video and it then keeps playing while the stream and recorder keep running.
- But frame delivery from the stream is fragile: if the video is resumed while only the stream is running, the stream's frames **stop arriving** (stuck at 30 or 80 frames; the stream still reports `streaming=true`). Restarting the stream pauses the video again and the same thing happens. Starting the recorder first and the stream second also starved (frames stuck at 30 after the video resumed, 2 of 2 runs).
- What worked, 4 of 4 runs: stream first, recorder started while the video is still paused, then resume the video. Frames kept flowing at about 10 per second (204, 198 and 204 frames in about 20 s, 284 in a 36 s run) with the video playing, the recorder file was the full length (about 15 s, 145 KB), and the video advanced normally. Why the recorder rescues the stream was not investigated (likely the recorder's session keeps the capture engine alive through the playback activation); treat the order as a recipe to re-verify on any iOS update.
- Consequence for the app: after `stream.start()` the app must (a) expect a pause event, (b) start the recorder, then (c) re-issue play. Player C's `injectJavaScript` does this deterministically. With player B the lib's `play` is a prop that is already `true`, so resuming means toggling it false then true (not tested on the device with the stream running).
- Android did not show this: the emulator video kept playing when the stream started (the emulator mic is silent, so this is not confirmed with a real mic on a real phone).

### iPad table

| Check | Result |
|---|---|
| A (lib default) | loads, ready fires; cannot be started or paused by the `play` prop |
| A0 (no base URL) | Error 153 (ready, then `undefined` error) |
| B | plays by prop with no gesture, pause and resume work, error `embed_not_allowed` for ids 3 and 4 |
| C | plays by injected JS with no gesture, pause and resume work, error 150 for ids 3 and 4, ids 0 and 1 played |
| Mic permission prompt | appears on first use, granted |
| Stream + recorder + video | works only with the order above; mic stream alone starves |
| Recorder | AAC `.m4a`, about 77 to 83 kbps |
| Fullscreen / landscape / earpiece-vs-speaker audio | not tested, unverified |

### Updated real-device checklist

Items 1 (audible volume and route), 5 (iOS fullscreen and landscape) and 7 (first-play gesture) from the earlier list: autoplay (item 7) is now verified on the iPad; the rest remain. New: verify the stream, recorder, resume order on an iPhone and on iOS betas; verify the same behaviour (stream pause) on a real Android phone with a real mic; verify headphone playback (with a Bluetooth route the stream/recorder session may behave differently); measure echo bleed with headphones off.
