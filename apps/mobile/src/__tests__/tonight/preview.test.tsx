import * as kjbox from '@nomad/api-kjbox';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import { useAuth } from '../../auth/store';
import { appStorage } from '../../storage';
import { useNightStore, type NomadNight } from '../../tonight/nightStore';
import { NightScreen } from '../../tonight/nomad/NightScreen';
import { nightPoll } from '../../tonight/nomad/queries';
import { versionPreview } from '../../tonight/preview/PreviewSheet';
import { usePreviewStore } from '../../tonight/preview/previewStore';
import { at, entry, iso, me, nightOpen, nowResult, renderTonight, rotationResult, song } from '../../test-utils/tonightFixtures';
import { deferred, group, kn, local } from './request/helpers';

type Listener = (e: Record<string, unknown>) => void;
const mockVideo = {
  playing: false,
  play: jest.fn(() => {
    mockVideo.playing = true;
  }),
  pause: jest.fn(),
  duration: 0,
  timeUpdateEventInterval: 0,
  listeners: new Map<string, Listener[]>(),
  addListener: jest.fn((name: string, l: Listener) => {
    mockVideo.listeners.set(name, [...(mockVideo.listeners.get(name) ?? []), l]);
    return { remove: () => mockVideo.listeners.set(name, (mockVideo.listeners.get(name) ?? []).filter((x) => x !== l)) };
  }),
};
const mockUseVideoPlayer = jest.fn();
jest.mock('expo-video', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    useVideoPlayer: (source: unknown, setup?: (p: unknown) => void) => {
      mockUseVideoPlayer(source);
      setup?.(mockVideo);
      return mockVideo;
    },
    VideoView: (props: Record<string, unknown>) => createElement(View, props),
  };
});
const videoEvent = (name: string, payload: Record<string, unknown>) =>
  act(() => (mockVideo.listeners.get(name) ?? []).forEach((l) => l(payload)));

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
  previewResolve: jest.fn(),
  previewClose: jest.fn(async () => ({ api_version: '1.0', ok: true })),
}));
const api = kjbox as jest.Mocked<typeof kjbox>;
const NIGHT = 'aaaaaaaaaaaaaaaa';
const result = (over: Partial<kjbox.PreviewResult>): kjbox.PreviewResult => ({ api_version: '1.0', mode: 'unavailable', title: 'T', ...over });

const emit = (s: AppStateStatus) =>
  act(() =>
    (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([type]) => type === 'change')
      .forEach(([, fn]) => (fn as (x: AppStateStatus) => void)(s)),
  );

let night: NomadNight;
beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  appStorage.clearAll();
  usePreviewStore.setState({ current: null });
  mockVideo.listeners = new Map();
  mockVideo.duration = 0;
  mockVideo.playing = false;
  Object.assign(nightPoll, { meMs: 60_000, nowMs: 60_000, rotationMs: 60_000, nightMs: 60_000 });
  useAuth.setState({ state: { status: 'signedIn', session: { token: 't', email: 'sam@example.com', createdAt: 0 } } });
  useNightStore.getState().rehydrate('sam@example.com');
  useNightStore.getState().joinNomad('2121', NIGHT, 'Sam');
  night = useNightStore.getState().current() as NomadNight;
  api.getMe.mockResolvedValue(
    me({
      songs: [
        song({ previewable: true, request: { id: 7, song_title: 'Starlight', linked_entry_id: 507 }, estimate: at(4) }),
        song({ quick: 'ready', make: 'rendering', request: { id: 8, song_title: 'Uprising', linked_entry_id: 508, source_type: 'make' }, estimate: at(6) }),
      ],
    }),
  );
  api.getNow.mockResolvedValue(nowResult());
  api.getRotation.mockResolvedValue({ etag: '"1"', data: rotationResult([entry(1, { previewable: true })]) });
  api.getNight.mockResolvedValue(nightOpen({ night_id: NIGHT }));
});

const show = (focused = true) => renderTonight(<NightScreen night={night} focused={focused} />);
const tapPreview = async (id = 'tonight-song-preview-r7') => {
  const button = await screen.findByTestId(id);
  // The resolve settles inside act, so the sheet's update is wrapped.
  await act(async () => fireEvent.press(button));
};

it('cdg falls back to web: "Preview on the web" opens the singer page for this code', async () => {
  api.previewResolve.mockResolvedValue(result({ mode: 'cdg', token: 'k1', cdg_audio_url: 'https://x/a', cdg_graphics_url: 'https://x/g' }));
  show();
  await tapPreview();
  expect(api.previewResolve).toHaveBeenCalledWith('2121', 'entry', 507, NIGHT, undefined);
  fireEvent.press(await screen.findByTestId('tonight-preview-web'));
  expect(Linking.openURL).toHaveBeenCalledWith('https://sing.nomadkaraoke.com/?t=2121');
  expect(mockUseVideoPlayer).not.toHaveBeenCalled();
});

