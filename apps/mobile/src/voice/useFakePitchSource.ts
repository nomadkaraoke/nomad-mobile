import { parseWav } from '@nomad/core';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useEffect, useMemo } from 'react';
import { FAKE_MIC } from '../config';
import type { MicPermission, PcmBuffer, PitchSource, VoiceSection } from './pitchSource';

/** Seconds [from, to) of the fake recording each voice-test section plays. */
export const FAKE_MIC_SECTIONS: Record<VoiceSection, [number, number]> = {
  low: [0, 4.4],
  high: [4.4, 7.2],
  sing: [7.2, 14.4],
  // A voice-session song: the sing part, looped (see LOOPED).
  song: [7.2, 14.4],
};

/** Sections that start again from their beginning instead of going quiet at their end. */
const LOOPED: ReadonlySet<VoiceSection> = new Set(['song']);

const FAKE_MIC_FILES: Record<string, number> = {
  'baritone-scale': require('../../assets/fake-mic/baritone-scale.wav'),
};

const BUFFER_SAMPLES = 1600;
const TICK_MS = 100;

/**
 * E2E-only source: plays a bundled synthetic WAV in 100 ms real-time chunks. Each start() plays that section's
 * slice from its beginning and then goes quiet (the step's own timeout or Done applies); `song` loops its slice until
 * stop(), its timestamps still counting up from 0.
 */
export function createFakePitchSource(name: string): PitchSource {
  const module = FAKE_MIC_FILES[name];
  if (module === undefined) throw new Error('unknown fake mic');

  let wav: Promise<{ sampleRate: number; samples: Float32Array }> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const load = () =>
    (wav ??= (async () => {
      const asset = await Asset.fromModule(module).downloadAsync();
      return parseWav(await new File(asset.localUri ?? asset.uri).bytes());
    })());

  let gen = 0;
  const stop = () => {
    gen++;
    if (timer) clearInterval(timer);
    timer = null;
  };

  return {
    kind: 'fake',
    async requestPermission(): Promise<MicPermission> {
      return 'granted';
    },
    async start(onBuffer, section) {
      stop();
      const mine = gen;
      const { sampleRate, samples } = await load();
      if (gen !== mine) return; // stop() or a newer start() landed while the asset loaded
      const [from, to] = FAKE_MIC_SECTIONS[section];
      const start = Math.round(from * sampleRate);
      const end = Math.min(samples.length, Math.round(to * sampleRate));
      const loop = LOOPED.has(section);
      let pos = start;
      let emitted = 0;
      timer = setInterval(() => {
        if (pos >= end) {
          if (!loop) return stop();
          pos = start;
        }
        const chunk: PcmBuffer = {
          samples: samples.slice(pos, Math.min(end, pos + BUFFER_SAMPLES)),
          sampleRate,
          timestamp: emitted / sampleRate,
        };
        pos += BUFFER_SAMPLES;
        emitted += chunk.samples.length;
        onBuffer(chunk);
      }, TICK_MS);
    },
    stop,
  };
}

/** The recording named by FAKE_MIC (config.ts; only ever set against a local stack). */
export function useFakePitchSource(): PitchSource {
  const source = useMemo(() => createFakePitchSource(FAKE_MIC ?? 'baritone-scale'), []);
  useEffect(() => () => source.stop(), [source]);
  return source;
}
