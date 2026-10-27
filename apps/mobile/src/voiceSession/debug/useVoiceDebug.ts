// The hidden admin voice debug screen's data (Phase 3d B3): decide's flags and the admin's own songs view (the
// private-recording player is the shared `recording/useRecordingPlayback`). The admin endpoints need an admin decide
// user (the gen session token the app sends).
import { adminVoiceSongs, getVoiceFlags, type UserSongOut } from '@nomad/api-decide';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../auth/store';

const FLAGS_KEY = ['voiceSession', 'flags'] as const;

/** decide's voice-session flags for the signed-in user (`is_admin` gates the debug screen). */
export function useVoiceFlags() {
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  return useQuery({ queryKey: [...FLAGS_KEY, email], enabled: !!email, queryFn: getVoiceFlags, retry: false });
}

/** Every song the signed-in admin labelled or attempted, with voice.db markers and the model's prediction. */
export function useVoiceDebugSongs() {
  const email = useAuth((s) => (s.state.status === 'signedIn' ? s.state.session.email : null));
  // The admin endpoints 403 for anyone else: never ask unless decide's flags say this user is an admin.
  const isAdmin = useVoiceFlags().data?.is_admin === true;
  return useQuery<UserSongOut[]>({
    queryKey: ['voiceSession', 'debugSongs', email],
    enabled: !!email && isAdmin,
    queryFn: () => adminVoiceSongs(email as string),
    retry: false,
  });
}
