import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type PermissionResponse,
} from 'expo-audio';
import { useEffect, useMemo, useRef } from 'react';
import { PLAYBACK_AUDIO_MODE } from '../audio/playbackMode';
import type { MicPermission, PcmBuffer, PitchSource } from './pitchSource';

/**
 * Requested capture rate. 16 kHz is plenty for singing pitch (MAX_HZ 2000 is far below Nyquist) and is a third of the
 * frames per second of 48 kHz, so pitch detection and held-note tracking cost a third of the JS time. expo-audio 57
 * honours it on both platforms: iOS converts the hardware rate with an AVAudioConverter (or, if it cannot build one,
 * delivers the hardware rate), Android opens AudioRecord at 16 kHz (or falls back to a supported rate). Either way the
 * buffer reports its actual `sampleRate` and the framer adapts, so an ignored request only costs CPU.
 */
export const MIC_SAMPLE_RATE = 16000;

/**
 * The mode set when the test stops: playback, exactly as `ensurePlaybackAudioMode` sets it, with recording off. A
 * partial `{ allowsRecording: false }` is NOT enough on iOS: every field left out falls back to the native default,
 * so `playsInSilentMode` becomes false and the ringer switch then mutes review and preview playback. And
 * `ensurePlaybackAudioMode` runs once per launch, so it would never put it back.
 */
export const AFTER_RECORDING_AUDIO_MODE = { ...PLAYBACK_AUDIO_MODE, allowsRecording: false } as const;

const toMicPermission = (r: Pick<PermissionResponse, 'granted' | 'canAskAgain'>): MicPermission =>
  r.granted ? 'granted' : r.canAskAgain ? 'denied' : 'blocked';

/** Live microphone PCM via expo-audio's native stream (SDK 57 `useAudioStream`). Ignores `section`. */
export function useMicPitchSource(): PitchSource {
  const sink = useRef<((b: PcmBuffer) => void) | null>(null);
  const gen = useRef(0);
  const running = useRef(false);
  const { stream } = useAudioStream({
    sampleRate: MIC_SAMPLE_RATE,
    channels: 1,
    encoding: 'float32',
    onBuffer: (buf) => {
      const out = sink.current;
      if (!out) return;
      const all = new Float32Array(buf.data);
      let samples = all;
      if (buf.channels > 1) {
        // Interleaved [L, R, L, R...]: keep channel 0.
        samples = new Float32Array(Math.floor(all.length / buf.channels));
        for (let i = 0; i < samples.length; i++) samples[i] = all[i * buf.channels]!;
      }
      out({ samples, sampleRate: buf.sampleRate, timestamp: buf.timestamp });
    },
  });

  const source = useMemo<PitchSource>(
    () => {
      // expo-audio releases the native stream in its own unmount cleanup, which runs before ours: stop() on a
      // released stream throws ERR_USING_RELEASED_SHARED_OBJECT, and a throw in an unmount cleanup closes the
      // release app (found on a release APK). The release already stopped capture, so the error is safe to drop.
      const stopStream = () => {
        try {
          stream.stop();
        } catch {
          // Already released.
        }
      };
      const leaveRecordingMode = () => {
        // Fire and forget: leaving recording mode must not block the UI, and a failure here is harmless.
        void setAudioModeAsync(AFTER_RECORDING_AUDIO_MODE).catch(() => {});
      };
      const stop = () => {
        gen.current++;
        running.current = false;
        sink.current = null;
        stopStream();
        leaveRecordingMode();
      };
      return {
        kind: 'mic',
        async requestPermission(): Promise<MicPermission> {
          return toMicPermission(await requestRecordingPermissionsAsync());
        },
        async checkPermission(): Promise<MicPermission> {
          return toMicPermission(await getRecordingPermissionsAsync());
        },
        async start(onBuffer) {
          const mine = ++gen.current;
          running.current = true;
          sink.current = onBuffer;
          // A stop() during either await bumps gen: undo what this start already did and bail out.
          const stale = () => {
            if (gen.current === mine) return false;
            if (!running.current) {
              stopStream();
              leaveRecordingMode();
            }
            return true;
          };
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          if (stale()) return;
          await stream.start();
          stale();
        },
        stop,
      };
    },
    [stream],
  );
  useEffect(() => () => source.stop(), [source]);
  return source;
}
