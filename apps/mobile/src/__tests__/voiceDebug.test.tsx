// Hidden admin voice debug screen at /me/voice-debug (Phase 3d Task B3): markers next to the sheet label,
// attempts with their recordings, the prediction; the Me row only for admins.
import * as decide from '@nomad/api-decide';
import { isolate } from '@nomad/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { File } from 'expo-file-system';
import { View } from 'react-native';

import { useAuth } from '../auth/store';
import { gen, session } from '../test-utils/genAuthMock';
import { appRoutes } from '../test-utils/routes';

jest.setTimeout(20_000);

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  popularSongs: jest.fn(async () => []),
  pingSearch: jest.fn(async () => true),
  logSearchEvent: jest.fn(async () => {}),
  configureClient: jest.fn(),
  getOfflineIndexManifest: jest.fn(async () => ({ bytes: 1 })),
  getRecommendationsV2: jest.fn(async () => ({ sections: [], filters_applied: {}, next_cursor: null, has_profile: true, catalog_run: 'r' })),
  getPreferences: jest.fn(async () => ({ genres: [], decades: [] })),
  listMyArtists: jest.fn(async () => ({ artists: [], total: 0, page: 1, per_page: 50, has_more: false })),
  listLovedSongs: jest.fn(async () => []),
  listHiddenSongs: jest.fn(async () => []),
  getQuizProgress: jest.fn(async () => null),
  listMusicServices: jest.fn(async () => []),
  getVoiceProfiles: jest.fn(async () => ({ profile: null, mic: null, latestSession: null })),
  getVoiceFlags: jest.fn(),
  adminVoiceSongs: jest.fn(),
  adminRecordingUrl: jest.fn((id: string) => `https://decide.test/api/admin/voice/recordings/${id}/audio`),
}));
jest.mock('@nomad/api-gen', () => ({
  ...jest.requireActual('@nomad/api-gen'),
  getMe: jest.fn(),
}));
// The player useAudioPlayer returns (the same object every render, like expo-audio's shared object).
const mockPlayer: { current: unknown } = { current: null };
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer.current,
  // The route table loads the voice session's recorder options (aacSink) at import.
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  AudioQuality: { MEDIUM: 64 },
}));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    delete = jest.fn();
    rename = jest.fn((name: string) => {
      this.uri = `${this.uri.slice(0, this.uri.lastIndexOf('/') + 1)}${name}`;
    });
    head = new Uint8Array(12);
    open = () => ({ readBytes: () => this.head, close: jest.fn() });
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    static downloadFileAsync = jest.fn();
  }
  class Directory {
    uri: string;
    exists = true;
    create = jest.fn();
    delete = jest.fn();
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///cache' } } };
});

const m = (f: unknown) => f as jest.Mock;
const flags = (is_admin: boolean) => ({ session_enabled: true, is_admin, voice_data: true, active_session_id: null });

const SONGS = [
  {
    song_key: 'alpha band|invented song',
    artist: 'Alpha Band',
    title: 'Invented Song',
    markers: {
      low: 45,
      high: 69,
      p10: 50,
      p50: 57,
      p90: 64,
      octave_split_male: true,
      octave_split_female: false,
      sustained_high_count: 3,
      syllables_per_s: 4.2,
      intro_s: 12.5,
    },
    label: { good: 'maybe', tags: ['too_high'], notes: 'chorus is a stretch' },
    attempts: [
      {
        session_id: 's1',
        at: '2026-10-22T19:00:00Z',
        quiz: { feel: 'loved', position: 'too_high', difficulty: 'hard' },
        context: { posture: 'standing', warmth: 'warm' },
        pitch: { p10: 50, p90: 64 },
        recording_id: 'rec-1',
      },
      { session_id: 's1', at: '2026-10-22T19:10:00Z', quiz: { feel: 'fine', position: 'comfortable' }, context: null, pitch: null, recording_id: null },
    ],
    prediction: { good: false, p: 0.31 },
  },
  {
    song_key: 'beta|none',
    artist: 'Beta Group',
    title: 'Unmeasured',
    markers: null,
    label: null,
    attempts: [{ session_id: 's2', at: '2026-10-22T20:00:00Z', quiz: null, context: null, pitch: null, recording_id: 'rec-2' }],
    prediction: null,
  },
];

