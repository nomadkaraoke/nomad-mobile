/** One chunk of mono PCM from a pitch source. `timestamp` is seconds since the source started. */
export type PcmBuffer = { samples: Float32Array; sampleRate: number; timestamp: number };
export type MicPermission = 'granted' | 'denied' | 'blocked';
/**
 * Which part of the voice test is running, or `song` (a voice-session song, Phase 3d). The mic ignores it; the fake
 * source plays that part of its file (`song` = the `sing` part, looped until stop()).
 */
export type VoiceSection = 'low' | 'high' | 'sing' | 'song';

export interface PitchSource {
  kind: 'mic' | 'fake';
  requestPermission(): Promise<MicPermission>;
  /** The current permission without ever prompting (undetermined reads as 'denied'). */
  checkPermission(): Promise<MicPermission>;
  start(onBuffer: (b: PcmBuffer) => void, section: VoiceSection): Promise<void>;
  /**
   * Never throws: it can run from unmount cleanups and timers after expo-audio has released the native stream (the mic
   * source drops ERR_USING_RELEASED_SHARED_OBJECT itself, 3c 8d913d6), and a throw there closes the release app.
   */
  stop(): void;
}