it('native video plays in the sheet with play/pause and progress; Close releases the token', async () => {
  api.previewResolve.mockResolvedValue(result({ mode: 'native_video', token: 'k1', stream_url: 'https://sing/preview/stream/k1?t=2121' }));
  show();
  await tapPreview();
  expect(await screen.findByTestId('tonight-preview-video')).toBeTruthy();
  expect(screen.getByTestId('tonight-preview-song')).toHaveTextContent(iso('Starlight'));
  expect(mockUseVideoPlayer).toHaveBeenCalledWith({ uri: 'https://sing/preview/stream/k1?t=2121', contentType: 'auto' });
  expect(mockVideo.play).toHaveBeenCalled();
  // No playingChange yet: the first tap must still pause (the state is seeded from player.playing).
  fireEvent.press(screen.getByTestId('tonight-preview-toggle'));
  expect(mockVideo.pause).toHaveBeenCalledTimes(1);
  mockVideo.pause.mockClear();
  mockVideo.duration = 100;
  videoEvent('timeUpdate', { currentTime: 25 });
  expect(screen.getByTestId('tonight-preview-progress').props.accessibilityValue).toMatchObject({ now: 25 });
  fireEvent.press(screen.getByTestId('tonight-preview-toggle'));
  expect(mockVideo.pause).toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('tonight-preview-done'));
  await waitFor(() => expect(screen.queryByTestId('tonight-preview-video') === null).toBe(true));
  expect(api.previewClose).toHaveBeenCalledWith('2121', 'k1', NIGHT);
});

it('hls uses the hls content type', async () => {
  api.previewResolve.mockResolvedValue(result({ mode: 'hls', token: 'k1', hls_url: 'https://sing/preview/hls/k1/index.m3u8?t=2121' }));
  show();
  await tapPreview();
  expect(await screen.findByTestId('tonight-preview-video')).toBeTruthy();
  expect(mockUseVideoPlayer).toHaveBeenCalledWith({ uri: 'https://sing/preview/hls/k1/index.m3u8?t=2121', contentType: 'hls' });
});

it('a preview sets the audio session to play in silent mode before playing (ruling E10-R6)', async () => {
  api.previewResolve.mockResolvedValue(result({ mode: 'native_audio', token: 'k1', stream_url: 'https://s/a' }));
  show();
  await tapPreview();
  expect(await screen.findByTestId('tonight-preview-audio')).toBeTruthy();
  expect(setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }));
  const modeAt = (setAudioModeAsync as jest.Mock).mock.invocationCallOrder[0]!;
  const createdAt = (createAudioPlayer as jest.Mock).mock.invocationCallOrder.at(-1)!;
  expect(modeAt).toBeLessThan(createdAt);
});

it('native audio plays through expo-audio with a simple visual', async () => {
  api.previewResolve.mockResolvedValue(result({ mode: 'native_audio', token: 'k1', stream_url: 'https://sing/preview/stream/k1?t=2121' }));
  show();
  await tapPreview();
  expect(await screen.findByTestId('tonight-preview-audio')).toBeTruthy();
  expect(createAudioPlayer).toHaveBeenCalledWith({ uri: 'https://sing/preview/stream/k1?t=2121' }, expect.anything());
  const player = (createAudioPlayer as jest.Mock).mock.results.at(-1)!.value;
  expect(player.play).toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('tonight-preview-done'));
  await waitFor(() => expect(player.remove).toHaveBeenCalled());
});

it.each([
  ['mode unavailable', () => api.previewResolve.mockResolvedValue(result({ mode: 'unavailable', reason: 'Not ready' }))],
  ['an error', () => api.previewResolve.mockRejectedValue(new kjbox.KjboxError('rate_limited', 429, 30, {}))],
])('%s shows "Preview isn\'t available right now" (ruling E10-R2)', async (_name, arrange) => {
  arrange();
  show();
  await tapPreview();
  expect(await screen.findByTestId('tonight-preview-unavailable')).toHaveTextContent("Preview isn't available right now");
});

it('a playback error shows the same message instead of crashing', async () => {
  api.previewResolve.mockResolvedValue(result({ mode: 'native_video', token: 'k1', stream_url: 'https://s/1' }));
  show();
  await tapPreview();
  expect(await screen.findByTestId('tonight-preview-video')).toBeTruthy();
  videoEvent('statusChange', { status: 'error', error: { message: 'boom' } });
  expect(await screen.findByTestId('tonight-preview-unavailable')).toBeTruthy();
});

