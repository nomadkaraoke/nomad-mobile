import { FAKE_MIC } from '../config';
import type { PitchSource } from './pitchSource';
import { useFakePitchSource } from './useFakePitchSource';
import { useMicPitchSource } from './useMicPitchSource';

/** The fake recording when FAKE_MIC is set (E2E against a local stack only), else the real microphone. */
export function usePitchSource(): PitchSource {
  // FAKE_MIC is a build-time constant, so the same hook runs on every render (the rules-of-hooks lint can't see that).
  const useSource = FAKE_MIC ? useFakePitchSource : useMicPitchSource;
  return useSource();
}
