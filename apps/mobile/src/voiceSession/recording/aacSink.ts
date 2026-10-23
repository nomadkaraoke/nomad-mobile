import { AudioQuality, IOSOutputFormat, type AudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import type { FinishedRecording } from './wavSink';

/**
 * The session's recording (RECORDING_SINK `aac-recorder`, D1 spike): AAC-LC mono 44.1 kHz, 48 kbps requested. iOS
 * ignores the bit rate with `AudioQuality.MEDIUM` and writes about 77–83 kbps (iPad, D1), which is accepted (about
 * 2 MB for a 3.5 minute song). Kept in the app's documents (not the cache) so a queued upload's file is not purged.
 */
export const AAC_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 48000,
  directory: 'document',
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/mp4', bitsPerSecond: 48000 },
};

export type AacSink = {
  /** Prepares and starts the recorder. */
  start(): Promise<void>;
  /** Stops the recorder: the finished file, or null when the recorder gave no file. */
  finish(): Promise<FinishedRecording | null>;
  /** Stops the recorder and deletes its file (a keep-alive take without consent, or an abandoned one). */
  discard(): Promise<void>;
};

const deleteQuietly = (uri: string | null) => {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
};

/** One take on expo-audio's recorder (from `useAudioRecorder(AAC_RECORDING_OPTIONS)`). */
export function createAacSink(recorder: AudioRecorder): AacSink {
  let started = false;
  let stopped = false;

  const stop = async (): Promise<number> => {
    if (!started || stopped) return 0;
    stopped = true;
    const durationS = recorder.getStatus().durationMillis / 1000;
    await recorder.stop();
    return durationS;
  };

  return {
    async start() {
      await recorder.prepareToRecordAsync();
      recorder.record();
      started = true;
    },
    async finish() {
      const durationS = await stop();
      const uri = recorder.uri;
      if (!uri) return null;
      return { uri, durationS, bytes: new File(uri).size };
    },
    async discard() {
      try {
        await stop();
      } finally {
        deleteQuietly(recorder.uri);
      }
    },
  };
}
