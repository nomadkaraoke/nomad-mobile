import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { useMemo, useRef } from 'react';
import type { MicPermission, PcmBuffer, PitchSource } from './pitchSource';

/** Live microphone PCM via expo-audio's native stream (SDK 57 `useAudioStream`). Ignores `section`. */
export function useMicPitchSource(): PitchSource {
  const sink = useRef<((b: PcmBuffer) => void) | null>(null);
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

  return useMemo<PitchSource>(
    () => ({
      kind: 'mic',
      async requestPermission(): Promise<MicPermission> {
        const r = await requestRecordingPermissionsAsync();
        if (r.granted) return 'granted';
        return r.canAskAgain ? 'denied' : 'blocked';
      },
      async start(onBuffer) {
        sink.current = onBuffer;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await stream.start();
      },
      stop() {
        sink.current = null;
        stream.stop();
        // Fire and forget: leaving recording mode must not block the UI, and a failure here is harmless.
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      },
    }),
    [stream],
  );
}
