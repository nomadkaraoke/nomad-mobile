import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { useEffect, useMemo, useRef } from 'react';
import type { MicPermission, PcmBuffer, PitchSource } from './pitchSource';

/** Live microphone PCM via expo-audio's native stream (SDK 57 `useAudioStream`). Ignores `section`. */
export function useMicPitchSource(): PitchSource {
  const sink = useRef<((b: PcmBuffer) => void) | null>(null);
  const gen = useRef(0);
  const running = useRef(false);
  const { stream } = useAudioStream({
    sampleRate: 48000,
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
      const leaveRecordingMode = () => {
        // Fire and forget: leaving recording mode must not block the UI, and a failure here is harmless.
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      };
      const stop = () => {
        gen.current++;
        running.current = false;
        sink.current = null;
        stream.stop();
        leaveRecordingMode();
      };
      return {
        kind: 'mic',
        async requestPermission(): Promise<MicPermission> {
          const r = await requestRecordingPermissionsAsync();
          if (r.granted) return 'granted';
          return r.canAskAgain ? 'denied' : 'blocked';
        },
        async start(onBuffer) {
          const mine = ++gen.current;
          running.current = true;
          sink.current = onBuffer;
          // A stop() during either await bumps gen: undo what this start already did and bail out.
          const stale = () => {
            if (gen.current === mine) return false;
            if (!running.current) {
              stream.stop();
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
