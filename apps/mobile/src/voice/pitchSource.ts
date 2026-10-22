/** One chunk of mono PCM from a pitch source. `timestamp` is seconds since the source started. */
export type PcmBuffer = { samples: Float32Array; sampleRate: number; timestamp: number };
export type MicPermission = 'granted' | 'denied' | 'blocked';
/** Which part of the voice test is running. The mic ignores it; the fake source plays that part of its file. */
export type VoiceSection = 'low' | 'high' | 'sing';

export interface PitchSource {
  kind: 'mic' | 'fake';
  requestPermission(): Promise<MicPermission>;
  start(onBuffer: (b: PcmBuffer) => void, section: VoiceSection): Promise<void>;
  stop(): void;
}