const open = (url: string) =>
  renderRouter({ ...appRoutes(), 'review/[id]': () => <View testID="review-stub" /> }, { initialUrl: url });
const signIn = () => act(() => useAuth.getState().signInWithSession(session()));

type Player = { replace: jest.Mock; play: jest.Mock; pause: jest.Mock; remove: jest.Mock; addListener: jest.Mock };
let player: Player;
let finish: (() => void) | null;
let deleted: jest.Mock;
let head: Uint8Array;
type Take = { uri: string; delete: jest.Mock; head: Uint8Array };
let downloads: Take[];
let destinations: string[];
const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(12 - b.length).fill(0)]);
const WAV = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map((c) => c.charCodeAt(0))));
const M4A = Uint8Array.from([0, 0, 0, 24, ...[...'ftyp'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);

beforeEach(async () => {
  jest.clearAllMocks();
  await useAuth.getState().signOut();
  gen.getMe.mockResolvedValue({ email: 'me@example.com', credits: 3 } as never);
  m(decide.getVoiceFlags).mockResolvedValue(flags(true));
  m(decide.adminVoiceSongs).mockResolvedValue(SONGS);
  finish = null;
  player = {
    replace: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn((_: string, cb: (s: { didJustFinish: boolean }) => void) => {
      finish = () => cb({ didJustFinish: true });
      return { remove: jest.fn() };
    }),
  };
  mockPlayer.current = player;
  deleted = jest.fn();
  head = M4A;
  downloads = [];
  destinations = [];
  m(File.downloadFileAsync).mockImplementation(async (_url: string, dest: File) => {
    const f = dest as unknown as Take;
    f.delete = deleted;
    f.head = head;
    destinations.push((dest as unknown as { uri: string }).uri);
    downloads.push(f);
    return f;
  });
});

describe('voiceDebug', () => {
  it('lists each song with its markers, label, attempts and prediction', async () => {
    await signIn();
    open('/me/voice-debug');
    expect(await screen.findByTestId('vs-debug')).toBeTruthy();
    await waitFor(() => expect(decide.adminVoiceSongs).toHaveBeenCalledWith('me@example.com'));
    expect(await screen.findByText(new RegExp(isolate('Alpha Band')))).toBeTruthy();
    // Note names (isolated), P10-P90, octave split, sustained highs, density, intro.
    expect(screen.getByTestId('vs-debug-markers-0')).toHaveTextContent(new RegExp(isolate('A2–A4')));
    expect(screen.getByTestId('vs-debug-markers-0')).toHaveTextContent(new RegExp(isolate('D3–E4')));
    expect(screen.getByTestId('vs-debug-markers-0')).toHaveTextContent(/4\.2/);
    expect(screen.getByTestId('vs-debug-markers-0')).toHaveTextContent(/12\.5/);
    expect(screen.getByTestId('vs-debug-label-0')).toHaveTextContent(/maybe/i);
    expect(screen.getByTestId('vs-debug-label-0')).toHaveTextContent(/too_high/);
    expect(screen.getByTestId('vs-debug-attempt-0-1')).toHaveTextContent(/loved/);
    expect(screen.getByTestId('vs-debug-attempt-0-1')).toHaveTextContent(/too_high/);
    expect(screen.getByTestId('vs-debug-attempt-0-1')).toHaveTextContent(/standing/);
    expect(screen.getByTestId('vs-debug-prediction-0')).toHaveTextContent(/0\.31/);
    // A song with no measurement or label says so; only the attempt with a recording has a play button.
    expect(screen.getByTestId('vs-debug-markers-1')).toBeTruthy();
    expect(screen.getByTestId('vs-debug-play-0-1')).toBeTruthy();
    expect(screen.getByTestId('vs-debug-play-1-1')).toBeTruthy();
    expect(screen.queryByTestId('vs-debug-play-0-2')).toBeNull();
  });

  it('shows the Me row only for admins', async () => {
    await signIn();
    open('/me/music-profile');
    expect(await screen.findByTestId('vs-debug-open')).toBeTruthy();
  });

  it('hides the Me row for non-admins', async () => {
    m(decide.getVoiceFlags).mockResolvedValue(flags(false));
    await signIn();
    open('/me/music-profile');
    await screen.findByTestId('profile-screen');
    await waitFor(() => expect(decide.getVoiceFlags).toHaveBeenCalled());
    expect(screen.queryByTestId('vs-debug-open')).toBeNull();
  });

  it('play downloads with the decide bearer header, then plays; the temp file goes when playback ends', async () => {
    await signIn();
    open('/me/voice-debug');
    fireEvent.press(await screen.findByTestId('vs-debug-play-0-1'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    const [url, , opts] = m(File.downloadFileAsync).mock.calls[0] as [string, unknown, { headers: unknown }];
    expect(url).toBe('https://decide.test/api/admin/voice/recordings/rec-1/audio');
    expect(destinations[0]).toBe('file:///cache/voice-debug/rec-1.bin');
    expect(opts.headers).toEqual({ Authorization: `Bearer ${useAuth.getState().getToken()}` });
    expect(downloads[0]!.uri).toBe('file:///cache/voice-debug/rec-1.m4a');
    expect(player.replace).toHaveBeenCalledWith('file:///cache/voice-debug/rec-1.m4a');
    expect(deleted).not.toHaveBeenCalled();
    act(() => finish?.());
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it('names a WAV take .wav (RIFF/WAVE magic bytes)', async () => {
    head = WAV;
    await signIn();
    open('/me/voice-debug');
    fireEvent.press(await screen.findByTestId('vs-debug-play-0-1'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(player.replace).toHaveBeenCalledWith('file:///cache/voice-debug/rec-1.wav');
  });

  it('falls back to .m4a for anything else', async () => {
    head = bytes(1, 2, 3);
    await signIn();
    open('/me/voice-debug');
    fireEvent.press(await screen.findByTestId('vs-debug-play-0-1'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(player.replace).toHaveBeenCalledWith('file:///cache/voice-debug/rec-1.m4a');
  });

  it('a stale download neither replaces nor deletes the newer take', async () => {
    const slow: { release: () => void } = { release: () => {} };
    m(File.downloadFileAsync).mockImplementationOnce(async (_u: string, dest: File) => {
      const f = dest as unknown as Take;
      f.delete = jest.fn();
      f.head = M4A;
      downloads.push(f);
      await new Promise<void>((r) => (slow.release = r));
      return f;
    });
    await signIn();
    open('/me/voice-debug');
    fireEvent.press(await screen.findByTestId('vs-debug-play-0-1'));
    await waitFor(() => expect(downloads).toHaveLength(1));
    fireEvent.press(await screen.findByTestId('vs-debug-play-1-1'));
    await waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    expect(player.replace).toHaveBeenLastCalledWith('file:///cache/voice-debug/rec-2.m4a');
    await act(async () => slow.release());
    // The stale rec-1 download removed itself only; rec-2 (newer take) is still current and its file kept.
    expect(deleted).not.toHaveBeenCalled();
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(downloads[0]!.delete).toHaveBeenCalledTimes(1);
  });

  it('a non-admin opening the screen never asks for the admin songs', async () => {
    m(decide.getVoiceFlags).mockResolvedValue(flags(false));
    await signIn();
    open('/me/voice-debug');
    expect(await screen.findByTestId('vs-debug-unavailable')).toBeTruthy();
    expect(decide.adminVoiceSongs).not.toHaveBeenCalled();
  });

  it('deletes the temp file when the screen unmounts mid-playback', async () => {
    await signIn();
    const view = open('/me/voice-debug');
    fireEvent.press(await screen.findByTestId('vs-debug-play-0-1'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    view.unmount();
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it('says so when the download fails', async () => {
    m(File.downloadFileAsync).mockRejectedValue(new Error('403'));
    await signIn();
    open('/me/voice-debug');
    fireEvent.press(await screen.findByTestId('vs-debug-play-0-1'));
    expect(await screen.findByTestId('vs-debug-play-error')).toBeTruthy();
    expect(player.play).not.toHaveBeenCalled();
  });
});
