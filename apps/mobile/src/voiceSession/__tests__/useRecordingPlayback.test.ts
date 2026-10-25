// The shared private-recording player (debug screen, Me's recordings, later the quiz catch-up): download with the
// decide bearer, or a local take as-is; optional segment (fromS / toS); temp files never outlive their playback.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { File } from 'expo-file-system';

import { useRecordingPlayback } from '../recording/useRecordingPlayback';

jest.mock('../../auth/store', () => ({ useAuth: { getState: () => ({ getToken: () => 'tok' }) } }));

type Status = { didJustFinish?: boolean; currentTime?: number };
const mockPlayer: { current: unknown } = { current: null };
jest.mock('expo-audio', () => ({ useAudioPlayer: () => mockPlayer.current }));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    delete = jest.fn();
    rename = jest.fn((name: string) => {
      this.uri = `${this.uri.slice(0, this.uri.lastIndexOf('/') + 1)}${name}`;
    });
    open = () => ({ readBytes: () => new Uint8Array(12), close: jest.fn() });
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
let player: { replace: jest.Mock; play: jest.Mock; pause: jest.Mock; seekTo: jest.Mock; addListener: jest.Mock };
let emit: (s: Status) => void;
let files: { uri: string; delete: jest.Mock }[];
const urlFor = (id: string) => `https://decide.test/api/voice/recordings/${encodeURIComponent(id)}/audio`;

beforeEach(() => {
  jest.clearAllMocks();
  emit = () => {};
  player = {
    replace: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => {}),
    addListener: jest.fn((_: string, cb: (s: Status) => void) => {
      emit = (s) => cb({ didJustFinish: false, currentTime: 0, ...s });
      return { remove: jest.fn() };
    }),
  };
  mockPlayer.current = player;
  files = [];
  m(File.downloadFileAsync).mockImplementation(async (_url: string, dest: { uri: string; delete: jest.Mock }) => {
    files.push(dest);
    return dest;
  });
});

describe('useRecordingPlayback', () => {
  it('downloads with bearer then plays', async () => {
    const { result } = renderHook(() => useRecordingPlayback(urlFor));
    await act(async () => result.current.play('s1:2'));
    const [url, , opts] = m(File.downloadFileAsync).mock.calls[0] as [string, unknown, { headers: unknown }];
    expect(url).toBe('https://decide.test/api/voice/recordings/s1%3A2/audio');
    // The file name never carries the raw id (":" is not safe in every file system); renamed after sniffing.
    expect(files[0]!.uri).toBe('file:///cache/voice-playback/s1_2.m4a');
    expect(opts.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(player.replace).toHaveBeenCalledWith(expect.stringMatching(/\.m4a$/));
    expect(player.play).toHaveBeenCalled();
    expect(result.current.state).toEqual({ key: 's1:2', status: 'playing' });
  });

  it('localUri skips download', async () => {
    const { result } = renderHook(() => useRecordingPlayback(urlFor));
    await act(async () => result.current.play('take', { localUri: 'file:///docs/take.m4a' }));
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
    expect(player.replace).toHaveBeenCalledWith('file:///docs/take.m4a');
    expect(player.play).toHaveBeenCalled();
    // The phone's own take is never deleted by the player.
    act(() => emit({ didJustFinish: true }));
    await act(async () => result.current.play('other', { localUri: 'file:///docs/other.m4a' }));
    expect(result.current.state.status).toBe('playing');
  });

  it('seeks to fromS and stops at toS', async () => {
    const { result } = renderHook(() => useRecordingPlayback(urlFor));
    await act(async () => result.current.play('take', { localUri: 'file:///docs/take.m4a', fromS: 12.5, toS: 15, key: 'q-0' }));
    expect(player.seekTo).toHaveBeenCalledWith(12.5);
    expect(result.current.state).toEqual({ key: 'q-0', status: 'playing' });
    player.pause.mockClear();
    act(() => emit({ currentTime: 14.2 }));
    expect(player.pause).not.toHaveBeenCalled();
    act(() => emit({ currentTime: 15.1 }));
    expect(player.pause).toHaveBeenCalled();
    expect(result.current.state).toEqual({ key: null, status: 'idle' });
  });

  it('a negative fromS starts at 0', async () => {
    const { result } = renderHook(() => useRecordingPlayback(urlFor));
    await act(async () => result.current.play('take', { localUri: 'file:///docs/take.m4a', fromS: -0.4 }));
    expect(player.seekTo).toHaveBeenCalledWith(0);
  });

  it('deletes temp file on next play/unmount', async () => {
    const { result, unmount } = renderHook(() => useRecordingPlayback(urlFor));
    await act(async () => result.current.play('r1'));
    expect(files[0]!.delete).not.toHaveBeenCalled();
    await act(async () => result.current.play('r2'));
    expect(files[0]!.delete).toHaveBeenCalledTimes(1);
    act(() => emit({ didJustFinish: true }));
    expect(files[1]!.delete).toHaveBeenCalledTimes(1);
    await act(async () => result.current.play('r3'));
    unmount();
    expect(files[2]!.delete).toHaveBeenCalledTimes(1);
  });

  it('stop pauses, deletes the temp file and goes idle', async () => {
    const { result } = renderHook(() => useRecordingPlayback(urlFor));
    await act(async () => result.current.play('r1'));
    act(() => result.current.stop());
    expect(player.pause).toHaveBeenCalled();
    expect(files[0]!.delete).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ key: null, status: 'idle' });
  });

  it('a failed download says so for that key', async () => {
    m(File.downloadFileAsync).mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useRecordingPlayback(urlFor));
    await act(async () => result.current.play('r1'));
    await waitFor(() => expect(result.current.state).toEqual({ key: 'r1', status: 'failed' }));
    expect(player.play).not.toHaveBeenCalled();
  });

  it('dirName keeps a caller\'s temp files apart', async () => {
    const { result } = renderHook(() => useRecordingPlayback(urlFor, { dirName: 'voice-debug' }));
    await act(async () => result.current.play('rec-1'));
    expect(files[0]!.uri).toMatch(/^file:\/\/\/cache\/voice-debug\//);
  });
});
