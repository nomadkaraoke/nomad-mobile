// Plays one private voice recording at a time (the admin debug screen, Me's "Your recordings"; later the quiz's
// falsetto catch-up): a decide recording is downloaded with the bearer header to a temp file and played from there
// (decide streams without Range), a take still on the phone plays as-is. Optional segment: fromS / toS.
import { useAudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/store';

export type PlaybackState = { key: string | null; status: 'idle' | 'loading' | 'playing' | 'failed' };

export type PlayOptions = {
  /** Seconds into the take to start from (clamped at 0). */
  fromS?: number;
  /** Seconds into the take to stop at. */
  toS?: number;
  /** A take still on the phone: played directly, never downloaded or deleted. */
  localUri?: string;
  /** What `state.key` reports (default: the recording id), e.g. one row of several segments of one take. */
  key?: string;
};

export type RecordingPlaybackOptions = {
  /** The cache sub-directory for downloads, swept when the hook mounts (one per screen). */
  dirName?: string;
};

const IDLE: PlaybackState = { key: null, status: 'idle' };
// Fine enough for a segment's stop (the quiz catch-up pads its segments by 0.5 s).
const UPDATE_INTERVAL_MS = 100;

/** `.wav` for RIFF....WAVE, otherwise `.m4a` (the app's AAC takes carry an `ftyp` box at offset 4). */
export function audioExtension(head: Uint8Array): 'wav' | 'm4a' {
  const at = (o: number, s: string) => [...s].every((c, i) => head[o + i] === c.charCodeAt(0));
  return head.length >= 12 && at(0, 'RIFF') && at(8, 'WAVE') ? 'wav' : 'm4a';
}

/** A file-name-safe stem for a recording id (ids may contain `:`). */
const stem = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * `play(id, opts)` starts a recording (stopping the one before), `stop()` stops it. A downloaded temp file is deleted
 * when its playback ends, another one starts, `stop()` runs or the hook unmounts; files left by a crash are swept on
 * mount. `urlFor(id)` is the audio URL (e.g. `voiceRecordingAudioUrl`; pass a stable function).
 */
export function useRecordingPlayback(urlFor: (id: string) => string, options: RecordingPlaybackOptions = {}) {
  const dirName = options.dirName ?? 'voice-playback';
  const player = useAudioPlayer(null, { updateInterval: UPDATE_INTERVAL_MS });
  const [state, setState] = useState<PlaybackState>(IDLE);
  const file = useRef<File | null>(null);
  const stopAt = useRef<number | null>(null);
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
    try {
      const dir = new Directory(Paths.cache, dirName);
      if (dir.exists) dir.delete();
    } catch {
      // Nothing to sweep.
    }
  }, [dirName]);

  useEffect(() => {
    const runs = run; // the counter itself: the cleanup must bump the live value
    const end = () => {
      stopAt.current = null;
      discard();
      setState(IDLE);
    };
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) return end();
      if (stopAt.current !== null && s.currentTime >= stopAt.current) {
        runs.current++;
        try {
          player.pause();
        } catch {
          // Released.
        }
        end();
      }
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

  const stop = useCallback(() => {
    run.current++;
    stopAt.current = null;
    try {
      player.pause();
    } catch {
      // Released.
    }
    discard();
    setState(IDLE);
  }, [player, discard]);

  const play = useCallback(
    async (id: string, opts: PlayOptions = {}) => {
      const mine = ++run.current;
      const key = opts.key ?? id;
      stopAt.current = null;
      player.pause();
      discard();
      setState({ key, status: 'loading' });
      try {
        let uri: string;
        if (opts.localUri) {
          uri = opts.localUri;
        } else {
          const dir = new Directory(Paths.cache, dirName);
          if (!dir.exists) dir.create();
          const token = useAuth.getState().getToken();
          // decide sends a Content-Type but no filename, so the extension is sniffed below.
          const downloaded = await File.downloadFileAsync(urlFor(id), new File(dir, `${stem(id)}.bin`), {
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
          downloaded.rename(`${stem(id)}.${audioExtension(head)}`);
          uri = downloaded.uri;
        }
        player.replace(uri);
        if (opts.fromS !== undefined) await player.seekTo(Math.max(0, opts.fromS));
        if (mine !== run.current) return;
        stopAt.current = opts.toS ?? null;
        player.play();
        setState({ key, status: 'playing' });
      } catch {
        if (mine === run.current) setState({ key, status: 'failed' });
      }
    },
    [player, discard, dirName, urlFor],
  );

  return { state, play, stop };
}
