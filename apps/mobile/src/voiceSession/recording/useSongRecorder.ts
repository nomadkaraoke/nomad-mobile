import {
  findHeldNotes,
  gateFrames,
  summarizeSongPitch,
  type PitchFrame,
  type PitchSummary,
  type VoicedFrame,
} from '@nomad/core';
import type { VoiceRecordingContentType } from '@nomad/api-decide';
import { setAudioModeAsync, useAudioRecorder, type AudioMode } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { createFramer } from '../../voice/framer';
import type { PitchSource } from '../../voice/pitchSource';
import { AAC_RECORDING_OPTIONS, createAacSink, type AacSink } from './aacSink';
import { createWavSink, type WavSink } from './wavSink';

/**
 * The audio session while a song plays with the mic on (D1 spike): `.playAndRecord`, audible with the ring switch on
 * silent, the video on the speaker (not the earpiece), mixing with the WebView's own audio.
 */
export const SESSION_AUDIO_MODE = {
  allowsRecording: true,
  playsInSilentMode: true,
  shouldRouteThroughEarpiece: false,
  interruptionMode: 'mixWithOthers',
} as const satisfies Partial<AudioMode>;

/** `aac`: expo-audio's recorder (RECORDING_SINK default). `wav`: the stream's own PCM (the fake mic, and the fallback). */
export type SongSink = 'aac' | 'wav';
export type SongRecording = { uri: string; durationS: number; contentType: VoiceRecordingContentType };
export type SongTake = { pitch: PitchSummary | null; file: SongRecording | null };
export type SongRecorderOptions = {
  /** The session's recording consent: without it no recording is kept. */
  record: boolean;
  /** The noise floor measured on the setup screen (frames at or under it are not singing). */
  floor: number;
  /** Default `aac`; a fake source always records `wav`. */
  sink?: SongSink;
};

/** livePitch updates at most this often (in audio time). */
const LIVE_PITCH_INTERVAL_S = 1 / 15;
const EMPTY: SongTake = { pitch: null, file: null };

/** Where WAV takes are written (documents, so a queued upload's file is not purged with the cache). */
const wavDir = () => new Directory(Paths.document, 'voice-recordings').uri;

type Run = {
  stopped: boolean;
  gated: VoicedFrame[];
  wav: WavSink | null;
  aac: AacSink | null;
  /** The AAC take only keeps the iOS stream alive (no consent): it is deleted, never returned. */
  aacKeepAliveOnly: boolean;
};

const deleteQuietly = (uri: string) => {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
};

const warn = (what: string, e: unknown) => console.warn(`[song recorder] ${what}: ${String(e)}`);

/**
 * One song's capture: a single stream from `source` feeds the pitch framer (live pitch and the song's pitch summary)
 * and, with consent, the recording.
 */
