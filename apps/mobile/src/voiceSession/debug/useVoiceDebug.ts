// The hidden admin voice debug screen's data (Phase 3d B3): decide's flags, the admin's own songs view and the
// private-recording player. The admin endpoints need an admin decide user (the gen session token the app sends).
import { adminRecordingUrl, adminVoiceSongs, getVoiceFlags, type UserSongOut } from '@nomad/api-decide';
import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  return useQuery<UserSongOut[]>({
    queryKey: ['voiceSession', 'debugSongs', email],
    enabled: !!email,
    queryFn: () => adminVoiceSongs(email as string),
    retry: false,
  });
}

export type PlaybackState = { key: string | null; status: 'idle' | 'loading' | 'playing' | 'failed' };

/**
 * Plays one private recording at a time: downloads it with the decide bearer header to a temp file, plays that, and
 * deletes the file when playback ends, another one starts, or the screen unmounts.
 */
export function useRecordingPlayback() {
  const player = useAudioPlayer(null);
  const [state, setState] = useState<PlaybackState>({ key: null, status: 'idle' });
  const file = useRef<File | null>(null);
  const run = useRef(0);

  const discard = useCallback(() => {
    const f = file.current;
    file.current = null;
    try {
      f?.delete();
    } catch {
      // Already gone.
    }
  }, []);

  useEffect(() => {
    const runs = run; // the counter itself (not a DOM node): the cleanup must bump the live value
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (!s.didJustFinish) return;
      discard();
      setState({ key: null, status: 'idle' });
    });
    return () => {
      runs.current++;
      sub.remove();
      try {
        player.pause();
      } catch {
        // The player is already released.
      }
      discard();
    };
  }, [player, discard]);

  /** Starts `recordingId`'s audio, or stops it when it is the one playing. */
  const toggle = useCallback(
    async (key: string, recordingId: string) => {
      const mine = ++run.current;
      player.pause();
      discard();
      if (state.key === key && state.status !== 'failed') {
        setState({ key: null, status: 'idle' });
        return;
      }
      setState({ key, status: 'loading' });
      try {
        const dir = new Directory(Paths.cache, 'voice-debug');
        if (!dir.exists) dir.create();
        const token = useAuth.getState().getToken();
        const downloaded = await File.downloadFileAsync(adminRecordingUrl(recordingId), dir, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          idempotent: true,
        });
        file.current = downloaded;
        if (mine !== run.current) {
          discard();
          return;
        }
        player.replace(downloaded.uri);
        player.play();
        setState({ key, status: 'playing' });
      } catch {
        if (mine === run.current) setState({ key, status: 'failed' });
      }
    },
    [player, discard, state],
  );

  return { state, toggle };
}