it('quick version ▶ previews entry_quick; rotation ▶ previews the entry', async () => {
  api.previewResolve.mockResolvedValue(result({ mode: 'unavailable' }));
  show();
  await tapPreview('tonight-song-quick-preview-r8');
  await waitFor(() => expect(api.previewResolve).toHaveBeenCalledWith('2121', 'entry_quick', 508, NIGHT, undefined));
  fireEvent.press(screen.getByTestId('tonight-preview-done'));
  await tapPreview('tonight-rotation-preview-501');
  await waitFor(() => expect(api.previewResolve).toHaveBeenLastCalledWith('2121', 'entry', 501, NIGHT, undefined));
});

describe('one preview at a time (ruling E10-R1)', () => {
  it('starting another stops the first and closes it on the box', async () => {
    api.previewResolve
      .mockResolvedValueOnce(result({ mode: 'native_video', token: 'k1', stream_url: 'https://s/1' }))
      .mockResolvedValueOnce(result({ mode: 'native_video', token: 'k2', stream_url: 'https://s/2' }));
    show();
    await tapPreview();
    expect(await screen.findByTestId('tonight-preview-video')).toBeTruthy();
    await act(() => usePreviewStore.getState().open('2121', NIGHT, { owner: 'night', title: 'Other', source: 'entry', entryId: 9 }));
    expect(api.previewClose).toHaveBeenCalledWith('2121', 'k1', NIGHT);
    expect(usePreviewStore.getState().current?.result?.token).toBe('k2');
  });

  it('a preview closed while resolving gives its token back', async () => {
    const slow = deferred<kjbox.PreviewResult>();
    api.previewResolve.mockReturnValue(slow.promise);
    const opening = usePreviewStore.getState().open('2121', NIGHT, { owner: 'night', title: 'X', source: 'entry', entryId: 1 });
    usePreviewStore.getState().close();
    slow.resolve(result({ mode: 'native_video', token: 'late', stream_url: 'https://s/1' }));
    await opening;
    expect(usePreviewStore.getState().current).toBeNull();
    expect(api.previewClose).toHaveBeenCalledWith('2121', 'late', NIGHT);
  });

  it('leaving the screen, backgrounding or unmounting stops and closes it', async () => {
    api.previewResolve.mockResolvedValue(result({ mode: 'native_video', token: 'k1', stream_url: 'https://s/1' }));
    const view = show();
    await tapPreview();
    expect(await screen.findByTestId('tonight-preview-video')).toBeTruthy();
    view.rerender(<NightScreen night={night} focused={false} />);
    await waitFor(() => expect(usePreviewStore.getState().current === null).toBe(true));
    expect(api.previewClose).toHaveBeenCalledTimes(1);

    view.rerender(<NightScreen night={night} focused />);
    await tapPreview();
    await waitFor(() => expect(usePreviewStore.getState().current?.status).toBe('ready'));
    emit('background');
    expect(usePreviewStore.getState().current).toBeNull();
    expect(api.previewClose).toHaveBeenCalledTimes(2);

    await tapPreview();
    await waitFor(() => expect(usePreviewStore.getState().current?.status).toBe('ready'));
    view.unmount();
    expect(usePreviewStore.getState().current).toBeNull();
    expect(api.previewClose).toHaveBeenCalledTimes(3);
  });

  it("another screen's preview never shows in this one", async () => {
    api.previewResolve.mockResolvedValue(result({ mode: 'native_video', token: 'k1', stream_url: 'https://s/1' }));
    show();
    expect(await screen.findByTestId('tonight-status-tile')).toBeTruthy();
    await act(() => usePreviewStore.getState().open('2121', NIGHT, { owner: 'search', title: 'X', source: 'entry', entryId: 1 }));
    expect(screen.queryByTestId('tonight-preview-video')).toBeNull();
  });
});

describe('versionPreview (the web descriptor)', () => {
  const g = group('Starlight');
  it('local, divebar and youtube', () => {
    expect(versionPreview(g, local('/lib/s.mp4'))).toEqual({ source: 'local', extra: { file_path: '/lib/s.mp4', title: 'Starlight — Muse' } });
    expect(versionPreview(g, kn(1, { divebar: { file_id: 'f9', format: 'mp4' } }))).toEqual({
      source: 'divebar',
      extra: { file_id: 'f9', format: 'mp4', title: 'Starlight — Muse' },
    });
    expect(versionPreview(g, kn(2))).toEqual({ source: 'youtube', extra: { youtube_url: 'https://youtu.be/2', title: 'Starlight — Muse' } });
  });
});
