import { useImperativeHandle, useRef, type Ref } from 'react';
import { View } from 'react-native';

import { FAKE_YT } from '../../config';
import { FakePlayer } from './FakePlayer';
import { LinkOutPlayer } from './LinkOutPlayer';
import type { PlayerMode } from './playerMode';
import { YouTubeEmbed } from './YouTubeEmbed';

/** What a voice session player reports. `unplayable` carries YouTube's error code (or 'unknown'). */
export type PlayerEvent = { kind: 'ready' } | { kind: 'playing' } | { kind: 'ended' } | { kind: 'unplayable'; code: number | string };

/** Start / pause the video. The link-out card ignores both (the video plays in the YouTube app). */
export interface PlayerHandle {
  play(): void;
  pause(): void;
}
export type KaraokePlayerHandle = PlayerHandle;

export type KaraokePlayerProps = {
  videoId: string;
  /** The song's length in seconds, when known (the link-out reminder fires at this + 10 s). */
  durationS: number | null;
  mode: PlayerMode;
  onEvent: (e: PlayerEvent) => void;
  testID?: string;
  ref?: Ref<KaraokePlayerHandle>;
};

/**
 * The voice session's karaoke video: `YouTubeEmbed` (`embed-hosted`), `LinkOutPlayer` (`linkout`), or `FakePlayer`
 * when `FAKE_YT` is on (E2E, local builds only; it wins over the mode).
 *
 * **Start order (iOS, verified on a real iPad, spike D1).** Starting the mic stream pauses an embedded video about
 * 1 s later, and resuming it while only the stream runs starves the stream's frames. So the player never starts by
 * itself: it reports `ready` and waits. The caller then sets the audio mode, starts the stream, starts the recorder
 * (D4's `useSongRecorder` enforces mode → stream → recorder) and only then calls `play()` through the ref. `pause()`
 * is there for the same dance if the session ever needs to restart capture mid-song.
 *
 * Events: `ready` once loaded, `playing` the first time the video plays (link-out: once YouTube is opened), `ended`
 * at the end (link-out: on returning to the app or "I'm back"), and `unplayable` for any embed error; the caller skips
 * the version (`not_embeddable`). After `ended` or `unplayable` nothing more is reported.
 */
export function KaraokePlayer({ videoId, durationS, mode, onEvent, testID, ref }: KaraokePlayerProps) {
  const inner = useRef<PlayerHandle>(null);
  useImperativeHandle(ref, () => ({ play: () => inner.current?.play(), pause: () => inner.current?.pause() }), []);

  // Keyed by video: a new song (or version) starts a fresh player with its own ready / playing / ended.
  let player;
  if (FAKE_YT) player = <FakePlayer key={videoId} ref={inner} onEvent={onEvent} />;
  else if (mode === 'linkout') player = <LinkOutPlayer key={videoId} videoId={videoId} durationS={durationS} onEvent={onEvent} />;
  else player = <YouTubeEmbed key={videoId} ref={inner} videoId={videoId} onEvent={onEvent} />;

  return <View testID={testID}>{player}</View>;
}
