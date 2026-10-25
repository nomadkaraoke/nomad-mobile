import { VoiceSessionFlow } from '../../voiceSession/VoiceSessionFlow';

/** "Find your voice" (Phase 3d spec §4): the singing session, as a modal over Discover or Me. */
export default function VoiceSessionRoute() {
  return <VoiceSessionFlow />;
}