export function useSongRecorder(
  source: PitchSource,
  opts: SongRecorderOptions,
): { start(): Promise<void>; stop(): Promise<SongTake>; livePitch: number | null } {
  const recorder = useAudioRecorder(AAC_RECORDING_OPTIONS);
  const [livePitch, setLivePitch] = useState<number | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const run = useRef<Run | null>(null);

  const api = useMemo(() => {
    /**
     * Starts pitch tracking and, with consent, the recording. Resolves once everything is running; only then may the
     * caller (re)start the video.
     *
     * iOS start order (D1 spike, iPad, 4 of 4 runs; docs/superpowers/specs/2026-10-22-mobile-phase3d-spike-results.md
     * § iPad): 1. the audio mode, 2. the mic stream (the OS pauses the embedded video about 1 s later), 3. the AAC
     * recorder while the video is still paused, 4. the caller resumes the video. A stream on its own stops delivering
     * frames once the video resumes, and recorder-then-stream starved too; the recorder started after the stream
     * keeps it alive. So on iOS the recorder runs even without consent, and that take is deleted at stop.
     */
    const start = async (): Promise<void> => {
      if (run.current) {
        // A start() over a running take abandons it: its file is never queued, so delete it.
        const old = await stop();
        if (old.file) deleteQuietly(old.file.uri);
      }
      const { record, floor, sink: wanted } = optsRef.current;
      const sink: SongSink = source.kind === 'fake' ? 'wav' : (wanted ?? 'aac');
      const r: Run = { stopped: false, gated: [], wav: null, aac: null, aacKeepAliveOnly: false };
      run.current = r;
      let lastPitchT = -Infinity;
      const framer = createFramer((f: PitchFrame) => {
        const [v] = gateFrames([f], floor);
        if (v) r.gated.push(v);
        if (f.t - lastPitchT >= LIVE_PITCH_INTERVAL_S) {
          lastPitchT = f.t;
          setLivePitch(v ? v.midi : null);
        }
      });
      // Stopped while start() awaited: stop the stream unless a newer run owns the source.
      const abandoned = () => {
        if (!r.stopped) return false;
        if (run.current === null) source.stop();
        return true;
      };

      try {
        // 1. Audio mode (a real mic only: the fake source records nothing from the device).
        if (source.kind === 'mic') {
          await setAudioModeAsync(SESSION_AUDIO_MODE);
          if (abandoned()) return;
        }
        if (record && sink === 'wav') r.wav = createWavSink(wavDir());
        // 2. The stream: pitch frames, and the WAV take when that is the sink.
        await source.start((b) => {
          if (r.stopped) return;
          framer.push(b);
          r.wav?.push(b);
        }, 'song');
        if (abandoned()) return;
      } catch (e) {
        r.stopped = true;
        if (run.current === r) run.current = null;
        source.stop();
        r.wav?.abort();
        throw e;
      }

      // 3. The AAC recorder, after the stream (see above). Android needs it only with consent.
      if (sink === 'aac' && (record || Platform.OS === 'ios')) {
        const aac = createAacSink(recorder);
        try {
          await aac.start();
        } catch (e) {
          // Pitch still works; this song just has no recording.
          warn('recorder did not start', e);
          await aac.discard().catch(() => {});
          return;
        }
        if (r.stopped) {
          await aac.discard().catch((e) => warn('discard failed', e));
          return;
        }
        r.aac = aac;
        r.aacKeepAliveOnly = !record;
      }
    };

    /** Stops everything: the song's pitch summary and, with consent, the recording (null without one). */
    const stop = async (): Promise<SongTake> => {
      const r = run.current;
      if (!r) return EMPTY;
      run.current = null;
      r.stopped = true;
      setLivePitch(null);
      let file: SongRecording | null = null;
      // The recorder first: stopping the source leaves recording mode, which must not cut the take short.
      if (r.aac) {
        if (r.aacKeepAliveOnly) {
          await r.aac.discard().catch((e) => warn('discard failed', e));
        } else {
          try {
            const f = await r.aac.finish();
            if (f) file = { uri: f.uri, durationS: f.durationS, contentType: 'audio/mp4' };
          } catch (e) {
            warn('recorder did not finish', e);
            await r.aac.discard().catch(() => {});
          }
        }
      }
      source.stop();
      if (r.wav) {
        try {
          const f = await r.wav.finish();
          file = { uri: f.uri, durationS: f.durationS, contentType: 'audio/wav' };
        } catch (e) {
          warn('wav did not finish', e);
          r.wav.abort();
        }
      }
      return { pitch: summarizeSongPitch(r.gated, findHeldNotes(r.gated)), file };
    };

    return { start, stop };
  }, [source, recorder]);

  useEffect(
    () => () => {
      const r = run.current;
      if (!r) return;
      run.current = null;
      r.stopped = true;
      source.stop();
      r.wav?.abort();
      void r.aac?.discard().catch(() => {});
    },
    [source],
  );

  return { start: api.start, stop: api.stop, livePitch };
}
