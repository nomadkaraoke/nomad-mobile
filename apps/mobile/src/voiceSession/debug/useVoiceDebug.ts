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
  // The admin endpoints 403 for anyone else: never ask unless decide's flags say this user is an admin.
  const isAdmin = useVoiceFlags().data?.is_admin === true;
  return useQuery<UserSongOut[]>({
    queryKey: ['voiceSession', 'debugSongs', email],
    enabled: !!email && isAdmin,
    queryFn: () => adminVoiceSongs(email as string),
    retry: false,
  });
}

const DIR_NAME = 'voice-debug';

/** `.wav` for RIFF....WAVE, otherwise `.m4a` (the app's AAC takes carry an `ftyp` box at offset 4). */
export function audioExtension(head: Uint8Array): 'wav' | 'm4a' {
  const at = (o: number, s: string) => [...s].every((c, i) => head[o + i] === c.charCodeAt(0));
  return head.length >= 12 && at(0, 'RIFF') && at(8, 'WAVE') ? 'wav' : 'm4a';
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

  // Files left by a crash or a kill are swept when the screen opens.
  useEffect(() => {
    try {
      const dir = new Directory(Paths.cache, DIR_NAME);
      if (dir.exists) dir.delete();
    } catch {
      // Nothing to sweep.
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
        const dir = new Directory(Paths.cache, DIR_NAME);
        if (!dir.exists) dir.create();
        const token = useAuth.getState().getToken();
        // Its own path per take; decide sends a Content-Type but no filename, so the extension is sniffed below.
        const downloaded = await File.downloadFileAsync(adminRecordingUrl(recordingId), new File(dir, `${recordingId}.bin`), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          idempotent: true,
        });
        if (mine !== run.current) {
          // A newer take (or the unmount) owns the player now: only drop what this download left.
          try {
            downloaded.delete();
          } catch {
            // Already gone.
          }
          return;
        }
        file.current = downloaded;
        const handle = downloaded.open();
        let head: Uint8Array;
        try {
          head = handle.readBytes(12);
        } finally {
          handle.close();
        }
        downloaded.rename(`${recordingId}.${audioExtension(head)}`);
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
